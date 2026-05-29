const RELOAD_MENU_ID = 'vijia-reload-extension'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:45731'
const DEFAULT_SETTINGS = {
  bridgeUrl: DEFAULT_BRIDGE_URL,
  sessionToken: '',
  debugOverlay: false
}

const GUIDE_STATE_KEY = 'vijiaGuideState'
const GUIDE_PLAN_TIMEOUT_MS = 120_000
const GUIDE_PLAN_RETRIES = 0
const GUIDE_LOADING_STALE_MS = GUIDE_PLAN_TIMEOUT_MS + 5_000
const GUIDE_TITLE_POLL_MS = 200
const GUIDE_SCREEN_TEXT_POLL_MS = 400

const ICON_PATHS = {
  sleeping: {
    16: 'icons/iji-sleeping-16.png',
    32: 'icons/iji-sleeping-32.png'
  },
  awake: {
    16: 'icons/iji-awake-16.png',
    32: 'icons/iji-awake-32.png'
  },
  glowing: {
    16: 'icons/iji-glowing-16.png',
    32: 'icons/iji-glowing-32.png'
  }
}

let guidePollTimer = null
let guideScreenpipeFailures = 0
let guideStepEpoch = 0
let guidePollInFlight = false
const GUIDE_SCREENPIPE_FAILURE_THRESHOLD = 3

function isPermanentScreenpipeError(reason) {
  return /api key|unauthorized|authentication/i.test(String(reason || ''))
}

function guideStepKey(step) {
  if (!step) {
    return ''
  }
  return [
    step.detection_type,
    step.instruction,
    step.match_value || '',
    step.screen_text || '',
    step.advance_when || ''
  ].join('\0')
}

async function isStillOnGuideStep(stepIndex, stepKey) {
  const fresh = await getGuideState()
  if (!fresh.active || fresh.finished) {
    return false
  }
  if (fresh.currentIndex !== stepIndex) {
    return false
  }
  return guideStepKey(fresh.steps[fresh.currentIndex]) === stepKey
}

async function advanceGuideFromDetection(stepIndex, step, reason) {
  const stepKey = guideStepKey(step)
  if (!(await isStillOnGuideStep(stepIndex, stepKey))) {
    console.log('[Vijia][guide] ignored stale auto-advance', {
      reason,
      stepIndex,
      detection_type: step?.detection_type
    })
    return getGuideState()
  }
  return advanceGuideAfterStep()
}

function defaultGuideState() {
  return {
    active: false,
    finished: false,
    goal: '',
    steps: [],
    currentIndex: 0,
    wrongNavCount: 0,
    lastWrongUrl: null,
    showSkipHelper: false,
    correction: null,
    trouble: null,
    error: null,
    isLoading: false,
    loadingStartedAt: null,
    loadingRequestId: null,
    detectionUnavailable: false,
    detectionReason: null
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get(DEFAULT_SETTINGS)
  let bridgeUrl = result.bridgeUrl || DEFAULT_BRIDGE_URL
  let sessionToken = result.sessionToken || ''
  if (!sessionToken) {
    try {
      const base = bridgeUrl.replace(/\/$/, '')
      const response = await fetch(`${base}/extension/bootstrap`)
      if (response.ok) {
        const data = await response.json()
        const t =
          data && typeof data.sessionToken === 'string'
            ? data.sessionToken.trim()
            : ''
        if (t) {
          sessionToken = t
          if (data && typeof data.bridgeUrl === 'string' && data.bridgeUrl.trim()) {
            bridgeUrl = data.bridgeUrl.trim()
          }
          await chrome.storage.local.set({ bridgeUrl, sessionToken })
        }
      }
    } catch {
      // App not running or port mismatch — user can paste token in options.
    }
  }
  return { bridgeUrl, sessionToken }
}

async function getGuideState() {
  const { [GUIDE_STATE_KEY]: raw } = await chrome.storage.local.get(GUIDE_STATE_KEY)
  if (!raw || typeof raw !== 'object') {
    return { ...defaultGuideState() }
  }
  const state = { ...defaultGuideState(), ...raw }
  const loadingStartedAt =
    typeof state.loadingStartedAt === 'number' ? state.loadingStartedAt : 0
  if (
    state.isLoading &&
    (!loadingStartedAt || Date.now() - loadingStartedAt > GUIDE_LOADING_STALE_MS)
  ) {
    const resetState = {
      ...defaultGuideState(),
      goal: String(state.goal || '').trim(),
      error: 'Guide request timed out. Please try again.'
    }
    await chrome.storage.local.set({ [GUIDE_STATE_KEY]: resetState })
    return resetState
  }
  return state
}

async function setGuideState(partial) {
  const current = await getGuideState()
  const next = { ...current, ...partial }
  await chrome.storage.local.set({ [GUIDE_STATE_KEY]: next })
  return next
}

async function updateActionIcon(state) {
  const iconState = state.active ? 'glowing' : state.finished ? 'awake' : 'sleeping'
  try {
    await chrome.action.setIcon({ path: ICON_PATHS[iconState] })
  } catch {
    // If assets are missing, do not break guide flow.
  }
}

function isHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return false
  }
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * @param {string} tabUrl
 * @param {string | null} pattern
 */
