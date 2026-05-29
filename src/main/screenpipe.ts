import { isMainProcessDebugMode } from './debugMode'

const DEFAULT_SCREENPIPE_URL = 'http://127.0.0.1:3030'
const SCREENPIPE_HEALTH_TIMEOUT_MS = 2000
const SCREENPIPE_SEARCH_TIMEOUT_MS = 8000
const SCREENPIPE_GUIDE_SEARCH_LIMIT = 20
/** Bound searches by time to avoid full-table scans on large DBs. */
const SCREENPIPE_GUIDE_SEARCH_LOOKBACK_MS = 2 * 60 * 1000
const SCREENPIPE_GUIDE_DEBUG_TEXT_PREVIEW_CHARS = 240
const SCREENPIPE_GUIDE_DEBUG_FRAME_PREVIEW_CHARS = 120
const SCREENPIPE_GUIDE_DEBUG_MAX_FRAMES = 5
const SCREENPIPE_GUIDE_DEBUG_HEARTBEAT_MS = 3000

type JsonObject = Record<string, unknown>

type ScreenpipeFetchResult = {
  ok: boolean
  status: number
  data: unknown
  url: string
  error?: string
}

export type ScreenpipeEndpointProbe = {
  ok: boolean
  status: number
  error?: string
}

export type ScreenpipeProbeResult = {
  available: boolean
  reason: string
  baseUrl: string
  hasApiKey: boolean
  health?: ScreenpipeEndpointProbe
  search?: ScreenpipeEndpointProbe
}

export type ScreenpipeGuideSnapshot = ScreenpipeProbeResult & {
  text: string | null
  debug?: ScreenpipeGuideDebugInfo
}

export type ScreenpipeSearchFrameSummary = {
  frameId: number | null
  timestamp: string | null
  appName: string | null
  windowName: string | null
  textSource: string | null
  textLength: number
  textPreview: string
}

export type ScreenpipeGuideDebugInfo = {
  searchPath: string
  searchUrl: string
  startTimeIso: string
  healthMs: number
  searchMs: number
  resultCount: number
  paginationTotal: number | null
  frames: ScreenpipeSearchFrameSummary[]
  textLength: number
  textPreview: string
  health: ScreenpipeEndpointProbe
  search: ScreenpipeEndpointProbe
}

export function getScreenpipeBaseUrl(): string {
  const raw = process.env['VIJIA_SCREENPIPE_URL']?.trim()
  return raw || DEFAULT_SCREENPIPE_URL
}

/** From `.env` (`VIJIA_SCREENPIPE_API_KEY`) or shell (`SCREENPIPE_API_KEY`). Run `screenpipe auth token`. */
export function getScreenpipeApiKey(): string | null {
  const raw =
    process.env['VIJIA_SCREENPIPE_API_KEY']?.trim() ||
    process.env['SCREENPIPE_API_KEY']?.trim()
  return raw || null
}

function screenpipeHeaders(): Record<string, string> {
  const key = getScreenpipeApiKey()
  if (!key) {
    return {}
  }
  return { Authorization: `Bearer ${key}` }
}

function fetchErrorMessage(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return `request timed out after ${timeoutMs}ms`
    }
    const cause = error.cause
    if (cause instanceof Error && cause.message) {
      return `${error.message} (${cause.message})`
    }
    return error.message
  }
  return 'unknown fetch error'
}

async function fetchScreenpipe(
  path: string,
  timeoutMs: number
): Promise<ScreenpipeFetchResult> {
  const base = getScreenpipeBaseUrl().replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: screenpipeHeaders()
    })
    let data: unknown = null
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        data = (await res.json()) as unknown
      } catch {
        data = null
      }
    }
    return { ok: res.ok, status: res.status, data, url }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      url,
      error: fetchErrorMessage(error, timeoutMs)
    }
  } finally {
    clearTimeout(timer)
  }
}

function toEndpointProbe(result: ScreenpipeFetchResult): ScreenpipeEndpointProbe {
  return {
    ok: result.ok,
    status: result.status,
    error: result.error
  }
}

