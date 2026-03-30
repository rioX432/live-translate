import React from 'react'
import { useSettingsState } from '../hooks/useSettingsState'
import {
  AudioSettings,
  LanguageSettings,
  STTSettings,
  TranslatorSettings,
  SubtitleSettings,
  SessionControls,
  UpdateStatus,
  CrashRecoveryBanner,
  ConfigSummary
} from './settings'

function SettingsPanel(): React.JSX.Element {
  const s = useSettingsState()
  const disabled = s.isRunning || s.isStarting

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

      {/* Microphone Selection — always visible */}
      <AudioSettings
        audio={s.audio}
        disabled={disabled}
        noiseSuppressionEnabled={s.noiseSuppression.enabled}
        onNoiseSuppressionChange={s.noiseSuppression.setEnabled}
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
