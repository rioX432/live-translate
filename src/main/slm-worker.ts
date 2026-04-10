/**
 * UtilityProcess worker for SLM inference via node-llama-cpp.
 * Supports TranslateGemma, Hunyuan-MT, LFM2, and PLaMo-2 models.
 * Runs in a separate process to avoid blocking the main process.
 *
 * IPC protocol:
 *   Main → Worker: { type: 'init', modelPath: string, kvCacheQuant?: boolean, modelType?: ModelType, draftModelPath?: string }
 *   Main → Worker: { type: 'translate', id: string, text: string, from: string, to: string }
 *   Main → Worker: { type: 'translate-incremental', id: string, text: string, previousOutput: string, from: string, to: string }
 *   Main → Worker: { type: 'translate-simulmt', id: string, text: string, previousOutput: string, from: string, to: string, isRevision: boolean }
 *   Main → Worker: { type: 'simulmt-reset' }
 *   Main → Worker: { type: 'summarize', id: string, transcript: string }
 *   Main → Worker: { type: 'dispose' }
 *   Worker → Main: { type: 'ready' }
 *   Worker → Main: { type: 'result', id: string, text: string }
 *   Worker → Main: { type: 'error', id?: string, message: string }
 */

import type { Llama, LlamaModel, LlamaContext, LlamaContextSequence } from 'node-llama-cpp'
import { LANG_NAMES_EN, LANG_NAMES_ZH } from '../engines/language-names'
import { formatGlossaryPrompt } from '../engines/translator/glossary-utils'
import { createLogger } from './logger'

const log = createLogger('slm-worker')

type ModelType = 'translategemma' | 'hunyuan-mt' | 'hunyuan-mt-15' | 'lfm2' | 'plamo'

/** Messages sent from main process to this worker */
type WorkerInboundMessage =
  | { type: 'init'; modelPath: string; kvCacheQuant?: boolean; modelType?: ModelType; draftModelPath?: string }
  | { type: 'translate'; id: string; text: string; from: string; to: string; context?: TranslateContextPayload }
  | { type: 'translate-incremental'; id: string; text: string; previousOutput: string; from: string; to: string; context?: TranslateContextPayload }
  | { type: 'translate-simulmt'; id: string; text: string; previousOutput: string; from: string; to: string; isRevision: boolean; context?: TranslateContextPayload }
  | { type: 'simulmt-reset' }
  | { type: 'summarize'; id: string; transcript: string }
  | { type: 'ger-correct'; id: string; text: string; language: string; glossary?: Array<{ source: string; target: string }> }
  | { type: 'dispose' }

interface TranslateContextPayload {
  previousSegments?: Array<{ source: string; translated: string }>
  glossary?: Array<{ source: string; target: string }>
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

/**
 * Persistent prefix-cached session for standard translate/translate-incremental.
 * Keeps the system prompt evaluated in the KV cache so subsequent translations
 * only need to evaluate the new user message tokens.
 * The session is reset between translations via resetChatHistory() which
 * preserves the KV cache prefix — node-llama-cpp's adaptStateToTokens()
 * automatically reuses matching prefix tokens.
 */
let prefixCacheSession: import('node-llama-cpp').LlamaChatSession | null = null
let prefixCacheSequence: LlamaContextSequence | null = null
let prefixCacheSystemPrompt: string | undefined = undefined

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

  // Queue prefix cache warm-up through the request queue to avoid
  // concurrent access with incoming translate requests.
  // This pre-evaluates the system prompt into the KV cache so the
  // first translation avoids the cold-start penalty.
  requestQueue = requestQueue.then(() => warmPrefixCache(), () => warmPrefixCache())
}

