import { app, ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendSessionLogNote } from './session-log'
import { getVijiaStorageRoot } from './vijiaStorage'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import type {
  BrowserBridgeHandshakeRequest,
  BrowserBridgeHandshakeResponse,
  BrowserBridgeHealthResponse,
  BrowserBridgeStatus,
  BrowserCaptureEnvelope,
  BrowserExtensionCaptureRequest,
  BrowserSite,
  GuideStep
} from '../shared/browserBridge'
import {
  buildBrowserCaptureDedupeKey,
  normalizeBrowserExtract
} from './text-extraction'
import { getSupabaseClientEnv } from './supabaseEnv'
import { isMainProcessDebugMode } from './debugMode'
import api, { type ClaudeProxyRequest } from '../shared/Api'

const DEFAULT_BRIDGE_PORT = 45731
const MAX_REQUEST_BYTES = 256 * 1024
const EVENT_TTL_MS = 30_000
const PAYLOAD_TTL_MS = 10_000

const allowedSites = new Set<BrowserSite>([
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'deepseek'
])

const browserBridgeEvents = new EventEmitter()

let bridgeServer: ReturnType<typeof createServer> | null = null
let bridgeIpcRegistered = false
let bridgeToken = ''
let bridgeStatus: BrowserBridgeStatus = {
  running: false,
  port: null,
  requiresToken: true,
  connected: false,
  lastHandshakeAt: null,
  lastCaptureAt: null
}
const seenEventIds = new Map<string, number>()
const seenPayloads = new Map<string, number>()

function resolveBridgePort(): number {
  const raw = process.env['VIJIA_EXTENSION_BRIDGE_PORT']
  const port = raw ? Number(raw) : DEFAULT_BRIDGE_PORT
  if (!Number.isInteger(port) || port <= 0) {
    return DEFAULT_BRIDGE_PORT
  }
  return port
}