function urlMatchesPattern(tabUrl, pattern) {
  if (!pattern || !isHttpUrl(tabUrl)) {
    return false
  }
  const t = tabUrl.toLowerCase()
  const pRaw = String(pattern).trim()
  if (!pRaw) {
    return false
  }
  try {
    if (pRaw.startsWith('http://') || pRaw.startsWith('https://')) {
      const u = new URL(pRaw)
      return t.includes(u.hostname.toLowerCase())
    }
  } catch {
    // fall through
  }
  const hostish = pRaw
    .replace(/^\*+\.?/, '')
    .replace(/^(https?:\/\/)/, '')
    .split('/')[0]
    .toLowerCase()
  if (!hostish) {
    return t.includes(pRaw.toLowerCase())
  }
  try {
    const tab = new URL(tabUrl)
    const h = tab.hostname.toLowerCase()
    return (
      h === hostish ||
      h.endsWith(`.${hostish}`) ||
      t.includes(hostish)
    )
  } catch {
    return t.includes(pRaw.toLowerCase())
  }
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color })
}

/**
 * @param {string} url
 * @param {unknown} body
 * @param {{ retries?: number; timeoutMs?: number }} [options] timeoutMs: aborts fetch if no response in time (guide-plan uses this; unset = no limit).
 */
async function postJson(url, body, options = {}) {
  const retries = options.retries ?? 2
  const timeoutMs = options.timeoutMs ?? 0
  const maxAttempts = retries + 1

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeoutId =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: timeoutMs > 0 ? controller.signal : undefined
      })

      let data = {}
      try {
        data = await response.json()
      } catch (_error) {
        data = {}
      }

      const result = {
        ok: response.ok,
        status: response.status,
        data
      }

      if (response.ok) {
        return result
      }

      if (response.status < 500) {
        return result
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return { ok: false, status: 0, data: { error: 'timeout' } }
      }
      if (attempt === maxAttempts - 1) {
        return { ok: false, status: 0, data: {} }
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
  }

  return { ok: false, status: 0, data: {} }
}

async function getGuideSignal(bridgeUrl, sessionToken) {
  const url = `${bridgeUrl.replace(/\/$/, '')}/extension/guide-signal`
  try {
    const response = await fetch(url, { headers: { 'x-vijia-token': sessionToken } })
    if (!response.ok) {
      console.warn('[Vijia][guide] guide-signal HTTP error', {
        status: response.status,
        url
      })
      return null
    }
    return await response.json()
  } catch (error) {
    console.warn('[Vijia][guide] guide-signal fetch failed', { url, error })
    return null
  }
}

function registerReloadContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: RELOAD_MENU_ID,
      title: 'Reload extension',
      contexts: ['action']
    })
  })
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === RELOAD_MENU_ID) {
    chrome.runtime.reload()
  }
})

