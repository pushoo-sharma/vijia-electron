import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  NotificationPriority,
  NotificationRecord,
  NotifyPayload,
  OverlayNotificationPayload
} from '../shared/notification'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import { getOverlayWebContents, refreshOverlayWindow } from './overlayManager'
import { getMainWindow } from './windowManager'

/**
 * Main-process notification engine: priorities, cooldown, adaptive multiplier,
 * overlay delivery, and in-memory history.
 */
export class NotificationManager {
  /** Max `normal` notifications per rolling window before throttle (default 10 minutes). */
  static readonly BASE_COOLDOWN_MS = 10 * 60 * 1000

  static readonly HISTORY_CAP = 50

  /** Consecutive dismissals that double the effective cooldown for `normal`. */
  static readonly DISMISSALS_TO_DOUBLE = 3

  private readonly history: NotificationRecord[] = []

  /** Recent dismissals (overlay → main). */
  private readonly dismissalLog: { id: string; dismissedAt: number }[] = []

  private guideModeActive = false

  /** Last time a `normal` notification was delivered (cooldown anchor). */
  private lastNormalShownAt = 0

  /** 1 or 2 — doubles effective cooldown after consecutive dismissals. */
  private cooldownMultiplier = 1

  private consecutiveDismissals = 0

  private overlayNotificationChannelReady = false

  private readonly pendingOverlayNotifications: OverlayNotificationPayload[] = []

  /** Effective cooldown for `normal` priority (base × adaptive multiplier). */
  getEffectiveCooldownMs(): number {
    return NotificationManager.BASE_COOLDOWN_MS * this.cooldownMultiplier
  }

  /**
   * Enqueue a notification from any trusted caller (IPC handler, tray, tests).
   * `normal` is throttled; `important` and `system` bypass cooldown.
   */
  notify(payload: NotifyPayload): void {
    const priority: NotificationPriority = payload.priority ?? 'normal'

    if (priority === 'normal') {
      const now = Date.now()
      if (now - this.lastNormalShownAt < this.getEffectiveCooldownMs()) {
        return
      }
    }

    const record = this.buildRecord(payload, priority)
    this.pushHistory(record)

    if (priority === 'normal') {
      this.lastNormalShownAt = record.createdAt
    }

    this.pushToOverlay(record)
  }

  private buildRecord(
    payload: NotifyPayload,
    priority: NotificationPriority
  ): NotificationRecord {
    return {
      id: randomUUID(),
      message: payload.message,
      contextSource: payload.contextSource,
      codeSnippet: payload.codeSnippet,
      actions: payload.actions,
      priority,
      createdAt: Date.now()
    }
  }

  private pushHistory(record: NotificationRecord): void {
    this.history.unshift(record)
    if (this.history.length > NotificationManager.HISTORY_CAP) {
      this.history.length = NotificationManager.HISTORY_CAP
    }
  }

