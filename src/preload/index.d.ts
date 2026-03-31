export interface ElectronAPI {
  pipelineStart: (config: unknown) => Promise<{ success?: boolean; error?: string }>
  pipelineStop: () => Promise<{ logPath?: string }>
  processAudio: (audioData: number[]) => Promise<unknown>
  processAudioStreaming: (audioData: number[]) => Promise<unknown>
  finalizeStreaming: (audioData: number[]) => Promise<unknown>
  onTranslationResult: (callback: (data: unknown) => void) => (() => void)
  onInterimResult: (callback: (data: unknown) => void) => (() => void)
  onDraftResult: (callback: (data: unknown) => void) => (() => void)
  onStatusUpdate: (callback: (message: string) => void) => (() => void)
  getSessionStartTime: () => Promise<number | null>
  getDisplays: () => Promise<
    Array<{
      id: number
      label: string
      bounds: { x: number; y: number; width: number; height: number }
    }>
  >
  moveSubtitleToDisplay: (displayId: number) => void
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
  getCrashedSession: () => Promise<{ config: Record<string, unknown>; startedAt: number } | null>
  listSessions: () => Promise<Array<{ id: string; startedAt: number; endedAt?: number; engineMode: string; entryCount: number }>>
  loadSession: (id: string) => Promise<unknown>
  searchSessions: (query: string) => Promise<Array<{ sessionId: string; matches: unknown[] }>>
  deleteSession: (id: string) => Promise<{ success: boolean }>
  exportSession: (id: string, format: string) => Promise<{ content?: string; ext?: string; error?: string }>
  getGgufVariants: (modelSize?: string) => Promise<Array<{ key: string; label: string; filename: string; sizeMB: number; downloaded: boolean }>>
  listPlugins: () => Promise<Array<{ name: string; version: string; engineType: string; engineId: string }>>
  getSessionLogs: () => Promise<Array<{ startedAt: number; endedAt: number; engineMode: string; durationMs: number }>>
  generateSummary: (transcriptPath: string) => Promise<{ summary?: string; error?: string }>
  detectGpu: () => Promise<{ hasGpu: boolean; gpuNames: string[] }>
  saveSubtitleSettings: (settings: Record<string, unknown>) => Promise<void>
  onSubtitleSettingsChanged: (callback: (settings: unknown) => void) => (() => void)
  onDisplaysChanged: (callback: () => void) => (() => void)
  getWhisperVariants: () => Promise<Array<{ key: string; label: string; description: string; filename: string; sizeMB: number; downloaded: boolean }>>
  getPlatform: () => Promise<string>
  saveGlossary: (terms: Array<{ source: string; target: string }>) => Promise<void>
  saveOrgGlossary: (terms: Array<{ source: string; target: string }>) => Promise<void>
  importGlossary: (target: 'personal' | 'org') => Promise<{
    entries?: Array<{ source: string; target: string }>
    count?: number
    canceled?: boolean
    error?: string
  }>
  exportGlossary: (target: 'personal' | 'org', format: 'json' | 'csv') => Promise<{
    success?: boolean
    path?: string
    count?: number
    canceled?: boolean
    error?: string
  }>
  getMergedGlossary: () => Promise<{
    merged: Array<{ source: string; target: string }>
    conflicts: Array<{ source: string; personalTarget: string; orgTarget: string }>
    personalCount: number
    orgCount: number
  }>
  isDraftModelAvailable: (engine?: string) => Promise<boolean>
  wsAudioStart: (port?: number) => Promise<void>
  wsAudioStop: () => Promise<void>
  wsAudioGetStatus: () => Promise<{ running: boolean; connected: boolean; port: number | null }>
  onWsAudioStatus: (callback: (status: { running: boolean; connected: boolean; port: number | null }) => void) => (() => void)
  // System audio loopback (#501)
  enableLoopbackAudio: () => Promise<void>
  disableLoopbackAudio: () => Promise<void>
  // TTS (#508)
  ttsSetEnabled: (enabled: boolean) => Promise<{ success?: boolean; error?: string }>
  ttsSetVoice: (voiceId: string) => Promise<void>
  ttsSetVolume: (volume: number) => Promise<void>
  ttsSetOutputDevice: (deviceId: string) => Promise<void>
  ttsGetSettings: () => Promise<{ enabled: boolean; voice: string; outputDevice: string; volume: number }>
  onTtsAudio: (callback: (data: { audio: number[]; sampleRate: number; volume: number }) => void) => (() => void)

  // Virtual Mic (#515)
  virtualMicGetStatus: () => Promise<{
    enabled: boolean
    activeDeviceId: number | null
    activeDeviceName: string | null
    availableDevices: Array<{ id: number; name: string; maxOutputChannels: number; defaultSampleRate: number }>
  }>
  virtualMicEnable: (deviceId: number) => Promise<{ success?: boolean; error?: string }>
  virtualMicDisable: () => Promise<{ success?: boolean; error?: string }>
  virtualMicRefreshDevices: () => Promise<Array<{ id: number; name: string; maxOutputChannels: number; defaultSampleRate: number }>>

  // Quick Start onboarding (#510)
  quickStartRecommend: () => Promise<{
    sttEngine: string
    translationEngine: string
    whisperVariant: string
    downloads: Array<{ type: string; key: string; filename: string; url: string; sizeMB: number; label: string }>
    totalDownloadMB: number
    needsDownload: boolean
    fallbackEngine: string | null
    reason: string
  }>
  quickStartApply: (options: { sourceLanguage: string; targetLanguage: string; recommendation: unknown }) => Promise<{ success: boolean }>
  quickStartIsCompleted: () => Promise<boolean>
  quickStartSkip: () => Promise<{ success: boolean }>
  quickStartSystemInfo: () => Promise<{ platform: string; totalMemoryMB: number; gpuInfo: { hasGpu: boolean; gpuNames: string[] } }>

  // Enterprise features (#519)
  enterpriseGetUsageSummary: (days?: number) => Promise<{
    periodStart: string
    periodEnd: string
    totalSessions: number
    totalDurationMs: number
    totalCharacters: number
    averageSessionDurationMs: number
    engineBreakdown: Record<string, number>
    languagePairBreakdown: Record<string, number>
    dailyStats: Array<{
      date: string
      totalSessionCount: number
      totalDurationMs: number
      totalCharacterCount: number
      engineUsage: Record<string, number>
      languagePairs: Record<string, number>
    }>
    error?: string
  }>
  enterpriseGetQuickStats: () => Promise<{ totalSessions: number; totalDurationMs: number }>
  enterpriseGetMdmConfig: () => Promise<{
    lockedEngine: string | null
    lockedSttEngine: string | null
    telemetryDisabled: boolean
    hasManagedApiKey: boolean
    hasManagedDeeplApiKey: boolean
    hasManagedGeminiApiKey: boolean
    organizationName: string | null
    autoUpdateDisabled: boolean
  }>
  enterpriseGetTelemetryConsent: () => Promise<{
    consent: boolean
    consentShown: boolean
    mdmDisabled: boolean
  }>
  enterpriseSetTelemetryConsent: (consent: boolean) => Promise<{ success: boolean; reason?: string }>

  // Auto-update (#314)
  updateCheck: () => Promise<{ success?: boolean; error?: string }>
  updateDownload: () => Promise<{ success?: boolean; error?: string }>
  updateInstall: () => Promise<{ success?: boolean; deferred?: boolean }>
  updateGetStatus: () => Promise<{ state: string; version?: string; progress?: number; error?: string }>
  onUpdateStatus: (callback: (status: { state: string; version?: string; progress?: number; error?: string }) => void) => (() => void)
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
