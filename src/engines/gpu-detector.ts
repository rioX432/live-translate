import { createLogger } from '../main/logger'

const log = createLogger('gpu-detector')

/**
 * GPU detection via node-llama-cpp.
 * Returns detected GPU names and whether a GPU is available.
 * Fails gracefully if node-llama-cpp is not installed.
 */
export interface GpuInfo {
  hasGpu: boolean
  gpuNames: string[]
}

let cachedResult: GpuInfo | null = null

export async function detectGpu(): Promise<GpuInfo> {
  if (cachedResult) return cachedResult

  try {
    const { getLlama } = await import('node-llama-cpp')
    const llama = await getLlama({ gpu: 'auto' })
    const gpuNames = await llama.getGpuDeviceNames()
    cachedResult = {
      hasGpu: gpuNames.length > 0,
      gpuNames: gpuNames.map(String)
    }
  } catch (err) {
    log.warn('Failed to detect GPU:', err)
    // Don't cache errors — allow retry on next call
    return { hasGpu: false, gpuNames: [] }
  }

  return cachedResult
}

export function clearGpuCache(): void {
  cachedResult = null
}
