import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  attachScreenpipeLogs,
  getScreenpipeBaseUrl,
  isScreenpipeHealthy,
  spawnScreenpipeRecord,
  waitForScreenpipeHealthy
} from './lib/screenpipe-dev.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skipScreenpipe =
  process.env['VIJIA_SKIP_SCREENPIPE'] === '1' ||
  process.env['SKIP_SCREENPIPE'] === '1'

/** @type {import('node:child_process').ChildProcess | null} */
let screenpipeChild = null
/** @type {import('node:child_process').ChildProcess | null} */
let viteChild = null
let shuttingDown = false
let startedScreenpipe = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (viteChild && !viteChild.killed) {
    viteChild.kill('SIGTERM')
  }
  if (startedScreenpipe && screenpipeChild && !screenpipeChild.killed) {
    screenpipeChild.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function ensureScreenpipe() {
  const baseUrl = getScreenpipeBaseUrl(root)

  if (await isScreenpipeHealthy(baseUrl)) {
    console.log(`[vijia] ScreenPipe already running at ${baseUrl}`)
    return baseUrl
  }

  console.log(`[vijia] Starting ScreenPipe for dev (API at ${baseUrl})…`)
  console.log(
    '[vijia] Grant screen recording in System Settings (audio disabled for dev).'
  )

  startedScreenpipe = true
  screenpipeChild = spawnScreenpipeRecord(root)
  attachScreenpipeLogs(screenpipeChild)

  screenpipeChild.on('exit', (code, signal) => {
    if (shuttingDown) return
    const why = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    console.error(`[vijia] ScreenPipe exited (${why}). Stopping dev server.`)
    shutdown(code ?? 1)
  })

  const ready = await waitForScreenpipeHealthy(baseUrl)
  if (!ready) {
    console.error(
      `[vijia] ScreenPipe did not become healthy at ${baseUrl} within 90s.\n` +
        '  Run `npm run screenpipe` alone to debug, or `screenpipe doctor`.\n' +
        '  To start Vijia without ScreenPipe: VIJIA_SKIP_SCREENPIPE=1 npm run dev'
    )
    if (screenpipeChild && !screenpipeChild.killed) {
      screenpipeChild.kill('SIGTERM')
    }
    process.exit(1)
  }

  console.log(`[vijia] ScreenPipe ready at ${baseUrl}`)
  return baseUrl
}

async function startVite() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  viteChild = spawn(npmCmd, ['run', 'dev:app'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })

  viteChild.on('exit', (code, signal) => {
    if (shuttingDown) return
    const exitCode = signal ? 1 : (code ?? 1)
    shutdown(exitCode)
  })
}

if (skipScreenpipe) {
  console.log('[vijia] VIJIA_SKIP_SCREENPIPE=1 — starting Electron only')
  await startVite()
} else {
  await ensureScreenpipe()
  await startVite()
}
