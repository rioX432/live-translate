import { useEffect, useState } from 'react'
import { str, bool, num, arr } from './settingsCastUtils'
import type { EngineMode } from '../components/settings/shared'
import { API_ENGINE_MODES } from '../components/settings/shared'

export interface EngineSettingsState {
  engineMode: EngineMode
  setEngineMode: (v: EngineMode) => void
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null

  apiKey: string
  setApiKey: (v: string) => void
  deeplApiKey: string
  setDeeplApiKey: (v: string) => void
  geminiApiKey: string
  setGeminiApiKey: (v: string) => void
  microsoftApiKey: string
  setMicrosoftApiKey: (v: string) => void
  microsoftRegion: string
  setMicrosoftRegion: (v: string) => void

  slmKvCacheQuant: boolean
  setSlmKvCacheQuant: (v: boolean) => void
  simulMtEnabled: boolean
  setSimulMtEnabled: (v: boolean) => void
  simulMtWaitK: number
  setSimulMtWaitK: (v: number) => void

  glossaryTerms: Array<{ source: string; target: string }>
  setGlossaryTerms: (v: Array<{ source: string; target: string }>) => void
}

export interface EngineSettingsInit {
  setShowAdvanced: (v: boolean) => void
  setShowApiOptions: (v: boolean) => void
}

export function useEngineSettings(init: EngineSettingsInit): EngineSettingsState {
  const [engineMode, setEngineMode] = useState<EngineMode>('offline-opus')
  const [gpuInfo, setGpuInfo] = useState<{ hasGpu: boolean; gpuNames: string[] } | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [deeplApiKey, setDeeplApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [microsoftApiKey, setMicrosoftApiKey] = useState('')
  const [microsoftRegion, setMicrosoftRegion] = useState('')
  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)
  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])

  // Load engine-related settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.translationEngine) setEngineMode(str(s.translationEngine, 'offline-opus') as EngineMode)
      if (s.googleApiKey) setApiKey(str(s.googleApiKey, ''))
      if (s.deeplApiKey) setDeeplApiKey(str(s.deeplApiKey, ''))
      if (s.geminiApiKey) setGeminiApiKey(str(s.geminiApiKey, ''))
      if (s.microsoftApiKey) setMicrosoftApiKey(str(s.microsoftApiKey, ''))
      if (s.microsoftRegion) setMicrosoftRegion(str(s.microsoftRegion, ''))
      if (s.slmKvCacheQuant !== undefined) setSlmKvCacheQuant(bool(s.slmKvCacheQuant, true))
      if (s.glossaryTerms) setGlossaryTerms(arr<{ source: string; target: string }>(s.glossaryTerms, []))
      if (s.simulMtEnabled !== undefined) setSimulMtEnabled(bool(s.simulMtEnabled, false))
      if (s.simulMtWaitK !== undefined) setSimulMtWaitK(num(s.simulMtWaitK, 3))

      // Auto-expand API section if an API engine is saved
      const engine = str(s.translationEngine, '')
      if (engine && API_ENGINE_MODES.includes(engine as EngineMode)) {
        init.setShowAdvanced(true)
        init.setShowApiOptions(true)
      }
    })
  }, [])

  // Detect GPU — fall back to OPUS-MT if no GPU
  useEffect(() => {
    window.api.detectGpu().then((info) => {
      setGpuInfo(info)
      if (!info.hasGpu) {
        window.api.getSettings().then((s) => {
          if (!s.translationEngine) {
            setEngineMode('offline-opus')
          }
        })
      }
    }).catch(() => setGpuInfo({ hasGpu: false, gpuNames: [] }))
  }, [])

  return {
    engineMode, setEngineMode,
    gpuInfo,
    apiKey, setApiKey,
    deeplApiKey, setDeeplApiKey,
    geminiApiKey, setGeminiApiKey,
    microsoftApiKey, setMicrosoftApiKey,
    microsoftRegion, setMicrosoftRegion,
    slmKvCacheQuant, setSlmKvCacheQuant,
    simulMtEnabled, setSimulMtEnabled,
    simulMtWaitK, setSimulMtWaitK,
    glossaryTerms, setGlossaryTerms
  }
}
