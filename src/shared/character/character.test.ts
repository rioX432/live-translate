import { describe, it, expect } from 'vitest'
import { CHARACTER_STATES, type CharacterReactions } from './types'
import { expressionForState, motionForState, assetForState, isMotionReduced } from './expressions'
import {
  INITIAL_CHARACTER_MACHINE,
  reduceCharacter,
  characterStatus,
  type CharacterEvent,
  type CharacterMachine
} from './state-machine'
import {
  defaultCharacterSettings,
  migrateCharacterSettings,
  activeProfile,
  builtinProfileId,
  CHARACTER_SIZE_MAX,
  CHARACTER_OPACITY_MIN
} from './settings'
import { characterWindowSize, placeCharacter, anchorOf, intersects, CHARACTER_MARGIN, MEETING_MIN_SIZE } from './layout'

const REACTIONS: CharacterReactions = { expressions: true, learned: 'hop', uncertain: 'tilt', error: 'shake' }

function run(events: CharacterEvent[], from: CharacterMachine = INITIAL_CHARACTER_MACHINE): CharacterMachine {
  return events.reduce(reduceCharacter, from)
}

describe('expressionForState', () => {
  it('gives every state a distinct expression', () => {
    const expressions = CHARACTER_STATES.map((s) => expressionForState(s, REACTIONS))
    expect(new Set(expressions).size).toBe(CHARACTER_STATES.length)
  })

  it('maps the main app states to the expected expressions', () => {
    expect(expressionForState('idle', REACTIONS)).toBe('neutral')
    expect(expressionForState('listening', REACTIONS)).toBe('attentive')
    expect(expressionForState('translating', REACTIONS)).toBe('thinking')
    expect(expressionForState('loading', REACTIONS)).toBe('busy')
    expect(expressionForState('error', REACTIONS)).toBe('worried')
  })

  it('keeps the neutral face in every state when expressions are off', () => {
    const off = { ...REACTIONS, expressions: false }
    for (const s of CHARACTER_STATES) expect(expressionForState(s, off)).toBe('neutral')
  })
})

describe('motionForState', () => {
  it('plays the configured reaction', () => {
    expect(motionForState('learned', REACTIONS, false)).toBe('hop')
    expect(motionForState('learned', { ...REACTIONS, learned: 'sparkle' }, false)).toBe('sparkle')
    expect(motionForState('error', REACTIONS, false)).toBe('shake')
  })

  it('stays still when the reaction is none or motion is reduced', () => {
    expect(motionForState('error', { ...REACTIONS, error: 'none' }, false)).toBeNull()
    for (const s of CHARACTER_STATES) expect(motionForState(s, REACTIONS, true)).toBeNull()
  })
})

describe('isMotionReduced', () => {
  it('stays still when animation is off, whatever the OS says', () => {
    expect(isMotionReduced('off', false, false)).toBe(true)
  })
  it('follows the OS and the app setting by default', () => {
    expect(isMotionReduced('follow-os', false, false)).toBe(false)
    expect(isMotionReduced('follow-os', true, false)).toBe(true)
    expect(isMotionReduced('follow-os', false, true)).toBe(true)
  })
  it('ignores the OS when animation is on but keeps the app accessibility setting', () => {
    expect(isMotionReduced('on', true, false)).toBe(false)
    expect(isMotionReduced('on', true, true)).toBe(true)
  })
})

describe('assetForState', () => {
  it('falls back to the idle image for states without their own image', () => {
    const appearance = { kind: 'image' as const, assets: { idle: 'idle-abc123.png', error: 'error-abc123.png' }, pixelArt: false }
    expect(assetForState(appearance, 'error')).toBe('error-abc123.png')
    expect(assetForState(appearance, 'listening')).toBe('idle-abc123.png')
    expect(assetForState({ kind: 'builtin', builtinId: 'mochi' }, 'idle')).toBeNull()
  })
})

