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
const baseUrl = getScreenpipeBaseUrl(root)

if (await isScreenpipeHealthy(baseUrl)) {
  console.log(`[vijia] ScreenPipe already running at ${baseUrl}`)
  process.exit(0)
}

console.log(`[vijia] Starting ScreenPipe (API at ${baseUrl})…`)
console.log('[vijia] Grant screen recording in System Settings (audio disabled).')

const child = spawnScreenpipeRecord(root)
attachScreenpipeLogs(child)

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})

const ready = await waitForScreenpipeHealthy(baseUrl)
if (!ready) {
  console.error(
    `[vijia] ScreenPipe did not become healthy at ${baseUrl} within 90s.\n` +
      '  Run `screenpipe doctor` for permissions and dependencies.'
  )
  child.kill('SIGTERM')
  process.exit(1)
}

console.log(`[vijia] ScreenPipe is up at ${baseUrl}`)

function shutdown() {
  if (!child.killed) {
    child.kill('SIGTERM')
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
