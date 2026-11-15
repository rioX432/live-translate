/**
 * Allowlist and type validation for settings written by the renderer through `save-settings`.
 *
 * Keys not listed here (activeSession, wsAudioPort, isFirstRun, onboarding state, glossaries, ...)
 * have dedicated handlers or are owned by the main process, so the generic writer must not touch them.
 */

type Validator = (value: unknown) => boolean

const isBool: Validator = (v) => typeof v === 'boolean'
const isString: Validator = (v) => typeof v === 'string' && v.length <= 256
const isInt =
  (min: number, max: number): Validator =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf =
  (...allowed: string[]): Validator =>
  (v) =>
    typeof v === 'string' && allowed.includes(v)

const LANGUAGES = ['ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'nl', 'pl', 'ar', 'th', 'vi', 'id']

export const SAVEABLE_SETTINGS: Readonly<Record<string, Validator>> = {
  translationEngine: isString,
  selectedMicrophone: isString,
  sttEngine: isString,
  selectedDisplay: isInt(0, 64),
  saveTranscripts: isBool,
  sessionRecoveryEnabled: isBool,
  slmKvCacheQuant: isBool,
  slmModelSize: oneOf('4b', '12b'),
  slmSpeculativeDecoding: isBool,
  simulMtEnabled: isBool,
  simulMtWaitK: isInt(1, 10),
  whisperVariant: isString,
  moonshineVariant: isString,
  sherpaOnnxModel: isString,
  sourceLanguage: (v) => v === 'auto' || (typeof v === 'string' && LANGUAGES.includes(v)),
  targetLanguage: (v) => typeof v === 'string' && LANGUAGES.includes(v),
  noiseSuppressionEnabled: isBool,
  streamingIntervalMs: isInt(500, 3000),
  showConfidenceIndicator: isBool,
  audioSource: oneOf('microphone', 'system', 'both'),
  hasCompletedSetup: isBool,
  ttsEnabled: isBool,
  ttsVoice: isString,
  ttsOutputDevice: isString,
  ttsVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  virtualMicEnabled: isBool,
  virtualMicDeviceId: isInt(-1, 4096),
  draftSttEnabled: isBool,
  speakerDiarizationEnabled: isBool,
  telemetryConsent: isBool,
  telemetryConsentShown: isBool,
  preferredLocalEngine: isString
}

/** Throws on an unknown key or a wrongly typed value; returns the entries to persist otherwise */
export function validateSettingsUpdate(settings: unknown): Array<[string, unknown]> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Invalid settings payload')
  }
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(settings)) {
    const validator = Object.prototype.hasOwnProperty.call(SAVEABLE_SETTINGS, key) ? SAVEABLE_SETTINGS[key] : undefined
    if (!validator) throw new Error(`Setting "${key}" cannot be saved`)
    if (!validator(value)) throw new Error(`Invalid value for setting "${key}"`)
    entries.push([key, value])
  }
  return entries
}
