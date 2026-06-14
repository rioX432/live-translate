/**
 * Shared utilities for API-based translators.
 * Deduplicates HTTP request, timeout, error handling, and JSON parsing logic.
 */

/** Default request timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 15_000

/** HTTP error mapping entry: status code(s) to human-readable message */
export interface HttpErrorMapping {
  statuses: number[]
  message: string
}

/**
 * Body-aware error classifier. Called for non-OK HTTP statuses with the raw
 * response body. Return a string message to throw, or null to fall through to
 * the standard errorMappings / generic message.
 */
export type ErrorBodyClassifier = (status: number, body: string) => string | null

/** Options for fetchWithTimeout */
export interface ApiFetchOptions {
  url: string
  init: RequestInit
  timeoutMs: number
  /** Service name for error messages (e.g. "Google Translation API") */
  serviceName: string
  /** Custom status-to-message mappings, checked before the generic fallback */
  errorMappings?: HttpErrorMapping[]
  /**
   * Optional body-aware classifier evaluated before errorMappings. Useful when
   * a single status code (e.g. 429) needs to be split into multiple semantic
   * errors based on the response body (e.g. monthly quota vs short rate-limit).
   */
  classifyErrorBody?: ErrorBodyClassifier
}

/**
 * Perform a fetch with AbortController timeout, HTTP error mapping, and JSON parsing.
 * Returns the parsed JSON response body.
 */
export async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const { url, init, timeoutMs, serviceName, errorMappings, classifyErrorBody } = options

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    })

    if (!response.ok) {
      let body = ''
      if (classifyErrorBody) {
        try {
          body = await response.text()
        } catch {
          // ignore — fall through to status-only handling
        }
        const classified = classifyErrorBody(response.status, body)
        if (classified) {
          throw new Error(`${serviceName}: ${classified}`)
        }
      }
      throwHttpError(response.status, serviceName, errorMappings)
    }

    let data: T
    try {
      data = (await response.json()) as T
    } catch {
      throw new Error(`${serviceName}: Invalid JSON response`)
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Throw a descriptive error based on HTTP status code.
 * Checks custom mappings first, then falls back to a generic message.
 */
function throwHttpError(
  status: number,
  serviceName: string,
  errorMappings?: HttpErrorMapping[]
): never {
  if (errorMappings) {
    for (const mapping of errorMappings) {
      if (mapping.statuses.includes(status)) {
        throw new Error(`${serviceName}: ${mapping.message}`)
      }
    }
  }
  throw new Error(`${serviceName} error: ${status}`)
}

/**
 * Standard initialization guard for API translators.
 * Validates the API key is present, runs a test translation, and marks as initialized.
 * Returns true if already initialized (caller should return early).
 */
export async function apiInitialize(opts: {
  initialized: boolean
  apiKey: string
  keyName: string
  serviceName: string
  testTranslate: () => Promise<string>
}): Promise<boolean> {
  if (opts.initialized) return true
  if (!opts.apiKey) {
    throw new Error(`${opts.keyName} is required`)
  }
  try {
    await opts.testTranslate()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Invalid ${opts.serviceName} key: ${msg}`)
  }
  return false
}
