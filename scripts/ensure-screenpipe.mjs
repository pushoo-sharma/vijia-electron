import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveScreenpipeBin } from './lib/screenpipe-dev.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = resolveScreenpipeBin(root)

if (!bin) {
  console.warn(
    '[vijia] screenpipe was not installed. Guide Mode screen_text_match needs it.\n' +
      '  Run: npm install'
  )
  process.exit(0)
}

const version = spawnSync(bin, ['--version'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30_000
})

if (version.status !== 0) {
  console.warn(
    '[vijia] screenpipe CLI is present but failed to run.\n' +
      '  Try: npm install screenpipe@latest --save-dev\n' +
      '  Docs: https://docs.screenpi.pe/getting-started'
  )
  process.exit(0)
}

const line = (version.stdout || version.stderr || '').trim().split('\n')[0]
console.log(`[vijia] screenpipe ready${line ? ` (${line})` : ''}`)
