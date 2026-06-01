import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const DEFAULT_SCREENPIPE_URL = 'http://127.0.0.1:3030'
/** Matches Vijia dev guide-mode tuning (fast active capture, slower when idle, no mic). */
export const SCREENPIPE_RECORD_ARGS = [
  'record',
  '--min-capture-interval-ms',
  '100',
  '--idle-capture-interval-ms',
  '3000',
  '--visual-check-interval-ms',
  '1000',
  '--disable-audio'
]
const HEALTH_TIMEOUT_MS = 2000
const HEALTH_POLL_MS = 500
const HEALTH_WAIT_MAX_MS = 90_000

/**
 * @param {string} root
 */
export function loadProjectEnv(root) {
  /** @type {Record<string, string>} */
  const merged = {}
  for (const name of ['.env', '.env.local']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      merged[key] = value
    }
  }
  return merged
}

/**
 * @param {string} root
 */
export function getScreenpipeBaseUrl(root) {
  const fileEnv = loadProjectEnv(root)
  const raw =
    process.env['VIJIA_SCREENPIPE_URL']?.trim() ||
    fileEnv['VIJIA_SCREENPIPE_URL']?.trim()
  return raw || DEFAULT_SCREENPIPE_URL
}

/**
 * @param {string} baseUrl
 */
export async function isScreenpipeHealthy(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} baseUrl
 */
export async function waitForScreenpipeHealthy(baseUrl) {
  const started = Date.now()
  while (Date.now() - started < HEALTH_WAIT_MAX_MS) {
    if (await isScreenpipeHealthy(baseUrl)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
  }
  return false
}

/**
 * @param {string} root
 */
export function resolveScreenpipeBin(root) {
  const name = process.platform === 'win32' ? 'screenpipe.cmd' : 'screenpipe'
  const bin = join(root, 'node_modules', '.bin', name)
  return existsSync(bin) ? bin : null
}

/**
 * @param {string} root
 */
export function spawnScreenpipeRecord(root) {
  return spawnScreenpipe(root, SCREENPIPE_RECORD_ARGS)
}

/**
 * @param {string} root
 * @param {string[]} args
 */
export function spawnScreenpipe(root, args) {
  const bin = resolveScreenpipeBin(root)
  if (!bin) {
    throw new Error(
      'screenpipe CLI not found. Run `npm install` in the project root.'
    )
  }

  const env = {
    ...process.env,
    SCREENPIPE_NO_REMINDERS: process.env['SCREENPIPE_NO_REMINDERS'] ?? '1'
  }

  return spawn(bin, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
export function attachScreenpipeLogs(child) {
  const prefix = (line) => `[screenpipe] ${line}`
  child.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) console.log(prefix(line))
    }
  })
  child.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) console.error(prefix(line))
    }
  })
}
