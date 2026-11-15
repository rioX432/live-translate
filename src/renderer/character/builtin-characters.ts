import type { CharacterExpression } from '../../shared/character/expressions'
import type { BuiltinCharacterId } from '../../shared/character/types'

/**
 * Built-in characters. Source: drawn by hand for this project as inline SVG,
 * with no third-party art, fonts, or generated images. License: the
 * repository's MIT license (LICENSE). They are shown through <img>, so the
 * SVG is treated as an image and cannot run scripts.
 */

export const BUILTIN_CHARACTER_NAMES: Record<BuiltinCharacterId, string> = {
  mochi: 'Mochi',
  pico: 'Pico'
}

function svg(viewBox: string, body: string, extraAttrs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${extraAttrs}>${body}</svg>`
}

// --- Mochi: a soft round blob ---

function mochiFace(e: CharacterExpression): string {
  const eye = (cx: number, cy: number, r = 4): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#3b2f3a"/>`
  const shine = (cx: number, cy: number): string => `<circle cx="${cx}" cy="${cy}" r="1.4" fill="#fff"/>`
  const blush = '<ellipse cx="30" cy="66" rx="6" ry="3.5" fill="#f9a8c4" opacity="0.8"/><ellipse cx="70" cy="66" rx="6" ry="3.5" fill="#f9a8c4" opacity="0.8"/>'
  switch (e) {
    case 'attentive':
      return `${eye(38, 56, 5.5)}${shine(40, 54)}${eye(62, 56, 5.5)}${shine(64, 54)}<ellipse cx="50" cy="70" rx="3.5" ry="4" fill="#3b2f3a"/>`
    case 'thinking':
      return `${eye(41, 54)}${eye(65, 54)}<path d="M44 70 h12" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>` +
        '<circle cx="78" cy="30" r="3" fill="#94a3b8"/><circle cx="86" cy="22" r="3.5" fill="#94a3b8"/><circle cx="94" cy="13" r="4" fill="#94a3b8"/>'
    case 'puzzled':
      return `${eye(38, 56, 3.5)}${eye(62, 55, 5.5)}<path d="M42 71 q4 -4 8 0 q4 4 8 0" fill="none" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>` +
        '<text x="80" y="30" font-family="sans-serif" font-size="22" font-weight="700" fill="#f59e0b">?</text>'
    case 'happy':
      return '<path d="M32 58 q6 -8 12 0 M56 58 q6 -8 12 0" fill="none" stroke="#3b2f3a" stroke-width="3.5" stroke-linecap="round"/>' +
        `<path d="M40 66 q10 12 20 0 z" fill="#3b2f3a"/>${blush}` +
        '<path d="M84 22 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" fill="#facc15"/>'
    case 'busy':
      return '<path d="M33 56 h10 M57 56 h10" stroke="#3b2f3a" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M45 70 h10" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="84" cy="22" r="8" fill="none" stroke="#94a3b8" stroke-width="3" stroke-dasharray="12 6"/>'
    case 'worried':
      return '<path d="M32 46 l10 4 M68 46 l-10 4" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>' +
        `${eye(38, 57)}${eye(62, 57)}<path d="M42 73 q8 -8 16 0" fill="none" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>` +
        '<path d="M78 36 q-5 8 0 11 q5 -3 0 -11z" fill="#7dd3fc"/>'
    case 'sleepy':
      return '<path d="M32 58 q6 5 12 0 M56 58 q6 5 12 0" fill="none" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="70" rx="3" ry="2" fill="#3b2f3a"/>' +
        '<text x="74" y="32" font-family="sans-serif" font-size="14" font-weight="700" fill="#94a3b8">z</text>' +
        '<text x="84" y="20" font-family="sans-serif" font-size="18" font-weight="700" fill="#94a3b8">Z</text>'
    case 'neutral':
    default:
      return `${eye(38, 56)}${shine(39.5, 54.5)}${eye(62, 56)}${shine(63.5, 54.5)}<path d="M44 68 q6 5 12 0" fill="none" stroke="#3b2f3a" stroke-width="3" stroke-linecap="round"/>${blush}`
  }
}