describe('character state machine', () => {
  it('starts idle in standby', () => {
    expect(characterStatus(INITIAL_CHARACTER_MACHINE)).toEqual({ state: 'idle', mode: 'standby' })
  })

  it('switches to meeting mode when recording starts and back to standby when it stops', () => {
    const starting = run([{ type: 'pipeline-state', state: 'initializing' }])
    expect(characterStatus(starting)).toEqual({ state: 'loading', mode: 'meeting' })

    const running = reduceCharacter(starting, { type: 'pipeline-state', state: 'running' })
    expect(characterStatus(running)).toEqual({ state: 'listening', mode: 'meeting' })

    const stopped = reduceCharacter(running, { type: 'pipeline-state', state: 'idle' })
    expect(characterStatus(stopped)).toEqual({ state: 'idle', mode: 'standby' })
  })

  it('shows translating while speech is processed and listening after the result', () => {
    const running = run([{ type: 'pipeline-state', state: 'running' }, { type: 'speech-activity' }])
    expect(characterStatus(running).state).toBe('translating')
    const done = reduceCharacter(running, { type: 'translation-result', lowConfidence: false })
    expect(characterStatus(done).state).toBe('listening')
  })

  it('ignores speech activity outside a session', () => {
    expect(characterStatus(run([{ type: 'speech-activity' }])).state).toBe('idle')
  })

  it('flashes uncertain on a low-confidence result, then returns', () => {
    const m = run([{ type: 'pipeline-state', state: 'running' }, { type: 'translation-result', lowConfidence: true }])
    expect(characterStatus(m).state).toBe('uncertain')
    expect(characterStatus(reduceCharacter(m, { type: 'transient-expired' })).state).toBe('listening')
  })

  it('does not let a lower-priority flash replace an error', () => {
    const m = run([
      { type: 'pipeline-state', state: 'running' },
      { type: 'error' },
      { type: 'term-learned' },
      { type: 'translation-result', lowConfidence: true }
    ])
    expect(characterStatus(m).state).toBe('error')
  })

  it('keeps an error visible across stop but clears other flashes', () => {
    const errored = run([{ type: 'pipeline-state', state: 'running' }, { type: 'error' }, { type: 'pipeline-state', state: 'idle' }])
    expect(characterStatus(errored)).toEqual({ state: 'error', mode: 'standby' })

    const learned = run([{ type: 'pipeline-state', state: 'running' }, { type: 'term-learned' }, { type: 'pipeline-state', state: 'idle' }])
    expect(characterStatus(learned).state).toBe('idle')
  })

  it('shows loading for a model load outside a session', () => {
    const m = run([{ type: 'engine-loading' }])
    expect(characterStatus(m)).toEqual({ state: 'loading', mode: 'standby' })
    expect(characterStatus(reduceCharacter(m, { type: 'engine-ready' })).state).toBe('idle')
  })

  it('sleeps after the idle timeout only in standby and wakes on activity', () => {
    const asleep = run([{ type: 'idle-timeout' }])
    expect(characterStatus(asleep).state).toBe('sleeping')
    expect(characterStatus(reduceCharacter(asleep, { type: 'pipeline-state', state: 'initializing' })).state).toBe('loading')

    const meeting = run([{ type: 'pipeline-state', state: 'running' }, { type: 'idle-timeout' }])
    expect(characterStatus(meeting).state).toBe('listening')
  })

  it('treats recovering as a loading meeting state', () => {
    const m = run([{ type: 'pipeline-state', state: 'running' }, { type: 'pipeline-state', state: 'recovering' }])
    expect(characterStatus(m)).toEqual({ state: 'loading', mode: 'meeting' })
  })
})

