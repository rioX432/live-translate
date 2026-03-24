/**
 * Discriminated union types for SLM worker IPC messages (Worker → Main).
 * Shared by SLMTranslator, HunyuanMTTranslator, and HunyuanMT15Translator.
 */

/** Messages sent from the SLM worker back to the main process */
export type SLMWorkerOutgoingMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id?: string; message: string }
