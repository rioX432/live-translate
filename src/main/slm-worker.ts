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

import { LANG_NAMES_EN, LANG_NAMES_ZH } from '../engines/language-names'

type ModelType = 'translategemma' | 'hunyuan-mt' | 'hunyuan-mt-15'

let llama: any = null
let model: any = null
let context: any = null
let draftModel: any = null
let draftContext: any = null
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
  console.log('[slm-worker] Getting llama instance...')
  llama = await getLlama({ gpu: 'auto' })
  console.log('[slm-worker] Loading model:', modelPath)
  model = await llama.loadModel({ modelPath })
  console.log('[slm-worker] Model loaded, creating context...')

  const contextOptions: Record<string, unknown> = {
    contextSize: 2048 // Limit context size for translation (short segments)
  }
  if (kvCacheQuant) {
    contextOptions.experimentalKvCacheKeyType = 'Q8_0'
    contextOptions.experimentalKvCacheValueType = 'Q8_0'
  }
  try {
    context = await model.createContext(contextOptions)
    console.log('[slm-worker] Context created successfully')
  } catch (err) {
    console.error('[slm-worker] createContext failed:', err)
    // Retry without KV cache quantization
    if (kvCacheQuant) {
      console.log('[slm-worker] Retrying without KV cache quantization...')
      context = await model.createContext({ contextSize: 2048 })
      console.log('[slm-worker] Context created without KV cache quant')
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
      console.log('[slm-worker] Speculative decoding enabled with draft model')
    } catch (err) {
      console.error('[slm-worker] Failed to load draft model, falling back to standard decoding:', err)
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

async function handleTranslate(
  id: string,
  text: string,
  from: string,
  to: string,
  translateContext?: {
    previousSegments?: Array<{ source: string; translated: string; speakerId?: string }>
    glossary?: Array<{ source: string; target: string }>
    speakerId?: string
  }
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
    const { LlamaChatSession, DraftSequenceTokenPredictor } = await import('node-llama-cpp')

    // Create context sequence, optionally with speculative decoding
    let contextSequence: any
    if (speculativeEnabled && draftContext) {
      const draftSequence = draftContext.getSequence()
      contextSequence = context.getSequence({
        tokenPredictor: new DraftSequenceTokenPredictor(draftSequence, {
          minTokens: 0,
          maxTokens: 16,
          minConfidence: 0.6
        })
      })
    } else {
      contextSequence = context.getSequence()
    }

    const session = new LlamaChatSession({ contextSequence })

    const fromLang = LANG_NAMES_EN[from] ?? from
    const toLang = LANG_NAMES_EN[to] ?? to

    // Build prompt based on model type
    let prompt: string
    let inferenceParams: { temperature: number; maxTokens: number; topK?: number; topP?: number; repeatPenalty?: { penalty: number } }

    if (activeModelType === 'hunyuan-mt-15') {
      // HY-MT1.5 uses the official Tencent prompt template:
      // Chinese ↔ Other: Chinese prompt; Other ↔ Other: English prompt
      const contextSection = buildContextPrompt(translateContext)
      const isChinese = from === 'zh' || from === 'zh-Hant' || to === 'zh' || to === 'zh-Hant'
      if (isChinese) {
        const targetZh = LANG_NAMES_ZH[to] ?? to
        prompt = `${contextSection}将以下文本翻译为${targetZh}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`
      } else {
        prompt = `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
      }
      // HY-MT1.5 recommended parameters (same as Hunyuan-MT)
      inferenceParams = { temperature: 0.7, maxTokens: 512, topK: 20, topP: 0.6, repeatPenalty: { penalty: 1.05 } }
    } else if (activeModelType === 'hunyuan-mt') {
      // Hunyuan-MT uses a specific prompt template:
      // Chinese ↔ Other: Chinese prompt; Other ↔ Other: English prompt
      const contextSection = buildContextPrompt(translateContext)
      const isChinese = from === 'zh' || to === 'zh'
      if (isChinese && to !== 'zh') {
        prompt = `${contextSection}把下面的文本翻译成${toLang}，不要额外解释。\n\n${text}`
      } else if (isChinese && to === 'zh') {
        prompt = `${contextSection}把下面的文本翻译成中文，不要额外解释。\n\n${text}`
      } else {
        prompt = `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
      }
      // Hunyuan-MT recommended parameters
      inferenceParams = { temperature: 0.7, maxTokens: 512, topK: 20, topP: 0.6, repeatPenalty: { penalty: 1.05 } }
    } else {
      // TranslateGemma prompt
      const contextSection = buildContextPrompt(translateContext)
      prompt = `${contextSection}Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`
      inferenceParams = { temperature: 0.1, maxTokens: 512 }
    }

    const response = await session.prompt(prompt, inferenceParams)

    // Log speculative decoding stats for debugging
    if (speculativeEnabled && contextSequence.tokenPredictions) {
      const stats = contextSequence.tokenPredictions
      console.log(`[slm-worker] Speculative stats — validated: ${stats.validated}, refuted: ${stats.refuted}`)
    }

    // Clean up the session context to free memory
    contextSequence.dispose?.()
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

async function handleTranslateIncremental(
  id: string,
  text: string,
  previousOutput: string,
  from: string,
  to: string,
  translateContext?: {
    previousSegments?: Array<{ source: string; translated: string; speakerId?: string }>
    glossary?: Array<{ source: string; target: string }>
    speakerId?: string
  }
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
    const { LlamaChatSession } = await import('node-llama-cpp')

    const contextSequence = context.getSequence()
    const session = new LlamaChatSession({ contextSequence })

    const fromLang = LANG_NAMES_EN[from] ?? from
    const toLang = LANG_NAMES_EN[to] ?? to

    const contextSection = buildContextPrompt(translateContext)

    // Build prompt with instruction to continue from previous output
    let prompt: string
    if (activeModelType === 'hunyuan-mt-15') {
      const isChinese = from === 'zh' || from === 'zh-Hant' || to === 'zh' || to === 'zh-Hant'
      if (isChinese) {
        const targetZh = LANG_NAMES_ZH[to] ?? to
        prompt = `${contextSection}将以下文本翻译为${targetZh}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`
      } else {
        prompt = `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
      }
    } else if (activeModelType === 'hunyuan-mt') {
      const isChinese = from === 'zh' || to === 'zh'
      if (isChinese && to !== 'zh') {
        prompt = `${contextSection}把下面的文本翻译成${toLang}，不要额外解释。\n\n${text}`
      } else if (isChinese && to === 'zh') {
        prompt = `${contextSection}把下面的文本翻译成中文，不要额外解释。\n\n${text}`
      } else {
        prompt = `${contextSection}Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`
      }
    } else {
      prompt = `${contextSection}Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`
    }

    // Use responsePrefix to force the model to continue from previous output
    // This implements prefix-constrained decoding for SimulMT consistency
    const inferenceParams = (activeModelType === 'hunyuan-mt' || activeModelType === 'hunyuan-mt-15')
      ? { temperature: 0.7, maxTokens: 512, topK: 20, topP: 0.6, repeatPenalty: { penalty: 1.05 } }
      : { temperature: 0.1, maxTokens: 512 }

    const response = await session.prompt(prompt, {
      ...inferenceParams,
      ...(previousOutput.trim() && { responsePrefix: previousOutput })
    })

    contextSequence.dispose?.()
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

    const response = await session.prompt(prompt, {
      temperature: 0.3,
      maxTokens: 1024
    })

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
process.parentPort!.on('message', (e: { data: any }) => {
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
        id: msg.id,
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
