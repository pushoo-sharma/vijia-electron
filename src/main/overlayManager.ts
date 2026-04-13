import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import {
  resetOverlayNotificationDelivery,
  setOverlayDeliveryReady,
  syncGuideModeToOverlay
} from './NotificationManager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let overlayWindow: BrowserWindow | null = null
let overlayInputIpcRegistered = false
let overlayDisplayListenersRegistered = false
let lastIgnoreMouse = false
let overlayOpen = false

/**
 * On Windows we extend the window 40 px above the visible screen edge.
 * Any native title-bar chrome Electron draws on transparent frameless windows
 * is rendered in that hidden band and is never visible to the user.
 * The FAB and all overlay content use CSS bottom/right anchoring so they
 * remain correctly positioned within the visible area.
 */
const WIN32_TOP_BLEED_PX = 40

function getPrimaryOverlayBounds(): Electron.Rectangle {
  const wa = screen.getPrimaryDisplay().workArea
  if (process.platform === 'win32') {
    return {
      x: wa.x,
      y: wa.y - WIN32_TOP_BLEED_PX,
      width: wa.width,
      height: wa.height + WIN32_TOP_BLEED_PX
    }
  }
  return wa
}

function ensureOverlayDisplayListeners(): void {
  if (overlayDisplayListenersRegistered) {
    return
  }
  overlayDisplayListenersRegistered = true
  const syncBounds = (): void => {
    const w = getOverlayWindow()
    if (w && !w.isDestroyed()) {
      applyOverlayWindowState(w)
    }
  }
  screen.on('display-metrics-changed', syncBounds)
  screen.on('display-added', syncBounds)
  screen.on('display-removed', syncBounds)
}

function getOverlayAlwaysOnTopLevel(): 'floating' | 'screen-saver' | 'normal' {
  if (process.platform === 'darwin') return 'screen-saver'
  if (process.platform === 'win32') return 'floating'
  return 'normal'
}

function applyOverlayWindowState(win: BrowserWindow): void {
  win.setBounds(getPrimaryOverlayBounds())
  win.setAlwaysOnTop(true, getOverlayAlwaysOnTopLevel())
}

/** Register once at app startup (before overlay loads). */
export function registerOverlayInputIpc(): void {
  if (overlayInputIpcRegistered) {
    return
  }
  overlayInputIpcRegistered = true

  ipcMain.on(IPC_CHANNELS.SET_IGNORE_MOUSE, (event, payload: { ignore: boolean }) => {
    const ow = getOverlayWindow()
    if (!ow || ow.isDestroyed() || event.sender !== ow.webContents) return
    const ignore = Boolean(payload?.ignore)
    lastIgnoreMouse = ignore
    ow.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on(IPC_CHANNELS.VIJIA_OVERLAY_TOGGLE, (event, payload: { open: boolean }) => {
    const ow = getOverlayWindow()
    if (!ow || ow.isDestroyed() || event.sender !== ow.webContents) return
    overlayOpen = Boolean(payload?.open)
    if (process.platform === 'win32') {
      ow.setFocusable(overlayOpen)
      if (overlayOpen) {
        ow.focus()
      } else {
        ow.showInactive()
      }
    }
    applyOverlayWindowState(ow)
  })

  ipcMain.on(IPC_CHANNELS.VIJIA_FADE_STATE, (event, _payload: { faded: boolean }) => {
    const ow = getOverlayWindow()
    if (!ow || ow.isDestroyed() || event.sender !== ow.webContents) return
    ow.setIgnoreMouseEvents(lastIgnoreMouse, { forward: true })
  })
}

function getOverlayPreloadPath(): string {
  return path.join(__dirname, '../preload/overlayPreload.cjs')
}

function overlayRendererUrl(): string | undefined {
  return process.env['ELECTRON_RENDERER_URL']
}

function buildOverlayLoadUrl(): string {
  const base = overlayRendererUrl()!
  return base.endsWith('/') ? `${base}overlay.html` : `${base}/overlay.html`
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function getOverlayWebContents(): Electron.WebContents | null {
  const w = getOverlayWindow()
  return w ? w.webContents : null
}

export function refreshOverlayWindow(): void {
  const w = getOverlayWindow()
  if (!w) return
  w.setMenuBarVisibility(false)
  applyOverlayWindowState(w)
  if (process.platform === 'win32') {
    w.setFocusable(overlayOpen)
    if (!overlayOpen) w.showInactive()
  }
}

export function nudgeOverlayWindowForWindows(): void {
  refreshOverlayWindow()
}

export function getOrCreateOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  const bounds = getPrimaryOverlayBounds()

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: '',
    autoHideMenuBar: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    // Non-focusable on Windows by default so DWM never activates the window chrome.
    // Focusability is restored dynamically when the prompt is open.
    focusable: process.platform !== 'win32',
    webPreferences: {
      preload: getOverlayPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.platform === 'darwin') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  overlayWindow.setMenuBarVisibility(false)
  ensureOverlayDisplayListeners()
  applyOverlayWindowState(overlayWindow)

  overlayWindow.on('show', () => applyOverlayWindowState(overlayWindow!))
  overlayWindow.on('restore', () => applyOverlayWindowState(overlayWindow!))
  overlayWindow.on('enter-full-screen', () => applyOverlayWindowState(overlayWindow!))
  overlayWindow.on('leave-full-screen', () => applyOverlayWindowState(overlayWindow!))

  if (process.platform === 'win32') {
    overlayWindow.on('focus', () => {
      if (overlayWindow && !overlayOpen) {
        overlayWindow.setFocusable(false)
        overlayWindow.showInactive()
      }
    })
    overlayWindow.on('blur', () => {
      if (overlayWindow && !overlayOpen) {
        overlayWindow.setFocusable(false)
        overlayWindow.showInactive()
      }
    })
  }

  lastIgnoreMouse = false
  overlayWindow.setIgnoreMouseEvents(false, { forward: true })

  const devUrl = overlayRendererUrl()
  if (devUrl) {
    void overlayWindow.loadURL(buildOverlayLoadUrl())
  } else {
    const htmlPath = path.join(__dirname, '../renderer/overlay.html')
    void overlayWindow.loadFile(htmlPath)
  }

  overlayWindow.webContents.on('did-finish-load', () => {
    setOverlayDeliveryReady(true)
    syncGuideModeToOverlay()
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
    resetOverlayNotificationDelivery()
  })

  return overlayWindow
}

export function destroyOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy()
  }
  overlayWindow = null
  resetOverlayNotificationDelivery()
}
