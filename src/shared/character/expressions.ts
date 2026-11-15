import type { AnimationPreference, CharacterAppearance, CharacterReactions, CharacterState } from './types'

export type CharacterExpression =
  | 'neutral'
  | 'attentive'
  | 'thinking'
  | 'puzzled'
  | 'happy'
  | 'busy'
  | 'worried'
  | 'sleepy'

const STATE_EXPRESSIONS: Record<CharacterState, CharacterExpression> = {
  idle: 'neutral',
  listening: 'attentive',
  translating: 'thinking',
  uncertain: 'puzzled',
  learned: 'happy',
  loading: 'busy',
  error: 'worried',
  sleeping: 'sleepy'
}

export function expressionForState(state: CharacterState, reactions: CharacterReactions): CharacterExpression {
  if (!reactions.expressions) return 'neutral'
  return STATE_EXPRESSIONS[state]
}

/** Short motion played once when entering a state; null means stay still */
export type CharacterMotion = 'hop' | 'sparkle' | 'tilt' | 'shake' | 'breathe' | null

export function motionForState(
  state: CharacterState,
  reactions: CharacterReactions,
  reducedMotion: boolean
): CharacterMotion {
  if (reducedMotion) return null
  switch (state) {
    case 'learned':
      return reactions.learned === 'none' ? null : reactions.learned
    case 'uncertain':
      return reactions.uncertain === 'none' ? null : reactions.uncertain
    case 'error':
      return reactions.error === 'none' ? null : reactions.error
    case 'listening':
      return 'breathe'
    default:
      return null
  }
}

/** Image asset file for a state; imported characters may supply only an idle image */
export function assetForState(appearance: CharacterAppearance, state: CharacterState): string | null {
  if (appearance.kind !== 'image') return null
  return appearance.assets[state] ?? appearance.assets.idle ?? null
}

/**
 * Whether the character should stay still. "off" always wins; "on" is the
 * user's explicit choice and ignores the OS setting, but the app-wide
 * accessibility "reduce motion" still applies.
 */
export function isMotionReduced(preference: AnimationPreference, osReduced: boolean, appReduced: boolean): boolean {
  if (preference === 'off') return true
  if (preference === 'on') return appReduced
  return osReduced || appReduced
}

export const STATE_LABELS: Record<CharacterState, string> = {
  idle: 'Waiting',
  listening: 'Listening',
  translating: 'Translating',
  uncertain: 'Unsure about a word',
  learned: 'Learned a term',
  loading: 'Loading model',
  error: 'Something went wrong',
  sleeping: 'Sleeping'
}
