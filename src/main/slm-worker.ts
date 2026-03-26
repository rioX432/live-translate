/**
 * UtilityProcess worker for SLM inference via node-llama-cpp.
 * Supports TranslateGemma and Hunyuan-MT models.
 * Runs in a separate process to avoid blocking the main process.
 *
 * IPC protocol:
 *   Main → Worker: { type: 'init', modelPath: string, kvCacheQuant?: boolean, modelType?: 'translategemma' | 'hunyuan-mt', draftModelPath?: string }
 *   Main → Worker: { type: 'translate', id: string, text: string, from: string, to: string }
 *   Main → Worker: { type: 'translate-incremental', id: string, text: string, previousOutput: string, from: string, to: string }
 *   Main → Worker: { type: 'summarize', id: string, transcript: string }
 *   Main → Worker: { type: 'dispose' }
 *   Worker → Main: { type: 'ready' }
 *   Worker → Main: { type: 'result', id: string, text: string }
 *   Worker → Main: { type: 'error', id?: string, message: string }
 */

import type { Llama, LlamaModel, LlamaContext, LlamaContextSequence } from 'node-llama-cpp'
import { LANG_NAMES_EN, LANG_NAMES_ZH } from '../engines/language-names'
import { createLogger } from './logger'

const log = createLogger('slm-worker')

type ModelType = 'translategemma' | 'hunyuan-mt' | 'hunyuan-mt-15' | 'gemma2-jpn' | 'alma-ja'

/** Messages sent from main process to this worker */
type WorkerInboundMessage =
  | { type: 'init'; modelPath: string; kvCacheQuant?: boolean; modelType?: ModelType; draftModelPath?: string }
  | { type: 'translate'; id: string; text: string; from: string; to: string; context?: TranslateContextPayload }
  | { type: 'translate-incremental'; id: string; text: string; previousOutput: string; from: string; to: string; context?: TranslateContextPayload }
  | { type: 'summarize'; id: string; transcript: string }
  | { type: 'dispose' }

interface TranslateContextPayload {
  previousSegments?: Array<{ source: string; translated: string; speakerId?: string }>
  glossary?: Array<{ source: string; target: string }>
  speakerId?: string
}

/** Context size for translation (short segments) */
const TRANSLATION_CONTEXT_SIZE = 2048

/** Inference parameters for summarization tasks */
const SUMMARIZATION_PARAMS = {
  temperature: 0.3,
  maxTokens: 1024
} as const

let llama: Llama | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let draftModel: LlamaModel | null = null
let draftContext: LlamaContext | null = null
let speculativeEnabled = false
let requestQueue: Promise<void> = Promise.resolve()
let activeModelType: ModelType = 'translategemma'

async function handleInit(
  modelPath: string,
  kvCacheQuant?: boolean,
  modelType?: ModelType,
  draftModelPath?: string
): Promise<void> {
  activeModelType = modelType ?? 'translategemma'
  const { getLlama } = await import('node-llama-cpp')
  log.info('Getting llama instance...')
  llama = await getLlama({ gpu: 'auto' })
  log.info('Loading model:', modelPath)
  model = await llama.loadModel({ modelPath })
  log.info('Model loaded, creating context...')

  const contextOptions: Record<string, unknown> = {
    contextSize: TRANSLATION_CONTEXT_SIZE
  }
  if (kvCacheQuant) {
    contextOptions.experimentalKvCacheKeyType = 'Q8_0'
    contextOptions.experimentalKvCacheValueType = 'Q8_0'
  }
  try {
    context = await model.createContext(contextOptions)
    log.info('Context created successfully')
  } catch (err) {
    log.error('createContext failed:', err)
    // Retry without KV cache quantization
    if (kvCacheQuant) {
      log.info('Retrying without KV cache quantization...')
      context = await model.createContext({ contextSize: TRANSLATION_CONTEXT_SIZE })
      log.info('Context created without KV cache quant')
    } else {
      throw err
    }
  }

  // Load draft model for speculative decoding if provided
  if (draftModelPath) {
    try {
      draftModel = await llama.loadModel({ modelPath: draftModelPath })
      const draftContextOptions: Record<string, unknown> = {}
      if (kvCacheQuant) {
        draftContextOptions.experimentalKvCacheKeyType = 'Q8_0'
        draftContextOptions.experimentalKvCacheValueType = 'Q8_0'
      }
      draftContext = await draftModel.createContext(draftContextOptions)
      speculativeEnabled = true
      log.info('Speculative decoding enabled with draft model')
    } catch (err) {
      log.error('Failed to load draft model, falling back to standard decoding:', err)
      draftModel = null
      draftContext = null
      speculativeEnabled = false
    }
  }

  process.parentPort!.postMessage({ type: 'ready' })
}

