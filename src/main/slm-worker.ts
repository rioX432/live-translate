/**
 * UtilityProcess worker for TranslateGemma 4B inference via node-llama-cpp.
 * Runs in a separate process to avoid blocking the main process.
 *
 * IPC protocol:
 *   Main → Worker: { type: 'init', modelPath: string, kvCacheQuant?: boolean }
 *   Main → Worker: { type: 'translate', id: string, text: string, from: string, to: string }
 *   Main → Worker: { type: 'summarize', id: string, transcript: string }
 *   Main → Worker: { type: 'dispose' }
 *   Worker → Main: { type: 'ready' }
 *   Worker → Main: { type: 'result', id: string, text: string }
 *   Worker → Main: { type: 'error', id?: string, message: string }
 */

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

let llama: any = null
let model: any = null
let context: any = null
let requestQueue: Promise<void> = Promise.resolve()

async function handleInit(modelPath: string, kvCacheQuant?: boolean): Promise<void> {
  const { getLlama } = await import('node-llama-cpp')
  llama = await getLlama({ gpu: 'auto' })
  model = await llama.loadModel({ modelPath })

  const contextOptions: Record<string, unknown> = {}
  if (kvCacheQuant) {
    contextOptions.experimentalKvCacheKeyType = 'Q8_0'
    contextOptions.experimentalKvCacheValueType = 'Q8_0'
  }
  context = await model.createContext(contextOptions)

  process.parentPort!.postMessage({ type: 'ready' })
}

async function handleTranslate(
  id: string,
  text: string,
  from: string,
  to: string
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
    const session = new LlamaChatSession({
      contextSequence: context.getSequence()
    })

    const fromLang = LANG_NAMES[from] ?? from
    const toLang = LANG_NAMES[to] ?? to

    // TranslateGemma optimized prompt format
    const prompt = `Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`

    const response = await session.prompt(prompt, {
      temperature: 0.1,
      maxTokens: 512
    })

    // Clean up the session context to free memory
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
  if (context) {
    await context.dispose?.()
    context = null
  }
  if (model) {
    await model.dispose?.()
    model = null
  }
  llama = null
  process.exit(0)
}

// Listen for messages from main process
// Serialize translate/summarize requests to prevent concurrent context access
process.parentPort!.on('message', (e: { data: any }) => {
  const msg = e.data

  const handleMessage = async (): Promise<void> => {
    try {
      switch (msg.type) {
        case 'init':
          await handleInit(msg.modelPath, msg.kvCacheQuant)
          break
        case 'translate':
          await handleTranslate(msg.id, msg.text, msg.from, msg.to)
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

  if (msg.type === 'translate' || msg.type === 'summarize') {
    // Queue to serialize context access
    requestQueue = requestQueue.then(handleMessage, handleMessage)
  } else {
    handleMessage()
  }
})
