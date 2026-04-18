/** Centralized design tokens — Tailwind Slate palette */
export const colors = {
  bg: {
    primary: '#0f172a',    // slate-900
    secondary: '#1e293b',  // slate-800
    tertiary: '#334155',   // slate-700
  },
  border: {
    default: '#334155',    // slate-700
    subtle: '#1e293b',     // slate-800
  },
  text: {
    primary: '#e2e8f0',    // slate-200
    secondary: '#cbd5e1',  // slate-300
    muted: '#94a3b8',      // slate-400
    dim: '#64748b',        // slate-500
  },
  accent: {
    blue: '#3b82f6',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#60a5fa',
  },
  translated: '#7dd3fc',   // sky-300 — default translated text color
} as const

export const fontSize = {
  xs: '10px',
  sm: '11px',
  base: '12px',
  md: '13px',
  lg: '14px',
  xl: '18px',
  '2xl': '20px',
} as const

export const spacing = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
} as const
