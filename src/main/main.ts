import { app } from 'electron'
import { startBrowserBridge, stopBrowserBridge } from './browserBridge'
import { createTray } from './tray'
import { isMainProcessDebugMode } from './debugMode'
import { isCooldownsDisabled } from './envFlags'
import {
  getOrCreateOverlayWindow,
  registerOverlayInputIpc
} from './overlayManager'
import { registerNotificationIpc } from './NotificationManager'
import { startProactiveEngine, stopProactiveEngine } from './proactive-engine'
import { logScreenpipeProbe, probeScreenpipeAvailability } from './screenpipe'

function logMainStartupFlags(): void {
  console.log('[Vijia] main startup flags', {
    VIJIA_DEBUG: isMainProcessDebugMode(),
    VIJIA_DISABLE_COOLDOWNS: isCooldownsDisabled(),
    packaged: app.isPackaged
  })
}

void app.whenReady().then(() => {
  logMainStartupFlags()
  registerNotificationIpc()
  registerOverlayInputIpc()
  void startBrowserBridge()
  void probeScreenpipeAvailability().then((probe) => {
    logScreenpipeProbe('startup', probe)
  })
  startProactiveEngine()
  getOrCreateOverlayWindow()
  createTray()
})

app.on('before-quit', () => {
  if (isMainProcessDebugMode()) {
    console.log('[Vijia][debug] main: before-quit, stopping proactive and bridge')
  }
  stopProactiveEngine()
  void stopBrowserBridge()
})

app.on('window-all-closed', () => {
  // Intentionally empty: the app stays in the tray until Quit.
})
