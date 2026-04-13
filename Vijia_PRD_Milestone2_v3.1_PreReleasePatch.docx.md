**Vijia**

Product Requirements Document

**Milestone 2 · Pre-Release Patch**

*v3.1  ·  April 2026*


| Stack         | Electron 30+ · React 18 · TypeScript 5 · Vite                    |
| ------------- | ---------------------------------------------------------------- |
| **Base PRD**  | VijiaPRDMilestone2v3.docx                                        |
| **Type**      | Pre-release bug-fix patch — 6 issues blocking milestone sign-off |
| **Target OS** | macOS and/or Windows                                             |
| **Status**    | **Blocking milestone release — fix before sign-off**             |


# **1  Overview**

This patch document captures six pre-release issues identified during QA of Milestone 2 (Floating Notification System). All six issues are blocking — the milestone will not be signed off until each is resolved.

Refer to VijiaPRDMilestone2v3.docx for the full functional specification. This document amends and supersedes the relevant sections of that base PRD. Where this document is silent, the base PRD requirements apply unchanged.

## **1.1  Issue Summary**


|     | ID         | Issue                                                                                                                                             | FR Ref        | Severity     |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ |
| 1   | **BUG-01** | Overlay window loses always-on-top when switching apps or taking a screenshot                                                                     | FR-01         | **Critical** |
| 2   | **BUG-02** | Circle does not act as a clean toggle — second click does not collapse prompt bar and notification hub together                                   | FR-01 / FR-04 | **High**     |
| 3   | **BUG-03** | Notification area is not a fixed-height container; notifications overflow rather than scrolling within a bounded hub                              | FR-02         | **High**     |
| 4   | **BUG-04** | Scrolling the notification hub only reveals the top 2 notifications, not the full history                                                         | FR-02 / FR-03 | **High**     |
| 5   | **BUG-05** | Hovering on a notification erroneously triggers the prompt bar to open                                                                            | FR-04         | **High**     |
| 6   | **BUG-06** | Click-through is not reinstated after notifications fully fade; clicks in the faded notification area still do not pass through to the app behind | FR-01 / FR-03 | **High**     |


# **2  Visual Context**

The screenshot below, supplied by QA, shows the Vijia overlay rendering at the top of the screen. The correct anchor is the bottom-right corner (per State 1 mockup in the base PRD). Investigate whether a window-positioning regression or a display-bounds calculation error is responsible, and restore the correct anchor as part of BUG-01 remediation.



Figure 1 — Overlay incorrectly anchored at screen top instead of bottom-right corner

# **3  Amended Functional Requirements**

The following requirements amend the base PRD. Each entry identifies the original FR it modifies or replaces. Requirements not listed here are unchanged.


