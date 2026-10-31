# Drag Search (drag-search.user.js)

A userscript for Tampermonkey in Chrome. Dragging a link or image opens it in a
new tab; dragging selected text searches it with the engine assigned to the
drag direction.

## Language

- Write all code, comments, and documentation in English.
- Chat with the user may be in Japanese.

## Principles (do not change)

- Do not add elements or attributes to the page. Anything added can show up on
  screen (for example on XML pages) and lets page scripts detect the script.
  The only exception is the settings dialog, and only while the user has it
  open from the Tampermonkey menu: it is removed when closed.
- Do not talk to any server. Request no URL other than the tab being opened.
  Tampermonkey's own update check against `@updateURL` is the only exception.
- No license checks, paid features, analytics, or log uploads.
- No hint display while dragging (the user decided it is unnecessary).
- `@grant` is `GM_openInTab`, `GM_getValue`, `GM_setValue`, and
  `GM_registerMenuCommand` only. Settings are changed in a settings dialog
  opened from the Tampermonkey menu (the user chose this over editing
  constants because it is easier to use) and kept in Tampermonkey's storage.
- Work for anyone without configuration: language-specific engines follow
  `navigator.language`.

## Layout

```text
drag-search.user.js      The distributed userscript (one file, no build)
test/drag-search.test.js Evaluates the userscript in jsdom and replays drags
```

Constants at the top of `drag-search.user.js`:

- `DEFAULT_DIRECTIONS`: what searches text dragged in each direction (`right`
  / `left` / `up` / `down`) until the user changes it: a key of `ENGINES`, a
  custom http(s) URL containing `%s`, or `null` to ignore text dragged that way
- `ENGINES`: search URLs. `%s` is replaced with the `encodeURIComponent`-ed
  text. `translate` and `wikipedia` embed the browser language
- `MIN_DISTANCE`: drags shorter than this (px) are ignored

The settings dialog saves the same kind of value per direction with
`GM_setValue("directions", …)`. The script reads it on every drop, and falls
back to the default for any direction whose saved value is invalid.

## Development

1. `pnpm install`
2. Before changing behavior, add a test to `test/drag-search.test.js` and
   confirm it fails for the expected reason
3. After implementing, pass `pnpm test` and `pnpm lint`. If Markdown changed,
   also pass `pnpm dlx markdownlint-cli2 README.md AGENTS.md`
4. Confirm the tests fail when the implemented lines are removed
5. For distributed changes, bump `@version` in the header

The tests load the userscript with `JSDOM`'s `window.eval`, replace the `GM_*`
functions with `vi.fn()` (storage is an in-memory `Map`; `stored` presets
it), and set `navigator.language` (default `en-US`). jsdom has no `DragEvent`
or `DataTransfer`, so `fire()` dispatches an `Event` with `dataTransfer`,
`clientX`, `clientY`, and `shiftKey` attached. jsdom marks every dispatched
event untrusted and `isTrusted` cannot be overridden, so `trustFiredEvents()`
hands window listeners a proxy whose `isTrusted` is false only for events fired
with `{ trusted: false }`. `drag()` sends dragstart → dragover → drop → dragend
in order. The settings dialog is in a closed shadow root, so
`recordShadowRoots()` keeps every root as it is created; jsdom has no
`showModal()` on `<dialog>`, so `addDialogMethods()` adds one.
`openSettings()` runs the registered menu command as the user would.

jsdom cannot fully reproduce real drags. When changing drag handling, load the
userscript with `page.addInitScript` in Playwright's Chromium and drag with
`page.mouse` (the script is not in the repository). Playwright locators cannot
reach into closed shadow roots, so to drive the settings dialog, replace
`Element.prototype.attachShadow` in the init script with one that forces
`mode: "open"`.

## Verified facts (no need to re-check)

- Data Chrome passes on drop: links and images give `text/uri-list` and
  `text/plain`; selected text gives only `text/plain`
- Without `preventDefault()` on dragover, the browser refuses the drop
- If a drop accepted on dragover is not `preventDefault()`-ed on drop, the
  browser navigates the current tab to the dropped link
- On XML pages, `document.createElement("script")` creates an element with no
  namespace, which is not `display: none`, so its text shows on screen
- `https://<lang>.wikipedia.org/w/index.php?search=` redirects straight to the
  article when the text matches a title
- Wikipedia names Norwegian Bokmål `no`, not `nb`. Google Translate takes
  `zh-CN` / `zh-TW` for Chinese and the language subtag otherwise
- Gemini (`gemini.google.com`) covers the chat with a file drop zone that
  calls `preventDefault()` on every drop and `stopPropagation()` on dragenter,
  so the script listens on `window` in the capture phase
- The settings dialog shows and saves in Chrome on Gemini (Trusted Types,
  strict CSP) and on XML pages, because it is built with
  `createElementNS` in the XHTML namespace, `textContent`, and CSSOM styles,
  never `innerHTML` or style attributes
- Drag, key, input, clipboard, and composition events from the settings
  dialog reach the page as if from its host `div`, and some carry the typed,
  pasted, or dragged text. Stopping them on `window` while capturing still lets
  the field receive the text and Escape close the dialog. The script runs at
  `document-start`, before `<html>` exists, so this guard comes before every
  page listener, including capturing ones the page adds in `<head>`
- In recent Chrome, Tampermonkey runs scripts only after "Allow User Scripts"
  is turned on in the extension's details page

## Errors

When `GM_openInTab` throws, log an RFC 9457 object with `console.error`.
`type` is `urn:drag-search:<kind>`; `detail` holds the file name and
`error.stack`, which includes the line number.
