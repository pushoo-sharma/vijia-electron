const DEFAULT_SCREENPIPE_URL = 'http://127.0.0.1:3030'
const SCREENPIPE_TIMEOUT_MS = 1000

type JsonObject = Record<string, unknown>

export function getScreenpipeBaseUrl(): string {
  const raw = process.env['VIJIA_SCREENPIPE_URL']?.trim()
  return raw || DEFAULT_SCREENPIPE_URL
}

async function fetchJson(url: string, timeoutMs = SCREENPIPE_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      return null
    }
    return (await res.json()) as unknown
  } catch {
    return null
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

export async function isScreenpipeAvailable(): Promise<boolean> {
  const base = getScreenpipeBaseUrl().replace(/\/$/, '')
  const candidates = ['/health', '/api/health', '/']
  for (const p of candidates) {
    const data = await fetchJson(`${base}${p}`)
    if (data) {
      return true
    }
  }
  return false
}

export async function getScreenpipeVisibleText(): Promise<string | null> {
  const base = getScreenpipeBaseUrl().replace(/\/$/, '')
  const candidates = ['/vision/current', '/api/vision/current', '/ocr', '/api/ocr']
  for (const p of candidates) {
    const data = await fetchJson(`${base}${p}`)
    if (!data) {
      continue
    }
    const normalized = normalizeScreenpipeText(data)
    if (normalized) {
      return normalized
    }
  }
  return null
}

