import type { CharacterAppearance, CharacterState } from '../../shared/character/types'

export type { CharacterState }

/**
 * The swap point for how a character is drawn. Only the sprite renderer exists
 * today; another way of drawing (Rive, VRM) is one more implementation of this
 * interface. A renderer only changes what is on screen: translation and memory
 * never know a character exists.
 */
export interface CharacterRenderer {
  mount(el: HTMLElement, profile: CharacterAppearance): Promise<void>
  setState(state: CharacterState): void
  setReducedMotion(reduced: boolean): void
  dispose(): void
}
