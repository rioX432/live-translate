import React, { useEffect, useState } from 'react'
import { useSettingsState } from '../hooks/useSettingsState'
import {
  AudioSettings,
  LanguageSettings,
  STTSettings,
  TranslatorSettings,
  SubtitleSettings,
  TTSSettings,
  VirtualMicSettings,
  SessionControls,
  UpdateStatus,
  CrashRecoveryBanner,
  ConfigSummary,
  QuickStartPanel,
  EnterpriseSettings,
  KeyboardShortcuts,
  AccessibilitySettings
} from './settings'

function SettingsPanel(): React.JSX.Element {
  const s = useSettingsState()
  const disabled = s.isRunning || s.isStarting

  const [showQuickStart, setShowQuickStart] = useState(false)
  const [quickStartChecked, setQuickStartChecked] = useState(false)

  // Check if Quick Start should be shown on mount
  useEffect(() => {
    window.api.quickStartIsCompleted().then((completed) => {
      setShowQuickStart(!completed)
      setQuickStartChecked(true)
    }).catch(() => {
      setQuickStartChecked(true)
    })
  }, [])

  // Listen for global shortcut actions from main process (#551)
  useEffect(() => {
    const unsub = window.api.onShortcutAction?.((action: string) => {
      if (action === 'toggle-capture-start' && !s.isRunning && !s.isStarting) {
        s.handleStart()
      } else if (action === 'toggle-capture-stop' && s.isRunning) {
        s.handleStop()
      }
    })
    const unsubLang = window.api.onLanguageSwitched?.((data: { sourceLanguage: string; targetLanguage: string }) => {
      s.setSourceLanguage(data.sourceLanguage as never)
      s.setTargetLanguage(data.targetLanguage as never)
    })
    return () => {
      unsub?.()
      unsubLang?.()
    }
  }, [s.isRunning, s.isStarting, s.handleStart, s.handleStop])

  // Show nothing until we know whether to show Quick Start
  if (!quickStartChecked) {
    return <div style={containerStyle} />
  }

  // Show Quick Start panel for first-time users
  if (showQuickStart) {
    return (
      <div style={containerStyle}>
        <QuickStartPanel onSetupComplete={() => setShowQuickStart(false)} />
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>live-translate</h1>

      {/* Crash recovery banner */}
      {s.crashedSession && !s.isRunning && (
        <CrashRecoveryBanner
          isStarting={s.isStarting}
          onResume={s.handleResume}
          onDismiss={s.handleDismissResume}
        />
      )}

      {/* Audio Input — always visible (#501: supports mic, system, or both) */}
      <AudioSettings
        audio={s.audio}
        disabled={disabled}
        noiseSuppressionEnabled={s.noiseSuppression.enabled}
        onNoiseSuppressionChange={s.noiseSuppression.setEnabled}
        platform={s.platform}
      />

      {/* Current config summary — always visible */}
      <ConfigSummary
        sttEngine={s.sttEngine}
        whisperVariant={s.whisperVariant}
        engineMode={s.engineMode}
        sourceLanguage={s.sourceLanguage}
        targetLanguage={s.targetLanguage}
        gpuInfo={s.gpuInfo}
      />

      {/* Advanced Settings toggle */}
      <button
        onClick={() => s.setShowAdvanced(!s.showAdvanced)}
        style={advancedToggleStyle}
      >
        <span>Advanced Settings</span>
        <span style={{ transform: s.showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          ▼
        </span>
      </button>

      {/* Advanced Settings content */}
      {s.showAdvanced && (
        <div style={{ marginBottom: '16px' }}>
          <LanguageSettings
            sourceLanguage={s.sourceLanguage}
            onSourceLanguageChange={s.setSourceLanguage}
            targetLanguage={s.targetLanguage}
            onTargetLanguageChange={s.setTargetLanguage}
            disabled={disabled}
          />

          <STTSettings
            sttEngine={s.sttEngine}
            onSttEngineChange={s.setSttEngine}
            whisperVariant={s.whisperVariant}
            onWhisperVariantChange={s.setWhisperVariant}
            platform={s.platform}
            disabled={disabled}
            sourceLanguage={s.sourceLanguage}
            draftSttEnabled={s.draftSttEnabled}
            onDraftSttEnabledChange={s.setDraftSttEnabled}
          />

          <TranslatorSettings
            engineMode={s.engineMode}
            onEngineModeChange={s.setEngineMode}
            platform={s.platform}
            disabled={disabled}
            gpuInfo={s.gpuInfo}
            slmKvCacheQuant={s.slmKvCacheQuant}
            onSlmKvCacheQuantChange={s.setSlmKvCacheQuant}
            simulMtEnabled={s.simulMtEnabled}
            onSimulMtEnabledChange={s.setSimulMtEnabled}
            simulMtWaitK={s.simulMtWaitK}
            onSimulMtWaitKChange={s.setSimulMtWaitK}
            adaptiveRoutingEnabled={s.adaptiveRoutingEnabled}
            onAdaptiveRoutingEnabledChange={s.setAdaptiveRoutingEnabled}
            adaptiveRoutingShortThreshold={s.adaptiveRoutingShortThreshold}
            onAdaptiveRoutingShortThresholdChange={s.setAdaptiveRoutingShortThreshold}
            adaptiveRoutingLongThreshold={s.adaptiveRoutingLongThreshold}
            onAdaptiveRoutingLongThresholdChange={s.setAdaptiveRoutingLongThreshold}
            adaptiveRoutingQualityEngine={s.adaptiveRoutingQualityEngine}
            onAdaptiveRoutingQualityEngineChange={s.setAdaptiveRoutingQualityEngine}
            apiKey={s.apiKey}
            onApiKeyChange={s.setApiKey}
            deeplApiKey={s.deeplApiKey}
            onDeeplApiKeyChange={s.setDeeplApiKey}
            geminiApiKey={s.geminiApiKey}
            onGeminiApiKeyChange={s.setGeminiApiKey}
            microsoftApiKey={s.microsoftApiKey}
            onMicrosoftApiKeyChange={s.setMicrosoftApiKey}
            microsoftRegion={s.microsoftRegion}
            onMicrosoftRegionChange={s.setMicrosoftRegion}
            showApiOptions={s.showApiOptions}
            onShowApiOptionsChange={s.setShowApiOptions}
            glossaryTerms={s.glossaryTerms}
            onGlossaryTermsChange={s.setGlossaryTerms}
            orgGlossaryTerms={s.orgGlossaryTerms}
            onOrgGlossaryTermsChange={s.setOrgGlossaryTerms}
          />

          <SubtitleSettings
            fontSize={s.subtitleFontSize}
            onFontSizeChange={(v) => { s.setSubtitleFontSize(v); s.pushSubtitleSettings({ fontSize: v }) }}
            sourceColor={s.subtitleSourceColor}
            onSourceColorChange={(v) => { s.setSubtitleSourceColor(v); s.pushSubtitleSettings({ sourceTextColor: v }) }}
            translatedColor={s.subtitleTranslatedColor}
            onTranslatedColorChange={(v) => { s.setSubtitleTranslatedColor(v); s.pushSubtitleSettings({ translatedTextColor: v }) }}
            bgOpacity={s.subtitleBgOpacity}
            onBgOpacityChange={(v) => { s.setSubtitleBgOpacity(v); s.pushSubtitleSettings({ backgroundOpacity: v }) }}
            position={s.subtitlePosition}
            onPositionChange={(v) => { s.setSubtitlePosition(v); s.pushSubtitleSettings({ position: v }) }}
            showConfidenceIndicator={s.showConfidenceIndicator}
            onShowConfidenceIndicatorChange={(v) => {
              s.setShowConfidenceIndicator(v)
              s.pushSubtitleSettings({ showConfidenceIndicator: v })
              window.api.saveSettings({ showConfidenceIndicator: v })
            }}
            displays={s.displays}
            selectedDisplay={s.selectedDisplay}
            onDisplayChange={s.handleDisplayChange}
          />

          <AccessibilitySettings
            highContrast={s.accessibility.highContrast}
            onHighContrastChange={(v) => { s.accessibility.setHighContrast(v); s.pushSubtitleSettings({ accessibility: { highContrast: v, dyslexiaFont: s.accessibility.dyslexiaFont, reducedMotion: s.accessibility.reducedMotion, letterSpacing: s.accessibility.letterSpacing, wordSpacing: s.accessibility.wordSpacing } }) }}
            dyslexiaFont={s.accessibility.dyslexiaFont}
            onDyslexiaFontChange={(v) => { s.accessibility.setDyslexiaFont(v); s.pushSubtitleSettings({ accessibility: { highContrast: s.accessibility.highContrast, dyslexiaFont: v, reducedMotion: s.accessibility.reducedMotion, letterSpacing: s.accessibility.letterSpacing, wordSpacing: s.accessibility.wordSpacing } }) }}
            reducedMotion={s.accessibility.reducedMotion}
            onReducedMotionChange={(v) => { s.accessibility.setReducedMotion(v); s.pushSubtitleSettings({ accessibility: { highContrast: s.accessibility.highContrast, dyslexiaFont: s.accessibility.dyslexiaFont, reducedMotion: v, letterSpacing: s.accessibility.letterSpacing, wordSpacing: s.accessibility.wordSpacing } }) }}
            letterSpacing={s.accessibility.letterSpacing}
            onLetterSpacingChange={(v) => { s.accessibility.setLetterSpacing(v); s.pushSubtitleSettings({ accessibility: { highContrast: s.accessibility.highContrast, dyslexiaFont: s.accessibility.dyslexiaFont, reducedMotion: s.accessibility.reducedMotion, letterSpacing: v, wordSpacing: s.accessibility.wordSpacing } }) }}
            wordSpacing={s.accessibility.wordSpacing}
            onWordSpacingChange={(v) => { s.accessibility.setWordSpacing(v); s.pushSubtitleSettings({ accessibility: { highContrast: s.accessibility.highContrast, dyslexiaFont: s.accessibility.dyslexiaFont, reducedMotion: s.accessibility.reducedMotion, letterSpacing: s.accessibility.letterSpacing, wordSpacing: v } }) }}
          />

          <TTSSettings disabled={disabled} />

          <VirtualMicSettings disabled={disabled} />

          <EnterpriseSettings disabled={disabled} />

          <KeyboardShortcuts />

          <UpdateStatus />
        </div>
      )}

      {/* Session controls — always visible */}
      <SessionControls
        isRunning={s.isRunning}
        isStarting={s.isStarting}
        engineMode={s.engineMode}
        apiKey={s.apiKey}
        deeplApiKey={s.deeplApiKey}
        geminiApiKey={s.geminiApiKey}
        microsoftApiKey={s.microsoftApiKey}
        status={s.status}
        sessionDuration={s.sessionDuration}
        onStart={s.handleStart}
        onStop={s.handleStop}
        lastTranscriptPath={s.lastTranscriptPath}
        summaryText={s.summaryText}
        isSummarizing={s.isSummarizing}
        onGenerateSummary={s.handleGenerateSummary}
        onSetStatus={s.setStatus}
        sessions={s.sessions}
      />
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '1.25rem 1.5rem',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: '#e2e8f0',
  background: '#0f172a',
  minHeight: '100vh',
  fontSize: '0.875rem'
}

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  marginBottom: '20px',
  color: '#f8fafc',
  letterSpacing: '-0.02em'
}

const advancedToggleStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'transparent',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#94a3b8',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px'
}

export default SettingsPanel
