# Vijia

System tray mini-app built with **Electron** (v30+), **React 18**, and **TypeScript 5**. The main window is a small SPA with four tabs; the app stays running in the tray until **Quit**.

## Requirements

- Node.js 18+ and npm

## Setup

```bash
npm install
```

`npm install` adds the [ScreenPipe](https://github.com/mediar-ai/screenpipe) CLI as a dev dependency (used for Guide Mode `screen_text_match`).

## Development

```bash
npm run dev
```

This starts **ScreenPipe** (if it is not already running on `http://127.0.0.1:3030`), then the Vite dev server and Electron. A tray icon appears; use **Open Vijia** from the context menu to show the window.

On first run, macOS may prompt for **Screen Recording** — allow it for Guide Mode screen detection. Dev auto-start uses fast screen capture intervals and `--disable-audio`.

| Command | Purpose |
|---------|---------|
| `npm run dev` | ScreenPipe + Electron (default) |
| `npm run dev:app` | Electron only (no ScreenPipe) |
| `npm run screenpipe` | ScreenPipe recorder only |
| `npm run screenpipe:token` | Print API token for `.env` (`VIJIA_SCREENPIPE_API_KEY`) |

To skip auto-starting ScreenPipe: `VIJIA_SKIP_SCREENPIPE=1 npm run dev`

Copy `.env.example` to `.env` and set Supabase keys; add `VIJIA_SCREENPIPE_API_KEY` if ScreenPipe API auth is enabled.

## Production build

```bash
npm run build
npm run preview
```

**Client / QA local run (built app + ScreenPipe + extension):** see [docs/local-client-setup.md](docs/local-client-setup.md).

## Typecheck

```bash
npm run typecheck
```

(`npx tsc --noEmit` — must pass with zero errors for submission.)

## Behavior notes

- **Close (×)** hides the window; the process keeps running. Use **Quit** in the tray menu to exit.
- **Open Vijia** shows or focuses the single main window and selects the **Home** tab (initial load uses `?tab=home` in the dev URL).
- Deep link: load with `?tab=subscription` (or `home` | `context` | `settings`) to set the initial tab. IPC `open-window` from the main process overrides the active tab when the window is already open.
- Optional: `openWindowWithTab` is exported from the main-process tray module for manual testing of tab routing.

## Platform

Tested workflows are intended to work on **Windows** and **macOS** (e.g. Dock hides when the window is hidden on macOS).
# vija-electron
