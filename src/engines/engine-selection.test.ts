import { describe, it, expect } from 'vitest'
import { selectEngines } from './engine-selection'

describe('selectEngines', () => {
  it('uses Qwen3-ASR on Apple Silicon Macs', () => {
    expect(selectEngines('darwin', 'arm64')).toEqual({ sttEngine: 'qwen3-asr', translatorEngine: 'hy-mt2' })
  })

  it.each([
    ['darwin', 'x64'],
    ['win32', 'x64'],
    ['win32', 'arm64'],
    ['linux', 'x64']
  ] as const)('uses whisper.cpp on %s/%s', (platform, arch) => {
    expect(selectEngines(platform, arch)).toEqual({ sttEngine: 'whisper-local', translatorEngine: 'hy-mt2' })
  })
})
