import { describe, it, expect } from 'vitest'
import {
  WHISPER_VARIANTS,
  HUNYUAN_MT_VARIANTS,
  HUNYUAN_MT_15_VARIANTS,
  LFM2_VARIANTS,
  PLAMO_VARIANTS,
  GGUF_VARIANTS_4B,
  GGUF_VARIANTS_12B,
  MODEL_URL,
  MODEL_SHA256
} from './model-downloader'

const ALL = [
  ...Object.values(WHISPER_VARIANTS),
  ...Object.values(HUNYUAN_MT_VARIANTS),
  ...Object.values(HUNYUAN_MT_15_VARIANTS),
  ...Object.values(LFM2_VARIANTS),
  ...Object.values(PLAMO_VARIANTS),
  ...Object.values(GGUF_VARIANTS_4B),
  ...Object.values(GGUF_VARIANTS_12B)
]

describe('model download pins', () => {
  it.each(ALL.map((v) => [v.filename, v] as const))('%s is pinned to a commit and a SHA256', (_name, v) => {
    expect(v.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+$/)
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('pins the default model too', () => {
    expect(MODEL_URL).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    expect(MODEL_SHA256).toBe(WHISPER_VARIANTS['kotoba-v2.0'].sha256)
  })
})
