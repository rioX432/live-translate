import React, { useEffect, useState } from 'react'
import { Section } from './Section'
import { disclosureArrowStyle, disclosureToggleStyle, inputStyle } from './shared'
import { type GlossaryTerm, termFromInput, upsertTerm } from './glossary-terms'

interface GlossarySettingsProps {
  glossaryTerms: GlossaryTerm[]
  onGlossaryTermsChange: (terms: GlossaryTerm[]) => void
  orgGlossaryTerms: GlossaryTerm[]
  onOrgGlossaryTermsChange: (terms: GlossaryTerm[]) => void
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
  glossaryTerms,
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: GlossarySettingsProps): React.JSX.Element {
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

  // The pipeline reads the glossary on every utterance, so edits need no restart
  const savePersonal = (terms: GlossaryTerm[]): void => {
    onGlossaryTermsChange(terms)
    window.api.saveGlossary(terms)
  }
  const saveOrg = (terms: GlossaryTerm[]): void => {
    onOrgGlossaryTermsChange(terms)
    window.api.saveOrgGlossary(terms)
  }

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
        // The main process already stored the imported list
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
          Fixed translations for specific terms (e.g. proper nouns). Changes apply from the next
          sentence, also during a meeting. &ldquo;Heard as&rdquo; lists spellings speech recognition
          writes for the term; they are corrected to the term.
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => handleImport('personal')} style={glossaryButtonStyle}>
            Import JSON/CSV
          </button>
          {glossaryTerms.length > 0 && (
            <>
              <button onClick={() => handleExport('personal', 'json')} style={glossaryButtonStyle}>
                Export JSON
              </button>
              <button onClick={() => handleExport('personal', 'csv')} style={glossaryButtonStyle}>
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
          <TermList terms={glossaryTerms} onChange={savePersonal} targetColor="#93c5fd" maxHeight="240px" />
        )}
        <TermForm submitLabel="Add" onSubmit={(term) => savePersonal(upsertTerm(glossaryTerms, term))} />
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
              <button onClick={() => handleImport('org')} style={glossaryButtonStyle}>
                Import JSON/CSV
              </button>
              {orgGlossaryTerms.length > 0 && (
                <>
                  <button onClick={() => handleExport('org', 'json')} style={glossaryButtonStyle}>
                    Export JSON
                  </button>
                  <button onClick={() => handleExport('org', 'csv')} style={glossaryButtonStyle}>
                    Export CSV
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm('Clear organization glossary? This cannot be undone.')) return
                      saveOrg([])
                      setGlossaryStatus('Organization glossary cleared')
                    }}
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
              <TermList terms={orgGlossaryTerms} onChange={saveOrg} targetColor="#a78bfa" maxHeight="180px" />
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

function TermForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: GlossaryTerm
  submitLabel: string
  onSubmit: (term: GlossaryTerm) => void
  onCancel?: () => void
}): React.JSX.Element {
  const [source, setSource] = useState(initial?.source ?? '')
  const [target, setTarget] = useState(initial?.target ?? '')
  const [aliases, setAliases] = useState(initial?.aliases?.join(', ') ?? '')
  const term = termFromInput(source, target, aliases)
  const ready = term !== null

  const submit = (): void => {
    if (!term) return
    onSubmit(term)
    if (!initial) {
      setSource('')
      setTarget('')
      setAliases('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Source term"
          aria-label="Source term"
          style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
        />
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Translation"
          aria-label="Translation"
          style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="Heard as (optional, comma-separated)"
          aria-label="Heard as"
          style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          style={{ ...termButtonStyle, color: '#e2e8f0', cursor: ready ? 'pointer' : 'not-allowed' }}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ ...termButtonStyle, color: '#94a3b8' }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function TermList({
  terms,
  onChange,
  targetColor,
  maxHeight
}: {
  terms: GlossaryTerm[]
  onChange: (terms: GlossaryTerm[]) => void
  targetColor: string
  maxHeight: string
}): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <div style={{ marginBottom: '8px', maxHeight, overflowY: 'auto' }}>
      {terms.map((term, idx) => editing === idx ? (
        <div key={`${idx}-${term.source}`} style={{ padding: '4px 0 8px', borderBottom: '1px solid #1e293b' }}>
          <TermForm
            initial={term}
            submitLabel="Save"
            onSubmit={(updated) => { onChange(upsertTerm(terms, updated, idx)); setEditing(null) }}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <div
          key={`${idx}-${term.source}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 0',
            borderBottom: '1px solid #1e293b',
            fontSize: '12px'
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ ...cellStyle, color: '#e2e8f0' }} title={term.source}>{term.source}</span>
              <span style={{ color: '#94a3b8', flexShrink: 0 }}>&rarr;</span>
              <span style={{ ...cellStyle, color: targetColor }} title={term.target}>{term.target}</span>
            </div>
            {term.aliases?.length ? (
              <div style={{ ...cellStyle, fontSize: '11px', color: '#94a3b8' }} title={term.aliases.join(', ')}>
                Heard as: {term.aliases.join(', ')}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => setEditing(idx)}
            aria-label={`Edit ${term.source}`}
            style={{ ...termButtonStyle, color: '#e2e8f0' }}
          >
            Edit
          </button>
          <button
            onClick={() => { onChange(terms.filter((_, i) => i !== idx)); setEditing(null) }}
            aria-label={`Remove ${term.source}`}
            style={{ ...termButtonStyle, color: '#ef4444' }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const termButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  minHeight: '44px',
  fontSize: '12px',
  fontWeight: 600,
  background: '#334155',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0
}
