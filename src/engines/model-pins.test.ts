import { describe, it, expect, vi } from 'vitest'

// model-downloader imports electron's app at module load.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/live-translate-test', isPackaged: false } }))
import {
  WHISPER_VARIANTS,
  HY_MT2_MODEL,
  GGUF_VARIANTS_4B,
  GGUF_VARIANTS_12B,
  QWEN3_ASR_MODEL,
  pinnedRepoFileUrl
} from './model-downloader'

const ALL = [
  ...Object.values(WHISPER_VARIANTS),
  HY_MT2_MODEL,
  ...Object.values(GGUF_VARIANTS_4B),
  ...Object.values(GGUF_VARIANTS_12B)
]

const PINNED_URL = /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+$/
const SHA256 = /^[0-9a-f]{64}$/

describe('model download pins', () => {
  it.each(ALL.map((v) => [v.filename, v] as const))('%s is pinned to a commit and a SHA256', (_name, v) => {
    expect(v.url).toMatch(PINNED_URL)
    expect(v.sha256).toMatch(SHA256)
  })

  it.each(QWEN3_ASR_MODEL.files.map((f) => [f.name, f] as const))(
    'Qwen3-ASR %s is pinned to a commit and a SHA256',
    (_name, file) => {
      expect(pinnedRepoFileUrl(QWEN3_ASR_MODEL, file)).toMatch(PINNED_URL)
      expect(file.sha256).toMatch(SHA256)
    }
  )

  it('ships the Qwen3-ASR weights and tokenizer files', () => {
    const names = QWEN3_ASR_MODEL.files.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['config.json', 'model.safetensors', 'vocab.json', 'merges.txt']))
  })
})
