import React, { useEffect, useState } from 'react'
import {
  ANIMATION_PREFERENCES,
  CHARACTER_STATES,
  ERROR_REACTIONS,
  LEARNED_REACTIONS,
  MEETING_PRESENCES,
  PERSONA_STYLES,
  SPEECH_LENGTHS,
  SPEECH_POLITENESS,
  UNCERTAIN_REACTIONS,
  type CharacterDisplaySettings,
  type CharacterProfile,
  type CharacterSettings as CharacterSettingsValue,
  type CharacterState
} from '../../../shared/character/types'
import {
  activeProfile,
  CHARACTER_FIRST_PERSON_MAX,
  CHARACTER_NAME_MAX,
  CHARACTER_NOTE_MAX,
  CHARACTER_OPACITY_MAX,
  CHARACTER_OPACITY_MIN,
  CHARACTER_SIZE_MAX,
  CHARACTER_SIZE_MIN
} from '../../../shared/character/settings'
import { STATE_LABELS } from '../../../shared/character/expressions'
import { useCharacterSettings } from '../../hooks/useCharacterSettings'
import { colors, fontSize } from '../../theme'
import { Section } from './Section'
import { CharacterPreview } from './CharacterPreview'
import { MemoryScreen } from './MemoryScreen'
import { selectStyle, sliderLabelStyle } from './shared'

const ANIMATION_LABELS: Record<(typeof ANIMATION_PREFERENCES)[number], string> = {
  'follow-os': 'Follow system setting',
  on: 'On',
  off: 'Off'
}
const MEETING_LABELS: Record<(typeof MEETING_PRESENCES)[number], string> = {
  compact: 'Stay small, away from subtitles',
  hidden: 'Hide during meetings'
}
const STYLE_LABELS: Record<(typeof PERSONA_STYLES)[number], string> = {
  friendly: 'Friendly',
  polite: 'Polite',
  concise: 'Concise',
  cheerful: 'Cheerful'
}
const LENGTH_LABELS: Record<(typeof SPEECH_LENGTHS)[number], string> = {
  short: 'Short',
  normal: 'Normal',
  detailed: 'Detailed'
}
const POLITENESS_LABELS: Record<(typeof SPEECH_POLITENESS)[number], string> = {
  polite: 'Polite (desu/masu)',
  casual: 'Casual'
}
const REACTION_LABELS: Record<string, string> = {
  hop: 'Hop',
  sparkle: 'Sparkle',
  tilt: 'Tilt head',
  shake: 'Shake',
  none: 'None'
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: fontSize.md,
  color: colors.text.muted,
  cursor: 'pointer'
}
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' }
const groupTitleStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: fontSize.base,
  fontWeight: 600,
  color: colors.text.secondary
}
const smallButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: fontSize.base,
  background: colors.bg.tertiary,
  color: colors.text.primary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: '6px',
  cursor: 'pointer'
}
const hintStyle: React.CSSProperties = { margin: 0, fontSize: fontSize.sm, color: colors.text.dim, lineHeight: 1.5 }

