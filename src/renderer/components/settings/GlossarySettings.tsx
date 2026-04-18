import React, { useEffect, useState } from 'react'
import { Section } from './Section'
import { disclosureArrowStyle, disclosureToggleStyle, inputStyle } from './shared'

interface GlossarySettingsProps {
  disabled: boolean
  glossaryTerms: Array<{ source: string; target: string }>
  onGlossaryTermsChange: (terms: Array<{ source: string; target: string }>) => void
  orgGlossaryTerms: Array<{ source: string; target: string }>
  onOrgGlossaryTermsChange: (terms: Array<{ source: string; target: string }>) => void
}

const glossaryButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '11px',
  fontWeight: 600,
  background: '#334155',
  color: '#e2e8f0',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  minHeight: '44px'
}

export function GlossarySettings({
  disabled,
  glossaryTerms,
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: GlossarySettingsProps): React.JSX.Element {
  const [newGlossarySource, setNewGlossarySource] = useState('')
  const [newGlossaryTarget, setNewGlossaryTarget] = useState('')
  const [glossaryStatus, setGlossaryStatus] = useState('')
  const [showOrgGlossary, setShowOrgGlossary] = useState(orgGlossaryTerms.length > 0)
  const [conflicts, setConflicts] = useState<Array<{ source: string; personalTarget: string; orgTarget: string }>>([])

  useEffect(() => {
    if (orgGlossaryTerms.length > 0 && glossaryTerms.length > 0) {
      window.api.getMergedGlossary().then((result) => {
        setConflicts(result.conflicts)
      }).catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err))
        console.warn('[glossary] Failed to merge glossary:', e.message)
      })
    } else {
      setConflicts([])
    }
  }, [glossaryTerms, orgGlossaryTerms])

  useEffect(() => {
    if (orgGlossaryTerms.length > 0) setShowOrgGlossary(true)
  }, [orgGlossaryTerms.length])

  const handleImport = async (target: 'personal' | 'org'): Promise<void> => {
    setGlossaryStatus('Importing...')
    try {
      const result = await window.api.importGlossary(target)
      if (result.canceled) {
        setGlossaryStatus('')
        return
      }
      if (result.error) {
        setGlossaryStatus(result.error)
        return
      }
      if (result.entries) {
        if (target === 'org') {
          onOrgGlossaryTermsChange(result.entries)
        } else {
          onGlossaryTermsChange(result.entries)
        }
        setGlossaryStatus(`Imported ${result.count} terms`)
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[glossary] Import failed:', e.message)
      setGlossaryStatus(`Import failed: ${e.message}`)
    }
  }

  const handleExport = async (target: 'personal' | 'org', format: 'json' | 'csv'): Promise<void> => {
    setGlossaryStatus('Exporting...')
    try {
      const result = await window.api.exportGlossary(target, format)
      if (result.canceled) {
        setGlossaryStatus('')
        return
      }
      if (result.error) {
        setGlossaryStatus(result.error)
        return
      }
      setGlossaryStatus(`Exported ${result.count} terms`)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[glossary] Export failed:', e.message)
      setGlossaryStatus(`Export failed: ${e.message}`)
    }
  }

  return (
    <>
      <Section label="Personal Glossary">
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
          Define fixed translations for specific terms (e.g. proper nouns).
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => handleImport('personal')} disabled={disabled} style={glossaryButtonStyle}>
            Import JSON/CSV
          </button>
          {glossaryTerms.length > 0 && (
            <>
              <button onClick={() => handleExport('personal', 'json')} disabled={disabled} style={glossaryButtonStyle}>
                Export JSON
              </button>
              <button onClick={() => handleExport('personal', 'csv')} disabled={disabled} style={glossaryButtonStyle}>
                Export CSV
              </button>
            </>
          )}
          <span style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'center' }}>
            {glossaryTerms.length} terms
          </span>
        </div>
        {glossaryTerms.length === 0 ? (
          <div
            style={{
              fontSize: '12px',
              color: '#94a3b8',
              textAlign: 'center',
              padding: '16px 0',
              borderBottom: '1px solid #1e293b'
            }}
          >
            No glossary terms added yet
          </div>
        ) : (
          <div style={{ marginBottom: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {glossaryTerms.map((term, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 0',
                  borderBottom: '1px solid #1e293b',
                  fontSize: '12px'
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: '#e2e8f0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={term.source}
                >
                  {term.source}
                </span>
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>&rarr;</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: '#93c5fd',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={term.target}
                >
                  {term.target}
                </span>
                <button
                  onClick={() => {
                    const updated = glossaryTerms.filter((_, i) => i !== idx)
                    onGlossaryTermsChange(updated)
                    window.api.saveGlossary(updated)
                  }}
                  disabled={disabled}
                  style={{
                    padding: '8px 16px',
                    minHeight: '44px',
                    fontSize: '12px',
                    background: '#334155',
                    color: '#ef4444',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            value={newGlossarySource}
            onChange={(e) => setNewGlossarySource(e.target.value)}
            placeholder="Source term"
            aria-label="Source term"
            style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
            disabled={disabled}
          />
          <input
            type="text"
            value={newGlossaryTarget}
            onChange={(e) => setNewGlossaryTarget(e.target.value)}
            placeholder="Translation"
            aria-label="Translation"
            style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
            disabled={disabled}
          />
          <button
            onClick={() => {
              if (!newGlossarySource.trim() || !newGlossaryTarget.trim()) return
              const updated = [...glossaryTerms, { source: newGlossarySource.trim(), target: newGlossaryTarget.trim() }]
              onGlossaryTermsChange(updated)
              window.api.saveGlossary(updated)
              setNewGlossarySource('')
              setNewGlossaryTarget('')
            }}
            disabled={disabled || !newGlossarySource.trim() || !newGlossaryTarget.trim()}
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
              background: '#334155',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: '6px',
              cursor: (disabled || !newGlossarySource.trim() || !newGlossaryTarget.trim()) ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Add
          </button>
        </div>
      </Section>

      <Section label="Organization Glossary">
        <button
          onClick={() => setShowOrgGlossary(!showOrgGlossary)}
          aria-expanded={showOrgGlossary}
          style={{ ...disclosureToggleStyle, fontSize: '12px' }}
        >
          <span style={disclosureArrowStyle(showOrgGlossary)}>
            &#9654;
          </span>
          Shared team glossary — org terms override personal when conflicts
        </button>

        {showOrgGlossary && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => handleImport('org')} disabled={disabled} style={glossaryButtonStyle}>
                Import JSON/CSV
              </button>
              {orgGlossaryTerms.length > 0 && (
                <>
                  <button onClick={() => handleExport('org', 'json')} disabled={disabled} style={glossaryButtonStyle}>
                    Export JSON
                  </button>
                  <button onClick={() => handleExport('org', 'csv')} disabled={disabled} style={glossaryButtonStyle}>
                    Export CSV
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm('Clear organization glossary? This cannot be undone.')) return
                      onOrgGlossaryTermsChange([])
                      window.api.saveOrgGlossary([])
                      setGlossaryStatus('Organization glossary cleared')
                    }}
                    disabled={disabled}
                    style={{ ...glossaryButtonStyle, color: '#ef4444' }}
                  >
                    Clear
                  </button>
                </>
              )}
              <span style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'center' }}>
                {orgGlossaryTerms.length} terms
              </span>
            </div>

            {orgGlossaryTerms.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>
                No organization glossary imported. Import a JSON or CSV file shared by your team.
              </div>
            ) : (
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {orgGlossaryTerms.map((term, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 0',
                      borderBottom: '1px solid #1e293b',
                      fontSize: '12px'
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={term.source}>
                      {term.source}
                    </span>
                    <span style={{ color: '#94a3b8', flexShrink: 0 }}>&rarr;</span>
                    <span style={{ flex: 1, minWidth: 0, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={term.target}>
                      {term.target}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {conflicts.length > 0 && (
              <div style={{ marginTop: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
                  {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} (org overrides personal)
                </div>
                {conflicts.slice(0, 5).map((c, idx) => (
                  <div key={idx} style={{ fontSize: '11px', color: '#94a3b8', padding: '2px 0' }}>
                    <span style={{ color: '#e2e8f0' }}>{c.source}</span>
                    {' '}
                    <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>{c.personalTarget}</span>
                    {' '}
                    <span style={{ color: '#a78bfa' }}>{c.orgTarget}</span>
                  </div>
                ))}
                {conflicts.length > 5 && (
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    ...and {conflicts.length - 5} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {glossaryStatus && (
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {glossaryStatus}
          </div>
        )}
      </Section>
    </>
  )
}
