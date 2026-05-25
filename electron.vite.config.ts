import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

/** Vite adds `crossorigin` to built assets; with `loadFile()` (file://) that often blocks ES module loads in Electron → blank window. */
function electronRendererStripCrossorigin(): Plugin {
  return {
    name: 'electron-renderer-strip-crossorigin',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/\s+crossorigin(?:=["']anonymous["'])?/g, '')
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const viteUrl = env['VITE_SUPABASE_URL'] ?? ''
  const viteKey = env['VITE_SUPABASE_ANON_KEY'] ?? ''
  const vijiaDebug = env['VIJIA_DEBUG'] ?? ''
  const vijiaDisableCooldowns = env['VIJIA_DISABLE_COOLDOWNS'] ?? ''
  const vijiaProactiveForceSpeak = env['VIJIA_PROACTIVE_FORCE_SPEAK'] ?? ''

  return {
  main: {
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(viteUrl),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(viteKey),
      'process.env.VIJIA_DEBUG': JSON.stringify(vijiaDebug),
      'process.env.VIJIA_DISABLE_COOLDOWNS': JSON.stringify(
        vijiaDisableCooldowns
      ),
      'process.env.VIJIA_PROACTIVE_FORCE_SPEAK': JSON.stringify(
        vijiaProactiveForceSpeak
      )
    },
    build: {
      externalizeDeps: true
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          preload: resolve('src/preload/preload.ts'),
          overlayPreload: resolve('src/preload/overlayPreload.ts')
        },
        /** ESM .mjs preloads fail in Electron preload VM ("Cannot use import statement outside a module"). CJS is reliable. */
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    publicDir: resolve('public'),
    plugins: [react(), electronRendererStripCrossorigin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/main-window')
      }
    }
  }
  }
})
