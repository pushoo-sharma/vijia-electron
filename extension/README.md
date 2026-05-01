# Vijia Browser Bridge (Chrome extension)

**Manifest V3** extension with **Guide Mode** (side panel) and a **chat capture** bridge: on supported AI chat sites it extracts the latest **user + assistant** message pair and **POSTs** it to the local Vijia Electron app over **loopback HTTP** (`127.0.0.1`). The app owns auth, deduplication, persistence, and downstream behavior. Guide plans are requested with **`POST /extension/guide-plan`** (Electron → Supabase `claude-proxy` with `guide: true`).

## Guide Mode (Milestone 2)

1. **Start Vijia** so the loopback bridge is up (`http://127.0.0.1:<port>`, default `45731`). The service worker can **`GET /extension/bootstrap`** to obtain `sessionToken` and `bridgeUrl` if options are empty.
2. Open the **side panel**: click the extension icon in the toolbar (opens the side panel; `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` is set in the service worker).
3. Enter a **goal** and click **Start guide**. The side panel calls the service worker, which **`POST`s** `{ sessionToken, goal }` to **`/extension/guide-plan`**. The Electron app calls **claude-proxy** and returns a JSON **steps** array.
4. **Steps**:
   - **`url_match`**: the active tab URL is checked via `chrome.tabs.onUpdated` / `chrome.tabs.onActivated` against `match_value` (host / substring heuristics). A match advances the step; a non-matching `http`/`https` URL increments a per-step “wrong” count and shows a short correction. After **3** wrong navigations, **Skip** and **Stop** are shown.
   - **`manual_advance`**: use the **Done** button in the side panel to advance.
5. **Stop guide** ends the run; **New goal** appears when all steps are complete.

**Prerequisites for plans:** the Electron app must have **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`** so `claude-proxy` can be called. If not configured, the bridge returns a clear error to the side panel.

## Architecture (end-to-end)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Supported tab (ChatGPT, Claude, Gemini, Perplexity, DeepSeek)  │
├─────────────────────────────────────────────────────────────────┤
│  site-adapters.js    Per-site heuristics → { user, assistant }  │
│  content-script.js   Observers + debounce → chrome.runtime      │
│                      .sendMessage({ type: 'VIJIA_CAPTURE' })   │
├─────────────────────────────────────────────────────────────────┤
│  service-worker.js   Adds sessionToken, tab/frame ids, POSTs    │
│                      to Electron: /extension/capture            │
├─────────────────────────────────────────────────────────────────┤
│  Electron (browserBridge.ts)  Token check, dedupe, session log, │
│                               events                            │
└─────────────────────────────────────────────────────────────────┘
```

## File map

| File | Role |
|------|------|
| `manifest.json` | MV3: service worker, **side panel** (`side_panel` + `sidePanel` permission), content scripts, `host_permissions` for chat sites + `http://127.0.0.1/*`, `options_page`, `storage` / `tabs` / `contextMenus`. |
| `sidebar.html` + `sidebar.css` + `sidebar.js` | Guide Mode UI: goal, progress, current step, Done / Skip / Stop, sync via `chrome.storage` (`vijiaGuideState`). |
| `site-adapters.js` | IIFE exposing `VIJIA_SITE_ADAPTERS.detectAdapter()`. Per-site `extractLastPair()`; ChatGPT has DOM role-based extraction + plaintext fallback. |
| `content-script.js` | Schedules capture on user activity; stability wait; dedupes by hash; sends `VIJIA_CAPTURE` to the service worker. Listens for `VIJIA_SCHEDULE_CAPTURE` from the worker (tab focus). |
| `service-worker.js` | Token/bootstrap, `POST` **handshake**, **capture**, **guide-plan**; **Guide** state + `tabs` URL watching; toolbar badge, context menu “Reload extension”, `tabs.onActivated` → content script `tab-switch` (chat sites) + guide URL evaluation. |
| `options.html` + `options.js` | Edit `bridgeUrl` and `sessionToken` in `chrome.storage.local`. |

## Debug overlay (development)

In the extension **options** page, enable **Debug: show on-page overlay**, then **reload** the chat tab. A small panel in the lower-right (Shadow DOM) logs debounced `schedule` reasons, `emit` / `send` (sizes), `bridge` HTTP results, and skips (hidden page, no adapter, dedupe). The panel can **minimize**, **copy** the log, or **close** (turns debug off in storage). Turn debug off for normal use.

## Pairing with Electron

1. With Vijia running, the app prints the bridge config path in the dev console (`Extension bridge config: …`) and may mirror values under project `.vijia/browser-extension-bridge.json` in dev.
2. Default **bridge URL**: `http://127.0.0.1:45731` (port comes from the app).
3. **Session token** is required. If empty, the service worker tries **`GET /extension/bootstrap`** to pull `sessionToken` (and optionally `bridgeUrl`) from the running app and store them.
4. Otherwise, paste `sessionToken` (and URL if needed) in the extension **Options** page.

