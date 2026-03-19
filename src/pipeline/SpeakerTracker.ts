/**
 * Simple speaker tracking based on silence gaps between speech segments.
 * When a silence gap exceeds the threshold, a new speaker is assumed.
 * This is a heuristic approach — for production-quality diarization,
 * a dedicated model (e.g., pyannote.audio) would be needed.
 */

const SPEAKER_CHANGE_GAP_MS = 2000
const SPEAKER_COLORS = ['#60a5fa', '#4ade80', '#f472b6', '#facc15', '#a78bfa', '#fb923c']

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
    return `Speaker ${String.fromCharCode(65 + this.currentSpeaker)}`
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
