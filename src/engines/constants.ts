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
// Qwen3-ASR resident helper
// ---------------------------------------------------------------------------

/** Spawn to ready: model load plus one warm-up decode that compiles the Metal kernels (ms) */
export const QWEN3_ASR_READY_TIMEOUT_MS = 120_000

/** One transcription reply; the renderer VAD caps a segment at 12 s of audio (ms) */
export const QWEN3_ASR_REQUEST_TIMEOUT_MS = 30_000

/** Consecutive helper crashes or failed starts tolerated before STT reports a hard failure */
export const QWEN3_ASR_MAX_RESTARTS = 3

// ---------------------------------------------------------------------------
// FluidAudio speaker diarization (#549)
// ---------------------------------------------------------------------------

/** Command timeout for FluidAudio diarization per chunk (ms) */
export const FLUID_AUDIO_DIARIZE_TIMEOUT_MS = 10_000

/** Init timeout for FluidAudio — first run downloads ~32MB of CoreML models (ms) */
export const FLUID_AUDIO_INIT_TIMEOUT_MS = 300_000