function mochiSvg(e: CharacterExpression): string {
  const body =
    '<ellipse cx="50" cy="92" rx="30" ry="4" fill="#000" opacity="0.18"/>' +
    '<path d="M14 72 C14 40 30 26 50 26 C70 26 86 40 86 72 C86 86 72 92 50 92 C28 92 14 86 14 72z" fill="#fdf2f8" stroke="#f0abfc" stroke-width="3"/>' +
    '<path d="M46 27 q4 -10 10 -8" fill="none" stroke="#86efac" stroke-width="4" stroke-linecap="round"/>'
  return svg('0 0 100 100', body + mochiFace(e))
}

// --- Pico: a 16x16 pixel robot ---

type Px = [number, number, number?, number?]

const rects = (cells: Px[], fill: string): string =>
  cells.map(([x, y, w = 1, h = 1]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join('')

const PICO_LAMP: Record<CharacterExpression, string> = {
  neutral: '#94a3b8',
  attentive: '#22c55e',
  thinking: '#60a5fa',
  puzzled: '#f59e0b',
  happy: '#facc15',
  busy: '#f59e0b',
  worried: '#ef4444',
  sleepy: '#475569'
}

const PICO_FACE: Record<CharacterExpression, Px[]> = {
  neutral: [[5, 7], [10, 7], [6, 10, 4, 1]],
  attentive: [[5, 6, 2, 2], [9, 6, 2, 2], [7, 10, 2, 1]],
  thinking: [[6, 6], [11, 6], [6, 10, 4, 1]],
  puzzled: [[5, 7], [9, 6, 2, 2], [6, 10], [7, 9], [8, 10], [9, 9]],
  happy: [[4, 7], [5, 6], [6, 7], [9, 7], [10, 6], [11, 7], [6, 9], [7, 10, 2, 1], [9, 9]],
  busy: [[4, 7, 3, 1], [9, 7, 3, 1], [7, 10, 2, 1]],
  worried: [[5, 7], [10, 7], [4, 6], [11, 6], [6, 10], [7, 9, 2, 1], [9, 10]],
  sleepy: [[4, 7, 3, 1], [9, 7, 3, 1], [7, 10, 2, 1]]
}

const PICO_EXTRA: Partial<Record<CharacterExpression, string>> = {
  puzzled: rects([[13, 0, 2, 1], [15, 1], [14, 2], [14, 4]], '#f59e0b'),
  happy: rects([[0, 1], [1, 0], [1, 2], [2, 1]], '#facc15'),
  // A crescent moon: a Z needs five rows, and only three fit above the head
  sleepy: rects([[14, 0, 2, 1], [13, 1], [14, 2, 2, 1]], '#cbd5e1'),
  worried: rects([[14, 4], [14, 5]], '#7dd3fc')
}

function picoSvg(e: CharacterExpression): string {
  const body =
    rects([[7, 0, 2, 1]], PICO_LAMP[e]) +
    rects([[7.5, 1, 1, 2]], '#64748b') +
    rects([[2, 3, 12, 10]], '#475569') +
    rects([[3, 4, 10, 8]], '#0f172a') +
    rects([[1, 6, 1, 4], [14, 6, 1, 4]], '#64748b') +
    rects([[4, 13, 8, 2]], '#334155') +
    rects([[5, 15, 2, 1], [9, 15, 2, 1]], '#1e293b')
  const face = rects(PICO_FACE[e], '#7dd3fc')
  return svg('0 0 16 16', body + face + (PICO_EXTRA[e] ?? ''), 'shape-rendering="crispEdges"')
}

export function builtinCharacterSvg(id: BuiltinCharacterId, expression: CharacterExpression): string {
  return id === 'pico' ? picoSvg(expression) : mochiSvg(expression)
}

export function builtinCharacterUrl(id: BuiltinCharacterId, expression: CharacterExpression): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(builtinCharacterSvg(id, expression))}`
}
