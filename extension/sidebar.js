const GUIDE_STATE_KEY = 'vijiaGuideState'

const el = {
  panelGoal: document.getElementById('panel-goal'),
  panelRun: document.getElementById('panel-run'),
  panelDone: document.getElementById('panel-done'),
  loadOverlay: document.getElementById('load-overlay'),
  goalInput: document.getElementById('goal-input'),
  errorGlobal: document.getElementById('error-global'),
  btnStart: document.getElementById('btn-start'),
  runGoal: document.getElementById('run-goal'),
  runProgress: document.getElementById('run-progress'),
  completedList: document.getElementById('completed-list'),
  currentWrap: document.getElementById('current-wrap'),
  currentInstruction: document.getElementById('current-instruction'),
  correction: document.getElementById('correction'),
  trouble: document.getElementById('trouble'),
  btnDone: document.getElementById('btn-done'),
  btnSkip: document.getElementById('btn-skip'),
  btnStopTrouble: document.getElementById('btn-stop-trouble'),
  btnStop: document.getElementById('btn-stop'),
  btnNew: document.getElementById('btn-new'),
  doneGoal: document.getElementById('done-goal'),
  btnCancelLoad: document.getElementById('btn-cancel-load')
}

/** @type {null | { currentIndex: number; active: boolean; finished: boolean; isLoading: boolean } } */
let lastSnapshot = null

/**
 * @param {Record<string, unknown>} s
 */
function applyStateToUi(s) {
  if (!s) {
    return
  }
  const prev = lastSnapshot

  if (s.isLoading) {
    el.loadOverlay.hidden = false
    el.btnStart.disabled = true
  } else {
    el.loadOverlay.hidden = true
    el.btnStart.disabled = false
  }

  if (s.error) {
    el.errorGlobal.textContent = String(s.error)
    el.errorGlobal.hidden = false
  } else {
    el.errorGlobal.hidden = true
    el.errorGlobal.textContent = ''
  }

  if (s.finished) {
    el.panelGoal.hidden = true
    el.panelRun.hidden = true
    el.panelDone.hidden = false
    if (s.goal) {
      el.doneGoal.textContent = String(s.goal)
      el.doneGoal.setAttribute('title', String(s.goal))
    }
  } else if (s.active) {
    el.panelGoal.hidden = true
    el.panelRun.hidden = false
    el.panelDone.hidden = true
    if (s.goal) {
      el.runGoal.textContent = `Goal: ${s.goal}`
      el.runGoal.setAttribute('title', String(s.goal))
    }
    const total = Array.isArray(s.steps) ? s.steps.length : 0
    const rawIndex = Math.max(0, Number(s.currentIndex) || 0)
    const index = total > 0 ? Math.min(rawIndex, total - 1) : 0
    if (total > 0) {
      el.runProgress.textContent = `Step ${index + 1} of ${total}`
    } else {
      el.runProgress.textContent = 'Step —'
    }

    el.completedList.innerHTML = ''
    for (let i = 0; i < index; i += 1) {
      const st = s.steps[i]
      if (st && st.instruction) {
        const li = document.createElement('li')
        li.textContent = st.instruction.replace(/\s+/g, ' ').trim()
        el.completedList.appendChild(li)
      }
    }
    const cur = s.steps && s.steps[index]
    if (el.currentInstruction) {
      el.currentInstruction.textContent = cur
        ? String(cur.instruction)
        : '—'
    }
    if (s.correction) {
      el.correction.textContent = String(s.correction)
      el.correction.hidden = false
    } else {
      el.correction.textContent = ''
      el.correction.hidden = true
    }
    if (s.trouble) {
      el.trouble.textContent = String(s.trouble)
      el.trouble.hidden = false
    } else {
      el.trouble.textContent = ''
      el.trouble.hidden = true
    }

    const isManual = cur && cur.detection_type === 'manual_advance'
    const showDone = isManual
    el.btnDone.hidden = !showDone
    if (s.showSkipHelper) {
      el.btnSkip.hidden = false
      el.btnStopTrouble.hidden = false
    } else {
      el.btnSkip.hidden = true
      el.btnStopTrouble.hidden = true
    }

    const steppedUp =
      prev != null && prev.active && s.active && prev.currentIndex < index
    if (el.currentWrap && steppedUp) {
      el.currentWrap.classList.remove('advance-flash')
      // eslint-disable-next-line no-unused-expressions
      void el.currentWrap.offsetWidth
      el.currentWrap.classList.add('advance-flash')
    }
  } else {
    el.panelGoal.hidden = false
    el.panelRun.hidden = true
    el.panelDone.hidden = true
  }

  lastSnapshot = {
    currentIndex: Number(s.currentIndex) || 0,
    active: !!s.active,
    finished: !!s.finished,
    isLoading: !!s.isLoading
  }
}

async function refresh() {
  const r = await sendMessage('VIJIA_GUIDE_GET_STATE', {})
  if (r && r.state && typeof r.state === 'object') {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
    return
  }
  const raw = await chrome.storage.local.get(GUIDE_STATE_KEY)
  const s = raw[GUIDE_STATE_KEY]
  applyStateToUi(
    s && typeof s === 'object'
      ? /** @type {Record<string, unknown>} */ (s)
      : { active: false, finished: false, isLoading: false, steps: [] }
  )
}

function sendMessage(type, extra) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (r) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, state: {} })
          return
        }
        resolve(r || { ok: false, state: {} })
      })
    } catch {
      resolve({ ok: false, state: {} })
    }
  })
}

el.btnStart.addEventListener('click', async () => {
  const g = (el.goalInput && el.goalInput.value) || ''
  el.errorGlobal.hidden = true
  const r = await sendMessage('VIJIA_GUIDE_START', { goal: g })
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
  await refresh()
})

el.btnDone.addEventListener('click', async () => {
  const r = await sendMessage('VIJIA_GUIDE_MANUAL_DONE', {})
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
})

el.btnSkip.addEventListener('click', async () => {
  const r = await sendMessage('VIJIA_GUIDE_SKIP', {})
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
})

el.btnStopTrouble.addEventListener('click', async () => {
  const r = await sendMessage('VIJIA_GUIDE_STOP', {})
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
  if (el.goalInput) {
    el.goalInput.value = ''
  }
})

el.btnStop.addEventListener('click', async () => {
  const r = await sendMessage('VIJIA_GUIDE_STOP', {})
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
  if (el.goalInput) {
    el.goalInput.value = ''
  }
})

el.btnNew.addEventListener('click', async () => {
  const r = await sendMessage('VIJIA_GUIDE_RESET', {})
  if (r && r.state) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
  }
  if (el.goalInput) {
    el.goalInput.value = ''
  }
})

if (el.btnCancelLoad) {
  el.btnCancelLoad.addEventListener('click', async () => {
    const r = await sendMessage('VIJIA_GUIDE_CANCEL_LOADING', {})
    if (r && r.state) {
      applyStateToUi(/** @type {Record<string, unknown>} */ (r.state))
    }
    void refresh()
  })
}

if (el.goalInput) {
  el.goalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      el.btnStart.click()
    }
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[GUIDE_STATE_KEY]) {
    return
  }
  const s = changes[GUIDE_STATE_KEY].newValue
  if (s) {
    applyStateToUi(/** @type {Record<string, unknown>} */ (s))
  }
})

void refresh().then(() => {
  if (el.goalInput) {
    el.goalInput.focus()
  }
})
