---
name: browser-driving
description: "How to drive the signed-in Warden Chrome — WebFetch vs browser routing, form filling, data extraction, downloads, email attachments, and native desktop apps. Activate before any browse / fill-a-form / download / open-a-desktop-app task."
---

## WebFetch vs browser
- `WebFetch` READS a page server-side → clean Markdown, anonymous (no login/cookies). DEFAULT for "find / look up / what does this page say". If the DOM alone answers it, WebFetch + answer in reply, no browser.
- `browser_*` drives the real signed-in Chrome (CDP 9222) to DISPLAY or INTERACT (click/type/login/media). `browser_navigate` first — it returns title+URL, not a snapshot. `browser_snapshot` for clickable refs; `browser_evaluate` to read/extract data (the DOM path for lists/results, not snapshot loops). `browser_click`/`browser_press_key`/`browser_select_option`/`browser_hover` return the updated snapshot themselves when the page changes. Never use Bash to launch Chrome — that spawns a blank-profile Chrome and breaks sign-ins.

## Route by intent
- KNOW something → `WebFetch`, answer, no browser.
- SEE a page / watch media / DO something (form, login, click) → find the URL with `WebFetch`/`WebSearch`, then `browser_navigate` straight to it. Reuse the shared browser; don't pile up tabs.
- Needs the ACCOUNT (post/submit/message/inbox/profile/behind a login) → signed-in Chrome via `browser_navigate` ALWAYS. Never judge "am I logged in?" from a WebFetch result.
- SEE a LOCAL file (HTML/PDF/image you wrote or that exists) → `browser_navigate` with the file's ABSOLUTE path (opens as file://), then `browser_snapshot` to confirm. Use `open_app` only for a file that belongs in its OS-default app. A local server only when the page genuinely needs one (fetch/CORS/service workers) — serve the directory that actually contains the file, navigate to the exact URL, fix the root if 404.
- ALREADY on a page → `browser_current_url` + `browser_snapshot`, then act there instead of opening a new tab.
- About to FILL/SUBMIT a form → `browser_tabs` first; if the target page (or its /submit URL) is already open, switch to it.
- WebFetch empty/blocked → the page is probably JS-rendered; `browser_navigate` + `browser_snapshot`.

## Data extraction (results / marketplace / search lists)
Extract in ONE `browser_evaluate` (map title+link from the result elements) — never snapshot → click → snapshot loops, never re-navigate the same URL hoping it changes. Empty selector → `browser_wait_for` a beat, then a different selector or `browser_snapshot` refs. "did not visibly change" → switch method on the very next call; repeating the same click or Escape never helps.

## Form filling
CLICK + TYPE, not DOM fishing. Take `browser_snapshot` once, act on refs (`browser_click`/`browser_type`/`browser_press_key`/`browser_select_option`). Missing ref → fresh `browser_snapshot`. Fill a field by its STABLE name, not its ref — pass `selector` (e.g. `[aria-label="Post body text field"]`) or `label` to `browser_type` (refs go stale on re-render). Fill the whole field in ONE `browser_type` call. `browser_type` REPLACES a field's entire content. Rich-text editors are `<div contenteditable>` — `browser_type` fills them; never surgically edit inside one (execCommand/paste) — React/Lexical revert that.

## Downloads
`browser_download` saves any file a page offers (PDF link, export button, email attachment card) and returns the path; uses Chrome's own download so signed-in pages work. The only way to fetch a file — never fish bytes out of the DOM with `browser_evaluate`, and never report a file saved unless `browser_download` (or Bash) returned its path.

## Email
Reading/searching mail is iris's work — a task that wants mail content ends with "This is email work — it routes to the email specialist". Downloading a FILE a mail page offers is a download: `browser_download` it.

## Native desktop apps
- Fire-and-forget SHOW (open a PDF/folder, launch Stremio) → `open_app` (app "xdg-open" or the binary) with the absolute path.
- DRIVE (click/type/screenshot a desktop app) → if the task says a window is already open+focused, trust it and act directly with `desktop_type`/`desktop_click` at the stated coordinates — do NOT re-screenshot to "find" it. Only screenshot when the task does NOT say focused (you must locate it) or asks you to confirm. If the window isn't open, launch it with Bash, `desktop_screenshot` to see the screen, then `desktop_click`/`desktop_type`.
