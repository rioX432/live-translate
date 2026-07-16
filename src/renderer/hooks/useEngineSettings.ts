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
  // Cloud realtime interpretation (#722, BYOK)
  openaiApiKey: string
  setOpenaiApiKey: (v: string) => void
  cloudRealtimeEnabled: boolean
  setCloudRealtimeEnabled: (v: boolean) => void
  // Gemini Live realtime interpretation (#723, BYOK, preview)
  geminiLiveApiKey: string
  setGeminiLiveApiKey: (v: string) => void
  geminiLiveEnabled: boolean
  setGeminiLiveEnabled: (v: boolean) => void

  slmKvCacheQuant: boolean
  setSlmKvCacheQuant: (v: boolean) => void
  slmSpeculativeDecoding: boolean
  setSlmSpeculativeDecoding: (v: boolean) => void
  simulMtEnabled: boolean
  setSimulMtEnabled: (v: boolean) => void
  simulMtWaitK: number
  setSimulMtWaitK: (v: number) => void

  glossaryTerms: Array<{ source: string; target: string }>
  setGlossaryTerms: (v: Array<{ source: string; target: string }>) => void
  orgGlossaryTerms: Array<{ source: string; target: string }>
  setOrgGlossaryTerms: (v: Array<{ source: string; target: string }>) => void

  // Adaptive routing (#547)
  adaptiveRoutingEnabled: boolean
  setAdaptiveRoutingEnabled: (v: boolean) => void
  adaptiveRoutingShortThreshold: number
  setAdaptiveRoutingShortThreshold: (v: number) => void
  adaptiveRoutingLongThreshold: number
  setAdaptiveRoutingLongThreshold: (v: number) => void
  adaptiveRoutingQualityEngine: string
  setAdaptiveRoutingQualityEngine: (v: string) => void
}

export interface EngineSettingsInit {
  setShowAdvanced: (v: boolean) => void
  setShowApiOptions: (v: boolean) => void
}