async function hydrateBridgeTokenFromDisk(): Promise<void> {
  if (bridgeToken) {
    return
  }

  const fromEnv = process.env['VIJIA_EXTENSION_TOKEN']?.trim()
  if (fromEnv) {
    bridgeToken = fromEnv
    return
  }

  try {
    const raw = await readFile(getBridgeConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as { sessionToken?: unknown }
    const t =
      typeof parsed.sessionToken === 'string' ? parsed.sessionToken.trim() : ''
    if (t.length >= 32 && /^[0-9a-f]+$/i.test(t)) {
      bridgeToken = t
    }
  } catch {
    // No config file yet, or invalid JSON — ensureBridgeToken will mint one.
  }
}

function ensureBridgeToken(): string {
  if (!bridgeToken) {
    bridgeToken = randomBytes(24).toString('hex')
  }
  return bridgeToken
}

function getBridgeStorageRoot(): string {
  return getVijiaStorageRoot()
}

function getBridgeDataPath(): string {
  return path.join(
    getBridgeStorageRoot(),
    'data',
    'browser-extension-captures.json'
  )
}

/** Serializes disk writes so concurrent captures do not trample the JSON file. */
let captureWriteQueue: Promise<void> = Promise.resolve()

function getBridgeConfigPath(): string {
  return path.join(getBridgeStorageRoot(), 'browser-extension-bridge.json')
}

async function appendBrowserCapture(envelope: BrowserCaptureEnvelope): Promise<void> {
  const target = getBridgeDataPath()
  await mkdir(path.dirname(target), { recursive: true })

  captureWriteQueue = captureWriteQueue
    .then(async () => {
      let list: BrowserCaptureEnvelope[] = []
      try {
        const raw = await readFile(target, 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          list = parsed as BrowserCaptureEnvelope[]
        }
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? (error as NodeJS.ErrnoException).code
            : undefined
        if (code !== 'ENOENT') {
          console.warn('[Vijia] Could not read browser-extension-captures.json, starting fresh:', error)
        }
      }
      list.push(envelope)
      await writeFile(target, JSON.stringify(list, null, 2), 'utf8')
    })
    .catch((error) => {
      console.error('[Vijia] Failed to persist browser capture:', error)
    })
  return captureWriteQueue
}

async function persistBridgeConfig(port: number): Promise<void> {
  const target = getBridgeConfigPath()
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(
    target,
    JSON.stringify(
      {
        bridgeUrl: `http://127.0.0.1:${port}`,
        sessionToken: ensureBridgeToken(),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  )
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function cleanupExpired(map: Map<string, number>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs
  for (const [key, ts] of map.entries()) {
    if (ts < cutoff) {
      map.delete(key)
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += bufferChunk.length
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error('payload-too-large')
    }
    chunks.push(bufferChunk)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) {
    return {}
  }

  return JSON.parse(text) as unknown
}

function isCaptureRequest(value: unknown): value is BrowserExtensionCaptureRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<BrowserExtensionCaptureRequest>
  return (
    payload.schema === 1 &&
    payload.source === 'browser-extension' &&
    typeof payload.sessionToken === 'string' &&
    typeof payload.eventId === 'string' &&
    typeof payload.capturedAt === 'string' &&
    typeof payload.site === 'string' &&
    typeof payload.url === 'string' &&
    typeof payload.title === 'string' &&
    typeof payload.tabId === 'number' &&
    typeof payload.frameId === 'number' &&
    !!payload.extract &&
    typeof payload.extract.user === 'string' &&
    typeof payload.extract.assistant === 'string'
  )
}

function isHandshakeRequest(value: unknown): value is BrowserBridgeHandshakeRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<BrowserBridgeHandshakeRequest>
  return typeof payload.token === 'string'
}

const GUIDE_CLAUDE_MAX_TOKENS = 2048

function isGuidePlanRequest(
  value: unknown
): value is { sessionToken: string; goal: string } {
  if (!value || typeof value !== 'object') {
    return false
  }
  const p = value as { sessionToken?: unknown; goal?: unknown }
  return (
    typeof p.sessionToken === 'string' &&
    p.sessionToken.length > 0 &&
    typeof p.goal === 'string' &&
    p.goal.trim().length > 0
  )
}

function isGuideStep(value: unknown): value is GuideStep {
  if (!value || typeof value !== 'object') {
    return false
  }
  const o = value as Record<string, unknown>
  if (typeof o.instruction !== 'string' || o.instruction.trim() === '') {
    return false
  }
  if (o.detection_type !== 'url_match' && o.detection_type !== 'manual_advance') {
    return false
  }
  if (o.match_value !== null && typeof o.match_value !== 'string') {
    return false
  }
  return true
}

function extractJsonArrayFromProxyData(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    return data
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.steps)) {
      return d.steps
    }
    if (Array.isArray(d.data)) {
      return d.data
    }
    if (typeof d.content === 'string') {
      try {
        return extractJsonArrayFromProxyData(JSON.parse(d.content) as unknown)
      } catch {
        // ignore
      }
    }
    const c0 = d.content
    if (Array.isArray(c0) && c0[0] && typeof c0[0] === 'object' && c0[0] !== null) {
      const t = (c0[0] as { text?: unknown }).text
      if (typeof t === 'string') {
        try {
          return extractJsonArrayFromProxyData(JSON.parse(t) as unknown)
        } catch {
          // ignore
        }
      }
    }
  }
  if (typeof data === 'string') {
    try {
      return extractJsonArrayFromProxyData(JSON.parse(data) as unknown)
    } catch {
      return null
    }
  }
  return null
}

function parseGuideStepsFromProxyBody(data: unknown): GuideStep[] | null {
  const arr = extractJsonArrayFromProxyData(data)
  if (!arr || arr.length === 0) {
    return null
  }
  const out: GuideStep[] = []
  for (const item of arr) {
    if (!isGuideStep(item)) {
      return null
    }
    if (item.detection_type === 'url_match') {
      if (typeof item.match_value !== 'string' || !item.match_value.trim()) {
        return null
      }
    }
    out.push({
      instruction: item.instruction.trim(),
      detection_type: item.detection_type,
      match_value: item.match_value
    })
  }
  return out
}

