# Vijia — Guide Mode  
## Milestone 2 Product Brief

**From:** Lucas  
**To:** Pushpak  
**Date:** April 28, 2026  

---

# Product Direction Pivot

Vijia is pivoting away from pattern synthesis and morning briefings. Guide Mode is now the core product. The Chrome extension will walk users through tasks step by step while watching their browser.

Everything related to pattern synthesis and session lifecycle is dropped from this milestone.

---

# How Guide Mode Works

The user experience flows as follows:

1. User clicks the Vijia extension icon in the Chrome toolbar.
2. A circle UI opens with a text input: `"What do you want to do?"`
3. User types a goal  
   - Example: `"Help me set up an Obsidian vault"`
   - Example: `"Help me create a Shopify store"`
4. Vijia sends that goal to `claude-proxy`.
5. Claude generates a step-by-step plan as a JSON array.
6. Steps appear in the sidebar one at a time.
7. The current step is highlighted.
8. When a step is complete, Vijia detects it and auto-advances to the next step.

---

# Step Detection (v1)

Two detection modes only:

- No pixel matching
- No screenshot comparison
- No Gemini visual confirmation

## `url_match`

- The step includes a URL pattern to match against.
- Extension watches the active tab's URL using `chrome.tabs.onUpdated`.
- Example:
  - Step says: `"Go to supabase.com"`
  - When the user navigates there, the step auto-advances instantly.

## `manual_advance`

Used for steps that cannot be detected by URL:

- Filling a form
- Clicking a button
- Copying text

The user clicks a `"Done"` or checkmark button in the sidebar to advance manually.

---

# Sidebar UI

The sidebar should contain:

- Goal at the top (what the user asked for)
- Progress indicator  
  - Example: `Step 3 of 8`
- Current step instruction in large text
- `"Done"` button for `manual_advance` steps
  - Hidden for `url_match` steps
- Completed steps shown above with checkmarks
  - Collapsed to one line each
- `"Stop Guide"` button to exit at any time

When a step auto-advances:

- Show a brief checkmark animation and transition
- No confetti
- No affirmations
- Just a check and move on

---

# Wrong Action Handling

## For `url_match` steps

If the user navigates to the wrong URL:

> "That's not quite right. You need to go to [correct destination]."

Rules:

- Do NOT block the user
- Only show a gentle correction

After **3 wrong navigations** on the same step:

> "Having trouble? You can skip this step or stop the guide."

Show:

- Skip button
- Stop button

---

# Claude Proxy Integration

Send the user's goal to `claude-proxy` with the flag:

```json
{
  "guide": true,
  "proactive": false,
  "messages": [
    {
      "role": "user",
      "content": "user's goal"
    }
  ],
  "max_tokens": 2048
}
```

Claude returns a JSON array of steps.

Each step contains:

- `instruction`
  - What to tell the user
- `detection_type`
  - `url_match` or `manual_advance`
- `match_value`
  - URL pattern or `null`

> Note: The prompt generating this JSON is Lucas's responsibility.  
> Pushpak only sends the goal and parses the response.

The `claude-proxy` Edge Function has already been updated by Lucas to handle the `guide: true` flag.

---

# Files to Create / Modify

## Chrome Extension

### New Files

- `sidebar.html`
- `sidebar.js`
  - (or popup equivalent)

### Modified Files

- `manifest.json`
  - Add `side_panel` or popup permissions
- `service-worker.js`
  - Handle guide mode state
  - Handle tab URL watching
- `content-script.js`
  - If needed for sidebar injection

---

## Electron App

### Modified Files

- `claude-proxy` Edge Function
- OR `src/shared/Api.ts`

Add support for:

```ts
guide: true
```

---

# Milestone Complete When

- User can type a goal and receive a step-by-step plan from Claude
- Steps display in the sidebar with progress tracking
- URL-based steps auto-advance when the user navigates correctly
- Manual steps advance on button click
- Wrong navigation shows a correction message
- 3 wrong navigations on same step offers Skip/Stop
- Guide can be stopped at any time
- All test instructions pass