registerReloadContextMenu()

const VIJIA_HOST_RE =
  /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|www\.perplexity\.ai|perplexity\.ai|chat\.deepseek\.com)\//u

async function runHandshake() {
  const settings = await getSettings()
  if (!settings.sessionToken) {
    await setBadge('SET', '#d97706')
    return
  }

  const response = await postJson(`${settings.bridgeUrl}/extension/handshake`, {
    token: settings.sessionToken,
    extensionVersion: chrome.runtime.getManifest().version
  })

  await setBadge(response.ok ? 'ON' : 'OFF', response.ok ? '#15803d' : '#b91c1c')
}

function buildCapturePayload(message, sender, sessionToken) {
  return {
    schema: 1,
    sessionToken,
    eventId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    site: message.payload.site,
    url: message.payload.url,
    title: message.payload.title,
    tabId: sender.tab?.id ?? -1,
    frameId: sender.frameId ?? 0,
    source: 'browser-extension',
    extract: message.payload.extract,
    pageState: message.payload.pageState
  }
}

// --- Guide Mode ---

function guideErrorMessage(data, status) {
  if (data && data.error === 'timeout') {
    return 'Request timed out. Is Vijia running? If it is, check the bridge URL in extension options and that Supabase env is set in the app.'
  }
  if (data && typeof data.detail === 'string' && data.detail) {
    return data.detail
  }
  if (data && typeof data.error === 'string' && data.error) {
    return data.error
  }
  if (data && data.ok === false) {
    return 'Guide plan failed. Check Vijia, Supabase env, and the bridge token.'
  }
  if (!status) {
    return "Could not reach the Vijia app. Start Vijia, or fix Options → bridge URL and session token."
  }
  return `Could not get steps (${String(status || 'error')})`
}

function erroredStartState(goalText, err) {
  return {
    ...defaultGuideState(),
    goal: goalText,
    isLoading: false,
    error: err,
    active: false,
    finished: false,
    steps: []
  }
}

async function getActiveLoadingRequest(requestId) {
  const current = await getGuideState()
  if (!current.isLoading || current.loadingRequestId !== requestId) {
    return null
  }
  return current
}

async function startGuideFromGoal(goal) {
  const settings = await getSettings()
  if (!settings.sessionToken) {
    return setGuideState(
      erroredStartState(
        String(goal).trim(),
        'Set session token in extension options, or start Vijia to bootstrap the bridge.'
      )
    )
  }
  const base = settings.bridgeUrl.replace(/\/$/, '')
  const trimmed = String(goal).trim()
  if (!trimmed) {
    return setGuideState(erroredStartState('', 'Please enter a goal.'))
  }
  const requestId = crypto.randomUUID()
  await setGuideState({
    ...defaultGuideState(),
    isLoading: true,
    loadingStartedAt: Date.now(),
    loadingRequestId: requestId,
    error: null,
    goal: trimmed,
    active: false,
    finished: false,
    steps: []
  })
  try {
    const response = await postJson(
      `${base}/extension/guide-plan`,
      { sessionToken: settings.sessionToken, goal: trimmed },
      { retries: GUIDE_PLAN_RETRIES, timeoutMs: GUIDE_PLAN_TIMEOUT_MS }
    )
    if (!(await getActiveLoadingRequest(requestId))) {
      return getGuideState()
    }
    if (!response.ok) {
      const data = response.data
      return setGuideState(
        erroredStartState(
          trimmed,
          guideErrorMessage(
            data && typeof data === 'object' ? data : {},
            response.status
          )
        )
      )
    }
    const d = response.data
    if (!d || d.ok !== true || !Array.isArray(d.steps) || d.steps.length === 0) {
      if (!(await getActiveLoadingRequest(requestId))) {
        return getGuideState()
      }
      return setGuideState(
        erroredStartState(
          trimmed,
          "Claude's response was not a valid list of steps."
        )
      )
    }
    const st = await setGuideState({
      isLoading: false,
      loadingStartedAt: null,
      loadingRequestId: null,
      error: null,
      active: true,
      finished: false,
      goal: trimmed,
      steps: d.steps,
      currentIndex: 0,
      wrongNavCount: 0,
      lastWrongUrl: null,
      showSkipHelper: false,
      correction: null,
      trouble: null,
      detectionUnavailable: false,
      detectionReason: null
    })
    await updateActionIcon(st)
    return st
  } catch (e) {
    if (!(await getActiveLoadingRequest(requestId))) {
      return getGuideState()
    }
    const msg = e instanceof Error ? e.message : 'unknown-error'
    return setGuideState(
      erroredStartState(
        trimmed,
        `Request failed: ${msg}. If Vijia is not running, start it and try again.`
      )
    )
  }
}