| Requirement                                                                  | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-01-P** **Always-On-Top Window (Patch)** **UPDATED**                     | Set alwaysOnTop: true with level 'screen-saver' (macOS) or 'floating' (Windows) when creating the overlay BrowserWindow. The overlay must remain above all other application windows at all times — including during screenshot capture, Mission Control activation, app-switcher usage (Cmd+Tab / Alt+Tab), and fullscreen transitions. Verify window position is anchored to the bottom-right corner of the primary display using screen.getPrimaryDisplay().workAreaSize; restore this anchor if a regression is found (see §2). Acceptance: open 5 different applications in sequence; the overlay must remain on top throughout. Take a screenshot — the overlay must remain on top.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **FR-02-P** **Circle Toggle — Open / Close Everything** **UPDATED**          | The circle is a single, stateless toggle: one click opens, the next click closes. No other gesture opens or closes the UI. First click (open): display the prompt bar AND the notification hub simultaneously. Second click (close): hide the prompt bar AND the notification hub simultaneously. The screen shows only the circle. Clicking the circle while the UI is open must close both components in a single interaction — no partial states. Hovering over any part of the overlay (circle, notifications, prompt bar) must NOT open or close either component. Acceptance: click circle → UI opens; click circle again → UI closes completely; only the circle remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **FR-03-P** **Fixed-Height Notification Hub** **UPDATED**                    | Replace the unbounded notification stack with a fixed-height scrollable container (the 'hub') anchored directly above the circle. The hub height is fixed in pixels (recommended: 360–480 px; exact value TBD with designer). It does not grow beyond this bound regardless of how many notifications exist. Notifications are NOT truncated. Each card renders at its natural height. If all current cards fit within the hub, the hub fills only to that height. A maximum of 3 notifications are visible in the hub viewport simultaneously. If fewer than 3 fit (due to tall cards), show however many fit without cutting any card off. If more than 3 notifications exist, older ones are hidden above the visible viewport. The user can scroll UP inside the hub to reveal them. Scroll behaviour: the hub scrolls only when the cursor is hovering inside it. Scrolling does not affect the rest of the overlay. The most recent notification always appears at the bottom of the hub; older notifications stack upward. Auto-fade (FR-03) applies to the hub as a whole: 3 s after mouse leaves, the entire hub fades to opacity 0 |
| **FR-04-P** **Full Notification History on Scroll** **UPDATED**              | Scrolling upward inside the notification hub must reveal ALL past notifications stored in history — not just the 2 currently visible. The hub must render all retained notifications (up to the 50-notification limit from FR-05) as scrollable content, with the oldest at the top. Faded notifications that become visible via scroll must render at their faded opacity (≈30%). Hovering individually unfades them. Scroll position is preserved while the hub is open; it resets to the bottom (most-recent) position each time the hub is re-opened via circle click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **FR-05-P** **Prompt Bar — Circle-Only Trigger** **UPDATED**                 | The prompt bar opens ONLY when the user clicks the circle (FR-02-P toggle). Hovering over notifications, scrolling the hub, or any interaction with notification cards must NOT open the prompt bar. The prompt bar sits below the notification hub and above the circle (base PRD State 2 layout). The prompt bar closes when: (a) the user clicks the circle again, or (b) the user presses Escape. No other interaction closes or opens the prompt bar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **FR-06-P** **Pixel-Precise Click-Through for Notification Hub** **UPDATED** | When notifications are visible (opacity 0), the notification hub area blocks click-through within the exact rendered bounding rect of each card — clicks on any visible card are captured by Vijia. Clicks in the gaps between cards, outside card bounds, and outside the hub container pass through to the app behind — identical to the pixel-precise circle behaviour already implemented. When ALL notifications have fully faded (opacity 0, after ≥3 s mouse-away), the entire hub area reverts to full click-through. This matches the click-through state when no notifications exist. The setIgnoreMouseEvents hit-detection loop (§6 of base PRD) must account for the faded state: if opacity 0, exclude hub rects from the active interactive region. Dynamic resizing (FR-01 §6.3) must fire whenever fade state changes, not only when cards are added or removed.                                                                                                                                                                                                                                                            |


# **4  IPC Contract Amendments**

The following additions to the IPC contract are required by the amended requirements above. All existing channels from the base PRD remain unchanged.


| Channel                  | Direction       | Payload            | Description                                                                                                                       |
| ------------------------ | --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **vijia:overlay-toggle** | Renderer → Main | { open: boolean }  | Renderer notifies main of the current open/closed state of the overlay UI on each circle click.                                   |
| **vijia:fade-state**     | Renderer → Main | { faded: boolean } | Renderer signals when notification hub transitions to/from fully-faded state so main can adjust setIgnoreMouseEvents accordingly. |


# **5  Acceptance Criteria (Patch)**

The following criteria supplement the base AC table. AC-01 through AC-16 from the base PRD remain in force. All criteria below must pass on macOS and/or Windows before the milestone is signed off.