function collectStrings(value: unknown, out: string[]): void {
  if (!value) {
    return
  }
  if (typeof value === 'string') {
    const t = value.trim()
    if (t) out.push(t)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as JsonObject)) collectStrings(v, out)
  }
}

function normalizeScreenpipeText(data: unknown): string {
  const chunks: string[] = []
  collectStrings(data, chunks)
  return chunks.join('\n').toLowerCase()
}

/** Prefer `content.text` from search results; avoids huge payloads from metadata fields. */
function extractOcrTextFromSearch(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return ''
  }
  const items = (data as JsonObject).data
  if (!Array.isArray(items)) {
    return normalizeScreenpipeText(data)
  }
  const chunks: string[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const content = (item as JsonObject).content
    if (!content || typeof content !== 'object') {
      continue
    }
    const text = (content as JsonObject).text
    if (typeof text === 'string') {
      const trimmed = text.trim()
      if (trimmed) {
        chunks.push(trimmed)
      }
    }
  }
  return chunks.join('\n').toLowerCase()
}

function previewText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }
  return `${trimmed.slice(0, maxChars)}…`
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractPaginationTotal(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const pagination = (data as JsonObject).pagination
  if (!pagination || typeof pagination !== 'object') {
    return null
  }
  return readOptionalNumber((pagination as JsonObject).total)
}

function extractSearchFrameSummaries(data: unknown): ScreenpipeSearchFrameSummary[] {
  if (!data || typeof data !== 'object') {
    return []
  }
  const items = (data as JsonObject).data
  if (!Array.isArray(items)) {
    return []
  }
  const frames: ScreenpipeSearchFrameSummary[] = []
  for (const item of items.slice(0, SCREENPIPE_GUIDE_DEBUG_MAX_FRAMES)) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const content = (item as JsonObject).content
    if (!content || typeof content !== 'object') {
      continue
    }
    const c = content as JsonObject
    const text = typeof c.text === 'string' ? c.text : ''
    frames.push({
      frameId: readOptionalNumber(c.frame_id),
      timestamp: readOptionalString(c.timestamp),
      appName: readOptionalString(c.app_name),
      windowName: readOptionalString(c.window_name),
      textSource: readOptionalString(c.text_source),
      textLength: text.length,
      textPreview: previewText(text, SCREENPIPE_GUIDE_DEBUG_FRAME_PREVIEW_CHARS)
    })
  }
  return frames
}

function countSearchResults(data: unknown): number {
  if (!data || typeof data !== 'object') {
    return 0
  }
  const items = (data as JsonObject).data
  return Array.isArray(items) ? items.length : 0
}

function buildGuideDebugInfo(input: {
  baseUrl: string
  searchPath: string
  startTimeIso: string
  healthMs: number
  searchMs: number
  health: ScreenpipeEndpointProbe
  search: ScreenpipeEndpointProbe
  searchResult: ScreenpipeFetchResult
  text: string | null
}): ScreenpipeGuideDebugInfo {
  const frames = extractSearchFrameSummaries(input.searchResult.data)
  const text = input.text ?? ''
  const base = input.baseUrl.replace(/\/$/, '')
  return {
    searchPath: input.searchPath,
    searchUrl: `${base}${input.searchPath}`,
    startTimeIso: input.startTimeIso,
    healthMs: Math.round(input.healthMs),
    searchMs: Math.round(input.searchMs),
    resultCount: countSearchResults(input.searchResult.data),
    paginationTotal: extractPaginationTotal(input.searchResult.data),
    frames,
    textLength: text.length,
    textPreview: previewText(text, SCREENPIPE_GUIDE_DEBUG_TEXT_PREVIEW_CHARS),
    health: input.health,
    search: input.search
  }
}

let lastGuideSnapshotLogSignature: string | null = null
let lastGuideSnapshotLogAtMs = 0

function isUnauthorized(status: number, data: unknown): boolean {
  if (status === 401 || status === 403) {
    return true
  }
  if (data && typeof data === 'object') {
    const err = (data as JsonObject).error
    if (typeof err === 'string' && /unauthorized|authentication|api key/i.test(err)) {
      return true
    }
  }
  return false
}

function screenpipeErrorDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const err = (data as JsonObject).error
  return typeof err === 'string' && err.trim() ? err.trim() : null
}

function guideSearchStartTimeIso(): string {
  return new Date(Date.now() - SCREENPIPE_GUIDE_SEARCH_LOOKBACK_MS).toISOString()
}

function buildGuideSearchPath(): { path: string; startTimeIso: string } {
  const startTimeIso = guideSearchStartTimeIso()
  const params = new URLSearchParams({
    limit: String(SCREENPIPE_GUIDE_SEARCH_LIMIT),
    content_type: 'all',
    start_time: startTimeIso
  })
  return { path: `/search?${params.toString()}`, startTimeIso }
}

function buildSearchFailureReason(searchResult: ScreenpipeFetchResult): string {
  const detail = searchResult.error ?? screenpipeErrorDetail(searchResult.data)
  if (searchResult.error) {
    return `ScreenPipe search failed: ${searchResult.error}`
  }
  if (detail) {
    return `ScreenPipe search failed (HTTP ${searchResult.status}): ${detail}`
  }
  return `ScreenPipe search failed (HTTP ${searchResult.status})`
}

export async function getScreenpipeGuideSnapshot(): Promise<ScreenpipeGuideSnapshot> {
  const baseUrl = getScreenpipeBaseUrl()
  const hasApiKey = !!getScreenpipeApiKey()
  const debugMode = isMainProcessDebugMode()

  const healthStartedAt = debugMode ? performance.now() : 0
  const healthResult = await fetchScreenpipe('/health', SCREENPIPE_HEALTH_TIMEOUT_MS)
  const healthMs = debugMode ? performance.now() - healthStartedAt : 0
  const health = toEndpointProbe(healthResult)
  if (!healthResult.ok) {
    const detail = healthResult.error ?? screenpipeErrorDetail(healthResult.data)
    const reason = healthResult.error
      ? `cannot reach ScreenPipe at ${baseUrl}: ${healthResult.error}`
      : detail
        ? `health check failed (HTTP ${healthResult.status}): ${detail}`
        : healthResult.status
          ? `health check failed (HTTP ${healthResult.status})`
          : `cannot reach ScreenPipe at ${baseUrl}`
    return {
      available: false,
      reason,
      baseUrl,
      hasApiKey,
      text: null,
      health,
      debug: debugMode
        ? buildGuideDebugInfo({
            baseUrl,
            searchPath: '(skipped — health failed)',
            startTimeIso: guideSearchStartTimeIso(),
            healthMs,
            searchMs: 0,
            health,
            search: { ok: false, status: 0, error: 'skipped' },
            searchResult: {
              ok: false,
              status: 0,
              data: null,
              url: `${baseUrl}/search`
            },
            text: null
          })
        : undefined
    }
  }

  const { path: searchPath, startTimeIso } = buildGuideSearchPath()
  const searchStartedAt = debugMode ? performance.now() : 0
  const searchResult = await fetchScreenpipe(searchPath, SCREENPIPE_SEARCH_TIMEOUT_MS)
  const searchMs = debugMode ? performance.now() - searchStartedAt : 0
  const search = toEndpointProbe(searchResult)

  if (searchResult.ok) {
    const text = extractOcrTextFromSearch(searchResult.data) || null
    return {
      available: true,
      reason: 'ok',
      baseUrl,
      hasApiKey,
      text,
      health,
      search,
      debug: debugMode
        ? buildGuideDebugInfo({
            baseUrl,
            searchPath,
            startTimeIso,
            healthMs,
            searchMs,
            health,
            search,
            searchResult,
            text
          })
        : undefined
    }
  }

  if (isUnauthorized(searchResult.status, searchResult.data) && !getScreenpipeApiKey()) {
    return {
      available: false,
      reason:
        'ScreenPipe search requires an API key. Add VIJIA_SCREENPIPE_API_KEY to .env ' +
        '(run `screenpipe auth token` or `npx screenpipe@latest auth token`).',
      baseUrl,
      hasApiKey,
      text: null,
      health,
      search,
      debug: debugMode
        ? buildGuideDebugInfo({
            baseUrl,
            searchPath,
            startTimeIso,
            healthMs,
            searchMs,
            health,
            search,
            searchResult,
            text: null
          })
        : undefined
    }
  }

  return {
    available: false,
    reason: buildSearchFailureReason(searchResult),
    baseUrl,
    hasApiKey,
    text: null,
    health,
    search,
    debug: debugMode
      ? buildGuideDebugInfo({
          baseUrl,
          searchPath,
          startTimeIso,
          healthMs,
          searchMs,
          health,
          search,
          searchResult,
          text: null
        })
      : undefined
  }
}

