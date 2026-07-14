/** Shadow measurement harness (#720) — parallel engine-path telemetry. */
export { ShadowRunner } from './ShadowRunner'
export { Semaphore } from './Semaphore'
export { summarize, percentile, estimateCostUsd } from './metrics'
export type { ShadowReport, PathSummary, LatencyStats } from './metrics'
export {
  DEFAULT_PATH_CONFIG,
  DEFAULT_LOCAL_LLM_PATH_CONFIG,
  DEFAULT_RUNNER_CONFIG
} from './types'
export type {
  ShadowPath,
  ShadowPathDescriptor,
  ShadowPathKind,
  ShadowPathConfig,
  ShadowRunnerConfig,
  ShadowCostModel,
  PathSampleResult,
  ShadowSample,
  ShadowDrop,
  ShadowError,
  DropReason
} from './types'
