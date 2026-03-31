import { MlxWhisperEngine } from './MlxWhisperEngine'

/**
 * Kotoba-Whisper v2.0 — Japanese-optimized STT engine.
 *
 * Uses the same mlx-whisper Python bridge as MlxWhisperEngine but with the
 * kaiinui/kotoba-whisper-v2.0-mlx model, which achieves JA CER 5.6%
 * (31% better than baseline MLX Whisper's 8.1%).
 *
 * IMPORTANT: This model outputs ONLY Japanese — EN WER is ~100%.
 * Only use when source language is JA or auto with JA-dominant audio.
 * Apple Silicon only (requires MLX).
 */
export class KotobaWhisperEngine extends MlxWhisperEngine {
  override readonly id = 'kotoba-whisper'
  override readonly name = 'Kotoba-Whisper v2.0 (JA-optimized)'

  constructor(options?: {
    onProgress?: (message: string) => void
  }) {
    super({
      model: 'kaiinui/kotoba-whisper-v2.0-mlx',
      onProgress: options?.onProgress
    })
  }

  protected override getLogPrefix(): string {
    return '[kotoba-whisper]'
  }
}
