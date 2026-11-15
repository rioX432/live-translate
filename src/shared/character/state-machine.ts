import type { CharacterMode, CharacterState, CharacterStatus } from './types'

/** Pipeline states as emitted by TranslationPipeline 'state-change' */
export type PipelineStateName = 'idle' | 'initializing' | 'running' | 'recovering'

export type CharacterEvent =
  | { type: 'pipeline-state'; state: PipelineStateName }
  | { type: 'engine-loading' }
  | { type: 'engine-ready' }
  /** Interim or draft text arrived: speech is being processed */
  | { type: 'speech-activity' }
  | { type: 'translation-result'; lowConfidence: boolean }
  | { type: 'error' }
  | { type: 'term-learned' }
  | { type: 'activity-expired' }
  | { type: 'transient-expired' }
  | { type: 'idle-timeout' }

type TransientState = Extract<CharacterState, 'error' | 'learned' | 'uncertain'>

export interface CharacterMachine {
  recording: boolean
  loading: boolean
  translating: boolean
  transient: TransientState | null
  sleeping: boolean
}

export const INITIAL_CHARACTER_MACHINE: CharacterMachine = {
  recording: false,
  loading: false,
  translating: false,
  transient: null,
  sleeping: false
}

/** How long one-shot states stay visible before returning to the base state */
export const TRANSIENT_DURATION_MS: Record<TransientState, number> = {
  error: 4000,
  learned: 1500,
  uncertain: 2500
}

/** If no result follows speech activity, stop showing "translating" after this */
export const ACTIVITY_TIMEOUT_MS = 4000

/** Standby time without any event before the character dozes off */
export const IDLE_SLEEP_MS = 5 * 60 * 1000

const TRANSIENT_PRIORITY: Record<TransientState, number> = { error: 3, learned: 2, uncertain: 1 }

function withTransient(m: CharacterMachine, next: TransientState): CharacterMachine {
  // A lower-priority flash must not hide a visible error
  if (m.transient && TRANSIENT_PRIORITY[m.transient] > TRANSIENT_PRIORITY[next]) return m
  return { ...m, transient: next, sleeping: false }
}

function reducePipelineState(m: CharacterMachine, state: PipelineStateName): CharacterMachine {
  switch (state) {
    case 'initializing':
    case 'recovering':
      return { ...m, recording: true, loading: true, translating: false, sleeping: false }
    case 'running':
      return { ...m, recording: true, loading: false, sleeping: false }
    case 'idle':
      // Stopping clears meeting-only flashes but keeps a visible error
      return {
        ...m,
        recording: false,
        loading: false,
        translating: false,
        transient: m.transient === 'error' ? 'error' : null,
        sleeping: false
      }
  }
}

export function reduceCharacter(m: CharacterMachine, event: CharacterEvent): CharacterMachine {
  switch (event.type) {
    case 'pipeline-state':
      return reducePipelineState(m, event.state)
    case 'engine-loading':
      return { ...m, loading: true, sleeping: false }
    case 'engine-ready':
      return { ...m, loading: false }
    case 'speech-activity':
      return m.recording ? { ...m, translating: true, sleeping: false } : m
    case 'translation-result': {
      const next = { ...m, translating: false, sleeping: false }
      return event.lowConfidence ? withTransient(next, 'uncertain') : next
    }
    case 'error':
      return withTransient({ ...m, translating: false }, 'error')
    case 'term-learned':
      return withTransient(m, 'learned')
    case 'activity-expired':
      return { ...m, translating: false }
    case 'transient-expired':
      return { ...m, transient: null }
    case 'idle-timeout':
      return m.recording || m.loading ? m : { ...m, sleeping: true }
  }
}

export function characterMode(m: CharacterMachine): CharacterMode {
  return m.recording ? 'meeting' : 'standby'
}

export function characterState(m: CharacterMachine): CharacterState {
  if (m.transient) return m.transient
  if (m.loading) return 'loading'
  if (m.recording) return m.translating ? 'translating' : 'listening'
  return m.sleeping ? 'sleeping' : 'idle'
}

export function characterStatus(m: CharacterMachine): CharacterStatus {
  return { state: characterState(m), mode: characterMode(m) }
}

/** Below this STT confidence a result shows the "unsure" reaction */
export const LOW_CONFIDENCE_THRESHOLD = 0.5
