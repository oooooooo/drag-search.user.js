# drag-search.user.js

Tampermonkey userscript: drag a link or image to open it in a new tab, or drag
selected text to search it. The drag direction picks the search engine.

It never writes to the page and never talks to any server except the tab it
opens. Tampermonkey checks this repository for updates.

I made this after Super Drag introduced a Pro version, as a simple
alternative that stays free forever.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Open
   [drag-search.user.js](https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js)
   and click Install.

## Usage

Each drop opens a background tab:

| Drag                   | Opens           |
| ---------------------- | --------------- |
| A link or image        | Its URL         |
| Text that is a web URL | The URL         |
| Other selected text    | A search for it |

Selected text is searched by the direction you drag it:

| Direction | Search                                   |
| --------- | ---------------------------------------- |
| Right     | Google                                   |
| Left      | Google Translate (into browser language) |
| Up        | Wikipedia (in browser language)          |
| Down      | Google Images                            |

- Hold Shift when dropping to open the tab in the foreground.
- Drops into input fields, drops the page handles itself, and drags of the
  page's own `draggable="true"` widgets behave as usual.
- Drags shorter than 10px are ignored.

To pick another engine for a direction, edit `DIRECTIONS` at the top of the
script. Engines are `google`, `images`, `youtube`, `translate`, and
`wikipedia`; add more to `ENGINES`. Set a direction to `null` to ignore text
dragged that way.

## Development

```sh
pnpm install
pnpm test
pnpm lint
```

## License

MIT
