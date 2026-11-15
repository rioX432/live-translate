import React from 'react'
import { colors, fontSize } from '../../theme'

/**
 * Entry point for the glossary and memory the character will learn. It is
 * empty for now; memory is stored apart from characters, so switching or
 * deleting a character never removes it.
 */
export function MemoryScreen({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <section
      aria-labelledby="memory-screen-title"
      data-testid="memory-screen"
      style={{
        marginTop: '12px',
        padding: '12px',
        background: colors.bg.primary,
        border: `1px solid ${colors.border.default}`,
        borderRadius: '8px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h3 id="memory-screen-title" style={{ margin: 0, fontSize: fontSize.lg, color: colors.text.primary }}>
          Glossary &amp; Memory
        </h3>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: colors.text.muted, cursor: 'pointer', fontSize: fontSize.md }}
        >
          Close
        </button>
      </div>
      <p style={{ margin: 0, fontSize: fontSize.base, color: colors.text.muted, lineHeight: 1.6 }}>
        Nothing has been remembered yet. Terms and corrections will appear here once the character can learn them.
        They are kept separately from characters, so changing or deleting a character keeps them.
      </p>
    </section>
  )
}