async function advanceGuideAfterStep() {
  guideStepEpoch++
  const s = await getGuideState()
  if (!s.active) {
    return s
  }
  const next = s.currentIndex + 1
  if (next >= s.steps.length) {
    const st = await setGuideState({
      ...s,
      active: false,
      finished: true,
      currentIndex: s.steps.length,
      wrongNavCount: 0,
      lastWrongUrl: null,
      showSkipHelper: false,
      correction: null,
      trouble: null
    })
    await updateActionIcon(st)
    return st
  }
  const st = await setGuideState({
    ...s,
    currentIndex: next,
    wrongNavCount: 0,
    lastWrongUrl: null,
    showSkipHelper: false,
    correction: null,
    trouble: null,
    detectionUnavailable: false,
    detectionReason: null
  })
  await updateActionIcon(st)
  return st
}

async function stopGuide() {
  guideStepEpoch++
  const st = await setGuideState(defaultGuideState())
  await updateActionIcon(st)
  return st
}

async function evaluateActiveTab() {
  const s = await getGuideState()
  if (!s.active || s.finished) {
    return
  }
  const stepIndex = s.currentIndex
  const step = s.steps[stepIndex]
  if (!step || step.detection_type !== 'url_match' || !step.match_value) {
    return
  }
  const stepKey = guideStepKey(step)
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!activeTab || !activeTab.id) {
    return
  }
  const url = activeTab.url || ''
  if (urlMatchesPattern(url, step.match_value)) {
    await advanceGuideFromDetection(stepIndex, step, 'url_match')
    await syncGuidePolling()
    return
  }
  if (!isHttpUrl(url)) {
    return
  }
  if (s.lastWrongUrl === url) {
    return
  }
  const wrongNavCount = s.wrongNavCount + 1
  const showSkipHelper = wrongNavCount >= 3
  const destination = step.match_value
  const correction = `That's not quite right. You need to go to [${destination}].`
  const trouble = showSkipHelper
    ? 'Having trouble? You can skip this step or stop the guide.'
    : null
  await setGuideState({
    ...s,
    wrongNavCount,
    lastWrongUrl: url,
    showSkipHelper,
    correction,
    trouble
  })
}

function stopGuidePolling() {
  if (guidePollTimer) {
    clearInterval(guidePollTimer)
    guidePollTimer = null
  }
  guideScreenpipeFailures = 0
}

