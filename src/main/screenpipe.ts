const DEFAULT_SCREENPIPE_URL = 'http://127.0.0.1:3030'
const SCREENPIPE_TIMEOUT_MS = 2000
const SCREENPIPE_SEARCH_LIMIT = 80

type JsonObject = Record<string, unknown>

type ScreenpipeFetchResult = {
  ok: boolean
  status: number
  data: unknown
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

async function fetchScreenpipe(
  path: string,
  timeoutMs = SCREENPIPE_TIMEOUT_MS
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
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  } finally {
    clearTimeout(timer)
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

export async function isScreenpipeAvailable(): Promise<boolean> {
  const health = await fetchScreenpipe('/health')
  if (!health.ok) {
    return false
  }

  const search = await fetchScreenpipe(
    `/search?limit=1&content_type=all`
  )
  if (search.ok) {
    return true
  }
  if (isUnauthorized(search.status, search.data) && !getScreenpipeApiKey()) {
    return false
  }

  // Server up but search blocked — still treat as unavailable for guide OCR.
  return false
}

export async function getScreenpipeVisibleText(): Promise<string | null> {
  const search = await fetchScreenpipe(
    `/search?limit=${SCREENPIPE_SEARCH_LIMIT}&content_type=all`
  )
  if (search.ok && search.data) {
    const normalized = normalizeScreenpipeText(search.data)
    if (normalized) {
      return normalized
    }
  }

  if (isUnauthorized(search.status, search.data) && !getScreenpipeApiKey()) {
    return null
  }

  // Legacy endpoints (older screenpipe builds without search auth).
  const legacyPaths = ['/vision/current', '/api/vision/current', '/ocr', '/api/ocr']
  for (const p of legacyPaths) {
    const res = await fetchScreenpipe(p)
    if (!res.ok || !res.data) {
      continue
    }
    const normalized = normalizeScreenpipeText(res.data)
    if (normalized) {
      return normalized
    }
  }

  return null
}

export function getScreenpipeSetupHint(): string | null {
  if (getScreenpipeApiKey()) {
    return null
  }
  return (
    'ScreenPipe API auth is enabled. Add VIJIA_SCREENPIPE_API_KEY to .env ' +
    '(run `screenpipe auth token` or `npx screenpipe@latest auth token`).'
  )
}