| ID         | Test                                             | Acceptance Scenario                                                 |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| **AC-P01** | **Always-on-top retained** **UPDATED**           | Given any external application gains focus OR a screenshot is taken |
| **AC-P02** | **Overlay anchored bottom-right** **UPDATED**    | Given the overlay initialises                                       |
| **AC-P03** | **Circle toggle — open** **UPDATED**             | Given the UI is closed                                              |
| **AC-P04** | **Circle toggle — close** **UPDATED**            | Given the UI is open                                                |
| **AC-P05** | **Notification hub fixed height** **UPDATED**    | Given more than 3 notifications exist                               |
| **AC-P06** | **Scroll reveals full history** **UPDATED**      | Given 10 notifications have been received                           |
| **AC-P07** | **Prompt bar — hover does not open** **UPDATED** | Given the UI is closed                                              |
| **AC-P08** | **Prompt bar — circle-only trigger** **UPDATED** | Given the UI is open                                                |
| **AC-P09** | **Click-through on faded hub** **UPDATED**       | Given all notifications have faded (3 s mouse-away)                 |
| **AC-P10** | **Click capture on visible cards** **UPDATED**   | Given a notification is visible (opacity 0                          |
| **AC-P11** | **Dynamic zone — fade transition** **NEW**       | Given notifications transition from visible to fully faded          |


# **6  Implementation Notes**

## **6.1  Always-On-Top Level**

Electron exposes a level parameter to BrowserWindow.setAlwaysOnTop(). Use the following platform-specific values:

- macOS: win.setAlwaysOnTop(true, 'screen-saver') — this level sits above the Dock, Mission Control, and screenshot overlays.
- Windows: win.setAlwaysOnTop(true, 'floating') — equivalent Windows API level.
- Verify the level is re-applied after any show() or BrowserWindow state restore; some Electron versions reset the level on hide/show.

## **6.2  Toggle State Management**

Maintain a single boolean isOpen in the React overlay root (Overlay.tsx). The circle's onClick handler flips this flag. Both NotificationHub and PromptBox receive isOpen as a prop and render only when it is true. No other component or event handler may mutate isOpen.

## **6.3  Notification Hub Architecture**

Replace the existing NotificationStack component with a NotificationHub component:

- Outer container: position absolute, fixed height (CSS variable -hub-height), overflow-y: hidden, anchored above PromptBox.
- Inner scroller: height 100%, overflow-y: auto, display flex, flex-direction column-reverse (most-recent at bottom). Apply overflow-y: scroll only on hover to avoid permanent scrollbar.
- Each NotificationCard renders at its natural height with no max-height or text truncation.
- The hub passes scroll container ref to useHitDetection so bounding rect calculations include the full visible card set.

## **6.4  Fade-State Click-Through**

Add a isFaded boolean to the overlay state, set to true when the auto-fade timer fires (3 s mouse-away) and false on any mouse-enter. The useHitDetection hook must:

- Exclude hub bounding rects from interactive regions when isFaded == true.
- Emit vijia:fade-state { faded: true/false } to main process on each transition so setIgnoreMouseEvents is updated immediately — not deferred to the next mousemove event.

# **7  Out of Scope (Unchanged)**

The following remain out of scope from the base PRD and are not affected by this patch:

- Notification persistence across app restarts
- Remote or cloud delivery of notifications
- Custom notification sounds or OS notification centre integration
- Multi-monitor awareness
- UI visual polish — designer will handle colours, typography, and final assets
- Installer or packaged build

# **8  Sign-Off Checklist**

Milestone 2 will be released when all of the following are checked:


|       | Item                                                              | Status  |
| ----- | ----------------------------------------------------------------- | ------- |
| **☐** | AC-01 through AC-16 (base PRD) all pass                           | Pending |
| **☐** | AC-P01 through AC-P11 (this patch) all pass                       | Pending |
| **☐** | npx tsc -noEmit completes with zero errors                        | Pending |
| **☐** | Overlay anchored to bottom-right corner on both macOS and Windows | Pending |
| **☐** | Circle toggle closes both prompt bar and hub with a single click  | Pending |
| **☐** | Notification hub scrolls to reveal full history                   | Pending |
| **☐** | Prompt bar does not open on notification hover                    | Pending |
| **☐** | Click-through restored after full fade                            | Pending |