async function evaluateNonUrlStep() {
  if (guidePollInFlight) {
    return
  }
  guidePollInFlight = true
  const epochAtStart = guideStepEpoch
  try {
    const s = await getGuideState()
    if (!s.active || s.finished) {
      stopGuidePolling()
      return
    }
    const stepIndex = s.currentIndex
    const step = s.steps[stepIndex]
    if (!step) {
      return
    }
    if (step.detection_type === 'manual_advance' || step.detection_type === 'url_match') {
      return
    }
    const stepKey = guideStepKey(step)
    const settings = await getSettings()
    if (!settings.sessionToken) {
      return
    }
    const signal = await getGuideSignal(settings.bridgeUrl, settings.sessionToken)
    if (epochAtStart !== guideStepEpoch) {
      return
    }
    if (!(await isStillOnGuideStep(stepIndex, stepKey))) {
      return
    }
    const fresh = await getGuideState()
  if (!signal || signal.ok !== true) {
    guideScreenpipeFailures++
    if (
      !fresh.detectionUnavailable &&
      guideScreenpipeFailures >= GUIDE_SCREENPIPE_FAILURE_THRESHOLD
    ) {
      console.warn('[Vijia][guide] signal detection unavailable', {
        step: step.step,
        detection_type: step.detection_type,
        signalOk: signal?.ok,
        bridgeUrl: settings.bridgeUrl,
        consecutiveFailures: guideScreenpipeFailures
      })
      await setGuideState({
        ...fresh,
        detectionUnavailable: true,
        detectionReason: 'Signal detection unavailable. Use Done to continue.'
      })
    }
    return
  }
  if (fresh.detectionUnavailable && signal.screenpipe?.available) {
    guideScreenpipeFailures = 0
    console.log('[Vijia][guide] ScreenPipe recovered, resuming auto-detection', {
      step: step.step
    })
    await setGuideState({
      ...fresh,
      detectionUnavailable: false,
      detectionReason: null
    })
  }
  if (step.detection_type === 'title_match') {
    const title = String(signal.activeWindowTitle || '').toLowerCase()
    const expected = String(step.match_value || '').toLowerCase()
    if (!title || !expected) {
      return
    }
    if (title.includes(expected)) {
      await advanceGuideFromDetection(stepIndex, step, 'title_match')
      await syncGuidePolling()
      return
    }
  }
  if (step.detection_type === 'screen_text_match') {
    const available = !!signal.screenpipe?.available
    const text = String(signal.screenpipe?.text || '').toLowerCase()
    const target = String(step.screen_text || '').toLowerCase()
    if (!available) {
      const reason =
        typeof signal.screenpipe?.reason === 'string' && signal.screenpipe.reason
          ? signal.screenpipe.reason
          : 'ScreenPipe is unavailable. Use Done to continue.'
      guideScreenpipeFailures++
      const shouldLatch =
        !fresh.detectionUnavailable &&
        (isPermanentScreenpipeError(reason) ||
          guideScreenpipeFailures >= GUIDE_SCREENPIPE_FAILURE_THRESHOLD)
      if (shouldLatch) {
        console.warn('[Vijia][guide] ScreenPipe unavailable for screen_text_match', {
          step: step.step,
          screen_text: step.screen_text,
          reason,
          consecutiveFailures: guideScreenpipeFailures
        })
        await setGuideState({
          ...fresh,
          detectionUnavailable: true,
          detectionReason: reason
        })
      }
      return
    }
    guideScreenpipeFailures = 0
    if (!target) {
      return
    }
    const found = text.includes(target)
    const advanceWhen = step.advance_when === 'disappears' ? 'disappears' : 'appears'
    if ((advanceWhen === 'appears' && found) || (advanceWhen === 'disappears' && !found)) {
      await advanceGuideFromDetection(stepIndex, step, 'screen_text_match')
      await syncGuidePolling()
    }
  }
  } finally {
    guidePollInFlight = false
  }
}

async function syncGuidePolling() {
  const s = await getGuideState()
  if (!s.active || s.finished) {
    stopGuidePolling()
    return
  }
  const step = s.steps[s.currentIndex]
  if (!step) {
    stopGuidePolling()
    return
  }
  if (step.detection_type === 'url_match' || step.detection_type === 'manual_advance') {
    stopGuidePolling()
    return
  }
  const intervalMs =
    step.detection_type === 'title_match' ? GUIDE_TITLE_POLL_MS : GUIDE_SCREEN_TEXT_POLL_MS
  stopGuidePolling()
  guidePollTimer = setInterval(() => {
    void evaluateNonUrlStep()
  }, intervalMs)
  void evaluateNonUrlStep()
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    void (async () => {
      const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (a && a.id === tabId) {
        await evaluateActiveTab()
      }
    })()
  }
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  void (async () => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId)
      const url = tab.url || ''
      if (VIJIA_HOST_RE.test(url)) {
        await chrome.tabs.sendMessage(activeInfo.tabId, {
          type: 'VIJIA_SCHEDULE_CAPTURE',
          reason: 'tab-switch'
        })
      }
    } catch {
      // Tab may not have content script yet.
    }
    await evaluateActiveTab()
  })()
})

