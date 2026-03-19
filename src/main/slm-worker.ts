/**
 * UtilityProcess worker for TranslateGemma 4B inference via node-llama-cpp.
 * Runs in a separate process to avoid blocking the main process.
 *
 * IPC protocol:
 *   Main → Worker: { type: 'init', modelPath: string }
 *   Main → Worker: { type: 'translate', id: string, text: string, from: string, to: string }
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

async function handleInit(modelPath: string): Promise<void> {
  const { getLlama } = await import('node-llama-cpp')
  llama = await getLlama({ gpu: 'auto' })
  model = await llama.loadModel({ modelPath })
  context = await model.createContext()

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

    // TranslateGemma prompt format (plain mode)
    const prompt = `Translate the following text from ${fromLang} to ${toLang}.\n\n${text}`

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
process.parentPort!.on('message', async (e: { data: any }) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg.modelPath)
        break
      case 'translate':
        await handleTranslate(msg.id, msg.text, msg.from, msg.to)
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
})
