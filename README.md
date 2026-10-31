# drag-search.user.js

Tampermonkey userscript: drag a link or image to open it in a new tab, or drag
selected text to search it. The drag direction picks the search engine.

It adds nothing to the page except its settings dialog, and only while you
have the dialog open. It never talks to any server except the tab it opens.
Tampermonkey checks this repository for updates.

I made this after Super Drag introduced a Pro version, as a simple
alternative that stays free forever.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Turn on "Allow User Scripts" on Tampermonkey's extension details page
   (`chrome://extensions`). Recent Chrome runs no userscripts without it.
3. Open
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
- Drops into input fields and drags of the page's own `draggable="true"`
  widgets behave as usual.
- Drags shorter than 10px are ignored.

To change what each direction searches, open the Tampermonkey menu and choose
**Settings**. Each direction can use Google, Google Images, YouTube, Google
Translate, Wikipedia, a custom URL in which `%s` becomes the dragged text, or
None to ignore text dragged that way. The dialog opens on the current page,
which can read a custom URL you select there, so keep private tokens out of
custom URLs.

## Development

```sh
pnpm install
pnpm test
pnpm lint
```

## License

MIT