chrome.runtime.onInstalled.addListener((details) => {
  registerReloadContextMenu()
  if (details.reason === 'install') {
    void chrome.storage.local.set(DEFAULT_SETTINGS)
    void setBadge('SET', '#d97706')
  }
  if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  }
  void runHandshake()
})

chrome.runtime.onStartup.addListener(() => {
  if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  }
  void runHandshake()
})

if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
}
void runHandshake()
void updateActionIcon(defaultGuideState())

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'VIJIA_GUIDE_GET_STATE') {
    void (async () => {
      sendResponse({ ok: true, state: await getGuideState() })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_CANCEL_LOADING') {
    void (async () => {
      const s = await getGuideState()
      if (!s.isLoading) {
        sendResponse({ ok: true, state: s })
        return
      }
      const goal = String(s.goal || '').trim()
      const st = await setGuideState({
        ...defaultGuideState(),
        goal,
        isLoading: false,
        loadingStartedAt: null,
        loadingRequestId: null,
        error: null,
        active: false,
        finished: false,
        steps: []
      })
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_START') {
    const goal = message.goal
    void (async () => {
      const st = await startGuideFromGoal(goal)
      await runHandshake()
      await evaluateActiveTab()
      await syncGuidePolling()
      sendResponse({ ok: !st.error, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_MANUAL_DONE') {
    void (async () => {
      const s = await getGuideState()
      if (!s.active) {
        sendResponse({ ok: true, state: s })
        return
      }
      const step = s.steps[s.currentIndex]
      const allowManual =
        step &&
        (step.detection_type === 'manual_advance' ||
          s.detectionUnavailable === true ||
          step.detection_type === 'screen_text_match')
      if (!allowManual) {
        sendResponse({ ok: false, state: s })
        return
      }
      const st = await advanceGuideAfterStep()
      await syncGuidePolling()
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_SKIP') {
    void (async () => {
      const s = await getGuideState()
      if (!s.active) {
        sendResponse({ ok: true, state: s })
        return
      }
      if (!s.showSkipHelper) {
        sendResponse({ ok: false, state: s })
        return
      }
      const st = await advanceGuideAfterStep()
      void evaluateActiveTab()
      await syncGuidePolling()
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_STOP') {
    void (async () => {
      const st = await stopGuide()
      stopGuidePolling()
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_RESET') {
    void (async () => {
      const st = await stopGuide()
      stopGuidePolling()
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type !== 'VIJIA_CAPTURE') {
    return false
  }
  void (async () => {
    const settings = await getSettings()

    if (!settings.sessionToken) {
      await setBadge('SET', '#d97706')
      sendResponse({ ok: false, error: 'missing-token' })
      return
    }

    const ex = message.payload?.extract
    const uLen = String(ex?.user ?? '').trim().length
    const aLen = String(ex?.assistant ?? '').trim().length
    if (!ex || uLen === 0 || aLen === 0) {
      sendResponse({ ok: true, skipped: true, reason: 'incomplete-pair' })
      return
    }

    const payload = buildCapturePayload(message, sender, settings.sessionToken)
    const response = await postJson(
      `${settings.bridgeUrl}/extension/capture`,
      payload
    )

    if (!response.ok) {
      console.warn(
        '[Vijia] Capture POST failed:',
        response.status,
        settings.bridgeUrl
      )
    }

    await setBadge(response.ok ? 'ON' : 'OFF', response.ok ? '#15803d' : '#b91c1c')
    sendResponse(response)
  })()
  return true
})
