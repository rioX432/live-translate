export interface ElectronAPI {
  pipelineStart: (config: unknown) => Promise<{ success?: boolean; error?: string }>
  pipelineStop: () => Promise<{ logPath?: string }>
  processAudio: (audioData: number[]) => Promise<unknown>
  processAudioStreaming: (audioData: number[]) => Promise<unknown>
  finalizeStreaming: (audioData: number[]) => Promise<unknown>
  sendTranslationResult: (data: unknown) => void
  onTranslationResult: (callback: (data: unknown) => void) => (() => void)
  onInterimResult: (callback: (data: unknown) => void) => (() => void)
  onStatusUpdate: (callback: (message: string) => void) => (() => void)
  getDisplays: () => Promise<
    Array<{
      id: number
      label: string
      bounds: { x: number; y: number; width: number; height: number }
    }>
  >
  moveSubtitleToDisplay: (displayId: number) => Promise<{ success?: boolean; error?: string }>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
  getCrashedSession: () => Promise<{ config: Record<string, unknown>; startedAt: number } | null>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
