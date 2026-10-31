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
	<div id="plain-editor" contenteditable="plaintext-only">plain</div>
	<div id="upper-editor" contenteditable="TRUE">upper</div>
	<div id="shadow-host"></div>
	<div id="zone"></div>
</body>`;

// Like an Atom feed: elements outside the HTML namespace.
const XML_PAGE = `<feed>
	<a id="link" href="https://example.com/a">a</a>
	<zone id="zone"/>
</feed>`;

const XHTML = "http://www.w3.org/1999/xhtml";

function setup({
	contentType = "text/html",
	language = "en-US",
	stored = {},
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
	const storage = new Map(Object.entries(stored));
	const GM = {
		GM_openInTab: vi.fn(),
		GM_getValue: vi.fn((key, fallback) =>
			storage.has(key) ? structuredClone(storage.get(key)) : fallback,
		),
		GM_setValue: vi.fn((key, value) =>
			storage.set(key, structuredClone(value)),
		),
		GM_registerMenuCommand: vi.fn(),
	};
	Object.assign(dom.window, GM);
	trustFiredEvents(dom.window);
	const shadowRoots = recordShadowRoots(dom.window);
	addDialogMethods(dom.window);
	dom.window.eval(source);
	return { dom, document: dom.window.document, shadowRoots, ...GM };
}

// The settings dialog lives in a closed shadow root, which tests cannot reach
// through the host, so keep every shadow root as it is created.
function recordShadowRoots(window) {
	const roots = [];
	const { attachShadow } = window.Element.prototype;
	window.Element.prototype.attachShadow = function (init) {
		const root = attachShadow.call(this, init);
		roots.push(root);
		return root;
	};
	return roots;
}

// jsdom has no showModal() or close() on <dialog>.
function addDialogMethods(window) {
	Object.assign(window.HTMLDialogElement.prototype, {
		showModal() {
			this.setAttribute("open", "");
		},
		close() {
			this.removeAttribute("open");
			this.dispatchEvent(new window.Event("close"));
		},
	});
}

// Opens the settings from the Tampermonkey menu, as the user would.
function openSettings({ GM_registerMenuCommand, shadowRoots }) {
	const [, open] = GM_registerMenuCommand.mock.calls[0];
	open();
	const root = shadowRoots.at(-1);
	const button = (label) =>
		[...root.querySelectorAll("button")].find(
			(element) => element.textContent === label,
		);
	return {
		root,
		dialog: root.querySelector("dialog"),
		select: (direction) => root.querySelector(`select[name="${direction}"]`),
		urlInput: (direction) =>
			root.querySelector(`input[name="${direction}-url"]`),
		error: () => root.querySelector("[role=alert]").textContent,
		click: (label) => button(label).click(),
	};
}

function choose(element, value) {
	element.value = value;
	element.dispatchEvent(new element.ownerDocument.defaultView.Event("change"));
}

const DEFAULTS = {
	right: "google",
	left: "translate",
	up: "wikipedia",
	down: "images",
};

// Events a page script dispatches itself, as opposed to ones the browser
// dispatches for a real drag.
const untrusted = new WeakSet();

// jsdom marks every dispatched event untrusted and will not let tests change
// isTrusted, so window listeners see each event through a proxy whose
// isTrusted is false only for events fired with { trusted: false }.
function trustFiredEvents(window) {
	const addEventListener = window.addEventListener.bind(window);
	window.addEventListener = (type, listener, options) =>
		addEventListener(
			type,
			(event) =>
				listener(
					new Proxy(event, {
						get: (target, key) => {
							if (key === "isTrusted") return !untrusted.has(target);
							const value = target[key];
							return typeof value === "function" ? value.bind(target) : value;
						},
					}),
				),
			options,
		);
}

function dataTransfer(data) {
	return { getData: (type) => data[type] ?? "", dropEffect: "none" };
}

function fire(document, target, type, { trusted = true, ...props } = {}) {
	const event = new document.defaultView.Event(type, {
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	if (!trusted) untrusted.add(event);
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
	{ data, move = { x: 100, y: 0 }, shiftKey = false, trusted = true } = {},
) {
	const transfer = dataTransfer(data);
	fire(document, from, "dragstart", { dataTransfer: transfer, trusted });
	const point = {
		clientX: move.x,
		clientY: move.y,
		dataTransfer: transfer,
		trusted,
	};
	const dragover = fire(document, to, "dragover", point);
	const drop = fire(document, to, "drop", { ...point, shiftKey });
	fire(document, from, "dragend", { dataTransfer: transfer, trusted });
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

	// Listeners added at document-start come before any the page adds, so the
	// guard that hides the settings dialog's events from the page runs first.
	it("runs before the page's own scripts", () => {
		expect(header("run-at")).toBe("document-start");
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

	it("searches with the engine saved for a direction", () => {
		const { document, GM_openInTab } = setup({
			stored: { directions: { left: "youtube" } },
		});

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "cat" },
			move: { x: -100, y: 0 },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://www.youtube.com/results?search_query=cat",
			{ active: false, insert: true },
		);
	});

	it("ignores text dragged in a direction saved as none, but still opens links", () => {
		const { document, GM_openInTab } = setup({
			stored: { directions: { left: null } },
		});
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

	it("searches with a custom URL saved for a direction", () => {
		const { document, GM_openInTab } = setup({
			stored: { directions: { right: "https://duckduckgo.com/?q=%s" } },
		});

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "a b" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://duckduckgo.com/?q=a%20b",
			{ active: false, insert: true },
		);
	});

	it("puts the dragged text in every %s of a custom URL", () => {
		const { document, GM_openInTab } = setup({
			stored: {
				directions: { right: "https://example.com/?q=%s&highlight=%s" },
			},
		});

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "red cat" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://example.com/?q=red%20cat&highlight=red%20cat",
			{ active: false, insert: true },
		);
	});

	it.each([
		["an unknown engine", "bing"],
		["a URL without %s", "https://duckduckgo.com/"],
		["a URL that is not http(s)", "javascript:alert('%s')"],
		["a number", 42],
	])("falls back to the default engine when %s is saved", (_, saved) => {
		const { document, GM_openInTab } = setup({
			stored: { directions: { right: saved } },
		});

		drag(document, byId(document, "text"), byId(document, "zone"), {
			data: { "text/plain": "cat" },
		});

		expect(GM_openInTab).toHaveBeenCalledWith(
			"https://www.google.com/search?q=cat",
			{ active: false, insert: true },
		);
	});

	describe("settings dialog", () => {
		it("is opened from a Settings command in the Tampermonkey menu", () => {
			const context = setup();

			expect(context.GM_registerMenuCommand).toHaveBeenCalledWith(
				"Settings",
				expect.any(Function),
			);
			const { dialog } = openSettings(context);
			expect(dialog.hasAttribute("open")).toBe(true);
		});

		it("shows the saved setting of each direction", () => {
			const settings = openSettings(
				setup({
					stored: {
						directions: {
							left: "youtube",
							up: null,
							down: "https://duckduckgo.com/?q=%s",
						},
					},
				}),
			);

			expect(settings.select("right").value).toBe("google");
			expect(settings.select("left").value).toBe("youtube");
			expect(settings.select("up").value).toBe("none");
			expect(settings.select("down").value).toBe("custom");
			expect(settings.urlInput("down").value).toBe(
				"https://duckduckgo.com/?q=%s",
			);
			expect(settings.urlInput("right").hidden).toBe(true);
			expect(settings.urlInput("down").hidden).toBe(false);
		});

		it("saves the chosen engines and uses them for the next drag", () => {
			const context = setup();
			const { document, GM_openInTab, GM_setValue } = context;
			const before = document.documentElement.outerHTML;
			const settings = openSettings(context);

			choose(settings.select("right"), "youtube");
			choose(settings.select("up"), "none");
			settings.click("Save");
			drag(document, byId(document, "text"), byId(document, "zone"), {
				data: { "text/plain": "cat" },
			});

			expect(GM_setValue).toHaveBeenCalledWith("directions", {
				...DEFAULTS,
				right: "youtube",
				up: null,
			});
			expect(document.documentElement.outerHTML).toBe(before);
			expect(GM_openInTab).toHaveBeenCalledWith(
				"https://www.youtube.com/results?search_query=cat",
				{ active: false, insert: true },
			);
		});

		it("saves a custom URL", () => {
			const context = setup();
			const settings = openSettings(context);

			choose(settings.select("down"), "custom");
			expect(settings.urlInput("down").hidden).toBe(false);
			settings.urlInput("down").value = " https://duckduckgo.com/?q=%s ";
			settings.click("Save");

			expect(context.GM_setValue).toHaveBeenCalledWith("directions", {
				...DEFAULTS,
				down: "https://duckduckgo.com/?q=%s",
			});
		});

		it.each([
			["without %s", "https://duckduckgo.com/"],
			["that is not http(s)", "javascript:alert('%s')"],
		])("refuses to save a custom URL %s", (_, url) => {
			const context = setup();
			const settings = openSettings(context);

			choose(settings.select("down"), "custom");
			settings.urlInput("down").value = url;
			settings.click("Save");

			expect(context.GM_setValue).not.toHaveBeenCalled();
			expect(settings.dialog.isConnected).toBe(true);
			expect(settings.error()).toContain("%s");
		});

		it("puts the defaults back in the form with Reset to defaults", () => {
			const context = setup({
				stored: { directions: { left: "youtube", up: null } },
			});
			const settings = openSettings(context);

			settings.click("Reset to defaults");
			settings.click("Save");

			expect(context.GM_setValue).toHaveBeenCalledWith("directions", DEFAULTS);
		});

		it.each([
			["Cancel", (settings) => settings.click("Cancel")],
			["Escape", (settings) => settings.dialog.close()],
		])(
			"closes without saving on %s and leaves the page as it was",
			(_, close) => {
				const context = setup();
				const before = context.document.documentElement.outerHTML;
				const settings = openSettings(context);

				choose(settings.select("right"), "youtube");
				close(settings);

				expect(context.GM_setValue).not.toHaveBeenCalled();
				expect(settings.dialog.isConnected).toBe(false);
				expect(context.document.documentElement.outerHTML).toBe(before);
			},
		);

		it("leaves text dragged within the settings dialog alone", () => {
			const context = setup();
			const settings = openSettings(context);
			choose(settings.select("down"), "custom");
			const input = settings.urlInput("down");

			const { dragover, drop } = drag(context.document, input, input, {
				data: { "text/plain": "https://duckduckgo.com/?q=%s" },
			});

			expect(dragover.defaultPrevented).toBe(false);
			expect(drop.defaultPrevented).toBe(false);
			expect(context.GM_openInTab).not.toHaveBeenCalled();
		});

		it.each([
			["while bubbling", false],
			["while capturing", true],
		])(
			"keeps keys typed in the settings dialog from page shortcuts that listen %s",
			(_, capture) => {
				const context = setup();
				const pageShortcut = vi.fn((event) => event.preventDefault());
				context.document.addEventListener("keydown", pageShortcut, { capture });
				const settings = openSettings(context);
				choose(settings.select("down"), "custom");

				const key = new context.dom.window.KeyboardEvent("keydown", {
					key: "/",
					bubbles: true,
					cancelable: true,
					composed: true,
				});
				settings.urlInput("down").dispatchEvent(key);

				expect(pageShortcut).not.toHaveBeenCalled();
				expect(key.defaultPrevented).toBe(false);
			},
		);

		it.each([
			"dragstart",
			"drag",
			"dragend",
			"dragenter",
			"dragover",
			"dragleave",
			"drop",
			"beforeinput",
			"input",
			"paste",
			"copy",
			"cut",
			"compositionstart",
			"compositionupdate",
			"compositionend",
		])(
			"keeps the page from seeing %s events from the settings dialog",
			(type) => {
				const context = setup();
				const pageListener = vi.fn();
				context.document.addEventListener(type, pageListener, {
					capture: true,
				});
				const settings = openSettings(context);
				choose(settings.select("down"), "custom");

				settings.urlInput("down").dispatchEvent(
					new context.dom.window.Event(type, {
						bubbles: true,
						composed: true,
					}),
				);

				expect(pageListener).not.toHaveBeenCalled();
			},
		);

		it("names each control after its direction for screen readers", () => {
			const settings = openSettings(setup());

			expect(settings.select("left").labels[0].textContent).toBe("← Left");
			expect(settings.urlInput("left").getAttribute("aria-label")).toBe(
				"← Left: custom URL",
			);
		});

		it("opens only one dialog at a time", () => {
			const context = setup();

			openSettings(context);
			openSettings(context);

			expect(context.document.documentElement.children).toHaveLength(3);
		});

		it("builds HTML elements on XML pages", () => {
			const { dialog, root } = openSettings(setup({ contentType: "text/xml" }));

			expect(root.host.namespaceURI).toBe(XHTML);
			expect(dialog.namespaceURI).toBe(XHTML);
			expect(root.querySelector("select").namespaceURI).toBe(XHTML);
		});
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

	it.each([
		["a textarea", "editor"],
		["a plaintext-only editor", "plain-editor"],
		["an editor marked TRUE in capitals", "upper-editor"],
	])("leaves drops into %s to the browser", (_, id) => {
		const { document, GM_openInTab } = setup();

		const { dragover, drop } = drag(
			document,
			byId(document, "text"),
			byId(document, id),
			{ data: { "text/plain": "hello" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(drop.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves drops into an editable field inside a shadow root to the browser", () => {
		const { document, GM_openInTab } = setup();
		const root = byId(document, "shadow-host").attachShadow({ mode: "open" });
		root.innerHTML = "<textarea></textarea>";

		const { dragover, drop } = drag(
			document,
			byId(document, "text"),
			root.querySelector("textarea"),
			{ data: { "text/plain": "hello" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(drop.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves text dragged out of an editable field inside a shadow root alone", () => {
		const { document, GM_openInTab } = setup();
		const root = byId(document, "shadow-host").attachShadow({ mode: "open" });
		root.innerHTML = "<textarea>hello</textarea>";

		const { dragover } = drag(
			document,
			root.querySelector("textarea"),
			byId(document, "zone"),
			{ data: { "text/plain": "hello" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves a link inside a draggable widget's shadow root alone", () => {
		const { document, GM_openInTab } = setup();
		const host = byId(document, "shadow-host");
		host.setAttribute("draggable", "true");
		const root = host.attachShadow({ mode: "open" });
		root.innerHTML = '<a href="https://example.com/a">a</a>';

		const { dragover } = drag(
			document,
			root.querySelector("a"),
			byId(document, "zone"),
			{ data: { "text/uri-list": "https://example.com/a" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("leaves drops into a shadow root inside an editor to the browser", () => {
		const { document, GM_openInTab } = setup();
		const host = byId(document, "shadow-host");
		host.setAttribute("contenteditable", "true");
		const root = host.attachShadow({ mode: "open" });
		root.innerHTML = "<span>inside</span>";

		const { dragover, drop } = drag(
			document,
			byId(document, "text"),
			root.querySelector("span"),
			{ data: { "text/plain": "hello" } },
		);

		expect(dragover.defaultPrevented).toBe(false);
		expect(drop.defaultPrevented).toBe(false);
		expect(GM_openInTab).not.toHaveBeenCalled();
	});

	it("ignores drags that a page script fakes", () => {
		const { document, GM_openInTab } = setup();

		const { dragover, drop } = drag(
			document,
			byId(document, "text"),
			byId(document, "zone"),
			{ data: { "text/uri-list": "https://evil.test/" }, trusted: false },
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