## Service worker behavior

- **`getSettings()`** — Reads `bridgeUrl` + `sessionToken` from storage; if token missing, fetches bootstrap from `${bridgeUrl}/extension/bootstrap` and persists on success.
- **`POST /extension/handshake`** — On install, startup, and service worker wake; sends `{ token, extensionVersion }`. Badge: **ON** (green) / **OFF** (red) / **SET** (amber, no token).
- **`POST /extension/guide-plan`** — When starting a guide: `{ sessionToken, goal }` → Electron → **claude-proxy** (`guide: true`); response must be a JSON **steps** array. Same token as capture.
- **`VIJIA_CAPTURE` messages** — Builds a normalized payload (`schema`, `eventId`, `capturedAt`, `site`, `url`, `title`, `tabId`, `frameId`, `source: 'browser-extension'`, `extract`, `pageState`) and **`POST /extension/capture`**. Retries on 5xx with backoff.
- **`chrome.tabs.onActivated`** / **`chrome.tabs.onUpdated`** — If the active tab is a **supported chat host**, sends **`VIJIA_SCHEDULE_CAPTURE`** with reason `tab-switch` (capture path). If a **Guide** is active, evaluates the **active** tab URL for `url_match` steps.

## Content script: when it captures

- **Global debounce**: every trigger routes through a **10s** debounce (`VIJIA_CAPTURE_DEBOUNCE_MS`); the timer resets on new activity so bursts collapse to one run.
- **Stability**: before sending, **`waitForStableExtract`** polls the adapter up to 5 times with 1s delay so the last user/assistant pair does not change between reads.
- **Dedup**: `buildHash` over `site`, `title`, and `pair`; identical payloads are not sent twice.
- **Empty pair**: if extraction is empty, schedules up to **4** retries ~2.2s apart.
- **Visibility**: no capture when `document.visibilityState === 'hidden'`.
- **Tab switch** (from worker): `visibilitychange` schedules `app-switch` (hidden) and `tab-switch` (visible); **scroll** (400ms after scroll end) → `scroll-pause`; **keydown** → `typing-start`; **keyup** (800ms idle) → `typing-stop`; **MutationObserver** (1.5s DOM idle) → `typing-stop`.
- **Startup**: initial `scheduleCapture('typing-stop')` plus one-shot **`startup-delay-*`** at 2.5s, 6s, 12s to catch late SPA mounts.

## Site adapters (extraction)

- **ChatGPT / OpenAI**: When present, walks `section[data-testid^="conversation-turn-"]` in order, then per-turn `[data-message-author-role]`: user text from `.user-message-bubble-color` / pre-wrap, assistant from `div.markdown` (with `[data-message-content]` / innerText fallbacks). Then falls back to a document-wide role walk, **main** paragraph heuristics, and marker `stableExtract`. Filters short “noise” assistant lines.
- **Gemini**: Only DOM-scoped: `[data-test-id="chat-history-container"]` or `#chat-history`, last `user-query` (`p.query-text-line` / `.query-text`) and last `model-response` (`.markdown-main-panel` / `message-content`). No body-text or marker fallbacks (avoids wrong captures).
- **Claude**: DOM-only — last `[data-user-message-bubble="true"]` (prefer `[data-testid="user-message"]` / `p.whitespace-pre-wrap`) and last `.font-claude-response .standard-markdown` (or `.progressive-markdown`). No body / marker fallbacks.
- **Perplexity**: DOM-only — last `h1[class*="group/query"]` (text in the `bg-subtle` bubble `span`) and last `[id^="markdown-content-"]` for the answer body. No body / marker fallbacks.
- **DeepSeek**: DOM-only under `.ds-virtual-list` — last `.ds-message` **without** `.ds-markdown` (user bubble) and last `.ds-message .ds-markdown` (answer). No body / marker fallbacks.

Extraction is **heuristic**; the app may still scrub or dedupe on ingest.

## Loading unpacked

1. `chrome://extensions` → Developer mode → **Load unpacked** → select this `extension/` folder.
2. Open **extension options**; confirm bridge URL and session token (or rely on bootstrap with the app running).
3. Optional: extension toolbar → right-click → **Reload extension** (context menu) after code changes.

## Related repo docs

- `docs/milestone-3-chrome-extension-architecture.md` — product/architecture context for M3.
- `docs/vijia_guide_mode_milestone_2.md` — Guide Mode product brief.
- Electron implementation: `src/main/browserBridge.ts` (`/extension/bootstrap`, `handshake`, `capture`, **`/extension/guide-plan`**, health).
