import React, { useEffect, useRef } from 'react'
import type { CharacterProfile, CharacterState } from '../../../shared/character/types'
import { SpriteRenderer } from '../../character/SpriteRenderer'
import { useCharacterProfileAssets } from '../../hooks/useCharacterSettings'

/** Draws a profile in one state with the same renderer as the desktop overlay */
export function CharacterPreview({
  profile,
  state,
  size,
  reducedMotion = true,
  label
}: {
  profile: CharacterProfile
  state: CharacterState
  size: number
  reducedMotion?: boolean
  label: string
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<SpriteRenderer | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const assets = useCharacterProfileAssets(profile)
  const lookKey = JSON.stringify([profile.id, profile.appearance, profile.reactions])

  useEffect(() => {
    const host = hostRef.current
    if (!host || assets === undefined) return
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
    // lookKey stands for the profile's appearance and reactions
  }, [lookKey, assets])

  useEffect(() => {
    rendererRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    rendererRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])

  return (
    <div
      ref={hostRef}
      // An empty label marks a decorative preview inside a control that already names it
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-character-id={profile.id}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  )
}
