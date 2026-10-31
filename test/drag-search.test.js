import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
	new URL("../drag-search.user.js", import.meta.url),
	"utf8",
);

const PAGE = `<!doctype html><body>
	<p id="text">hello world</p>
	<a id="link" href="https://example.com/a">a</a>
	<a id="script-link" href="javascript:alert(1)">x</a>
	<div id="widget" draggable="true">drag me</div>
	<textarea id="editor"></textarea>
	<div id="zone"></div>
</body>`;

// Like an Atom feed: elements outside the HTML namespace.
const XML_PAGE = `<feed>
	<a id="link" href="https://example.com/a">a</a>
	<zone id="zone"/>
</feed>`;

// Replaces the DIRECTIONS setting, as a user would by editing the script.
function withDirections(directions) {
	const pattern = /const DIRECTIONS = \{[^}]*\};/;
	expect(source).toMatch(pattern);
	return source.replace(
		pattern,
		`const DIRECTIONS = ${JSON.stringify(directions)};`,
	);
}

function setup({
	contentType = "text/html",
	language = "en-US",
	script = source,
} = {}) {
	const markup = contentType === "text/html" ? PAGE : XML_PAGE;
	const dom = new JSDOM(markup, {
		url: "https://page.test/",
		contentType,
		runScripts: "outside-only",
	});
	Object.defineProperty(dom.window.navigator, "language", {
		value: language,
	});
	const GM_openInTab = vi.fn();
	dom.window.GM_openInTab = GM_openInTab;
	dom.window.eval(script);
	return { dom, document: dom.window.document, GM_openInTab };
}

function dataTransfer(data) {
	return { getData: (type) => data[type] ?? "", dropEffect: "none" };
}

function fire(document, target, type, props = {}) {
	const event = new document.defaultView.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.assign(event, { clientX: 0, clientY: 0, shiftKey: false });
	for (const [key, value] of Object.entries(props)) {
		Object.defineProperty(event, key, { value });
	}
	target.dispatchEvent(event);
	return event;
}

// Simulates a whole drag: start on `from`, hover and drop on `to`.
// `move` is how far the pointer travels; screen y grows downward.
function drag(
	document,
	from,
	to,
	{ data, move = { x: 100, y: 0 }, shiftKey = false } = {},
) {
	const transfer = dataTransfer(data);
	fire(document, from, "dragstart", { dataTransfer: transfer });
	const point = { clientX: move.x, clientY: move.y, dataTransfer: transfer };
	const dragover = fire(document, to, "dragover", point);
	const drop = fire(document, to, "drop", { ...point, shiftKey });
	fire(document, from, "dragend", { dataTransfer: transfer });
	return { dragover, drop };
}

const byId = (document, id) => document.getElementById(id);

const header = (key) =>
	source.match(new RegExp(`^// @${key}\\s+(.+)$`, "m"))?.[1];

