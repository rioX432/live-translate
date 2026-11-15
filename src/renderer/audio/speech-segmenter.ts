/** Audio for one speech segment, sent to the main process. */
export interface SegmentAudio {
  kind: 'interim' | 'final'
  segmentId: string
  audio: Float32Array
  /** Wall-clock ms (Date.now()) of the last speech frame; finals only. */
  speechEndedAt?: number
}

export interface SpeechSegmenterOptions {
  sampleRate: number
  /** Audio kept from before speech start, so the first syllable is not clipped. */
  preRollSamples: number
  /** A segment this long is split, so STT latency and interim cost stay bounded. */
  maxSegmentSamples: number
  /** The split point is the quietest frame within this many trailing samples. */
  splitSearchSamples: number
  /** Interims shorter than this carry too little audio for a useful hypothesis. */
  minInterimSamples: number
  newId: () => string
}

interface Frame {
  samples: Float32Array
  isSpeech: boolean
  at: number
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

function concat(frames: Frame[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.samples.length, 0))
  let offset = 0
  for (const f of frames) {
    out.set(f.samples, offset)
    offset += f.samples.length
  }
  return out
}

/**
 * Turns VAD frames and speech events into segments with stable IDs: interims
 * re-send the whole segment so far, and each segment gets exactly one final.
 *
 * Drive it in the order @ricky0123/vad-web fires its callbacks: `frame()` for
 * every frame, then `speechStart()` / `speechRealStart()` / `speechEnd()` /
 * `misfire()`. The library reports a frame before the speech start it causes,
 * so that frame is already in the pre-roll when the segment opens.
 */
export class SpeechSegmenter {
  private preRoll: Frame[] = []
  private preRollSamples = 0
  private frames: Frame[] = []
  private samples = 0
  private segmentId: string | null = null
  private real = false
  private interimSentAt = 0

  constructor(private readonly opts: SpeechSegmenterOptions) {}

  get activeSegmentId(): string | null {
    return this.segmentId
  }

  /** Add one VAD frame. Returns a final when the segment had to be split. */
  frame(samples: Float32Array, isSpeech: boolean, now: number): SegmentAudio | null {
    const f: Frame = { samples: new Float32Array(samples), isSpeech, at: now }
    if (!this.segmentId) {
      this.preRoll.push(f)
      this.preRollSamples += f.samples.length
      // Keep the newest frame (it may be the one that triggers speech start) plus up to preRollSamples before it.
      while (this.preRollSamples - f.samples.length > this.opts.preRollSamples) {
        this.preRollSamples -= this.preRoll.shift()!.samples.length
      }
      return null
    }
    this.frames.push(f)
    this.samples += f.samples.length
    return this.real && this.samples >= this.opts.maxSegmentSamples ? this.split() : null
  }

  speechStart(): void {
    if (this.segmentId) return
    this.segmentId = this.opts.newId()
    this.frames = this.preRoll
    this.samples = this.frames.reduce((n, f) => n + f.samples.length, 0)
    this.preRoll = []
    this.preRollSamples = 0
    this.real = false
    this.interimSentAt = 0
  }

  /** Speech lasted long enough that the VAD can no longer call it a misfire. */
  speechRealStart(): void {
    if (this.segmentId) this.real = true
  }

  /** The whole segment so far, when it has grown since the last interim. */
  interim(): SegmentAudio | null {
    if (!this.segmentId || !this.real) return null
    if (this.samples < this.opts.minInterimSamples || this.samples === this.interimSentAt) return null
    this.interimSentAt = this.samples
    return { kind: 'interim', segmentId: this.segmentId, audio: concat(this.frames) }
  }

  speechEnd(): SegmentAudio | null {
    return this.close()
  }

  /**
   * The VAD judged the speech too short. A misfire cannot follow a real start
   * in vad-web, but if one did, interims were already shown for this segment,
   * so it is closed with a final instead of being left open.
   */
  misfire(): SegmentAudio | null {
    if (this.real) return this.close()
    this.discard()
    return null
  }

  /** Capture is stopping: close a real segment, drop a tentative one. */
  flush(): SegmentAudio | null {
    return this.misfire()
  }

  reset(): void {
    this.preRoll = []
    this.preRollSamples = 0
    this.discard()
  }

  private close(): SegmentAudio | null {
    if (!this.segmentId) return null
    // A split can leave an empty continuation that no interim ever showed.
    if (this.samples === 0) {
      this.discard()
      return null
    }
    const final = this.finalOf(this.segmentId, this.frames)
    this.discard()
    return final
  }

  private discard(): void {
    this.segmentId = null
    this.frames = []
    this.samples = 0
    this.real = false
    this.interimSentAt = 0
  }

  private split(): SegmentAudio {
    // Cut after the quietest recent frame so a word is less likely to be halved.
    let searched = 0
    let cut = this.frames.length - 1
    let quietest = Infinity
    for (let i = this.frames.length - 1; i > 0 && searched < this.opts.splitSearchSamples; i--) {
      searched += this.frames[i].samples.length
      const level = rms(this.frames[i].samples)
      if (level < quietest) {
        quietest = level
        cut = i
      }
    }
    const head = this.frames.slice(0, cut + 1)
    const tail = this.frames.slice(cut + 1)
    const final = this.finalOf(this.segmentId!, head)
    this.segmentId = this.opts.newId()
    this.frames = tail
    this.samples = tail.reduce((n, f) => n + f.samples.length, 0)
    this.interimSentAt = 0
    return final
  }

  private finalOf(segmentId: string, frames: Frame[]): SegmentAudio {
    let speechEndedAt = frames.length ? frames[frames.length - 1].at : Date.now()
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].isSpeech) {
        speechEndedAt = frames[i].at
        break
      }
    }
    return { kind: 'final', segmentId, audio: concat(frames), speechEndedAt }
  }
}

/** Segment IDs unique across reloads: the main process may still hold IDs from the previous page. */
export function createSegmentIdFactory(random: () => number = Math.random): () => string {
  const session = Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0')
  let n = 0
  return () => `${session}-${++n}`
}
