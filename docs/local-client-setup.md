# Vijia — local setup (built app)

Step-by-step guide for running a **production build** of Vijia on your machine (not the hot-reload dev server). Intended for QA, demos, and client validation on **macOS** or **Windows**.

---

## What you will run

| Piece | Role |
|-------|------|
| **Vijia (built)** | Tray app — `npm run build` then `npm run preview` |
| **ScreenPipe** | Local screen OCR API on `http://127.0.0.1:3030` — required for Guide Mode `screen_text_match` |
| **Chrome extension** | Browser bridge + Guide Mode side panel — load unpacked from `extension/` |

All three can run on one machine. Vijia and ScreenPipe are separate processes.

---

## 1. Prerequisites

- **Node.js 18+** and **npm** — [https://nodejs.org](https://nodejs.org)
- **Google Chrome** (for the extension)
- **Git** (to clone the repo), or a zip of the project from your team
- **Supabase keys** — your team should provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API in Supabase)

**macOS:** You will be asked for **Screen Recording** permission (ScreenPipe and/or system settings).

---

## 2. Get the project

```bash
git clone <your-repo-url> vija-electron
cd vija-electron
```

If you received a zip, unzip it and `cd` into the folder that contains `package.json`.

---

## 3. Configure environment

Copy the example env file and fill in Supabase (required for guides and AI features):

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**ScreenPipe API key (only if searches fail with “requires an API key”):**

1. Start ScreenPipe once (step 5 below).
2. Run:

   ```bash
   npm run screenpipe:token
   ```

3. Add the printed token to `.env`:

   ```env
   VIJIA_SCREENPIPE_API_KEY=sp-xxxxxxxx
   ```

4. **Rebuild** Vijia (step 4) so the key is included in the built app.

Optional:

```env
VIJIA_SCREENPIPE_URL=http://127.0.0.1:3030
VIJIA_DEBUG=1
```

Do not commit `.env` — it contains secrets.

---

## 4. Install dependencies and build Vijia

```bash
npm install
npm run build
```

- `npm install` also installs the ScreenPipe CLI used by `npm run screenpipe`.
- `npm run build` compiles the app to the `out/` folder.
- Env vars from `.env` are **baked in at build time**. If you change `.env` later, run `npm run build` again before `npm run preview`.

Optional check:

```bash
npm run typecheck
```

---

## 5. Start ScreenPipe (separate terminal)

Keep this terminal open while testing Vijia.

**Option A — project script (recommended, same tuning as the team uses):**

```bash
npm run screenpipe
```

**Option B — explicit CLI flags:**

```bash
npx screenpipe@latest record \
  --min-capture-interval-ms 100 \
  --idle-capture-interval-ms 3000 \
  --visual-check-interval-ms 1000 \
  --disable-audio
```

When prompted, allow **Screen Recording** on macOS.

Verify the API is up (optional):

```bash
curl -s http://127.0.0.1:3030/health
```

You should get a successful response. If you use an API key, add the header your team documents, or rely on Vijia’s configured `VIJIA_SCREENPIPE_API_KEY` after rebuild.

---

## 6. Run the built Vijia app

In a **second** terminal (ScreenPipe still running in the first):

```bash
cd vija-electron
npm run preview
```

This launches the **built** Electron app (not `npm run dev`).

- A **tray icon** appears.
- Use the tray menu → **Open Vijia** to show the window.
- **Quit** in the tray menu exits completely (closing the window only hides it).

If the console warns that ScreenPipe is unavailable, check step 5 and that nothing else is blocking port `3030`.

---

## 7. Install the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`extension`** folder inside the repo (e.g. `vija-electron/extension`)
5. With Vijia running (`npm run preview`), open the extension **Options**:
   - **Bridge URL:** `http://127.0.0.1:45731` (default unless your team changed the port)
   - **Session token:** leave empty to auto-fetch from Vijia, or paste the token from the app’s bridge config if provided

The extension toolbar badge should show **ON** (green) when connected.

---

## 8. Quick test checklist

| Step | Action | Expected |
|------|--------|----------|
| 1 | ScreenPipe terminal shows recording / API ready | `curl` health OK |
| 2 | `npm run preview` | Tray icon, window opens |
| 3 | Extension badge | Green **ON** |
| 4 | Extension side panel → enter a goal → **Start guide** | Plan loads (needs valid Supabase in `.env` + rebuild) |
| 5 | Follow a step that uses screen text | Step advances when matching text appears on screen |

---

## 9. Daily workflow (summary)

```text
Terminal 1:  npm run screenpipe
Terminal 2:  npm run preview
Chrome:      extension loaded; side panel for guides
```

After pulling new code or changing `.env`:

```bash
npm install
npm run build
npm run preview
```

---

## 10. Troubleshooting

| Problem | What to try |
|---------|-------------|
| Guide plan fails / Supabase errors | Confirm `.env` Supabase vars, then `npm run build` again |
| ScreenPipe unavailable | Start step 5 first; check port 3030; restart ScreenPipe |
| API key errors | `npm run screenpipe:token` → add `VIJIA_SCREENPIPE_API_KEY` → `npm run build` → `npm run preview` |
| Extension badge **OFF** | Vijia must be running; check bridge URL `http://127.0.0.1:45731` |
| `screen_text_match` never advances | ScreenPipe running + screen recording permission; try `VIJIA_DEBUG=1`, rebuild, watch main-process logs |
| Wrong ScreenPipe settings | Stop existing ScreenPipe, then use `npm run screenpipe` (project flags) |

**macOS permissions:** System Settings → Privacy & Security → Screen Recording → enable for Terminal (or iTerm) and/or ScreenPipe / Electron as applicable.

**Stop everything:** Quit Vijia from the tray; `Ctrl+C` in the ScreenPipe terminal.

---

## Dev vs built (reference)

| | Built (this guide) | Development |
|--|-------------------|-------------|
| Command | `npm run build` → `npm run preview` | `npm run dev` |
| ScreenPipe | You start manually (`npm run screenpipe`) | Started automatically unless `VIJIA_SKIP_SCREENPIPE=1` |
| Hot reload | No | Yes |

For engineers hacking on the repo, see the root [README.md](../README.md).