async function handleGuidePlan(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid-body'
    writeJson(res, message === 'payload-too-large' ? 413 : 400, {
      ok: false,
      error: message
    })
    return
  }

  if (!isGuidePlanRequest(body) || !hasValidToken(body.sessionToken)) {
    writeJson(res, 401, {
      ok: false,
      error: 'invalid-request'
    })
    return
  }

  if (!getSupabaseClientEnv()) {
    writeJson(res, 503, {
      ok: false,
      error: 'supabase-not-configured',
      detail: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the app.'
    })
    return
  }

  const goal = body.goal.trim()
  const requestBody: ClaudeProxyRequest = {
    proactive: false,
    guide: true,
    max_tokens: GUIDE_CLAUDE_MAX_TOKENS,
    messages: [{ role: 'user', content: goal }]
  }

  try {
    if (isMainProcessDebugMode()) {
      console.log('[Vijia][debug] guide-plan claude-proxy request:', requestBody)
    }
    const resProxy = await api.claudeProxy(requestBody)
    if (resProxy.status < 200 || resProxy.status >= 300) {
      writeJson(res, 502, {
        ok: false,
        error: 'claude-proxy-error',
        detail: `HTTP ${resProxy.status}`
      })
      return
    }
    const raw: unknown = resProxy.data
    if (isMainProcessDebugMode()) {
      console.log('[Vijia][debug] guide-plan claude-proxy raw response:', raw)
    }
    const steps = parseGuideStepsFromProxyBody(raw)
    if (!steps || steps.length === 0) {
      writeJson(res, 422, {
        ok: false,
        error: 'invalid-guide-response',
        detail: 'Expected a non-empty JSON array of steps with instruction, detection_type, and match_value.'
      })
      return
    }
    writeJson(res, 200, { ok: true, steps })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (isMainProcessDebugMode()) {
      console.warn('[Vijia] guide-plan:', msg)
    }
    writeJson(res, 500, { ok: false, error: 'internal-error', detail: msg })
  }
}

function getHealthResponse(): BrowserBridgeHealthResponse {
  return {
    ok: bridgeStatus.running,
    ...bridgeStatus
  }
}

function hasValidToken(payloadToken: string | undefined): boolean {
  return typeof payloadToken === 'string' && payloadToken === ensureBridgeToken()
}