/** Build context sections for the translation prompt */
function buildContextPrompt(ctx?: {
  previousSegments?: Array<{ source: string; translated: string }>
  glossary?: Array<{ source: string; target: string }>
}): string {
  if (!ctx) return ''

  const parts: string[] = []

  // Glossary terms
  const glossaryPrompt = formatGlossaryPrompt(ctx.glossary)
  if (glossaryPrompt) {
    parts.push(glossaryPrompt)
  }

  // Previous segments for coherence
  if (ctx.previousSegments && ctx.previousSegments.length > 0) {
    const history = ctx.previousSegments
      .map((s) => `  ${s.source} → ${s.translated}`)
      .join('\n')
    parts.push(`Previous translations for context:\n${history}`)
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

  if (activeModelType === 'plamo') {
    // PLaMo-2-Translate uses structured tags for translation.
    // The prompt is passed directly as user content; node-llama-cpp
    // applies the chat template which includes the <|plamo:op|> tags.
    return `<|plamo:op|>dataset\ntranslation\n<|plamo:op|>input lang=${fromLang}\n${contextSection}${text}\n<|plamo:op|>output lang=${toLang}\n`
  }

  if (activeModelType === 'lfm2') {
    // LFM2 uses a simple system prompt via chat template;
    // the system message is set by node-llama-cpp's chat session,
    // so we just return the user text as the prompt body.
    return `${contextSection}${text}`
  }

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

  // TranslateGemma: simple translation prompt
  return `${contextSection}Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`
}

/** Get the system prompt for LFM2 based on target language */
function getLFM2SystemPrompt(to: string): string {
  const toLang = LANG_NAMES_EN[to] ?? to
  return `Translate to ${toLang}.`
}

/** Get inference parameters based on model type */
function getInferenceParams(): { temperature: number; maxTokens: number; topK?: number; topP?: number; minP?: number; repeatPenalty?: { penalty: number } } {
  if (activeModelType === 'plamo') {
    // PLaMo-2-Translate recommends greedy decoding (temperature=0) for translation
    return { temperature: 0, maxTokens: 1024 }
  }
  if (activeModelType === 'lfm2') {
    return { temperature: 0.5, maxTokens: 512, topP: 1.0, minP: 0.1, repeatPenalty: { penalty: 1.05 } }
  }
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

/**
 * Ensure the prefix-cached session exists and matches the desired system prompt.
 * Creates or recreates the session if the system prompt changed.
 */
async function ensurePrefixCacheSession(systemPrompt?: string): Promise<{
  session: import('node-llama-cpp').LlamaChatSession
  created: boolean
}> {
  const { LlamaChatSession } = await import('node-llama-cpp')

  // Reuse existing session if system prompt matches
  if (prefixCacheSession && prefixCacheSystemPrompt === systemPrompt) {
    return { session: prefixCacheSession, created: false }
  }

  // Dispose stale session if system prompt changed
  if (prefixCacheSession) {
    log.info('Prefix cache invalidated: system prompt changed')
    prefixCacheSequence?.dispose?.()
    prefixCacheSession.dispose?.()
    prefixCacheSession = null
    prefixCacheSequence = null
  }

  // Create new persistent session
  prefixCacheSequence = await createContextSequence()
  prefixCacheSession = new LlamaChatSession({
    contextSequence: prefixCacheSequence,
    ...(systemPrompt && { systemPrompt })
  })
  prefixCacheSystemPrompt = systemPrompt
  log.info('Prefix cache session created' + (systemPrompt ? ' (with system prompt)' : ''))

  return { session: prefixCacheSession, created: true }
}

/**
 * Warm the prefix cache by pre-evaluating the system prompt into the KV cache.
 * Called after model initialization so the first translation is fast.
 */
async function warmPrefixCache(): Promise<void> {
  if (!context) return

  try {
    const t0 = performance.now()
    // Determine the system prompt based on model type.
    // For LFM2, we use a generic warm-up prompt (actual target language will be set per-request).
    // For other models, no system prompt is used in standard translate.
    const systemPrompt = activeModelType === 'lfm2' ? getLFM2SystemPrompt('en') : undefined
    const { session } = await ensurePrefixCacheSession(systemPrompt)

    // Pre-evaluate the system prompt into KV cache using preloadPrompt
    // This forces the chat template + system prompt tokens into the context
    await session.preloadPrompt('warmup')
    // Reset so the warmup prompt doesn't affect actual translations
    session.resetChatHistory()

    const warmMs = performance.now() - t0
    log.info(`Prefix cache warmed in ${warmMs.toFixed(0)}ms`)
  } catch (err) {
    log.error('Failed to warm prefix cache (non-fatal):', err)
    // Non-fatal: translations will still work, just without prefix cache
    prefixCacheSequence?.dispose?.()
    prefixCacheSession?.dispose?.()
    prefixCacheSession = null
    prefixCacheSequence = null
  }
}

/** Run translation inference and return the result */
async function runInference(
  prompt: string,
  previousOutput?: string,
  systemPrompt?: string
): Promise<{ response: string; inferenceMs: number; contextMs: number }> {
  const t0 = performance.now()

  try {
    // Use the prefix-cached session for KV cache reuse
    const { session, created } = await ensurePrefixCacheSession(systemPrompt)

    // Reset chat history before each translation to clear previous conversation
    // while preserving the system prompt prefix in the KV cache
    if (!created) {
      session.resetChatHistory()
    }

    const contextMs = performance.now() - t0

    const inferenceParams = getInferenceParams()
    const t1 = performance.now()
    const response = await session.prompt(prompt, {
      ...inferenceParams,
      ...(previousOutput?.trim() && { responsePrefix: previousOutput })
    })
    const inferenceMs = performance.now() - t1

    // Log speculative decoding stats for debugging
    if (speculativeEnabled && prefixCacheSequence?.tokenPredictions) {
      const stats = prefixCacheSequence.tokenPredictions
      const label = previousOutput !== undefined ? 'Incremental speculative' : 'Speculative'
      log.info(`${label} stats — validated: ${stats.validated}, refuted: ${stats.refuted}`)
    }

    return { response: response.trim(), inferenceMs, contextMs }
  } catch (err) {
    // Invalidate prefix cache on error to avoid corrupted state
    log.error('Inference failed, invalidating prefix cache:', err)
    prefixCacheSequence?.dispose?.()
    prefixCacheSession?.dispose?.()
    prefixCacheSession = null
    prefixCacheSequence = null
    prefixCacheSystemPrompt = undefined
    throw err
  }
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
    const memBefore = process.memoryUsage()
    const t0 = performance.now()
    const prompt = buildTranslationPrompt(text, from, to, translateContext)
    const promptMs = performance.now() - t0

    const systemPrompt = activeModelType === 'lfm2' ? getLFM2SystemPrompt(to) : undefined
    const { response, inferenceMs, contextMs } = await runInference(prompt, undefined, systemPrompt)
    const memAfter = process.memoryUsage()
    const totalMs = performance.now() - t0

    log.info(
      `Profile: total=${totalMs.toFixed(0)}ms prompt=${promptMs.toFixed(0)}ms ` +
      `ctx=${contextMs.toFixed(0)}ms inference=${inferenceMs.toFixed(0)}ms ` +
      `inputLen=${text.length} outputLen=${response.length} ` +
      `rss=${(memAfter.rss / 1048576).toFixed(0)}MB ` +
      `heapDelta=${((memAfter.heapUsed - memBefore.heapUsed) / 1048576).toFixed(1)}MB`
    )

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: response
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
    const memBefore = process.memoryUsage()
    const t0 = performance.now()
    const prompt = buildTranslationPrompt(text, from, to, translateContext)
    const promptMs = performance.now() - t0
    const systemPrompt = activeModelType === 'lfm2' ? getLFM2SystemPrompt(to) : undefined
    const { response, inferenceMs, contextMs } = await runInference(prompt, previousOutput, systemPrompt)
    const memAfter = process.memoryUsage()
    const totalMs = performance.now() - t0

    log.info(
      `Profile(incr): total=${totalMs.toFixed(0)}ms prompt=${promptMs.toFixed(0)}ms ` +
      `ctx=${contextMs.toFixed(0)}ms inference=${inferenceMs.toFixed(0)}ms ` +
      `inputLen=${text.length} outputLen=${response.length} ` +
      `rss=${(memAfter.rss / 1048576).toFixed(0)}MB ` +
      `heapDelta=${((memAfter.heapUsed - memBefore.heapUsed) / 1048576).toFixed(1)}MB`
    )

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: response
    })
  } catch (err) {
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Persistent SimulMT session state.
 * Unlike regular translate which creates a new session per request,
 * SimulMT keeps a single LlamaChatSession alive across multiple turns.
 * This enables KV cache reuse for the shared system prompt + context prefix,
 * significantly reducing latency for incremental translation.
 */
let simulMtSession: import('node-llama-cpp').LlamaChatSession | null = null
let simulMtSequence: LlamaContextSequence | null = null
let simulMtLanguagePair: string = ''

/**
 * Build the SimulMT multi-turn prompt.
 * Uses a conversational format where source chunks and target translations
 * alternate as user/assistant turns, enabling KV cache prefix reuse.
 */
function buildSimulMtPrompt(
  text: string,
  from: string,
  to: string,
  isRevision: boolean
): string {
  const fromLang = LANG_NAMES_EN[from] ?? from
  const toLang = LANG_NAMES_EN[to] ?? to

  if (isRevision) {
    // Revision: full clause has arrived, retranslate for accuracy
    if (activeModelType === 'hunyuan-mt-15') {
      const isChinese = from === 'zh' || from === 'zh-Hant' || to === 'zh' || to === 'zh-Hant'
      if (isChinese) {
        const targetZh = LANG_NAMES_ZH[to] ?? to
        return `将以下完整句子翻译为${targetZh}，注意只需要输出翻译后的结果：\n\n${text}`
      }
      return `Translate the following complete sentence into ${toLang}, output only the translation:\n\n${text}`
    }
    return `Translate the following complete sentence from ${fromLang} to ${toLang}. Output only the translation:\n\n${text}`
  }

  // Incremental: partial clause, translate what's available
  if (activeModelType === 'hunyuan-mt-15') {
    const isChinese = from === 'zh' || from === 'zh-Hant' || to === 'zh' || to === 'zh-Hant'
    if (isChinese) {
      const targetZh = LANG_NAMES_ZH[to] ?? to
      return `将以下文本翻译为${targetZh}，注意只需要输出翻译后的结果：\n\n${text}`
    }
    return `Translate the following partial text into ${toLang}, without additional explanation:\n\n${text}`
  }

  return `Translate this partial ${fromLang} text into ${toLang}. Output only the translation:\n\n${text}`
}

/**
 * Handle SimulMT translation with persistent session for KV cache reuse.
 * The session is kept alive across turns so the system prompt and prior
 * context remain in the KV cache, avoiding re-evaluation.
 */
async function handleTranslateSimulMt(
  id: string,
  text: string,
  previousOutput: string,
  from: string,
  to: string,
  isRevision: boolean,
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
    const { LlamaChatSession } = await import('node-llama-cpp')

    const langPair = `${from}-${to}`
    const t0 = performance.now()

    // Reset session if language pair changed
    if (simulMtLanguagePair !== langPair) {
      if (simulMtSession) {
        simulMtSequence?.dispose?.()
        simulMtSession.dispose?.()
      }
      simulMtSession = null
      simulMtSequence = null
      simulMtLanguagePair = langPair
    }

    // Create persistent session if needed
    if (!simulMtSession) {
      simulMtSequence = await createContextSequence()

      const fromLang = LANG_NAMES_EN[from] ?? from
      const toLang = LANG_NAMES_EN[to] ?? to
      const systemPrompt = activeModelType === 'lfm2'
        ? getLFM2SystemPrompt(to)
        : `You are a simultaneous interpreter translating ${fromLang} to ${toLang}. ` +
          `Translate each input segment accurately and concisely. Output only the translation.`

      simulMtSession = new LlamaChatSession({
        contextSequence: simulMtSequence,
        systemPrompt
      })
      log.info(`SimulMT session created for ${langPair}`)
    }

    const contextSection = buildContextPrompt(translateContext)
    const prompt = contextSection + buildSimulMtPrompt(text, from, to, isRevision)
    const inferenceParams = getInferenceParams()

    const t1 = performance.now()
    const response = await simulMtSession.prompt(prompt, {
      ...inferenceParams,
      ...(previousOutput?.trim() && !isRevision && { responsePrefix: previousOutput })
    })
    const inferenceMs = performance.now() - t1
    const totalMs = performance.now() - t0

    const label = isRevision ? 'SimulMT(rev)' : 'SimulMT(incr)'
    log.info(
      `${label}: total=${totalMs.toFixed(0)}ms inference=${inferenceMs.toFixed(0)}ms ` +
      `inputLen=${text.length} outputLen=${response.length}`
    )

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: response.trim()
    })
  } catch (err) {
    // Reset session on error to avoid corrupted state
    if (simulMtSession) {
      simulMtSequence?.dispose?.()
      simulMtSession.dispose?.()
      simulMtSession = null
      simulMtSequence = null
    }
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

/** Reset the persistent SimulMT session (e.g. on speech segment end) */
function handleSimulMtReset(): void {
  if (simulMtSession) {
    simulMtSequence?.dispose?.()
    simulMtSession.dispose?.()
    simulMtSession = null
    simulMtSequence = null
    log.info('SimulMT session reset')
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

/**
 * Handle GER (Generative Error Correction) request.
 * Performs selective correction of STT output focused on glossary terms,
 * proper nouns, numbers, and units. Does NOT rewrite the entire text.
 */
async function handleGERCorrect(
  id: string,
  text: string,
  language: string,
  glossary?: Array<{ source: string; target: string }>
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
    const t0 = performance.now()
    const langName = LANG_NAMES_EN[language] ?? language

    // Build a targeted correction prompt
    const parts: string[] = []
    parts.push(
      `You are a speech recognition error corrector for ${langName}.`,
      'Fix ONLY clear errors in proper nouns, numbers, units, and technical terms.',
      'Do NOT rephrase or rewrite. Output the corrected text only.'
    )

    if (glossary && glossary.length > 0) {
      const entries = glossary.map((g) => `  "${g.source}"`).join('\n')
      parts.push(`\nKnown terms (correct spellings):\n${entries}`)
    }

    parts.push(`\nSTT output:\n${text}`)

    const prompt = parts.join('\n')

    const { response, inferenceMs } = await runInference(prompt)
    const totalMs = performance.now() - t0

    log.info(
      `GER: total=${totalMs.toFixed(0)}ms inference=${inferenceMs.toFixed(0)}ms ` +
      `inputLen=${text.length} outputLen=${response.length}`
    )

    process.parentPort!.postMessage({
      type: 'result',
      id,
      text: response
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
    // Clean up prefix cache session
    if (prefixCacheSession) {
      prefixCacheSequence?.dispose?.()
      prefixCacheSession.dispose?.()
      prefixCacheSession = null
      prefixCacheSequence = null
      prefixCacheSystemPrompt = undefined
    }
    // Clean up SimulMT session
    if (simulMtSession) {
      simulMtSequence?.dispose?.()
      simulMtSession.dispose?.()
      simulMtSession = null
      simulMtSequence = null
    }
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
        case 'translate-simulmt':
          await handleTranslateSimulMt(msg.id, msg.text, msg.previousOutput, msg.from, msg.to, msg.isRevision, msg.context)
          break
        case 'simulmt-reset':
          handleSimulMtReset()
          break
        case 'summarize':
          await handleSummarize(msg.id, msg.transcript)
          break
        case 'ger-correct':
          await handleGERCorrect(msg.id, msg.text, msg.language, msg.glossary)
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

  if (msg.type === 'translate' || msg.type === 'translate-incremental' || msg.type === 'translate-simulmt' || msg.type === 'summarize' || msg.type === 'ger-correct') {
    // Queue to serialize context access
    requestQueue = requestQueue.then(handleMessage, handleMessage)
  } else {
    handleMessage()
  }
})
