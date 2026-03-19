export interface ElectronAPI {
  pipelineStart: (config: unknown) => Promise<{ success?: boolean; error?: string }>
  pipelineStop: () => Promise<{ logPath?: string }>
  processAudio: (audioData: number[]) => Promise<unknown>
  processAudioStreaming: (audioData: number[]) => Promise<unknown>
  finalizeStreaming: (audioData: number[]) => Promise<unknown>
  onTranslationResult: (callback: (data: unknown) => void) => (() => void)
  onInterimResult: (callback: (data: unknown) => void) => (() => void)
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
  getGgufVariants: () => Promise<Array<{ key: string; label: string; filename: string; sizeMB: number; downloaded: boolean }>>
  listPlugins: () => Promise<Array<{ name: string; version: string; engineType: string; engineId: string }>>
  getSessionLogs: () => Promise<Array<{ startedAt: number; endedAt: number; engineMode: string; durationMs: number }>>
  generateSummary: (transcriptPath: string) => Promise<{ summary?: string; error?: string }>
  detectGpu: () => Promise<{ hasGpu: boolean; gpuNames: string[] }>
  saveSubtitleSettings: (settings: Record<string, unknown>) => Promise<void>
  onSubtitleSettingsChanged: (callback: (settings: unknown) => void) => (() => void)
  onDisplaysChanged: (callback: () => void) => (() => void)
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
