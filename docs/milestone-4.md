# Vijia — Milestone 3 Brief

## Overview

Vijia guides people through complex multi-app tasks that AI agents can't do for you — things like installing and setting up developer tools, configuring apps, or building something across multiple programs. AI tells you what to do but can't sit next to you and watch you do it. Vijia can.

---

## What a Vijia Guide Session Looks Like

**Example prompt:** *"Help me set up OpenClaw on my Mac."*

Vijia generates a step plan and walks the user through it:

| Step | Instruction | Detection Type | Trigger |
|------|-------------|---------------|---------|
| 1 | Open browser → `github.com/mediar-ai/openclaw` | `url_match` | Navigates to URL |
| 2 | Scroll to Installation section in README | `manual_advance` | User clicks Done |
| 3 | Open Terminal (Cmd+Space → "Terminal") | `title_match` | Terminal window opens |
| 4 | Run: `git clone https://github.com/mediar-ai/openclaw.git` | `screen_text_match` | "Cloning into" appears on screen |
| 5 | Run: `cd openclaw && npm install` | `screen_text_match` | "added X packages" appears |
| 6 | Create `.env`: run `cp .env.example .env` | `manual_advance` | User clicks Done |
| 7 | Open Claude, paste prompt to configure API keys | `url_match` → `manual_advance` | Navigates to claude.ai |
| 8 | Run: `npm run dev` | `screen_text_match` | "ready" or "localhost" appears |
| 9 | Open `localhost:3000` in browser | `url_match` | Navigates to localhost:3000 |

> The guide crosses between browser, terminal, Claude, and back to browser — watching the screen to know when each step is complete.

---

## Milestone 3: ScreenPipe Integration

### The Problem

Guide Mode currently detects only:
- URL changes (browser)
- Window titles (desktop apps)

This isn't enough for steps like "run this command and wait for it to finish" or "click the Install button."

### The Solution: ScreenPipe

[ScreenPipe](https://github.com/mediar-ai/screenpipe) is an open-source tool that does **continuous screen capture + local OCR**. It runs as a background process and exposes a local API returning text currently visible on screen.

- No cloud calls — everything runs locally
- Under 500ms response time
- Privacy-first

---

## What to Build

### 1. New Detection Type: `screen_text_match`

Add a third detection type to Guide Mode alongside `url_match` and `manual_advance`:

```json
{
  "detection_type": "screen_text_match",
  "screen_text": "Installation Complete",
  "advance_when": "appears"
}
```

| `advance_when` | Behaviour |
|----------------|-----------|
| `"appears"` | Advance when text shows up (success message, command output, new page loaded) |
| `"disappears"` | Advance when text leaves the screen (button clicked, dialog closed) |

Poll ScreenPipe's local API every **300–500ms** and auto-advance when the condition is met.

### 2. New Detection Type: `title_match`

Poll the active window title every **200ms** using `node-active-window` (already installed). Auto-advance when the title contains the `match_value` string.

Handles steps like "Open Terminal," "Open Obsidian," "Open VS Code" instantly without ScreenPipe.

### Detection Priority in Guide Mode

1. `url_match` — browser URL via Chrome extension *(instant)*
2. `title_match` — window title via node-active-window *(instant)*
3. `screen_text_match` — screen content via ScreenPipe *(< 500ms)*
4. `manual_advance` — user clicks Done button *(fallback)*

---

## ScreenPipe Setup Requirements

- **On app startup:** Check if ScreenPipe is running by attempting to connect to its local API (typically `localhost:3030`)
- **If not running:** Show a message prompting the user to install it, with a link
- **During Guide Mode:** Read screen content from ScreenPipe's API
- **If unavailable:** Gracefully fall back to `manual_advance` for affected steps — don't crash

---

## Test Instructions

**Scenario:** *"Help me install Obsidian"*

1. Navigate to `obsidian.md` → auto-advance via `url_match`
2. Click Download → `screen_text_match` detects download started
3. Open installer → `title_match` detects "Obsidian Setup"
4. Click Install → `screen_text_match` detects "Installation Complete"
5. Every step should feel instant with no visible delay
6. Disconnect ScreenPipe → verify steps fall back to `manual_advance` buttons

---

## Milestone 3 Completion Criteria

- [ ] ScreenPipe integration reads screen content locally
- [ ] `screen_text_match` works for both `"appears"` and `"disappears"`
- [ ] `title_match` works via `node-active-window`
- [ ] All four detection types work together in a single guide
- [ ] Guide Mode feels instant across browser and desktop apps
- [ ] Graceful fallback when ScreenPipe isn't running
- [ ] All test instructions pass

---

## What Carries Over from Milestones 1 & 2

Everything built previously carries over directly — nothing is being rebuilt:

- Chrome extension & browser bridge
- Guide Mode sidebar
- URL matching & manual advance
- Claude integration with `guide: true`

Milestone 3 adds ScreenPipe and `title_match` **on top** of the existing foundation.

---

## Part B: Visual Identity Implementation

The full brand identity has been delivered by the designer. Assets are available here:
**[Google Drive — Brand Assets Folder](https://drive.google.com/drive/folders/1i4QBe8PXYG0suypjefh2mpM7Vv51TMws?usp=sharing)**

Contents: brandbook, logo files, IJI face character, institutional font, and color palette.

### Extension Icon

Replace the current blue "V" icon with the **IJI face character** using `chrome.action.setIcon()`:

| State | Appearance | Trigger |
|-------|-----------|---------|
| Sleeping | Eyes closed, purple smile | Extension idle |
| Awake | Eyes open, purple smile | Extension active |
| Glowing | Green ring around circle | Guide Mode running |

### Sidebar UI

Apply the brand to the Guide Mode sidebar:

- **Background:** Light lavender/purple (from brandbook) — not the current dark gradient
- **Typography:** Institutional font from brand assets
- **Colors:**
  - Purple tones for UI elements
  - Green accent for active/progress states
  - Dark charcoal for text
- **IJI face** at the top of the sidebar (replaces blue "V" circle)
- **Step completion checkmarks** in green
- **Notification bubbles** matching the dark rounded card style from brandbook mockups
- Support **light mode** (lavender background) and **dark mode** (dark charcoal background)

### Reference

All exact hex codes, font names, and usage guidelines are in the brandbook PDF. Target: the extension should look like Gabriel's mockups, not a generic dev tool.

| Element | Reference |
|---------|-----------|
| Sidebar / chat | Chat window mockups in brandbook (light & dark mode) |
| Icon states | Three circle states in brandbook |
| Notification bubbles | Floating message examples in brandbook |