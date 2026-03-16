export interface ElectronAPI {
  pipelineStart: (config: unknown) => Promise<{ success?: boolean; error?: string }>
  pipelineStop: () => Promise<{ logPath?: string }>
  processAudio: (audioBuffer: ArrayBuffer) => Promise<unknown>
  sendTranslationResult: (data: unknown) => void
  onTranslationResult: (callback: (data: unknown) => void) => void
  onStatusUpdate: (callback: (message: string) => void) => void
  getDisplays: () => Promise<
    Array<{
      id: number
      label: string
      bounds: { x: number; y: number; width: number; height: number }
    }>
  >
  moveSubtitleToDisplay: (displayId: number) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
