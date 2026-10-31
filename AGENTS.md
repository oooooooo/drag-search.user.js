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
- Do not talk to any server. Request no URL other than the tab being opened.
  Tampermonkey's own update check against `@updateURL` is the only exception.
- No license checks, paid features, analytics, or log uploads.
- No hint display while dragging (the user decided it is unnecessary).
- `@grant` is `GM_openInTab` only. So settings are constants edited in the
  script, not a settings UI.
- Work for anyone without configuration: language-specific engines follow
  `navigator.language`.

## Layout

```text
drag-search.user.js      The distributed userscript (one file, no build)
test/drag-search.test.js Evaluates the userscript in jsdom and replays drags
```

Settings at the top of `drag-search.user.js`:

- `DIRECTIONS`: the engine (a key of `ENGINES`) for each direction (`right` /
  `left` / `up` / `down`), or `null` to ignore text dragged that way
- `ENGINES`: search URLs. `%s` is replaced with the `encodeURIComponent`-ed
  text. `translate` and `wikipedia` embed the browser language
- `MIN_DISTANCE`: drags shorter than this (px) are ignored

## Development

1. `pnpm install`
2. Before changing behavior, add a test to `test/drag-search.test.js` and
   confirm it fails for the expected reason
3. After implementing, pass `pnpm test` and `pnpm lint`. If Markdown changed,
   also pass `pnpm dlx markdownlint-cli2 README.md AGENTS.md`
4. Confirm the tests fail when the implemented lines are removed
5. For distributed changes, bump `@version` in the header

The tests load the userscript with `JSDOM`'s `window.eval`, replace
`GM_openInTab` with `vi.fn()`, and set `navigator.language` (default `en-US`).
jsdom has no `DragEvent` or `DataTransfer`, so `fire()` dispatches an `Event`
with `dataTransfer`, `clientX`, `clientY`, and `shiftKey` attached. `drag()`
sends dragstart → dragover → drop → dragend in order. `withDirections()`
rewrites the `DIRECTIONS` literal in the source, as a user would.

jsdom cannot fully reproduce real drags. When changing drag handling, load the
userscript with `page.addInitScript` in Playwright's Chromium and drag with
`page.mouse` (the script is not in the repository).

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
- In recent Chrome, Tampermonkey runs scripts only after "Allow User Scripts"
  is turned on in the extension's details page

## Errors

When `GM_openInTab` throws, log an RFC 9457 object with `console.error`.
`type` is `urn:drag-search:<kind>`; `detail` holds the file name and
`error.stack`, which includes the line number.
