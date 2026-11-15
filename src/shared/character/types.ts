/**
 * Character (desktop companion) types shared by the main process and renderer.
 *
 * Appearance and persona live here; glossary/memory and translation settings
 * are stored elsewhere so that switching or deleting a character never touches
 * what the AI has learned.
 */

export const CHARACTER_STATES = [
  'idle',
  'listening',
  'translating',
  'uncertain',
  'learned',
  'loading',
  'error',
  'sleeping'
] as const

export type CharacterState = (typeof CHARACTER_STATES)[number]

/** Recording on → meeting; recording off → standby. Never chosen by the user. */
export type CharacterMode = 'meeting' | 'standby'

export const BUILTIN_CHARACTER_IDS = ['mochi', 'pico'] as const
export type BuiltinCharacterId = (typeof BUILTIN_CHARACTER_IDS)[number]

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'gif', 'webp'] as const
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number]

export type CharacterAppearance =
  | { kind: 'builtin'; builtinId: BuiltinCharacterId }
  | {
      kind: 'image'
      /** File names inside userData/characters/<profile id>/; missing states fall back to idle */
      assets: Partial<Record<CharacterState, string>>
      pixelArt: boolean
    }

export const PERSONA_STYLES = ['friendly', 'polite', 'concise', 'cheerful'] as const
export type PersonaStyle = (typeof PERSONA_STYLES)[number]

/** Used only for future companion conversation, never for translation prompts */
export interface CharacterPersona {
  style: PersonaStyle
  firstPerson: string
  note: string
}

export const SPEECH_LENGTHS = ['short', 'normal', 'detailed'] as const
export const SPEECH_POLITENESS = ['polite', 'casual'] as const

/**
 * Speech style only. Voice output (TTS) is out of scope for now; `tts` is
 * reserved so a future voice engine can read the same profile.
 */
export interface CharacterVoice {
  length: (typeof SPEECH_LENGTHS)[number]
  politeness: (typeof SPEECH_POLITENESS)[number]
  tts: null
}

export const LEARNED_REACTIONS = ['hop', 'sparkle', 'none'] as const
export const UNCERTAIN_REACTIONS = ['tilt', 'none'] as const
export const ERROR_REACTIONS = ['shake', 'none'] as const

export interface CharacterReactions {
  /** Expression changes per state; off keeps the idle look in every state */
  expressions: boolean
  learned: (typeof LEARNED_REACTIONS)[number]
  uncertain: (typeof UNCERTAIN_REACTIONS)[number]
  error: (typeof ERROR_REACTIONS)[number]
}

export interface CharacterProfile {
  id: string
  name: string
  appearance: CharacterAppearance
  persona: CharacterPersona
  voice: CharacterVoice
  reactions: CharacterReactions
}

export const ANIMATION_PREFERENCES = ['follow-os', 'on', 'off'] as const
export type AnimationPreference = (typeof ANIMATION_PREFERENCES)[number]

export const MEETING_PRESENCES = ['compact', 'hidden'] as const
export type MeetingPresence = (typeof MEETING_PRESENCES)[number]

export interface CharacterPosition {
  x: number
  y: number
}

/** Display settings are per user, not per character, so switching keeps position and size */
export interface CharacterDisplaySettings {
  visible: boolean
  sizePx: number
  opacity: number
  animation: AnimationPreference
  inMeeting: MeetingPresence
  /** Keyed by Electron display id, same scheme as subtitlePositions */
  positionByDisplay: Record<string, CharacterPosition>
}

export interface CharacterSettings {
  schemaVersion: 1
  activeCharacterId: string
  characters: CharacterProfile[]
  display: CharacterDisplaySettings
}

export interface CharacterStatus {
  state: CharacterState
  mode: CharacterMode
}
