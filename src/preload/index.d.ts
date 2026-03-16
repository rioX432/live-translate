export interface ElectronAPI {
  sendTranslationResult: (data: unknown) => void
  onTranslationResult: (callback: (data: unknown) => void) => void
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
