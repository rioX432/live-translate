/**
 * Simple speaker tracking based on silence gaps between speech segments.
 * When a silence gap exceeds the threshold, a new speaker is assumed.
 * This is a heuristic approach — for production-quality diarization,
 * a dedicated model (e.g., pyannote.audio) would be needed.
 */

const SPEAKER_CHANGE_GAP_MS = 2000

/** Default 8-color palette for speaker identification */
export const SPEAKER_COLORS = [
  '#60a5fa', '#4ade80', '#f472b6', '#facc15',
  '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'
]
export const SPEAKER_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/**
 * Map a speakerId string (e.g. "Speaker A") to its palette color.
 * Returns undefined if the speakerId does not match the expected format.
 */
export function getSpeakerColor(speakerId: string): string | undefined {
  const match = speakerId.match(/^Speaker ([A-H])$/)
  if (!match) return undefined
  const idx = match[1]!.charCodeAt(0) - 'A'.charCodeAt(0)
  return SPEAKER_COLORS[idx]
}

export class SpeakerTracker {
  private currentSpeaker = 0
  private lastSpeechTimestamp = 0
  private speakerCount = 1

  /** Call on each speech segment to track speaker changes */
  update(timestamp: number): string {
    if (this.lastSpeechTimestamp > 0) {
      const gap = timestamp - this.lastSpeechTimestamp
      if (gap > SPEAKER_CHANGE_GAP_MS) {
        // Potential speaker change — cycle to next speaker
        this.currentSpeaker = (this.currentSpeaker + 1) % SPEAKER_COLORS.length
        if (this.currentSpeaker >= this.speakerCount) {
          this.speakerCount = this.currentSpeaker + 1
        }
      }
    }
    this.lastSpeechTimestamp = timestamp
    return this.getSpeakerId()
  }

  getSpeakerId(): string {
    return `Speaker ${SPEAKER_NAMES[this.currentSpeaker % SPEAKER_NAMES.length]}`
  }

  getColor(): string {
    return SPEAKER_COLORS[this.currentSpeaker % SPEAKER_COLORS.length]!
  }

  reset(): void {
    this.currentSpeaker = 0
    this.lastSpeechTimestamp = 0
    this.speakerCount = 1
  }
}