  private broadcastGuideMode(): void {
    const wc = getOverlayWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send(IPC_CHANNELS.VIJIA_GUIDE_MODE, { active: this.guideModeActive })
    }
  }

  private flushPendingOverlayNotifications(): void {
    const wc = getOverlayWebContents()
    if (!wc || wc.isDestroyed()) return
    while (this.pendingOverlayNotifications.length > 0) {
      const p = this.pendingOverlayNotifications.shift()
      if (p) {
        wc.send(IPC_CHANNELS.VIJIA_NOTIFICATION, p)
      }
    }
  }

  private pushToOverlay(payload: OverlayNotificationPayload): void {
    refreshOverlayWindow()
    const wc = getOverlayWebContents()
    if (!wc || wc.isDestroyed()) {
      this.pendingOverlayNotifications.push(payload)
      return
    }

    if (!this.overlayNotificationChannelReady) {
      this.pendingOverlayNotifications.push(payload)
      return
    }

    wc.send(IPC_CHANNELS.VIJIA_NOTIFICATION, payload)
  }

  /** Call when the overlay window is destroyed so the next instance can handshake again. */
  resetOverlayDeliveryState(): void {
    this.overlayNotificationChannelReady = false
    this.pendingOverlayNotifications.length = 0
  }

  /**
   * Called from main when overlay webContents has finished loading (replaces renderer
   * `vijia:overlay-ready` IPC).
   */
  setOverlayDeliveryReady(ready: boolean): void {
    this.overlayNotificationChannelReady = ready
    if (ready) {
      this.flushPendingOverlayNotifications()
    }
  }

  private recordDismissal(id: string): void {
    this.dismissalLog.unshift({ id, dismissedAt: Date.now() })
    if (this.dismissalLog.length > NotificationManager.HISTORY_CAP) {
      this.dismissalLog.length = NotificationManager.HISTORY_CAP
    }
  }

  private handleDismiss(payload: unknown): void {
    const { id } = payload as { id: string }
    this.recordDismissal(id)
    this.consecutiveDismissals += 1
    if (this.consecutiveDismissals >= NotificationManager.DISMISSALS_TO_DOUBLE) {
      this.cooldownMultiplier = 2
      this.consecutiveDismissals = 0
    }
  }

  private handlePromptSubmit(_payload: unknown): void {
    void (_payload as { text: string }).text
  }

  private handleSetGuideMode(payload: unknown): void {
    const { active } = payload as { active: boolean }
    this.guideModeActive = active
    this.broadcastGuideMode()
  }

  getHistory(): NotificationRecord[] {
    return [...this.history]
  }

  syncGuideModeToOverlay(): void {
    this.broadcastGuideMode()
  }

  getGuideModeActive(): boolean {
    return this.guideModeActive
  }

  /** Tray / QA: sends a non-throttled test notification. */
  simulateTestNotification(): void {
    this.notify({
      message: `Just sending a quick note to say hi. Hope you're having a good day and everything is go.`,
      priority: 'important',
      contextSource: 'Vijia — QA',
      actions: [
        { id: 'guide', label: 'Guide me', kind: 'guide' },
        { id: 'dismiss', label: 'dismiss', kind: 'dismiss' }
      ]
    })
  }

  registerIpcHandlers(): void {
    ipcMain.on(IPC_CHANNELS.VIJIA_NOTIFY, (event, payload) => {
      const mw = getMainWindow()
      if (!mw || mw.isDestroyed() || event.sender !== mw.webContents) {
        return
      }
      this.notify(payload as NotifyPayload)
    })

    ipcMain.on(IPC_CHANNELS.VIJIA_DISMISS, (event, payload) => {
      const ow = getOverlayWebContents()
      if (!ow || ow.isDestroyed() || event.sender !== ow) {
        return
      }
      this.handleDismiss(payload)
    })

    ipcMain.on(IPC_CHANNELS.VIJIA_PROMPT_SUBMIT, (event, payload) => {
      const ow = getOverlayWebContents()
      if (!ow || ow.isDestroyed() || event.sender !== ow) {
        return
      }
      this.handlePromptSubmit(payload)
    })

    ipcMain.on(IPC_CHANNELS.VIJIA_SET_GUIDE_MODE, (event, payload) => {
      const mw = getMainWindow()
      const ow = getOverlayWebContents()
      const fromMain =
        mw && !mw.isDestroyed() && event.sender === mw.webContents
      const fromOverlay =
        ow && !ow.isDestroyed() && event.sender === ow
      if (!fromMain && !fromOverlay) {
        return
      }
      this.handleSetGuideMode(payload)
    })

    ipcMain.handle(IPC_CHANNELS.VIJIA_GET_HISTORY, (event) => {
      const mw = getMainWindow()
      if (!mw || mw.isDestroyed() || event.sender !== mw.webContents) {
        return []
      }
      return this.getHistory()
    })
  }
}

/** Singleton used by app bootstrap and IPC. */
export const notificationManager = new NotificationManager()

/** Same as `NotificationManager.BASE_COOLDOWN_MS` (shared cooldown base for `normal`). */
export const BASE_COOLDOWN_MS = NotificationManager.BASE_COOLDOWN_MS

export function registerNotificationIpc(): void {
  notificationManager.registerIpcHandlers()
}

export function resetOverlayNotificationDelivery(): void {
  notificationManager.resetOverlayDeliveryState()
}

export function setOverlayDeliveryReady(ready: boolean): void {
  notificationManager.setOverlayDeliveryReady(ready)
}

export function syncGuideModeToOverlay(): void {
  notificationManager.syncGuideModeToOverlay()
}

export function getGuideModeActive(): boolean {
  return notificationManager.getGuideModeActive()
}

export function simulateTestNotification(): void {
  notificationManager.simulateTestNotification()
}
