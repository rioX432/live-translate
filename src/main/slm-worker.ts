/**
 * UtilityProcess worker for GGUF inference via node-llama-cpp: Hy-MT2 translation
 * and meeting summaries. Runs in a separate process to avoid blocking the main
 * process.
 *
 * IPC protocol:
 *   Main → Worker: { type: 'init', modelPath: string, modelType?: ModelType }
 *   Main → Worker: { type: 'translate', id: string, text: string, from: string, to: string, context?: ... }
 *   Main → Worker: { type: 'summarize', id: string, transcript: string }
 *   Main → Worker: { type: 'dispose' }
 *   Worker → Main: { type: 'ready' }
 *   Worker → Main: { type: 'result', id: string, text: string }
 *   Worker → Main: { type: 'error', id?: string, message: string }
 *   Worker → Main: { type: 'disposed' }
 */

import type { Llama, LlamaModel, LlamaContext, LlamaContextSequence, LlamaChatSession } from 'node-llama-cpp'
import { buildHyMt2Prompt, HY_MT2_INFERENCE_PARAMS } from '../engines/translator/hy-mt2-prompt'
import type { HyMt2PromptContext } from '../engines/translator/hy-mt2-prompt'
import { createLogger } from './logger'

const log = createLogger('slm-worker')

/** `hy-mt2` serves translation; `summary` loads a general model for summaries only. */
type ModelType = 'hy-mt2' | 'summary'

type WorkerInboundMessage =
  | { type: 'init'; modelPath: string; modelType?: ModelType }
  | { type: 'translate'; id: string; text: string; from: string; to: string; context?: HyMt2PromptContext }
  | { type: 'summarize'; id: string; transcript: string }
  | { type: 'dispose' }

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
let requestQueue: Promise<void> = Promise.resolve()
let activeModelType: ModelType = 'summary'

/**
 * Persistent session reused across translations. resetChatHistory() between
 * requests keeps the chat-template prefix in the KV cache, and node-llama-cpp
 * reuses the matching prefix tokens on the next prompt.
 */
let translationSession: LlamaChatSession | null = null
let translationSequence: LlamaContextSequence | null = null

async function handleInit(modelPath: string, modelType?: ModelType): Promise<void> {
  activeModelType = modelType ?? 'summary'
  const { getLlama } = await import('node-llama-cpp')
  llama = await getLlama({ gpu: 'auto' })
  log.info('Loading model:', modelPath)
  model = await llama.loadModel({ modelPath })
  context = await model.createContext({ contextSize: TRANSLATION_CONTEXT_SIZE })
  log.info('Context created')

  process.parentPort!.postMessage({ type: 'ready' })

  if (activeModelType === 'hy-mt2') {
    // Queued so the warm-up never races an incoming translate request.
    requestQueue = requestQueue.then(() => warmTranslationSession(), () => warmTranslationSession())
  }
}

function disposeTranslationSession(): void {
  translationSequence?.dispose?.()
  translationSession?.dispose?.()
  translationSession = null
  translationSequence = null
}

async function ensureTranslationSession(): Promise<{ session: LlamaChatSession; created: boolean }> {
  if (translationSession) return { session: translationSession, created: false }
  const { LlamaChatSession } = await import('node-llama-cpp')
  translationSequence = context!.getSequence()
  // No system prompt: the Hy-MT2 model card asks for the user message alone.
  translationSession = new LlamaChatSession({ contextSequence: translationSequence })
  return { session: translationSession, created: true }
}

/** Evaluate the chat-template prefix once so the first translation skips that cost. */
async function warmTranslationSession(): Promise<void> {
  if (!context) return
  try {
    const t0 = performance.now()
    const { session } = await ensureTranslationSession()
    await session.preloadPrompt('warmup')
    session.resetChatHistory()
    log.info(`Translation session warmed in ${(performance.now() - t0).toFixed(0)}ms`)
  } catch (err) {
    log.error('Failed to warm translation session (non-fatal):', err)
    disposeTranslationSession()
  }
}

async function handleTranslate(
  id: string,
  text: string,
  to: string,
  translateContext?: HyMt2PromptContext
): Promise<void> {
  if (!context) {
    process.parentPort!.postMessage({ type: 'error', id, message: 'Model not initialized' })
    return
  }
  if (activeModelType !== 'hy-mt2') {
    process.parentPort!.postMessage({ type: 'error', id, message: 'Loaded model is not a translation model' })
    return
  }

  try {
    const t0 = performance.now()
    const prompt = buildHyMt2Prompt(text, to, translateContext)
    const { session, created } = await ensureTranslationSession()
    if (!created) session.resetChatHistory()
    const response = (await session.prompt(prompt, { ...HY_MT2_INFERENCE_PARAMS })).trim()
    const totalMs = performance.now() - t0

    log.info(
      `Profile: total=${totalMs.toFixed(0)}ms inputLen=${text.length} outputLen=${response.length} ` +
      `rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`
    )
    process.parentPort!.postMessage({ type: 'result', id, text: response })
  } catch (err) {
    // A failed prompt can leave the sequence half-evaluated; start clean next time.
    log.error('Translation failed, resetting session:', err)
    disposeTranslationSession()
    process.parentPort!.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

async function handleSummarize(id: string, transcript: string): Promise<void> {
  if (!context) {
    process.parentPort!.postMessage({ type: 'error', id, message: 'Model not initialized' })
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
    disposeTranslationSession()
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

// Serialize translate/summarize requests to prevent concurrent context access
process.parentPort!.on('message', (e: { data: WorkerInboundMessage }) => {
  const msg = e.data

  const handleMessage = async (): Promise<void> => {
    try {
      switch (msg.type) {
        case 'init':
          await handleInit(msg.modelPath, msg.modelType)
          break
        case 'translate':
          await handleTranslate(msg.id, msg.text, msg.to, msg.context)
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

  if (msg.type === 'translate' || msg.type === 'summarize') {
    requestQueue = requestQueue.then(handleMessage, handleMessage)
  } else {
    handleMessage()
  }
})