function Select<T extends string>({
  label,
  value,
  options,
  labels,
  onChange
}: {
  label: string
  value: T
  options: readonly T[]
  labels: Record<string, string>
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={sliderLabelStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} style={selectStyle}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Text field that saves when it loses focus, so typing does not write settings on every key */
function DraftText({
  label,
  value,
  maxLength,
  multiline,
  onCommit
}: {
  label: string
  value: string
  maxLength: number
  multiline?: boolean
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  const common = {
    value: draft,
    maxLength,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    // Text fields default to content-box, so width 100% plus padding would overflow
    style: { ...selectStyle, boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'vertical' as const }
  }
  return (
    <label style={fieldStyle}>
      <span style={sliderLabelStyle}>{label}</span>
      {multiline ? (
        <textarea rows={3} {...common} />
      ) : (
        <input type="text" {...common} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </label>
  )
}

export function CharacterSettings(): React.JSX.Element | null {
  const { settings, save, replace } = useCharacterSettings()
  const [open, setOpen] = useState(false)
  const [previewState, setPreviewState] = useState<CharacterState>('idle')
  const [imageState, setImageState] = useState<CharacterState>('idle')
  const [showMemory, setShowMemory] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!settings) return null
  const profile = activeProfile(settings)

  const updateProfile = (patch: (p: CharacterProfile) => CharacterProfile): void => {
    void save({ ...settings, characters: settings.characters.map((p) => (p.id === profile.id ? patch(p) : p)) })
  }
  const updateDisplay = (patch: Partial<CharacterDisplaySettings>): void => {
    void save({ ...settings, display: { ...settings.display, ...patch } })
  }
  const applyResult = (result: { settings?: CharacterSettingsValue; canceled?: boolean; error?: string }): void => {
    if (result.settings) replace(result.settings)
    setMessage(result.error ?? null)
  }
  const importImage = async (request: { profileId?: string; state?: CharacterState }): Promise<void> => {
    applyResult(await window.api.characterImportImage(request))
  }
  const deleteActive = async (): Promise<void> => {
    applyResult(await window.api.characterDelete(profile.id))
  }

  return (
    <Section label="Character">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="character-settings-content"
        data-testid="character-settings-toggle"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 12px',
          background: colors.bg.secondary,
          border: `1px solid ${colors.border.default}`,
          borderRadius: '8px',
          cursor: 'pointer',
          color: colors.text.primary,
          textAlign: 'left'
        }}
      >
        <CharacterPreview profile={profile} state="idle" size={40} label="" />
        <span style={{ flex: 1, fontSize: fontSize.md }}>
          {profile.name}
          <span style={{ display: 'block', fontSize: fontSize.sm, color: colors.text.dim }}>
            {settings.display.visible ? 'Shown on desktop' : 'Hidden'}
          </span>
        </span>
        <span aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>

      {open && (
        <div id="character-settings-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={settings.display.visible}
              onChange={(e) => updateDisplay({ visible: e.target.checked })}
              data-testid="character-visible"
            />
            <span>Show character on the desktop</span>
          </label>

          <h3 style={groupTitleStyle}>Look</h3>
          <div role="radiogroup" aria-label="Character" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {settings.characters.map((p) => {
              const selected = p.id === settings.activeCharacterId
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`character-option-${p.id}`}
                  onClick={() => void save({ ...settings, activeCharacterId: p.id })}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    width: '84px',
                    padding: '8px 4px',
                    background: selected ? colors.bg.tertiary : colors.bg.secondary,
                    border: `2px solid ${selected ? colors.accent.blue : colors.border.default}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: colors.text.primary,
                    fontSize: fontSize.sm
                  }}
                >
                  <CharacterPreview profile={p} state="idle" size={48} label="" />
                  <span style={{ maxWidth: '76px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" style={smallButtonStyle} onClick={() => void importImage({})}>
              Import image…
            </button>
            {profile.appearance.kind === 'image' && (
              <button type="button" style={{ ...smallButtonStyle, color: '#fca5a5' }} onClick={() => void deleteActive()}>
                Delete this character
              </button>
            )}
          </div>
          <p style={hintStyle}>PNG, JPEG, GIF, or WebP up to 2 MB. The image is copied into the app; the original file is not changed.</p>
          {message && (
            <p role="alert" style={{ ...hintStyle, color: '#fca5a5' }}>
              {message}
            </p>
          )}

          {profile.appearance.kind === 'image' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Select
                    label="Image for state"
                    value={imageState}
                    options={CHARACTER_STATES}
                    labels={STATE_LABELS}
                    onChange={setImageState}
                  />
                </div>
                <button
                  type="button"
                  style={smallButtonStyle}
                  onClick={() => void importImage({ profileId: profile.id, state: imageState })}
                >
                  Choose image…
                </button>
              </div>
              <p style={hintStyle}>States without their own image use the Waiting image.</p>
              <label style={labelStyle}>
                <input
                  type="checkbox"
                  checked={profile.appearance.pixelArt}
                  onChange={(e) => {
                    const pixelArt = e.target.checked
                    updateProfile((p) => (p.appearance.kind === 'image' ? { ...p, appearance: { ...p.appearance, pixelArt } } : p))
                  }}
                />
                <span>Pixel art (keep edges sharp when scaled)</span>
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div
              style={{
                padding: '8px',
                background: colors.bg.primary,
                border: `1px solid ${colors.border.default}`,
                borderRadius: '8px'
              }}
            >
              <CharacterPreview
                profile={profile}
                state={previewState}
                size={96}
                reducedMotion={false}
                label={`${profile.name}: ${STATE_LABELS[previewState]}`}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select label="Preview state" value={previewState} options={CHARACTER_STATES} labels={STATE_LABELS} onChange={setPreviewState} />
            </div>
          </div>

          <DraftText
            label="Name"
            value={profile.name}
            maxLength={CHARACTER_NAME_MAX}
            onCommit={(name) => updateProfile((p) => ({ ...p, name }))}
          />

          <h3 style={groupTitleStyle}>Personality</h3>
          <Select
            label="Conversation style"
            value={profile.persona.style}
            options={PERSONA_STYLES}
            labels={STYLE_LABELS}
            onChange={(style) => updateProfile((p) => ({ ...p, persona: { ...p.persona, style } }))}
          />
          <DraftText
            label="How the character refers to itself"
            value={profile.persona.firstPerson}
            maxLength={CHARACTER_FIRST_PERSON_MAX}
            onCommit={(firstPerson) => updateProfile((p) => ({ ...p, persona: { ...p.persona, firstPerson } }))}
          />
          <DraftText
            label="Notes on personality"
            value={profile.persona.note}
            maxLength={CHARACTER_NOTE_MAX}
            multiline
            onCommit={(note) => updateProfile((p) => ({ ...p, persona: { ...p.persona, note } }))}
          />
          <p style={hintStyle}>Personality is saved for character conversations. It never changes how meetings are translated.</p>

          <h3 style={groupTitleStyle}>Speech style</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <Select
              label="Length"
              value={profile.voice.length}
              options={SPEECH_LENGTHS}
              labels={LENGTH_LABELS}
              onChange={(length) => updateProfile((p) => ({ ...p, voice: { ...p.voice, length } }))}
            />
            <Select
              label="Tone"
              value={profile.voice.politeness}
              options={SPEECH_POLITENESS}
              labels={POLITENESS_LABELS}
              onChange={(politeness) => updateProfile((p) => ({ ...p, voice: { ...p.voice, politeness } }))}
            />
          </div>
          <p style={hintStyle}>The character does not speak aloud. This is saved for a future voice.</p>

          <h3 style={groupTitleStyle}>Expressions and reactions</h3>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={profile.reactions.expressions}
              onChange={(e) => {
                const expressions = e.target.checked
                updateProfile((p) => ({ ...p, reactions: { ...p.reactions, expressions } }))
              }}
            />
            <span>Change expression with what the app is doing</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <Select
              label="Learned a term"
              value={profile.reactions.learned}
              options={LEARNED_REACTIONS}
              labels={REACTION_LABELS}
              onChange={(learned) => updateProfile((p) => ({ ...p, reactions: { ...p.reactions, learned } }))}
            />
            <Select
              label="Unsure"
              value={profile.reactions.uncertain}
              options={UNCERTAIN_REACTIONS}
              labels={REACTION_LABELS}
              onChange={(uncertain) => updateProfile((p) => ({ ...p, reactions: { ...p.reactions, uncertain } }))}
            />
            <Select
              label="Error"
              value={profile.reactions.error}
              options={ERROR_REACTIONS}
              labels={REACTION_LABELS}
              onChange={(error) => updateProfile((p) => ({ ...p, reactions: { ...p.reactions, error } }))}
            />
          </div>

          <h3 style={groupTitleStyle}>On the desktop</h3>
          <label style={fieldStyle}>
            <span style={sliderLabelStyle}>Size: {settings.display.sizePx}px</span>
            <input
              type="range"
              min={CHARACTER_SIZE_MIN}
              max={CHARACTER_SIZE_MAX}
              step={8}
              value={settings.display.sizePx}
              onChange={(e) => updateDisplay({ sizePx: Number(e.target.value) })}
            />
          </label>
          <label style={fieldStyle}>
            <span style={sliderLabelStyle}>Opacity: {Math.round(settings.display.opacity * 100)}%</span>
            <input
              type="range"
              min={CHARACTER_OPACITY_MIN * 100}
              max={CHARACTER_OPACITY_MAX * 100}
              step={5}
              value={Math.round(settings.display.opacity * 100)}
              onChange={(e) => updateDisplay({ opacity: Number(e.target.value) / 100 })}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <Select
              label="Animation"
              value={settings.display.animation}
              options={ANIMATION_PREFERENCES}
              labels={ANIMATION_LABELS}
              onChange={(animation) => updateDisplay({ animation })}
            />
            <Select
              label="During meetings"
              value={settings.display.inMeeting}
              options={MEETING_PRESENCES}
              labels={MEETING_LABELS}
              onChange={(inMeeting) => updateDisplay({ inMeeting })}
            />
          </div>
          <div>
            <button
              type="button"
              style={smallButtonStyle}
              onClick={() => void window.api.characterResetPosition().then(replace)}
            >
              Reset position
            </button>
          </div>
          <p style={hintStyle}>Drag the character to move it. While recording it stays small and out of the way of subtitles.</p>

          <h3 style={groupTitleStyle}>Memory</h3>
          <div>
            <button type="button" style={smallButtonStyle} onClick={() => setShowMemory(true)} data-testid="open-memory-screen">
              Glossary &amp; Memory…
            </button>
          </div>
          {showMemory && <MemoryScreen onClose={() => setShowMemory(false)} />}
        </div>
      )}
    </Section>
  )
}