/** Build context sections for the translation prompt */
function buildContextPrompt(ctx?: {
  previousSegments?: Array<{ source: string; translated: string; speakerId?: string }>
  glossary?: Array<{ source: string; target: string }>
  speakerId?: string
}): string {
  if (!ctx) return ''

  const parts: string[] = []

  // Glossary terms
  if (ctx.glossary && ctx.glossary.length > 0) {
    const entries = ctx.glossary.map((g) => `  "${g.source}" → "${g.target}"`).join('\n')
    parts.push(`Use these fixed translations for specific terms:\n${entries}`)
  }

  // Previous segments for coherence
  if (ctx.previousSegments && ctx.previousSegments.length > 0) {
    const history = ctx.previousSegments
      .map((s) => {
        const speaker = s.speakerId ? ` [${s.speakerId}]` : ''
        return `  ${s.source}${speaker} → ${s.translated}`
      })
      .join('\n')
    parts.push(`Previous translations for context:\n${history}`)
  }

  // Speaker hint
  if (ctx.speakerId) {
    parts.push(`Current speaker: ${ctx.speakerId}. Maintain consistent style for this speaker.`)
  }

  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : ''
}

/** Build the translation prompt based on model type and language pair */
function buildTranslationPrompt(
  text: string,
  from: string,
  to: string,
  translateContext?: TranslateContextPayload
): string {
  const fromLang = LANG_NAMES_EN[from] ?? from
  const toLang = LANG_NAMES_EN[to] ?? to
  const contextSection = buildContextPrompt(translateContext)

  if (activeModelType === 'hunyuan-mt-15') {
    const isChinese = from === 'zh' || from === 'zh-Hant' || to === 'zh' || to === 'zh-Hant'
    if (isChinese) {
      const targetZh = LANG_NAMES_ZH[to] ?? to
      return `${contextSection}将以下文本翻译为${targetZh}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`
    }
    return `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
  }

  if (activeModelType === 'hunyuan-mt') {
    const isChinese = from === 'zh' || to === 'zh'
    if (isChinese && to !== 'zh') {
      return `${contextSection}把下面的文本翻译成${toLang}，不要额外解释。\n\n${text}`
    }
    if (isChinese && to === 'zh') {
      return `${contextSection}把下面的文本翻译成中文，不要额外解释。\n\n${text}`
    }
    return `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
  }

  // TranslateGemma, gemma2-jpn, alma-ja: simple translation prompt
  return `${contextSection}Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`
}

/** Get inference parameters based on model type */
function getInferenceParams(): { temperature: number; maxTokens: number; topK?: number; topP?: number; repeatPenalty?: { penalty: number } } {
  if (activeModelType === 'hunyuan-mt' || activeModelType === 'hunyuan-mt-15') {
    return { temperature: 0.7, maxTokens: 512, topK: 20, topP: 0.6, repeatPenalty: { penalty: 1.05 } }
  }
  return { temperature: 0.1, maxTokens: 512 }
}

/** Create a context sequence, optionally with speculative decoding */
async function createContextSequence(): Promise<LlamaContextSequence> {
  const { DraftSequenceTokenPredictor } = await import('node-llama-cpp')

  if (speculativeEnabled && draftContext) {
    const draftSequence = draftContext.getSequence()
    return context!.getSequence({
      tokenPredictor: new DraftSequenceTokenPredictor(draftSequence, {
        minTokens: 0,
        maxTokens: 16,
        minConfidence: 0.6
      })
    })
  }
  return context!.getSequence()
}

