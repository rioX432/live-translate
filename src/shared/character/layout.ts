import type { CharacterDisplaySettings, CharacterMode, CharacterPosition } from './types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Gap kept between the character and screen edges or the subtitle band */
export const CHARACTER_MARGIN = 16

/** In a meeting the compact character shrinks to this share of its normal size */
export const MEETING_SCALE = 0.75
export const MEETING_MIN_SIZE = 48

/** Extra height above the sprite so hop and sparkle motions are not clipped */
const MOTION_HEADROOM = 0.25

export function characterWindowSize(display: CharacterDisplaySettings, mode: CharacterMode): { width: number; height: number } {
  const base = display.sizePx
  const size = mode === 'meeting' && display.inMeeting === 'compact'
    ? Math.max(MEETING_MIN_SIZE, Math.round(base * MEETING_SCALE))
    : base
  return { width: size, height: Math.round(size * (1 + MOTION_HEADROOM)) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function clampInto(rect: Rect, area: Rect): Rect {
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - rect.width)
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - rect.height)
  return { ...rect, x: Math.round(x), y: Math.round(y) }
}

/**
 * Where the character window goes.
 *
 * The saved position is the bottom-left anchor of the window so that a size
 * change grows the character upward instead of pushing it off the bottom.
 * Without a saved position the character sits bottom-right, above the
 * subtitle band when the band is on this display. In a meeting it is moved
 * above the band if it would overlap it, because subtitles must stay readable.
 */
export function placeCharacter(params: {
  workArea: Rect
  size: { width: number; height: number }
  saved: CharacterPosition | undefined
  subtitle: Rect | null
  mode: CharacterMode
}): Rect {
  const { workArea, size, saved, subtitle, mode } = params
  const onThisDisplay = subtitle && intersects(subtitle, workArea) ? subtitle : null

  let rect: Rect
  if (saved) {
    rect = { x: saved.x, y: saved.y - size.height, ...size }
  } else {
    const bottom = onThisDisplay ? Math.min(onThisDisplay.y, workArea.y + workArea.height) : workArea.y + workArea.height
    rect = {
      x: workArea.x + workArea.width - size.width - CHARACTER_MARGIN,
      y: bottom - size.height - CHARACTER_MARGIN,
      ...size
    }
  }
  rect = clampInto(rect, workArea)

  if (mode === 'meeting' && onThisDisplay && intersects(rect, onThisDisplay)) {
    rect = clampInto({ ...rect, y: onThisDisplay.y - size.height - CHARACTER_MARGIN }, workArea)
  }
  return rect
}

/** Inverse of placeCharacter's anchor: the position to save for a window rect */
export function anchorOf(rect: Rect): CharacterPosition {
  return { x: Math.round(rect.x), y: Math.round(rect.y + rect.height) }
}
