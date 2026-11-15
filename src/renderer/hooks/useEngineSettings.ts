import { useEffect, useState } from 'react'
import { bool, num, arr } from './settingsCastUtils'
import type { SttEngineType } from '../components/settings/shared'

export interface EngineSettingsState {
  /** STT engine main selected for this platform, shown read-only */
  sttEngine: SttEngineType
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null

  simulMtEnabled: boolean
  setSimulMtEnabled: (v: boolean) => void
  simulMtWaitK: number
  setSimulMtWaitK: (v: number) => void

  glossaryTerms: Array<{ source: string; target: string }>
  setGlossaryTerms: (v: Array<{ source: string; target: string }>) => void
  orgGlossaryTerms: Array<{ source: string; target: string }>
  setOrgGlossaryTerms: (v: Array<{ source: string; target: string }>) => void

}

export function useEngineSettings(): EngineSettingsState {
  const [sttEngine, setSttEngine] = useState<SttEngineType>('whisper-local')
  const [gpuInfo, setGpuInfo] = useState<{ hasGpu: boolean; gpuNames: string[] } | null>(null)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)
  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])
  const [orgGlossaryTerms, setOrgGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])

  // Load engine-related settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.glossaryTerms) setGlossaryTerms(arr<{ source: string; target: string }>(s.glossaryTerms, []))
      if (s.orgGlossaryTerms) setOrgGlossaryTerms(arr<{ source: string; target: string }>(s.orgGlossaryTerms, []))
      if (s.simulMtEnabled !== undefined) setSimulMtEnabled(bool(s.simulMtEnabled, false))
      if (s.simulMtWaitK !== undefined) setSimulMtWaitK(num(s.simulMtWaitK, 3))
    })
  }, [])

  // The STT engine depends on the CPU architecture, which only main knows
  useEffect(() => {
    window.api.quickStartRecommend()
      .then((rec) => setSttEngine(rec.sttEngine))
      .catch((e) => console.warn('[settings] Failed to load engine selection:', e))
  }, [])

  useEffect(() => {
    window.api.detectGpu()
      .then(setGpuInfo)
      .catch(() => setGpuInfo({ hasGpu: false, gpuNames: [] }))
  }, [])

  return {
    sttEngine,
    gpuInfo,
    simulMtEnabled, setSimulMtEnabled,
    simulMtWaitK, setSimulMtWaitK,
    glossaryTerms, setGlossaryTerms,
    orgGlossaryTerms, setOrgGlossaryTerms
  }
}