describe("drag-search.user.js", () => {
	it("installs and updates from the GitHub repository", () => {
		const raw =
			"https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js";

		expect(header("downloadURL")).toBe(raw);
		expect(header("updateURL")).toBe(raw);
		expect(header("homepageURL")).toBe(
			"https://github.com/oooooooo/drag-search.user.js",
		);
	});

	it("opens a dragged link in a background tab", () => {
		const { document, GM_openInTab } = setup();
		const link = byId(document, "link");

		const { dragover, drop } = drag(document, link, byId(document, "zone"), {
			data: {
				"text/uri-list": "https://example.com/a",
				"text/plain": "https://example.com/a",
			},
		});

		expect(dragover.defaultPrevented).toBe(true);
		expect(drop.defaultPrevented).toBe(true);
		expect(GM_openInTab).toHaveBeenCalledWith("https://example.com/a", {
			active: false,
			insert: true,
		});
	});

	it("opens the tab in the foreground when Shift is held on drop", () => {
		const { document, GM_openInTab } = setup();

		drag(document, byId(document, "link"), byId(document, "zone"), {
			data: { "text/uri-list": "https://example.com/a" },
			shiftKey: true,
		});

		expect(GM_openInTab).toHaveBeenCalledWith("https://example.com/a", {
			active: true,
			insert: true,
		});
	});

	it.each([
		["right", { x: 100, y: 0 }, "https://www.google.com/search?q=cat"],
		[
			"left",
			{ x: -100, y: 0 },
			"https://translate.google.com/?sl=auto&tl=en&op=translate&text=cat",
		],
		[
			"up",
			{ x: 0, y: -100 },
			"https://en.wikipedia.org/w/index.php?search=cat",
		],
		["down", { x: 0, y: 100 }, "https://www.google.com/search?udm=2&q=cat"],
		[
			"mostly up",
			{ x: 40, y: -100 },
			"https://en.wikipedia.org/w/index.php?search=cat",
		],
	])(
		"searches text dragged %s with that direction's engine",
		(_, move, url) => {
			const { document, GM_openInTab } = setup();

			drag(document, byId(document, "text"), byId(document, "zone"), {
				data: { "text/plain": "cat" },
				move,
			});

			expect(GM_openInTab).toHaveBeenCalledWith(url, {
				active: false,
				insert: true,
			});
		},
	);

	it.each([
		["fr-FR", "fr", "fr"],
		["ja", "ja", "ja"],
		["zh-TW", "zh-TW", "zh"],
		["zh-Hant-HK", "zh-TW", "zh"],
		["zh-CN", "zh-CN", "zh"],
		["nb-NO", "no", "no"],
	])(
		"translates into and searches the Wikipedia of the browser language %s",
		(language, translate, wikipedia) => {
			const { document, GM_openInTab } = setup({ language });
			const text = byId(document, "text");
			const zone = byId(document, "zone");

			drag(document, text, zone, {
				data: { "text/plain": "cat" },
				move: { x: -100, y: 0 },
			});
			drag(document, text, zone, {
				data: { "text/plain": "cat" },
				move: { x: 0, y: -100 },
			});

			expect(GM_openInTab.mock.calls.map(([url]) => url)).toEqual([
				`https://translate.google.com/?sl=auto&tl=${translate}&op=translate&text=cat`,
				`https://${wikipedia}.wikipedia.org/w/index.php?search=cat`,
			]);
		},
	);

	it("lets the user pick the engine for each direction", () => {
		const script = withDirections({
			right: "wikipedia",
			left: "youtube",
			up: "google",
			down: "translate",
		});
		const { document, GM_openInTab } = setup({ script });

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "cat" },
			move: { x: -100, y: 0 },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://www.youtube.com/results?search_query=cat",
			{ active: false, insert: true },
		);
	});

	it("ignores text dragged in a direction set to null, but still opens links", () => {
		const script = withDirections({
			right: "google",
			left: null,
			up: "wikipedia",
			down: "images",
		});
		const { document, GM_openInTab } = setup({ script });
		const zone = byId(document, "zone");
		const left = { x: -100, y: 0 };

		const { drop } = drag(document, byId(document, "text"), zone, {
			data: { "text/plain": "cat" },
			move: left,
		});
		drag(document, byId(document, "link"), zone, {
			data: { "text/uri-list": "https://example.com/a" },
			move: left,
		});

		expect(drop.defaultPrevented).toBe(true);
		expect(GM_openInTab.mock.calls.map(([url]) => url)).toEqual([
			"https://example.com/a",
		]);
	});

	it("opens a dragged link whichever way it is dragged", () => {
		const { document, GM_openInTab } = setup();

		drag(document, byId(document, "link"), byId(document, "zone"), {
			data: { "text/uri-list": "https://example.com/a" },
			move: { x: -100, y: 0 },
		});

		expect(GM_openInTab).toHaveBeenCalledWith("https://example.com/a", {
			active: false,
			insert: true,
		});
	});

	it("searches Google for dragged text", () => {
		const { document, GM_openInTab } = setup();
		const text = byId(document, "text").firstChild;

		drag(document, text, byId(document, "zone"), {
			data: { "text/plain": "  hello & world\n" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://www.google.com/search?q=hello%20%26%20world",
			{ active: false, insert: true },
		);
	});

	it("opens dragged text that is an http(s) URL instead of searching it", () => {
		const { document, GM_openInTab } = setup();

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "https://example.com/b" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith("https://example.com/b", {
			active: false,
			insert: true,
		});
	});

	it("never opens a javascript: link, and keeps the page from navigating", () => {
		const { document, GM_openInTab } = setup();

		const { drop } = drag(
			document,
			byId(document, "script-link"),
			byId(document, "zone"),
			{
				data: {
					"text/uri-list": "javascript:alert(1)",
					"text/plain": "javascript:alert(1)",
				},
			},
		);

		expect(drop.defaultPrevented).toBe(true);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("ignores a drop that lands close to where the drag started", () => {
		const { document, GM_openInTab } = setup();

		const { drop } = drag(
			document,
			byId(document, "link"),
			byId(document, "zone"),
			{
				data: { "text/uri-list": "https://example.com/a" },
				move: { x: 5, y: 0 },
			},
		);

		expect(drop.defaultPrevented).toBe(true);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves drops into editable fields to the browser", () => {
		const { document, GM_openInTab } = setup();

		const { dragover, drop } = drag(
			document,
			byId(document, "text"),
			byId(document, "editor"),
			{ data: { "text/plain": "hello" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(drop.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	// Like Gemini, whose file upload drop zone covers the whole chat and
	// takes every drop, even text dragged within the page.
	it("searches text dropped on a page-wide drop zone that takes every drop", () => {
		const { document, GM_openInTab } = setup();
		const zone = byId(document, "zone");
		for (const type of ["dragover", "drop"]) {
			zone.addEventListener(type, (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
		}

		drag(document, byId(document, "text"), zone, {
			data: { "text/plain": "cat" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://www.google.com/search?q=cat",
			{ active: false, insert: true },
		);
	});

	it("leaves the page's own draggable widgets alone", () => {
		const { document, GM_openInTab } = setup();

		const { dragover } = drag(
			document,
			byId(document, "widget"),
			byId(document, "zone"),
			{ data: { "text/plain": "drag me" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves drags that come from outside the page alone", () => {
		const { document, GM_openInTab } = setup();
		const zone = byId(document, "zone");
		const transfer = dataTransfer({ "text/plain": "outside" });

		const dragover = fire(document, zone, "dragover", {
			dataTransfer: transfer,
			clientX: 100,
		});
		fire(document, zone, "drop", { dataTransfer: transfer, clientX: 100 });

		expect(dragover.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("does not write anything into the page, even on XML pages", () => {
		const { document } = setup({ contentType: "text/xml" });
		const before = document.documentElement.outerHTML;

		drag(document, byId(document, "link"), byId(document, "zone"), {
			data: { "text/uri-list": "https://example.com/a" },
		});

		expect(document.documentElement.outerHTML).toBe(before);
	});

	it("reports a failure to open a tab as an RFC 9457 problem", () => {
		const { document, GM_openInTab, dom } = setup();
		GM_openInTab.mockImplementation(() => {
			throw new Error("blocked");
		});
		const consoleError = vi
			.spyOn(dom.window.console, "error")
			.mockImplementation(() => {});

		drag(document, byId(document, "link"), byId(document, "zone"), {
			data: { "text/uri-list": "https://example.com/a" },
		});

		const [problem] = consoleError.mock.calls[0];
		expect(problem).toMatchObject({
			type: "urn:drag-search:open-tab-failed",
			title: "Failed to open a tab",
		});
		expect(problem.detail).toContain("drag-search.user.js");
		expect(problem.detail).toContain("blocked");
	});
});
