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
    loadingRequestId: null
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
    return setGuideState({
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
      trouble: null
    })
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
  const s = await getGuideState()
  if (!s.active) {
    return s
  }
  const next = s.currentIndex + 1
  if (next >= s.steps.length) {
    return setGuideState({
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
  }
  return setGuideState({
    ...s,
    currentIndex: next,
    wrongNavCount: 0,
    lastWrongUrl: null,
    showSkipHelper: false,
    correction: null,
    trouble: null
  })
}

async function stopGuide() {
  await setGuideState(defaultGuideState())
  return getGuideState()
}

async function evaluateActiveTab() {
  const s = await getGuideState()
  if (!s.active || s.finished) {
    return
  }
  const step = s.steps[s.currentIndex]
  if (!step || step.detection_type !== 'url_match' || !step.match_value) {
    return
  }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!activeTab || !activeTab.id) {
    return
  }
  const url = activeTab.url || ''
  if (urlMatchesPattern(url, step.match_value)) {
    await advanceGuideAfterStep()
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
      if (!step || step.detection_type !== 'manual_advance') {
        sendResponse({ ok: false, state: s })
        return
      }
      const st = await advanceGuideAfterStep()
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
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_STOP') {
    void (async () => {
      const st = await stopGuide()
      sendResponse({ ok: true, state: st })
    })()
    return true
  }
  if (message?.type === 'VIJIA_GUIDE_RESET') {
    void (async () => {
      const st = await stopGuide()
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
