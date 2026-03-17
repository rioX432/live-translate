/**
 * Local Agreement algorithm for streaming speech recognition.
 *
 * Compares consecutive Whisper transcription results and only emits
 * text that both results agree on (longest common prefix).
 * This reduces flickering and provides stable interim display.
 *
 * Reference: "Turning Whisper into Real-Time Transcription System" (IJCNLP 2023)
 */

export interface AgreementResult {
  /** Text confirmed by agreement between consecutive transcriptions */
  confirmedText: string
  /** New confirmed text since last update (delta) */
  newConfirmed: string
  /** Unconfirmed text beyond the agreed prefix */
  interimText: string
}

export class LocalAgreement {
  private previousTranscript = ''
  private confirmedText = ''

  /**
   * Feed a new transcription result and compute agreement.
   * Call this each time Whisper produces output on the rolling buffer.
   */
  update(newTranscript: string): AgreementResult {
    const commonPrefix = longestCommonPrefix(this.previousTranscript, newTranscript)

    let newConfirmed = ''
    if (commonPrefix.length > this.confirmedText.length) {
      newConfirmed = commonPrefix.slice(this.confirmedText.length)
      this.confirmedText = commonPrefix
    }

    this.previousTranscript = newTranscript

    // Interim is whatever extends beyond the confirmed prefix in the new transcript
    const interimText = newTranscript.slice(this.confirmedText.length)

    return {
      confirmedText: this.confirmedText,
      newConfirmed,
      interimText
    }
  }

  /**
   * Finalize the current speech segment.
   * Promotes all remaining text to confirmed and resets state.
   */
  finalize(finalTranscript: string): AgreementResult {
    const fullText = finalTranscript || this.previousTranscript
    const newConfirmed = fullText.slice(this.confirmedText.length)

    const result: AgreementResult = {
      confirmedText: fullText,
      newConfirmed,
      interimText: ''
    }

    this.reset()
    return result
  }

  /** Reset state for a new speech segment */
  reset(): void {
    this.previousTranscript = ''
    this.confirmedText = ''
  }
}

/**
 * Compute the longest common prefix of two strings.
 * Breaks at word boundaries to avoid partial-word confirmation.
 */
function longestCommonPrefix(a: string, b: string): string {
  const minLen = Math.min(a.length, b.length)
  let i = 0
  while (i < minLen && a[i] === b[i]) {
    i++
  }

  // If we matched the entire shorter string, return as-is
  if (i === a.length || i === b.length) {
    return a.slice(0, i)
  }

  // Snap to last word boundary to avoid confirming partial words
  const raw = a.slice(0, i)
  const lastSpace = raw.lastIndexOf(' ')
  if (lastSpace > 0) {
    return raw.slice(0, lastSpace + 1)
  }

  // No word boundary found — return empty to avoid partial-word confirmation
  return ''
}
