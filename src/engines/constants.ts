/**
 * Shared timeout and limit constants for engine subsystems.
 *
 * Centralizes magic numbers previously scattered across SubprocessBridge,
 * SLM translators, and STT engines so they can be tuned in one place.
 */

// ---------------------------------------------------------------------------
// SubprocessBridge (Python bridge processes)
// ---------------------------------------------------------------------------

/** How long to wait for the dispose command before force-killing the bridge (ms) */
export const BRIDGE_DISPOSE_GRACE_MS = 500

/** Max stderr lines forwarded per rate-limit window */
export const BRIDGE_STDERR_MAX_LINES = 10

/** Rate-limit window for stderr forwarding (ms) */
export const BRIDGE_STDERR_WINDOW_MS = 5_000

/** Upper bound on pending requests in SubprocessBridge before oldest is evicted */
export const BRIDGE_MAX_PENDING_REQUESTS = 100

/** Auto-timeout for orphaned pending requests in SubprocessBridge (ms) */
export const BRIDGE_PENDING_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// UtilityProcess workers (SLM / Hunyuan translators)
// ---------------------------------------------------------------------------

/** Timeout for a single SLM translation request (ms) */
export const WORKER_TRANSLATE_TIMEOUT_MS = 30_000

/** Timeout for SLM meeting summarization (ms) */
export const WORKER_SUMMARIZE_TIMEOUT_MS = 120_000

/** Timeout for SLM / Hunyuan model initialization (ms) */
export const WORKER_INIT_TIMEOUT_MS = 5 * 60_000

/** Grace period after sending dispose to the worker before force-killing (ms) */
export const WORKER_DISPOSE_GRACE_MS = 1_000

/** Upper bound on pending requests in UtilityProcess workers before oldest is rejected */
export const WORKER_MAX_PENDING_REQUESTS = 50

// ---------------------------------------------------------------------------
// CTranslate2 bridges (OPUS-MT, Madlad-400)
// ---------------------------------------------------------------------------

/** Command timeout for CT2 OPUS-MT translation (ms) */
export const CT2_OPUS_MT_TRANSLATE_TIMEOUT_MS = 15_000

/** Init timeout for CT2 OPUS-MT bridge (ms) */
export const CT2_OPUS_MT_INIT_TIMEOUT_MS = 120_000

/** Command timeout for CT2 Madlad-400 translation (ms) */
export const CT2_MADLAD400_TRANSLATE_TIMEOUT_MS = 15_000

/** Init timeout for CT2 Madlad-400 bridge (ms) */
export const CT2_MADLAD400_INIT_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Python discovery (execSync import checks)
// ---------------------------------------------------------------------------

/** Timeout for `python3 -c "import ..."` checks when locating a suitable venv (ms) */
export const PYTHON_IMPORT_CHECK_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// STT bridges (mlx-whisper, Qwen-ASR)
// ---------------------------------------------------------------------------

/** Command timeout for mlx-whisper transcription (ms) */
export const MLX_WHISPER_TRANSCRIBE_TIMEOUT_MS = 30_000

/** Init timeout for mlx-whisper bridge (ms) */
export const MLX_WHISPER_INIT_TIMEOUT_MS = 60_000

/** Command timeout for Qwen-ASR transcription (ms) */
export const QWEN_ASR_TRANSCRIBE_TIMEOUT_MS = 30_000

/** Init timeout for Qwen-ASR bridge (ms) */
export const QWEN_ASR_INIT_TIMEOUT_MS = 120_000

/** Command timeout for SenseVoice transcription (ms) */
export const SENSEVOICE_TRANSCRIBE_TIMEOUT_MS = 30_000

/** Init timeout for SenseVoice bridge — model download on first run can be slow (ms) */
export const SENSEVOICE_INIT_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// ANE translator
// ---------------------------------------------------------------------------

/** Command timeout for ANE translation (ms) */
export const ANE_TRANSLATE_TIMEOUT_MS = 30_000

/** Init timeout for ANE bridge — first-run CoreML conversion can be slow (ms) */
export const ANE_INIT_TIMEOUT_MS = 600_000
