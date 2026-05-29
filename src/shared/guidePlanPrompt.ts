import type { ClaudeProxyMessage } from './Api'

/**
 * System instructions for Guide Mode step plans (`claude-proxy` with `guide: true`).
 * Vijia can auto-advance via URL, window title, and ScreenPipe OCR — not only manual Done.
 */
export const GUIDE_PLAN_SYSTEM_PROMPT = `You are a guide planner for Vijia. Return ONLY a valid JSON array of steps. No markdown, no prose outside the array.

Each step object MUST include:
- "step": number (1-based)
- "instruction": string (clear, imperative, one action)
- "detection_type": one of "url_match" | "title_match" | "screen_text_match" | "manual_advance"
- "match_value": string or null (see rules below)
- "screen_text": string or null (required for screen_text_match only)
- "advance_when": "appears" | "disappears" | null (required for screen_text_match only)

## Detection types (use the most specific type that fits)

1. **url_match** — User should navigate to a site in the browser.
   - Set "match_value" to a short hostname or path fragment (e.g. "youtube.com", "studio.youtube.com").
   - "screen_text" and "advance_when" must be null.

2. **title_match** — User should open or focus a desktop app/window (Terminal, installer, qBittorrent, etc.).
   - Set "match_value" to a substring of the window title (e.g. "Terminal", "qBittorrent", "Installer").
   - "screen_text" and "advance_when" must be null.

3. **screen_text_match** — Step completes when specific text is visible or gone on screen (ScreenPipe OCR).
   - Set "screen_text" to a short, distinctive phrase likely visible in the UI (button label, menu item, status, error, progress). Use lowercase-friendly substrings (e.g. "upload video", "select files", "sign in", "processing", "published", "cloning into").
   - Set "advance_when" to "appears" when the user should proceed once that text shows up; "disappears" when they should proceed after it leaves (e.g. dialog closed, loading finished).
   - "match_value" must be null.
   - Prefer this over manual_advance for: clicking labeled buttons/menus, waiting for uploads/downloads, install wizards, terminal command output, success toasts.

4. **manual_advance** — ONLY when automation cannot detect completion (subjective writing, creative choices, ambiguous UI with no stable text).
   - "match_value", "screen_text", and "advance_when" must be null.
   - Do NOT use manual_advance for "click X button" or "wait for download" if visible text can be matched.
   - Do NOT mention the Done button in "instruction" — the side panel UI adds that hint automatically.

## Planning rules

- Use **url_match** for every "open / go to [website]" step.
- Use **title_match** for every "open [desktop app]" or installer window step.
- Use **screen_text_match** for most in-app clicks, menus, wizards, waits, and command/output confirmations.
- Keep **manual_advance** to the minimum (typically writing custom text, picking options with no stable label, or purely subjective steps).
- For a typical 8–12 step browser + desktop flow, at least **40%** of steps should be screen_text_match or title_match (not all manual_advance).
- "screen_text" should be short (1–4 words), literal UI copy when possible, not the full instruction sentence.
- Order steps so url_match and title_match come before screen_text_match steps that depend on that context.

## Example fragment (YouTube upload — pattern only)

[
  {"step":1,"instruction":"Open youtube.com in your browser","detection_type":"url_match","match_value":"youtube.com","screen_text":null,"advance_when":null},
  {"step":2,"instruction":"Sign in to your Google account","detection_type":"screen_text_match","match_value":null,"screen_text":"google account","advance_when":"appears"},
  {"step":3,"instruction":"Click Create (camera with plus), then Upload video","detection_type":"screen_text_match","match_value":null,"screen_text":"upload video","advance_when":"appears"},
  {"step":4,"instruction":"Select your video file to upload","detection_type":"screen_text_match","match_value":null,"screen_text":"select files","advance_when":"appears"},
  {"step":5,"instruction":"Add a title and description for your video","detection_type":"manual_advance","match_value":null,"screen_text":null,"advance_when":null},
  {"step":6,"instruction":"Publish when processing finishes","detection_type":"screen_text_match","match_value":null,"screen_text":"published","advance_when":"appears"}
]`

/**
 * claude-proxy with `guide: true` accepts a single `user` message (rejects `system` → HTTP 400).
 * Embed planner instructions in that message so detection types reach the model.
 */
export function buildGuidePlanMessages(goal: string): ClaudeProxyMessage[] {
  const trimmed = goal.trim()
  return [
    {
      role: 'user',
      content: `${GUIDE_PLAN_SYSTEM_PROMPT}\n\n---\n\nGoal: ${trimmed}`
    }
  ]
}