/** Run translation inference and return the result */
async function runInference(
  prompt: string,
  previousOutput?: string
): Promise<string> {
  const { LlamaChatSession } = await import('node-llama-cpp')

  const contextSequence = await createContextSequence()
  const session = new LlamaChatSession({ contextSequence })

  const inferenceParams = getInferenceParams()
  const response = await session.prompt(prompt, {
    ...inferenceParams,
    ...(previousOutput?.trim() && { responsePrefix: previousOutput })
  })

  // Log speculative decoding stats for debugging
  if (speculativeEnabled && contextSequence.tokenPredictions) {
    const stats = contextSequence.tokenPredictions
    const label = previousOutput !== undefined ? 'Incremental speculative' : 'Speculative'
    log.info(`${label} stats — validated: ${stats.validated}, refuted: ${stats.refuted}`)
  }

  // Clean up the session context to free memory
  contextSequence.dispose?.()
  session.dispose?.()

  return response.trim()
}

async function handleTranslate(
  id: string,
  text: string,
  from: string,
  to: string,
  translateContext?: TranslateContextPayload
): Promise<void> {
  if (!context) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: 'Model not initialized'
    })
    return
  }

  try {
    const prompt = buildTranslationPrompt(text, from, to, translateContext)
    const result = await runInference(prompt)

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: result
    })
  } catch (err) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

async function handleTranslateIncremental(
  id: string,
  text: string,
  previousOutput: string,
  from: string,
  to: string,
  translateContext?: TranslateContextPayload
): Promise<void> {
  if (!context) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: 'Model not initialized'
    })
    return
  }

  try {
    const prompt = buildTranslationPrompt(text, from, to, translateContext)
    const result = await runInference(prompt, previousOutput)

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: result
    })
  } catch (err) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

async function handleSummarize(id: string, transcript: string): Promise<void> {
  if (!context) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: 'Model not initialized'
    })
    return
  }

  try {
    const { LlamaChatSession } = await import('node-llama-cpp')
    const session = new LlamaChatSession({
      contextSequence: context.getSequence()
    })

    const prompt = `Summarize the following meeting transcript. Extract:
1. Key decisions made
2. Action items (who does what)
3. Main discussion topics

Be concise and use bullet points.

Transcript:
${transcript}`

    const response = await session.prompt(prompt, SUMMARIZATION_PARAMS)

    session.dispose?.()

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: response.trim()
    })
  } catch (err) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

async function handleDispose(): Promise<void> {
  try {
    if (draftContext) {
      await draftContext.dispose()
      draftContext = null
    }
    if (draftModel) {
      await draftModel.dispose()
      draftModel = null
    }
    speculativeEnabled = false
    if (context) {
      await context.dispose()
      context = null
    }
    if (model) {
      await model.dispose()
      model = null
    }
    if (llama) {
      await llama.dispose()
      llama = null
    }
  } finally {
    process.parentPort!.postMessage({ type: 'disposed' })
  }
}

// Listen for messages from main process
// Serialize translate/summarize requests to prevent concurrent context access
process.parentPort!.on('message', (e: { data: WorkerInboundMessage }) => {
  const msg = e.data

  const handleMessage = async (): Promise<void> => {
    try {
      switch (msg.type) {
        case 'init':
          await handleInit(msg.modelPath, msg.kvCacheQuant, msg.modelType, msg.draftModelPath)
          break
        case 'translate':
          await handleTranslate(msg.id, msg.text, msg.from, msg.to, msg.context)
          break
        case 'translate-incremental':
          await handleTranslateIncremental(msg.id, msg.text, msg.previousOutput, msg.from, msg.to, msg.context)
          break
        case 'summarize':
          await handleSummarize(msg.id, msg.transcript)
          break
        case 'dispose':
          await handleDispose()
          break
      }
    } catch (err) {
      process.parentPort!.postMessage({
        type: 'error',
        id: 'id' in msg ? msg.id : undefined,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (msg.type === 'translate' || msg.type === 'translate-incremental' || msg.type === 'summarize') {
    // Queue to serialize context access
    requestQueue = requestQueue.then(handleMessage, handleMessage)
  } else {
    handleMessage()
  }
})
