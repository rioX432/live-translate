/** A pipeline result as the subtitle window receives it over IPC. */
export interface SubtitleResult {
  segmentId?: string
  sourceText: string
  translatedText: string
  confirmedText?: string
  interimText?: string
  speakerLabel?: string
  speakerIndex?: number
  /** Sentence-level confidence from STT (0.0–1.0) */
  confidence?: number
  /** Per-token confidence scores for translated text (0.0–1.0 each) */
  tokenConfidences?: number[]
}

export interface SubtitleLine {
  segmentId?: string
  confirmedText: string
  interimText: string
  translatedText: string
  final: boolean
  confidence?: number
  tokenConfidences?: number[]
  speakerLabel?: string
  speakerIndex?: number
}

export interface SubtitleState {
  /** The utterance being spoken now, or the latest final when nobody is speaking. */
  current: SubtitleLine | null
  /** The utterance before `current`, kept on screen so a new interim never wipes it. */
  previous: SubtitleLine | null
  /** Recently closed segments; late interims for them are ignored. */
  closed: string[]
  error: string | null
}

export type SubtitleAction =
  | { type: 'result'; final: boolean; result: SubtitleResult }
  | { type: 'dropped'; segmentId: string }
  | { type: 'status'; state: string; error?: string }
  | { type: 'corrected'; segmentId?: string; translatedText: string }

export const INITIAL_SUBTITLE_STATE: SubtitleState = { current: null, previous: null, closed: [], error: null }

const MAX_CLOSED_IDS = 64

function close(closed: string[], segmentId?: string): string[] {
  if (!segmentId || closed.includes(segmentId)) return closed
  const next = [...closed, segmentId]
  return next.length > MAX_CLOSED_IDS ? next.slice(next.length - MAX_CLOSED_IDS) : next
}

function sameSegment(line: SubtitleLine | null, segmentId?: string): line is SubtitleLine {
  return !!line && line.segmentId === segmentId
}

function toLine(result: SubtitleResult, final: boolean, prior?: SubtitleLine): SubtitleLine {
  const split = !final && result.confirmedText !== undefined
  return {
    segmentId: result.segmentId ?? prior?.segmentId,
    confirmedText: split ? result.confirmedText! : result.sourceText,
    interimText: split ? result.interimText ?? '' : '',
    // An interim without a translation yet keeps this segment's last one; it
    // never inherits another segment's translation.
    translatedText: result.translatedText || (final ? '' : prior?.translatedText ?? ''),
    final,
    confidence: result.confidence,
    tokenConfidences: result.tokenConfidences,
    speakerLabel: result.speakerLabel ?? prior?.speakerLabel,
    speakerIndex: result.speakerLabel !== undefined ? result.speakerIndex ?? 0 : prior?.speakerIndex
  }
}

function applyResult(state: SubtitleState, final: boolean, result: SubtitleResult): SubtitleState {
  // Drafts from the hybrid translator carry no segment ID; they belong to the live line.
  const id = result.segmentId ?? (!final && state.current && !state.current.final ? state.current.segmentId : undefined)
  if (!result.sourceText?.trim()) return state
  if (!final && id && state.closed.includes(id)) return state
  const closed = final ? close(state.closed, id) : state.closed

  // Without segment IDs (older producers) a final always closes the line.
  if (sameSegment(state.current, id) && (id !== undefined || !state.current.final)) {
    return { ...state, closed, current: toLine(result, final, state.current) }
  }
  if (id && sameSegment(state.previous, id)) {
    // A final that lands after the next utterance already started.
    if (!final) return state
    return { ...state, closed, previous: toLine(result, final, state.previous) }
  }
  if (final && state.current && !state.current.final) {
    // A final for an older segment while a newer one is live: show it above.
    return { ...state, closed, previous: toLine(result, final) }
  }
  return { ...state, closed, previous: state.current, current: toLine(result, final) }
}

export function subtitleReducer(state: SubtitleState, action: SubtitleAction): SubtitleState {
  switch (action.type) {
    case 'result': {
      const next = applyResult(state, action.final, action.result)
      // A final that made it through means STT is working again.
      return action.final && next !== state && next.error ? { ...next, error: null } : next
    }
    case 'dropped': {
      const closed = close(state.closed, action.segmentId)
      // The segment produced no final: take its interim off the screen.
      if (sameSegment(state.current, action.segmentId) && !state.current.final) {
        return { ...state, closed, current: state.previous, previous: null }
      }
      if (sameSegment(state.previous, action.segmentId) && !state.previous.final) {
        return { ...state, closed, previous: null }
      }
      return { ...state, closed }
    }
    case 'status':
      if (action.error) return { ...state, error: action.error }
      return action.state === 'running' && state.error ? { ...state, error: null } : state
    case 'corrected':
      if (sameSegment(state.current, action.segmentId)) {
        return { ...state, current: { ...state.current, translatedText: action.translatedText } }
      }
      if (sameSegment(state.previous, action.segmentId)) {
        return { ...state, previous: { ...state.previous, translatedText: action.translatedText } }
      }
      return state
  }
}
