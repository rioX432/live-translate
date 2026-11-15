import React, { useEffect, useRef, useState } from 'react'
import type { CharacterSettings, CharacterState, CharacterStatus } from '../../shared/character/types'
import { activeProfile } from '../../shared/character/settings'
import { isMotionReduced, STATE_LABELS } from '../../shared/character/expressions'
import { SpriteRenderer } from '../character/SpriteRenderer'
import type { CharacterRenderer } from '../character/CharacterRenderer'
import { useCharacterProfileAssets } from '../hooks/useCharacterSettings'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** The desktop character window (#/character): draws the active character and lets the user drag it */
export default function CharacterOverlay(): React.JSX.Element | null {
  const [settings, setSettings] = useState<CharacterSettings | null>(null)
  const [status, setStatus] = useState<CharacterStatus>({ state: 'idle', mode: 'standby' })
  const [appReducedMotion, setAppReducedMotion] = useState(false)
  const osReducedMotion = useOsReducedMotion()
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CharacterRenderer | null>(null)
  const stateRef = useRef<CharacterState>('idle')
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    window.api.characterGetSettings().then(setSettings)
    window.api.characterGetStatus().then(setStatus)
    window.api.characterGetAppReducedMotion().then(setAppReducedMotion)
    const offSettings = window.api.onCharacterSettingsChanged(setSettings)
    const offStatus = window.api.onCharacterStatus(setStatus)
    const offA11y = window.api.onCharacterAppReducedMotion(setAppReducedMotion)
    return () => {
      offSettings()
      offStatus()
      offA11y()
    }
  }, [])

  const profile = settings ? activeProfile(settings) : null
  const assets = useCharacterProfileAssets(profile)
  const reduced = settings ? isMotionReduced(settings.display.animation, osReducedMotion, appReducedMotion) : true
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  stateRef.current = status.state
  const lookKey = profile ? JSON.stringify([profile.id, profile.appearance, profile.reactions]) : ''

  // Remount only when the look changes; state changes go through setState
  useEffect(() => {
    const host = hostRef.current
    if (!host || !profile || assets === undefined) return
    const renderer = new SpriteRenderer({ reactions: profile.reactions, imageAssets: assets })
    rendererRef.current = renderer
    renderer.setReducedMotion(reducedRef.current)
    void renderer.mount(host, profile.appearance).then(() => {
      if (rendererRef.current === renderer) renderer.setState(stateRef.current)
    })
    return () => {
      renderer.dispose()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
    // lookKey stands for profile's appearance and reactions; settings arrive as new objects on every save
  }, [lookKey, assets])

  useEffect(() => {
    rendererRef.current?.setState(status.state)
  }, [status.state])

  useEffect(() => {
    rendererRef.current?.setReducedMotion(reduced)
  }, [reduced])

  if (!settings || !profile) return null

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.screenX, y: e.screenY, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = e.screenX - d.x
    const dy = e.screenY - d.y
    if (dx === 0 && dy === 0) return
    drag.current = { x: e.screenX, y: e.screenY, moved: true }
    window.api.characterMoveBy(dx, dy)
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d?.moved) window.api.characterDragEnd()
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'transparent',
        overflow: 'hidden'
      }}
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={`${profile.name}: ${STATE_LABELS[status.state]}`}
        title={`${profile.name}: ${STATE_LABELS[status.state]}`}
        data-testid="character-overlay"
        data-character-id={profile.id}
        data-state={status.state}
        data-mode={status.mode}
        // The window ignores the mouse until the pointer is over the character itself
        onPointerEnter={() => window.api.characterSetInteractive(true)}
        onPointerLeave={() => {
          if (!drag.current) window.api.characterSetInteractive(false)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          opacity: settings.display.opacity,
          cursor: 'grab',
          touchAction: 'none'
        }}
      />
    </div>
  )
}
