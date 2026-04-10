import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Pipeline control
  pipelineStart: (config: unknown) => ipcRenderer.invoke('pipeline-start', config),
  pipelineStop: () => ipcRenderer.invoke('pipeline-stop'),
  processAudio: (audioData: number[]) => ipcRenderer.invoke('process-audio', audioData),
  processAudioStreaming: (audioData: number[]) => ipcRenderer.invoke('process-audio-streaming', audioData),
  finalizeStreaming: (audioData: number[]) => ipcRenderer.invoke('finalize-streaming', audioData),

  // Translation results
  onTranslationResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('translation-result', handler)
    return () => ipcRenderer.off('translation-result', handler)
  },
  onInterimResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('interim-result', handler)
    return () => ipcRenderer.off('interim-result', handler)
  },
  // Draft result from hybrid translation (#235)
  onDraftResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('draft-result', handler)
    return () => ipcRenderer.off('draft-result', handler)
  },

  // Status updates from main process
  onStatusUpdate: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('status-update', handler)
    return () => ipcRenderer.off('status-update', handler)
  },

  // Session info
  getSessionStartTime: () => ipcRenderer.invoke('get-session-start-time'),

  // Display management
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  moveSubtitleToDisplay: (displayId: number) =>
    ipcRenderer.send('move-subtitle-to-display', displayId),

  // Settings persistence (#49)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-settings', settings),

  // Crash recovery (#54)
  getCrashedSession: () => ipcRenderer.invoke('get-crashed-session'),

  // Session management (#121)
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  loadSession: (id: string) => ipcRenderer.invoke('load-session', id),
  searchSessions: (query: string) => ipcRenderer.invoke('search-sessions', query),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  exportSession: (id: string, format: string) => ipcRenderer.invoke('export-session', id, format),

  // GGUF model management (#133)
  getGgufVariants: (modelSize?: string) => ipcRenderer.invoke('get-gguf-variants', modelSize),

  // Plugin management (#127)
  listPlugins: () => ipcRenderer.invoke('list-plugins'),

  // Session logs (#116)
  getSessionLogs: () => ipcRenderer.invoke('get-session-logs'),

  // Meeting summary (#124)
  generateSummary: (transcriptPath: string) =>
    ipcRenderer.invoke('generate-summary', transcriptPath),

  // GPU detection (#132)
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),

  // Subtitle settings (#118)
  saveSubtitleSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-subtitle-settings', settings),
  onSubtitleSettingsChanged: (callback: (settings: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown): void => callback(settings)
    ipcRenderer.on('subtitle-settings-changed', handler)
    return () => ipcRenderer.off('subtitle-settings-changed', handler)
  },

  // Glossary management (#240, #517)
  saveGlossary: (terms: Array<{ source: string; target: string }>) =>
    ipcRenderer.invoke('save-glossary', terms),
  saveOrgGlossary: (terms: Array<{ source: string; target: string }>) =>
    ipcRenderer.invoke('save-org-glossary', terms),
  importGlossary: (target: 'personal' | 'org') =>
    ipcRenderer.invoke('import-glossary', target),
  exportGlossary: (target: 'personal' | 'org', format: 'json' | 'csv') =>
    ipcRenderer.invoke('export-glossary', target, format),
  getMergedGlossary: () => ipcRenderer.invoke('get-merged-glossary'),

  // #238: Check if draft model is available for speculative decoding
  isDraftModelAvailable: (engine?: string) => ipcRenderer.invoke('is-draft-model-available', engine),

  // #261: Whisper model variant info
  getWhisperVariants: () => ipcRenderer.invoke('get-whisper-variants'),

  // #243: Platform detection for hiding platform-specific options
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // #548: macOS version detection for Apple SpeechTranscriber (macOS 26+)
  getMacOSVersion: () => ipcRenderer.invoke('get-macos-version') as Promise<string | null>,

  // Display change notifications (#192)
  onDisplaysChanged: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('displays-changed', handler)
    return () => ipcRenderer.off('displays-changed', handler)
  },

  // WebSocket audio server for Chrome extension (#264)
  wsAudioStart: (port?: number) => ipcRenderer.invoke('ws-audio-start', port),
  wsAudioStop: () => ipcRenderer.invoke('ws-audio-stop'),
  wsAudioGetStatus: () => ipcRenderer.invoke('ws-audio-get-status'),
  onWsAudioStatus: (callback: (status: { running: boolean; connected: boolean; port: number | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { running: boolean; connected: boolean; port: number | null }): void => callback(status)
    ipcRenderer.on('ws-audio-status', handler)
    return () => ipcRenderer.off('ws-audio-status', handler)
  },

  // System audio loopback (#501)
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  // Subtitle drag mode (#509)
  toggleSubtitleDragMode: (enabled: boolean) =>
    ipcRenderer.invoke('toggle-subtitle-drag-mode', enabled),
  // Subtitle edit mode (#590)
  toggleSubtitleEditMode: (enabled: boolean) =>
    ipcRenderer.invoke('toggle-subtitle-edit-mode', enabled),
  onEditModeChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean): void => callback(enabled)
    ipcRenderer.on('edit-mode-changed', handler)
    return () => ipcRenderer.off('edit-mode-changed', handler)
  },
  // Translation corrections (#590)
  saveCorrection: (correction: { sourceText: string; originalTranslation: string; correctedTranslation: string }) =>
    ipcRenderer.invoke('save-correction', correction),
  getCorrectionHistory: () => ipcRenderer.invoke('get-correction-history'),
  clearCorrectionHistory: () => ipcRenderer.invoke('clear-correction-history'),
  moveSubtitleByDelta: (dx: number, dy: number) =>
    ipcRenderer.send('move-subtitle-by-delta', dx, dy),
  saveSubtitlePosition: () => ipcRenderer.invoke('save-subtitle-position'),
  resetSubtitlePosition: () => ipcRenderer.invoke('reset-subtitle-position'),
  onDragModeChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean): void => callback(enabled)
    ipcRenderer.on('drag-mode-changed', handler)
    return () => ipcRenderer.off('drag-mode-changed', handler)
  },

  // TTS (#508)
  ttsSetEnabled: (enabled: boolean) => ipcRenderer.invoke('tts-set-enabled', enabled),
  ttsSetVoice: (voiceId: string) => ipcRenderer.invoke('tts-set-voice', voiceId),
  ttsSetVolume: (volume: number) => ipcRenderer.invoke('tts-set-volume', volume),
  ttsSetOutputDevice: (deviceId: string) => ipcRenderer.invoke('tts-set-output-device', deviceId),
  ttsGetSettings: () => ipcRenderer.invoke('tts-get-settings'),
  onTtsAudio: (callback: (data: { audio: number[]; sampleRate: number; volume: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { audio: number[]; sampleRate: number; volume: number }): void => callback(data)
    ipcRenderer.on('tts-audio', handler)
    return () => ipcRenderer.off('tts-audio', handler)
  },

  // Virtual Mic (#515)
  virtualMicGetStatus: () => ipcRenderer.invoke('virtual-mic-get-status'),
  virtualMicEnable: (deviceId: number) => ipcRenderer.invoke('virtual-mic-enable', deviceId),
  virtualMicDisable: () => ipcRenderer.invoke('virtual-mic-disable'),
  virtualMicRefreshDevices: () => ipcRenderer.invoke('virtual-mic-refresh-devices'),

  // Quick Start onboarding (#510)
  quickStartRecommend: () => ipcRenderer.invoke('quick-start-recommend'),
  quickStartApply: (options: { sourceLanguage: string; targetLanguage: string; recommendation: unknown }) =>
    ipcRenderer.invoke('quick-start-apply', options),
  quickStartIsCompleted: () => ipcRenderer.invoke('quick-start-is-completed'),
  quickStartSkip: () => ipcRenderer.invoke('quick-start-skip'),
  quickStartSystemInfo: () => ipcRenderer.invoke('quick-start-system-info'),

  // Enterprise features (#519)
  enterpriseGetUsageSummary: (days?: number) => ipcRenderer.invoke('enterprise-get-usage-summary', days),
  enterpriseGetQuickStats: () => ipcRenderer.invoke('enterprise-get-quick-stats'),
  enterpriseGetMdmConfig: () => ipcRenderer.invoke('enterprise-get-mdm-config'),
  enterpriseGetTelemetryConsent: () => ipcRenderer.invoke('enterprise-get-telemetry-consent'),
  enterpriseSetTelemetryConsent: (consent: boolean) => ipcRenderer.invoke('enterprise-set-telemetry-consent', consent),

  // Audio MessagePort for zero-copy transfer (#553)
  onAudioPort: (callback: (port: MessagePort) => void) => {
    const handler = (event: Electron.IpcRendererEvent): void => {
      if (event.ports && event.ports.length > 0) {
        callback(event.ports[0])
      }
    }
    ipcRenderer.on('audio-port', handler)
    return () => ipcRenderer.off('audio-port', handler)
  },

  // Onboarding: cloud-first progressive download (#575)
  onboardingGetStatus: () => ipcRenderer.invoke('onboarding-get-status'),
  onboardingStartDownload: () => ipcRenderer.invoke('onboarding-start-download'),
  onboardingSwitchToLocal: () => ipcRenderer.invoke('onboarding-switch-to-local'),
  onboardingDismiss: () => ipcRenderer.invoke('onboarding-dismiss'),
  onboardingSetPreferredEngine: (engine: string) => ipcRenderer.invoke('onboarding-set-preferred-engine', engine),
  onboardingIsFirstRun: () => ipcRenderer.invoke('onboarding-is-first-run'),
  onOnboardingDownloadProgress: (callback: (data: { status: string; progress: number; message?: string; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; progress: number; message?: string; error?: string }): void => callback(data)
    ipcRenderer.on('onboarding-download-progress', handler)
    return () => ipcRenderer.off('onboarding-download-progress', handler)
  },

  // Keyboard shortcuts (#509)
  getShortcutLabels: () => ipcRenderer.invoke('get-shortcut-labels'),
  onShortcutAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string): void => callback(action)
    ipcRenderer.on('shortcut-action', handler)
    return () => ipcRenderer.off('shortcut-action', handler)
  },
  onLanguageSwitched: (callback: (data: { sourceLanguage: string; targetLanguage: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sourceLanguage: string; targetLanguage: string }): void => callback(data)
    ipcRenderer.on('language-switched', handler)
    return () => ipcRenderer.off('language-switched', handler)
  },

  // Auto-update (#314)
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  updateGetStatus: () => ipcRenderer.invoke('update-get-status'),
  onUpdateStatus: (callback: (status: { state: string; version?: string; progress?: number; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { state: string; version?: string; progress?: number; error?: string }): void => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.off('update-status', handler)
  }
})
