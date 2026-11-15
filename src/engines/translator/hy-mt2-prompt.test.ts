import { describe, it, expect } from 'vitest'
import { buildHyMt2Prompt, HY_MT2_INFERENCE_PARAMS } from './hy-mt2-prompt'

describe('HY_MT2_INFERENCE_PARAMS', () => {
  it('decodes greedily so the same input always yields the same subtitle', () => {
    expect(HY_MT2_INFERENCE_PARAMS.temperature).toBe(0)
    expect(HY_MT2_INFERENCE_PARAMS).not.toHaveProperty('topP')
    expect(HY_MT2_INFERENCE_PARAMS).not.toHaveProperty('topK')
    expect(HY_MT2_INFERENCE_PARAMS.repeatPenalty.penalty).toBe(1.05)
  })
})

describe('buildHyMt2Prompt', () => {
  it('uses the official default template with the full target language name', () => {
    expect(buildHyMt2Prompt('こんにちは', 'en')).toBe(
      'Translate the following text into English. Note that you should only output the translated result without any additional explanation:\n\nこんにちは'
    )
  })

  it('uses the official terminology template only for terms that occur in the text', () => {
    const prompt = buildHyMt2Prompt('Kubernetes の設定です', 'en', {
      glossary: [
        { source: 'Kubernetes', target: 'Kubernetes' },
        { source: '設定', target: 'configuration' },
        { source: '会議', target: 'meeting' }
      ]
    })
    expect(prompt).toBe(
      'Reference the following translations:\n' +
      'Kubernetes translates to Kubernetes\n' +
      '設定 translates to configuration\n\n' +
      'Translate the following text into English. Note that you must ONLY output the translated result without any additional explanation:\n\n' +
      'Kubernetes の設定です'
    )
    expect(prompt).not.toContain('meeting')
  })

  it('falls back to the default template when no glossary term occurs', () => {
    const prompt = buildHyMt2Prompt('hello', 'ja', { glossary: [{ source: '会議', target: 'meeting' }] })
    expect(prompt.startsWith('Translate the following text into Japanese.')).toBe(true)
  })

  it('passes previous source sentences as background and never their translations', () => {
    const prompt = buildHyMt2Prompt('次の議題です', 'en', {
      previousSegments: [
        { source: '一つ目', translated: 'FIRST-TRANSLATION' },
        { source: '二つ目', translated: 'SECOND-TRANSLATION' },
        { source: '三つ目', translated: 'THIRD-TRANSLATION' }
      ]
    })
    expect(prompt).toBe(
      '[Background Information]\n二つ目\n三つ目\n\n' +
      'Please translate the following text into English, taking the provided background information into consideration.\n\n' +
      '[Source Text]\n次の議題です'
    )
    expect(prompt).not.toContain('TRANSLATION')
    expect(prompt).not.toContain('→')
  })

  it('ignores blank previous segments', () => {
    const prompt = buildHyMt2Prompt('test', 'ja', { previousSegments: [{ source: '  ', translated: 'x' }] })
    expect(prompt).not.toContain('[Background Information]')
  })

  it('is a pure function of its inputs', () => {
    const ctx = { previousSegments: [{ source: 'a', translated: 'b' }], glossary: [{ source: 'x', target: 'y' }] }
    expect(buildHyMt2Prompt('x z', 'en', ctx)).toBe(buildHyMt2Prompt('x z', 'en', ctx))
  })
})