export async function probeScreenpipeAvailability(): Promise<ScreenpipeProbeResult> {
  const snapshot = await getScreenpipeGuideSnapshot()
  const { text: _text, ...probe } = snapshot
  return probe
}

export function logScreenpipeGuideSnapshot(
  context: string,
  snapshot: ScreenpipeGuideSnapshot,
  extra?: { activeWindowTitle?: string | null }
): void {
  if (!isMainProcessDebugMode()) {
    return
  }

  const debug = snapshot.debug
  const latestFrameId = debug?.frames[0]?.frameId ?? null
  const signature = JSON.stringify({
    available: snapshot.available,
    reason: snapshot.reason,
    latestFrameId,
    resultCount: debug?.resultCount ?? 0,
    textLength: debug?.textLength ?? snapshot.text?.length ?? 0,
    searchMs: debug?.searchMs ?? null,
    searchStatus: debug?.search.status ?? null
  })
  const now = Date.now()
  const changed = signature !== lastGuideSnapshotLogSignature
  const heartbeat = now - lastGuideSnapshotLogAtMs >= SCREENPIPE_GUIDE_DEBUG_HEARTBEAT_MS
  if (!changed && !heartbeat) {
    return
  }

  lastGuideSnapshotLogSignature = signature
  lastGuideSnapshotLogAtMs = now

  const logPayload: Record<string, unknown> = {
    context,
    available: snapshot.available,
    reason: snapshot.reason,
    baseUrl: snapshot.baseUrl,
    hasApiKey: snapshot.hasApiKey,
    activeWindowTitle: extra?.activeWindowTitle ?? null,
    screenpipe: debug ?? {
      textLength: snapshot.text?.length ?? 0,
      health: snapshot.health,
      search: snapshot.search
    }
  }

  if (changed) {
    console.log('[Vijia][debug] ScreenPipe guide snapshot (changed)', logPayload)
    return
  }

  console.log('[Vijia][debug] ScreenPipe guide snapshot (heartbeat)', logPayload)
}

export function logScreenpipeProbe(context: string, probe: ScreenpipeProbeResult): void {
  if (probe.available) {
    if (isMainProcessDebugMode()) {
      console.log(`[Vijia][debug] ScreenPipe available (${context})`, {
        baseUrl: probe.baseUrl,
        hasApiKey: probe.hasApiKey
      })
    }
    return
  }

  console.warn(`[Vijia] ScreenPipe unavailable (${context}): ${probe.reason}`, {
    baseUrl: probe.baseUrl,
    hasApiKey: probe.hasApiKey,
    health: probe.health,
    search: probe.search
  })
}

export async function isScreenpipeAvailable(): Promise<boolean> {
  const probe = await probeScreenpipeAvailability()
  return probe.available
}

export async function getScreenpipeVisibleText(): Promise<string | null> {
  const snapshot = await getScreenpipeGuideSnapshot()
  return snapshot.text
}

export function getScreenpipeSetupHint(): string | null {
  if (getScreenpipeApiKey()) {
    return null
  }
  return (
    'ScreenPipe API auth may be enabled. Add VIJIA_SCREENPIPE_API_KEY to .env ' +
    '(run `screenpipe auth token` or `npx screenpipe@latest auth token`).'
  )
}