export function useEngineSettings(init: EngineSettingsInit): EngineSettingsState {
  const [engineMode, setEngineMode] = useState<EngineMode>('auto')
  const [gpuInfo, setGpuInfo] = useState<{ hasGpu: boolean; gpuNames: string[] } | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [deeplApiKey, setDeeplApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [microsoftApiKey, setMicrosoftApiKey] = useState('')
  const [microsoftRegion, setMicrosoftRegion] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [cloudRealtimeEnabled, setCloudRealtimeEnabled] = useState(false)
  const [geminiLiveApiKey, setGeminiLiveApiKey] = useState('')
  const [geminiLiveEnabled, setGeminiLiveEnabled] = useState(false)
  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)
  const [slmSpeculativeDecoding, setSlmSpeculativeDecoding] = useState(false)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)
  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])
  const [orgGlossaryTerms, setOrgGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])
  const [adaptiveRoutingEnabled, setAdaptiveRoutingEnabled] = useState(false)
  const [adaptiveRoutingShortThreshold, setAdaptiveRoutingShortThreshold] = useState(10)
  const [adaptiveRoutingLongThreshold, setAdaptiveRoutingLongThreshold] = useState(50)
  const [adaptiveRoutingQualityEngine, setAdaptiveRoutingQualityEngine] = useState('hunyuan-mt')

  // Load engine-related settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      // #702: Coerce legacy/unknown engine IDs to 'auto' so the UI never displays a removed option.
      // The main process also migrates the persisted value on startup.
      if (s.translationEngine) {
        const raw = str(s.translationEngine, 'auto')
        const valid: EngineMode[] = ['auto', 'rotation', 'online', 'online-deepl', 'online-gemini', 'offline-hymt15', 'offline-hunyuan-mt', 'offline-apple']
        setEngineMode((valid.includes(raw as EngineMode) ? raw : 'auto') as EngineMode)
      }
      if (s.googleApiKey) setApiKey(str(s.googleApiKey, ''))
      if (s.deeplApiKey) setDeeplApiKey(str(s.deeplApiKey, ''))
      if (s.geminiApiKey) setGeminiApiKey(str(s.geminiApiKey, ''))
      if (s.microsoftApiKey) setMicrosoftApiKey(str(s.microsoftApiKey, ''))
      if (s.microsoftRegion) setMicrosoftRegion(str(s.microsoftRegion, ''))
      if (s.openaiApiKey) setOpenaiApiKey(str(s.openaiApiKey, ''))
      if (s.cloudRealtimeEnabled !== undefined) setCloudRealtimeEnabled(bool(s.cloudRealtimeEnabled, false))
      if (s.geminiLiveApiKey) setGeminiLiveApiKey(str(s.geminiLiveApiKey, ''))
      if (s.geminiLiveEnabled !== undefined) setGeminiLiveEnabled(bool(s.geminiLiveEnabled, false))
      if (s.slmKvCacheQuant !== undefined) setSlmKvCacheQuant(bool(s.slmKvCacheQuant, true))
      if (s.slmSpeculativeDecoding !== undefined) setSlmSpeculativeDecoding(bool(s.slmSpeculativeDecoding, false))
      if (s.glossaryTerms) setGlossaryTerms(arr<{ source: string; target: string }>(s.glossaryTerms, []))
      if (s.orgGlossaryTerms) setOrgGlossaryTerms(arr<{ source: string; target: string }>(s.orgGlossaryTerms, []))
      if (s.simulMtEnabled !== undefined) setSimulMtEnabled(bool(s.simulMtEnabled, false))
      if (s.simulMtWaitK !== undefined) setSimulMtWaitK(num(s.simulMtWaitK, 3))
      if (s.adaptiveRoutingEnabled !== undefined) setAdaptiveRoutingEnabled(bool(s.adaptiveRoutingEnabled, false))
      if (s.adaptiveRoutingShortThreshold !== undefined) setAdaptiveRoutingShortThreshold(num(s.adaptiveRoutingShortThreshold, 10))
      if (s.adaptiveRoutingLongThreshold !== undefined) setAdaptiveRoutingLongThreshold(num(s.adaptiveRoutingLongThreshold, 50))
      if (s.adaptiveRoutingQualityEngine) setAdaptiveRoutingQualityEngine(str(s.adaptiveRoutingQualityEngine, 'hunyuan-mt'))

      // Auto-expand API section if an API engine is saved
      const engine = str(s.translationEngine, '')
      if (engine && API_ENGINE_MODES.includes(engine as EngineMode)) {
        init.setShowAdvanced(true)
        init.setShowApiOptions(true)
      }
    })
  }, [])

  // Detect GPU — fall back to HY-MT1.5 if no GPU
  useEffect(() => {
    window.api.detectGpu().then((info) => {
      setGpuInfo(info)
      if (!info.hasGpu) {
        window.api.getSettings().then((s) => {
          if (!s.translationEngine) {
            setEngineMode('offline-hymt15')
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
    openaiApiKey, setOpenaiApiKey,
    cloudRealtimeEnabled, setCloudRealtimeEnabled,
    geminiLiveApiKey, setGeminiLiveApiKey,
    geminiLiveEnabled, setGeminiLiveEnabled,
    slmKvCacheQuant, setSlmKvCacheQuant,
    slmSpeculativeDecoding, setSlmSpeculativeDecoding,
    simulMtEnabled, setSimulMtEnabled,
    simulMtWaitK, setSimulMtWaitK,
    glossaryTerms, setGlossaryTerms,
    orgGlossaryTerms, setOrgGlossaryTerms,
    adaptiveRoutingEnabled, setAdaptiveRoutingEnabled,
    adaptiveRoutingShortThreshold, setAdaptiveRoutingShortThreshold,
    adaptiveRoutingLongThreshold, setAdaptiveRoutingLongThreshold,
    adaptiveRoutingQualityEngine, setAdaptiveRoutingQualityEngine
  }
}
