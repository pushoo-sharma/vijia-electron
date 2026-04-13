import { Menu, Tray, nativeImage, app } from 'electron'
import path from 'node:path'
import {
  destroyAllWindows,
  getMainWindow,
  setQuitting,
  showMainWindow
} from './windowManager'
import { nudgeOverlayWindowForWindows, refreshOverlayWindow } from './overlayManager'
import { simulateTestNotification } from './NotificationManager'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import type { TabKey } from '../shared/tab'

let tray: Tray | null = null

function trayIconPath(): string {
  return path.join(app.getAppPath(), 'assets', 'letter-v.png')
}

export function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Vijia',
      click: (): void => {
        nudgeOverlayWindowForWindows()
        showMainWindow('home')
      }
    },
    {
      label: 'Simulate Notification',
      click: (): void => {
        refreshOverlayWindow()
        simulateTestNotification()
      }
    },
    {
      label: 'Pause',
      click: (): void => {
        console.log('[Vijia] Pause (placeholder)')
        getMainWindow()?.webContents.send(IPC_CHANNELS.TRAY_ACTION, {
          action: 'pause'
        })
      }
    },
    {
      label: 'Resume',
      click: (): void => {
        console.log('[Vijia] Resume (placeholder)')
        getMainWindow()?.webContents.send(IPC_CHANNELS.TRAY_ACTION, {
          action: 'resume'
        })
      }
    },
    {
      label: 'Quit',
      click: (): void => {
        setQuitting(true)
        destroyAllWindows()
        app.quit()
      }
    }
  ])

  tray.setToolTip('Vijia')
  tray.setContextMenu(contextMenu)
}

/** Exposed for tests / programmatic navigation (e.g. AC-05). */
export function openWindowWithTab(tab: TabKey): void {
  showMainWindow(tab)
}
