import { BrowserWindow, app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import type { TabKey } from '../shared/tab'
import { destroyOverlayWindow, refreshOverlayWindow } from './overlayManager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function getPreloadPath(): string {
  return path.join(__dirname, '../preload/preload.cjs')
}

export function setQuitting(value: boolean): void {
  isQuitting = value
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function buildRendererUrl(rendererUrl: string, tab?: TabKey): string {
  const u = new URL(rendererUrl)
  if (tab) {
    u.searchParams.set('tab', tab)
  }
  return u.href
}

export function getOrCreateMainWindow(initialTab?: TabKey): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    show: false,
    center: true,
    resizable: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep preload behavior consistent with overlay window.
      sandbox: false
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
      if (process.platform === 'darwin') {
        app.dock?.hide()
      }
    }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(buildRendererUrl(rendererUrl, initialTab))
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html')
    if (initialTab) {
      void mainWindow.loadFile(indexHtml, {
        query: { tab: initialTab }
      })
    } else {
      void mainWindow.loadFile(indexHtml)
    }
  }

  return mainWindow
}

export function showMainWindow(tab?: TabKey): void {
  const t = tab ?? 'home'
  const existed = mainWindow !== null && !mainWindow.isDestroyed()

  if (!existed) {
    getOrCreateMainWindow(t)
    const win = mainWindow!
    win.show()
    if (process.platform === 'darwin') {
      app.dock?.show()
    }
    win.focus()
    return
  }

  const win = mainWindow!
  win.show()
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
  win.focus()
  refreshOverlayWindow()
  win.webContents.send(IPC_CHANNELS.OPEN_WINDOW, { tab: t })
}

export function destroyAllWindows(): void {
  destroyOverlayWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = null
  }
}