describe('migrateCharacterSettings', () => {
  it('returns defaults with both built-in characters for empty or broken input', () => {
    for (const raw of [undefined, null, 'x', 42, [], {}]) {
      const s = migrateCharacterSettings(raw)
      expect(s).toEqual(defaultCharacterSettings())
      expect(s.characters.map((c) => c.id)).toEqual([builtinProfileId('mochi'), builtinProfileId('pico')])
    }
  })

  it('round-trips valid settings unchanged', () => {
    const s = defaultCharacterSettings()
    s.activeCharacterId = builtinProfileId('pico')
    s.characters[1].name = 'Robo'
    s.characters[1].persona = { style: 'cheerful', firstPerson: 'ぼく', note: 'Likes tea' }
    s.characters.push({
      ...s.characters[0],
      id: 'custom-0123abcd',
      name: 'Mine',
      appearance: { kind: 'image', assets: { idle: 'idle-a1b2c3.png', error: 'error-a1b2c3.webp' }, pixelArt: true }
    })
    s.display = { visible: false, sizePx: 120, opacity: 0.6, animation: 'off', inMeeting: 'hidden', positionByDisplay: { '1': { x: 10, y: 20 } } }
    const copy = JSON.parse(JSON.stringify(s))
    expect(migrateCharacterSettings(copy)).toEqual(s)
  })

  it('clamps display values and drops invalid positions', () => {
    const s = migrateCharacterSettings({
      display: {
        sizePx: 9999,
        opacity: 0,
        animation: 'wild',
        positionByDisplay: { '1': { x: 5.4, y: 6.6 }, '../x': { x: 1, y: 1 }, '2': { x: 'a', y: 1 }, '3': { x: Infinity, y: 0 } }
      }
    })
    expect(s.display.sizePx).toBe(CHARACTER_SIZE_MAX)
    expect(s.display.opacity).toBe(CHARACTER_OPACITY_MIN)
    expect(s.display.animation).toBe('follow-os')
    expect(s.display.positionByDisplay).toEqual({ '1': { x: 5, y: 7 } })
  })

  it('rejects unsafe ids and asset paths from imported characters', () => {
    const base = defaultCharacterSettings().characters[0]
    const s = migrateCharacterSettings({
      characters: [
        { ...base, id: '../../etc', appearance: { kind: 'image', assets: { idle: 'idle-abcdef.png' } } },
        { ...base, id: 'custom-deadbeef', appearance: { kind: 'image', assets: { idle: '../secret.png' } } },
        { ...base, id: 'custom-cafebabe', appearance: { kind: 'image', assets: { idle: 'idle-abcdef.png', error: 'idle-abcdef.png', listening: 'x.svg' } } }
      ]
    })
    const custom = s.characters.filter((c) => c.appearance.kind === 'image')
    expect(custom.map((c) => c.id)).toEqual(['custom-cafebabe'])
    expect(custom[0].appearance).toEqual({ kind: 'image', assets: { idle: 'idle-abcdef.png' }, pixelArt: false })
  })

  it('restores missing built-ins, removes duplicates, and repairs the active id', () => {
    const pico = defaultCharacterSettings().characters[1]
    const s = migrateCharacterSettings({ activeCharacterId: 'custom-00000000', characters: [pico, pico] })
    expect(s.characters.map((c) => c.id)).toEqual([builtinProfileId('mochi'), builtinProfileId('pico')])
    expect(s.activeCharacterId).toBe(builtinProfileId('mochi'))
    expect(activeProfile(s).id).toBe(builtinProfileId('mochi'))
  })

  it('fills missing persona, voice, and reaction fields and never stores a TTS voice', () => {
    const s = migrateCharacterSettings({
      characters: [{ id: builtinProfileId('mochi'), name: '  ', appearance: { kind: 'builtin', builtinId: 'mochi' }, voice: { length: 'detailed', tts: 'some-voice' } }]
    })
    const mochi = s.characters[0]
    expect(mochi.name).toBe('Mochi')
    expect(mochi.voice).toEqual({ length: 'detailed', politeness: 'polite', tts: null })
    expect(mochi.persona.style).toBe('friendly')
    expect(mochi.reactions.expressions).toBe(true)
  })

  it('strips control characters and truncates long text', () => {
    const s = migrateCharacterSettings({
      characters: [{ id: builtinProfileId('mochi'), name: 'Mo\u0000chi'.padEnd(100, 'x'), appearance: { kind: 'builtin', builtinId: 'mochi' } }]
    })
    expect(s.characters[0].name.startsWith('Mochi')).toBe(true)
    expect(s.characters[0].name.length).toBeLessThanOrEqual(40)
  })
})

describe('character layout', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 }
  const subtitle = { x: 0, y: 700, width: 1440, height: 200 }
  const display = { ...defaultCharacterSettings().display, sizePx: 100 }

  it('shrinks the compact character in a meeting and hides nothing in standby', () => {
    expect(characterWindowSize(display, 'standby')).toEqual({ width: 100, height: 125 })
    expect(characterWindowSize(display, 'meeting')).toEqual({ width: 75, height: 94 })
    expect(characterWindowSize({ ...display, sizePx: 48 }, 'meeting').width).toBe(MEETING_MIN_SIZE)
    expect(characterWindowSize({ ...display, inMeeting: 'hidden' }, 'meeting').width).toBe(100)
  })

  it('defaults to bottom-right above the subtitle band', () => {
    const r = placeCharacter({ workArea, size: { width: 100, height: 125 }, saved: undefined, subtitle, mode: 'standby' })
    expect(r.x + r.width).toBe(1440 - CHARACTER_MARGIN)
    expect(r.y + r.height).toBe(700 - CHARACTER_MARGIN)
  })

  it('keeps a saved position in standby but moves off the subtitles in a meeting', () => {
    const saved = { x: 200, y: 800 }
    const size = { width: 100, height: 125 }
    const standby = placeCharacter({ workArea, size, saved, subtitle, mode: 'standby' })
    expect(standby).toEqual({ x: 200, y: 675, width: 100, height: 125 })
    expect(anchorOf(standby)).toEqual(saved)

    const meeting = placeCharacter({ workArea, size, saved, subtitle, mode: 'meeting' })
    expect(intersects(meeting, subtitle)).toBe(false)
    expect(meeting.x).toBe(200)
  })

  it('clamps an off-screen saved position into the work area', () => {
    const r = placeCharacter({ workArea, size: { width: 100, height: 125 }, saved: { x: 5000, y: -100 }, subtitle: null, mode: 'standby' })
    expect(r).toEqual({ x: 1340, y: 25, width: 100, height: 125 })
  })

  it('ignores a subtitle band on another display', () => {
    const elsewhere = { x: 2000, y: 700, width: 1920, height: 200 }
    const r = placeCharacter({ workArea, size: { width: 100, height: 125 }, saved: undefined, subtitle: elsewhere, mode: 'meeting' })
    expect(r.y + r.height).toBe(900 - CHARACTER_MARGIN)
  })
})