async function handleHandshake(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown

  try {
    body = await readJsonBody(req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid-body'
    writeJson(res, message === 'payload-too-large' ? 413 : 400, {
      ok: false,
      error: message
    })
    return
  }

  if (!isHandshakeRequest(body) || !hasValidToken(body.token)) {
    writeJson(res, 401, {
      ok: false,
      connected: false,
      error: 'invalid-token'
    })
    return
  }

  bridgeStatus = {
    ...bridgeStatus,
    connected: true,
    lastHandshakeAt: Date.now()
  }

  const response: BrowserBridgeHandshakeResponse = {
    ok: true,
    connected: true
  }
  writeJson(res, 200, response)
}

async function handleExtensionBootstrap(res: ServerResponse): Promise<void> {
  await hydrateBridgeTokenFromDisk()
  const port = bridgeStatus.port ?? resolveBridgePort()
  writeJson(res, 200, {
    sessionToken: ensureBridgeToken(),
    bridgeUrl: `http://127.0.0.1:${port}`
  })
}

async function handleCapture(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown

  try {
    body = await readJsonBody(req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid-body'
    writeJson(res, message === 'payload-too-large' ? 413 : 400, {
      accepted: false,
      error: message
    })
    return
  }

  if (!isCaptureRequest(body)) {
    writeJson(res, 400, { accepted: false, error: 'invalid-schema' })
    return
  }

  if (!hasValidToken(body.sessionToken)) {
    writeJson(res, 401, { accepted: false, error: 'invalid-token' })
    return
  }

  if (!allowedSites.has(body.site)) {
    writeJson(res, 400, { accepted: false, error: 'invalid-site' })
    return
  }

  const extract = normalizeBrowserExtract(body.extract)
  if (!extract.user && !extract.assistant) {
    writeJson(res, 422, { accepted: false, error: 'empty-extract' })
    return
  }

  cleanupExpired(seenEventIds, EVENT_TTL_MS)
  cleanupExpired(seenPayloads, PAYLOAD_TTL_MS)

  if (seenEventIds.has(body.eventId)) {
    writeJson(res, 202, { accepted: false, deduped: true })
    return
  }

  const dedupeKey = buildBrowserCaptureDedupeKey({
    ...body,
    extract
  })

  if (seenPayloads.has(dedupeKey)) {
    writeJson(res, 202, { accepted: false, deduped: true })
    return
  }

  seenEventIds.set(body.eventId, Date.now())
  seenPayloads.set(dedupeKey, Date.now())

  const envelope: BrowserCaptureEnvelope = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    dedupeKey,
    payload: {
      ...body,
      extract
    }
  }

  await appendBrowserCapture(envelope)
  void appendSessionLogNote({
    source: 'browser-extension',
    site: body.site,
    title: body.title,
    url: body.url,
    user: extract.user,
    assistant: extract.assistant,
    dedupeKey,
    bridgeCaptureId: envelope.id
  }).catch((error) => {
    console.error('[Vijia] session-log append failed:', error)
  })
  bridgeStatus = {
    ...bridgeStatus,
    connected: true,
    lastCaptureAt: Date.now()
  }
  browserBridgeEvents.emit('capture', envelope)
  writeJson(res, 202, { accepted: true, id: envelope.id })
}

async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (method === 'GET' && url.pathname === '/extension/health') {
    writeJson(res, 200, getHealthResponse())
    return
  }

  if (method === 'GET' && url.pathname === '/extension/bootstrap') {
    await handleExtensionBootstrap(res)
    return
  }

  if (method === 'POST' && url.pathname === '/extension/handshake') {
    await handleHandshake(req, res)
    return
  }

  if (method === 'POST' && url.pathname === '/extension/capture') {
    await handleCapture(req, res)
    return
  }

  if (method === 'POST' && url.pathname === '/extension/guide-plan') {
    await handleGuidePlan(req, res)
    return
  }

  writeJson(res, 404, { ok: false, error: 'not-found' })
}

function registerBrowserBridgeIpc(): void {
  if (bridgeIpcRegistered) {
    return
  }

  bridgeIpcRegistered = true
  ipcMain.handle(IPC_CHANNELS.VIJIA_GET_BROWSER_BRIDGE_STATUS, () => {
    return getHealthResponse()
  })
}

export function onBrowserCapture(
  listener: (payload: BrowserCaptureEnvelope) => void
): () => void {
  browserBridgeEvents.on('capture', listener)
  return () => {
    browserBridgeEvents.off('capture', listener)
  }
}

export function getBrowserBridgeStatus(): BrowserBridgeStatus {
  return { ...bridgeStatus }
}

export async function startBrowserBridge(): Promise<void> {
  if (bridgeServer) {
    return
  }

  await hydrateBridgeTokenFromDisk()
  ensureBridgeToken()
  registerBrowserBridgeIpc()

  const port = resolveBridgePort()
  bridgeServer = createServer((req, res) => {
    void handleBridgeRequest(req, res).catch((error) => {
      console.error('[Vijia] Browser bridge error:', error)
      writeJson(res, 500, { ok: false, error: 'internal-error' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    bridgeServer?.once('error', reject)
    bridgeServer?.listen(port, '127.0.0.1', () => {
      resolve()
    })
  })

  bridgeStatus = {
    ...bridgeStatus,
    running: true,
    port
  }
  await persistBridgeConfig(port)
  if (!app.isPackaged) {
    console.info(`[Vijia] Extension bridge config: ${getBridgeConfigPath()}`)
    console.info(`[Vijia] Captures JSON: ${getBridgeDataPath()}`)
  }
}

export async function stopBrowserBridge(): Promise<void> {
  if (!bridgeServer) {
    return
  }

  const server = bridgeServer
  bridgeServer = null

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  bridgeStatus = {
    ...bridgeStatus,
    running: false,
    connected: false,
    port: null
  }
}
