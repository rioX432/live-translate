/**
 * The app ships one STT engine per platform and one translator. MLX needs Apple
 * Silicon, so other platforms (Windows, Intel Mac) use whisper.cpp, which runs on
 * CPU, CUDA and Metal alike.
 */
export interface EngineSelection {
  sttEngine: 'qwen3-asr' | 'whisper-local'
  translatorEngine: 'hy-mt2'
}

export function selectEngines(platform: NodeJS.Platform, arch: string): EngineSelection {
  return {
    sttEngine: platform === 'darwin' && arch === 'arm64' ? 'qwen3-asr' : 'whisper-local',
    translatorEngine: 'hy-mt2'
  }
}
