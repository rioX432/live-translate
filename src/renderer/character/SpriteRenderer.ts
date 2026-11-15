import type { CharacterAppearance, CharacterReactions, CharacterState } from '../../shared/character/types'
import { expressionForState, motionForState, type CharacterMotion } from '../../shared/character/expressions'
import { builtinCharacterUrl } from './builtin-characters'
import type { CharacterRenderer } from './CharacterRenderer'

const STYLE_ID = 'character-sprite-styles'

const MOTION_CSS = `
.character-sprite { width: 100%; height: 100%; object-fit: contain; object-position: bottom center;
  display: block; user-select: none; -webkit-user-drag: none; transform-origin: 50% 100%; }
.character-sprite.pixelated { image-rendering: pixelated; }
.character-motion-hop { animation: character-hop 600ms ease-out 2; }
.character-motion-sparkle { animation: character-sparkle 900ms ease-out 1; }
.character-motion-tilt { animation: character-tilt 1200ms ease-in-out 1; }
.character-motion-shake { animation: character-shake 500ms ease-in-out 1; }
.character-motion-breathe { animation: character-breathe 2400ms ease-in-out infinite; }
@keyframes character-hop { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-18%) } 70% { transform: translateY(0) scaleY(0.94) } }
@keyframes character-sparkle { 0%,100% { filter: none; transform: scale(1) } 40% { filter: brightness(1.3) drop-shadow(0 0 6px #facc15); transform: scale(1.06) } }
@keyframes character-tilt { 0%,100% { transform: rotate(0) } 30%,70% { transform: rotate(-10deg) } }
@keyframes character-shake { 0%,100% { transform: translateX(0) } 20%,60% { transform: translateX(-6%) } 40%,80% { transform: translateX(6%) } }
@keyframes character-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.03, 0.97) } }
`

const MOTION_CLASSES = ['hop', 'sparkle', 'tilt', 'shake', 'breathe'].map((m) => `character-motion-${m}`)

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = MOTION_CSS
  doc.head.appendChild(style)
}

export interface SpriteRendererOptions {
  reactions: CharacterReactions
  /** Data URLs of an imported character's images, keyed by state */
  imageAssets?: Partial<Record<CharacterState, string>>
}

/**
 * Draws a character as one image per state (built-in SVG or imported
 * PNG/JPEG/GIF/WebP) and plays short CSS motions on state changes. Nothing
 * animates while the state is unchanged, so an idle character costs no frames.
 */
export class SpriteRenderer implements CharacterRenderer {
  private img: HTMLImageElement | null = null
  private appearance: CharacterAppearance | null = null
  private state: CharacterState = 'idle'
  private reduced = false

  constructor(private readonly options: SpriteRendererOptions) {}

  async mount(el: HTMLElement, profile: CharacterAppearance): Promise<void> {
    this.dispose()
    ensureStyles(el.ownerDocument)
    const img = el.ownerDocument.createElement('img')
    img.alt = ''
    img.draggable = false
    img.className = 'character-sprite'
    if (profile.kind === 'image' && profile.pixelArt) img.classList.add('pixelated')
    el.appendChild(img)
    this.img = img
    this.appearance = profile
    this.render(false)
    await img.decode().catch(() => undefined)
  }

  setState(state: CharacterState): void {
    if (state === this.state) return
    this.state = state
    this.render(true)
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced
    if (reduced) {
      this.img?.classList.remove(...MOTION_CLASSES)
    } else if (motionForState(this.state, this.options.reactions, false) === 'breathe') {
      this.applyMotion('breathe')
    }
  }

  dispose(): void {
    this.img?.remove()
    this.img = null
    this.appearance = null
  }

  private imageUrl(): string | null {
    const appearance = this.appearance
    if (!appearance) return null
    const { reactions, imageAssets = {} } = this.options
    if (appearance.kind === 'builtin') {
      return builtinCharacterUrl(appearance.builtinId, expressionForState(this.state, reactions))
    }
    const state = reactions.expressions ? this.state : 'idle'
    return imageAssets[state] ?? imageAssets.idle ?? null
  }

  private render(animate: boolean): void {
    const img = this.img
    if (!img) return
    const url = this.imageUrl()
    if (url && img.src !== url) img.src = url
    img.dataset.state = this.state
    const motion = motionForState(this.state, this.options.reactions, this.reduced)
    // Breathing is a steady loop and may start on mount; one-shot motions only follow a change
    this.applyMotion(animate || motion === 'breathe' ? motion : null)
  }

  private applyMotion(motion: CharacterMotion): void {
    const img = this.img
    if (!img) return
    img.classList.remove(...MOTION_CLASSES)
    if (!motion) return
    // Reading layout restarts the animation when the same motion plays twice in a row
    void img.offsetWidth
    img.classList.add(`character-motion-${motion}`)
  }
}
