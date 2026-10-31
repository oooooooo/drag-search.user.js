// ==UserScript==
// @name         Drag Search
// @namespace    https://github.com/oooooooo/drag-search.user.js
// @homepageURL  https://github.com/oooooooo/drag-search.user.js
// @downloadURL  https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js
// @updateURL    https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js
// @license      MIT
// @version      1.2.0
// @description  Drag a link to open it, or drag selected text to search it, in a new tab
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
	// What searches text dragged in each direction until the user changes it
	// in the settings dialog: a key of ENGINES, a custom URL containing %s, or
	// null to ignore text dragged that way.
	const DEFAULT_DIRECTIONS = {
		right: "google",
		left: "translate",
		up: "wikipedia",
		down: "images",
	};
	const DIRECTION_LABELS = {
		right: "→ Right",
		left: "← Left",
		up: "↑ Up",
		down: "↓ Down",
	};
	// %s becomes the dragged text.
	const ENGINES = {
		google: "https://www.google.com/search?q=%s",
		images: "https://www.google.com/search?udm=2&q=%s",
		youtube: "https://www.youtube.com/results?search_query=%s",
		translate: `https://translate.google.com/?sl=auto&tl=${translateLanguage(navigator.language)}&op=translate&text=%s`,
		wikipedia: `https://${wikipediaLanguage(navigator.language)}.wikipedia.org/w/index.php?search=%s`,
	};
	const ENGINE_LABELS = {
		google: "Google",
		images: "Google Images",
		youtube: "YouTube",
		translate: "Google Translate",
		wikipedia: "Wikipedia",
	};
	const STORAGE_KEY = "directions";
	// A click that wobbles while pressed starts a short drag; ignore those.
	const MIN_DISTANCE = 10;
	const FORM_FIELD = "input, textarea";
	// The nearest element that sets contenteditable to a valid value decides
	// whether its contents are editable. Values are case-insensitive.
	const EDITING_HOST_OR_OPT_OUT =
		':is([contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [contenteditable="false" i])';

	// Google Translate tells the two Chinese scripts apart by region.
	function translateLanguage(locale) {
		const [language, ...rest] = locale.split("-");
		if (language === "zh") {
			const traditional = rest.some((part) =>
				["Hant", "TW", "HK", "MO"].includes(part),
			);
			return traditional ? "zh-TW" : "zh-CN";
		}
		return language === "nb" ? "no" : language;
	}

	// Wikipedia has one site per language, named by the language subtag.
	function wikipediaLanguage(locale) {
		const [language] = locale.split("-");
		return language === "nb" ? "no" : language;
	}

	// Where the current drag started, or null when the drag is not ours.
	let origin = null;

	// The host of the settings dialog while it is open, otherwise null.
	let settingsHost = null;

	// The elements the event passed through, innermost first. Unlike
	// event.target and closest(), this reaches inside shadow roots and out to
	// the ancestors of their hosts.
	const elementsOf = (event) =>
		event.composedPath().filter((node) => node.nodeType === Node.ELEMENT_NODE);

	const isEditable = (event) => {
		const elements = elementsOf(event);
		// The dialog's shadow root is closed, so the path stops at its host
		// and hides the form fields inside.
		if (settingsHost !== null && elements.includes(settingsHost)) return true;
		if (elements.some((element) => element.matches(FORM_FIELD))) return true;
		const decider = elements.find((element) =>
			element.matches(EDITING_HOST_OR_OPT_OUT),
		);
		return (
			decider != null &&
			decider.getAttribute("contenteditable").toLowerCase() !== "false"
		);
	};

	const isPageDraggable = (event) =>
		elementsOf(event).some((element) => element.matches('[draggable="true"]'));

	const webUrl = (text) => {
		try {
			const url = new URL(text);
			return url.protocol === "http:" || url.protocol === "https:"
				? url.href
				: null;
		} catch {
			return null;
		}
	};

	const firstUri = (uriList) =>
		uriList
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line !== "" && !line.startsWith("#")) ?? "";

	const isCustomUrl = (setting) =>
		typeof setting === "string" &&
		setting.includes("%s") &&
		webUrl(setting) !== null;

	const isValidSetting = (setting) =>
		setting === null || Object.hasOwn(ENGINES, setting) || isCustomUrl(setting);

	// Read on every drop, so a change in the settings applies to every open
	// tab. Anything invalid, such as an engine a later version removed, falls
	// back to the default for that direction.
	const loadDirections = () => {
		const saved = GM_getValue(STORAGE_KEY, {});
		return Object.fromEntries(
			Object.entries(DEFAULT_DIRECTIONS).map(([direction, fallback]) => {
				const setting = saved?.[direction];
				return [direction, isValidSetting(setting) ? setting : fallback];
			}),
		);
	};

	const searchUrlOf = (setting) =>
		ENGINES[setting] ?? (isCustomUrl(setting) ? setting : null);

	// Links and images arrive as text/uri-list; selected text only as text/plain.
	const urlToOpen = (dataTransfer, direction) => {
		const uri = firstUri(dataTransfer.getData("text/uri-list"));
		const text = dataTransfer.getData("text/plain").trim();
		if (uri !== "") return webUrl(uri);
		if (text === "") return null;
		const searchUrl = searchUrlOf(loadDirections()[direction]);
		return (
			webUrl(text) ??
			searchUrl?.replaceAll("%s", encodeURIComponent(text)) ??
			null
		);
	};

	const directionOf = (dx, dy) => {
		if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
		return dy >= 0 ? "down" : "up";
	};

	const openTab = (url, foreground) => {
		try {
			GM_openInTab(url, { active: foreground, insert: true });
		} catch (error) {
			console.error({
				type: "urn:drag-search:open-tab-failed",
				title: "Failed to open a tab",
				detail: `drag-search.user.js: ${error?.stack ?? error}`,
			});
		}
	};

	// Listen on window while capturing, ahead of the page: pages with a
	// page-wide file drop zone (Gemini, for one) cancel and stop every drop.
	// Page scripts can dispatch drag events too; act only on real drags, so a
	// page cannot open tabs through GM_openInTab.
	const listen = (type, listener) =>
		window.addEventListener(
			type,
			(event) => {
				if (event.isTrusted) listener(event);
			},
			{ capture: true },
		);

	listen("dragstart", (event) => {
		const ours = !isEditable(event) && !isPageDraggable(event);
		origin = ours ? { x: event.clientX, y: event.clientY } : null;
	});

	listen("dragover", (event) => {
		if (origin === null || isEditable(event)) return;
		// Without this the browser refuses the drop.
		event.preventDefault();
	});

	listen("drop", (event) => {
		const start = origin;
		origin = null;
		if (start === null || isEditable(event)) return;
		// Otherwise the browser navigates this tab to the dropped link.
		event.preventDefault();

		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.hypot(dx, dy) < MIN_DISTANCE) return;
		const url = urlToOpen(event.dataTransfer, directionOf(dx, dy));
		if (url !== null) openTab(url, event.shiftKey);
	});

	listen("dragend", () => {
		origin = null;
	});

	// The settings dialog is the one thing the script adds to a page, and only
	// while the user has it open. It lives in a closed shadow root so the page
	// cannot reach or restyle it, and in the top layer via showModal() so the
	// page cannot cover it.

	// On XML pages createElement() makes elements outside the HTML namespace,
	// which are neither styled nor interactive.
	const html = (tag, properties = {}, style = {}, children = []) => {
		const element = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			tag,
		);
		Object.assign(element, properties);
		// Set through CSSOM: pages whose CSP forbids inline styles still allow it.
		Object.assign(element.style, style);
		element.append(...children);
		return element;
	};

	const FONT = "14px/1.5 system-ui, sans-serif";

	const directionRow = (direction, setting) => {
		const select = html(
			"select",
			{ name: direction, id: direction },
			{ font: FONT },
			[
				...Object.entries(ENGINE_LABELS).map(([value, label]) =>
					html("option", { value, textContent: label }),
				),
				html("option", { value: "none", textContent: "None" }),
				html("option", { value: "custom", textContent: "Custom URL…" }),
			],
		);
		const urlInput = html(
			"input",
			{
				name: `${direction}-url`,
				type: "url",
				placeholder: "https://example.com/search?q=%s",
				value: isCustomUrl(setting) ? setting : "",
			},
			{ font: FONT, width: "100%", boxSizing: "border-box" },
		);
		const show = (value) => {
			if (value === null) select.value = "none";
			else if (isCustomUrl(value)) select.value = "custom";
			else select.value = value;
			if (isCustomUrl(value)) urlInput.value = value;
			urlInput.hidden = select.value !== "custom";
		};
		select.addEventListener("change", () => {
			urlInput.hidden = select.value !== "custom";
		});
		show(setting);
		const row = html(
			"div",
			{},
			{
				display: "grid",
				gridTemplateColumns: "5em 1fr",
				alignItems: "center",
				gap: "4px 8px",
			},
			[
				html("label", {
					htmlFor: direction,
					textContent: DIRECTION_LABELS[direction],
				}),
				select,
				html("span"),
				urlInput,
			],
		);
		// What the row holds: an engine key, null, a custom URL, or undefined
		// when the custom URL is not a valid one.
		const read = () => {
			if (select.value === "none") return null;
			if (select.value !== "custom") return select.value;
			const url = urlInput.value.trim();
			return isCustomUrl(url) ? url : undefined;
		};
		urlInput.setAttribute(
			"aria-label",
			`${DIRECTION_LABELS[direction]}: custom URL`,
		);
		return { row, read, show, urlInput };
	};

	const openSettings = () => {
		if (settingsHost !== null) return;
		const directions = loadDirections();
		const rows = Object.keys(DEFAULT_DIRECTIONS).map((direction) => [
			direction,
			directionRow(direction, directions[direction]),
		]);
		const error = html(
			"p",
			{ role: "alert" },
			{ color: "#b00020", margin: "0", minHeight: "1.5em" },
		);
		const button = (label, onClick) => {
			const element = html(
				"button",
				{ type: "button", textContent: label },
				{
					font: FONT,
				},
			);
			element.addEventListener("click", onClick);
			return element;
		};
		const dialog = html(
			"dialog",
			{},
			{
				font: FONT,
				color: "#202124",
				background: "#fff",
				border: "1px solid #dadce0",
				borderRadius: "8px",
				padding: "16px",
				width: "min(28em, calc(100vw - 32px))",
			},
		);
		const host = html("div");
		settingsHost = host;
		const close = () => dialog.close();
		const save = () => {
			const entries = rows.map(([direction, { read }]) => [direction, read()]);
			const invalid = entries.find(([, setting]) => setting === undefined);
			if (invalid !== undefined) {
				error.textContent =
					"Enter an http(s) URL that contains %s, which becomes the dragged text.";
				rows
					.find(([direction]) => direction === invalid[0])[1]
					.urlInput.focus();
				return;
			}
			GM_setValue(STORAGE_KEY, Object.fromEntries(entries));
			close();
		};
		const reset = () => {
			for (const [direction, { show }] of rows) {
				show(DEFAULT_DIRECTIONS[direction]);
			}
			error.textContent = "";
		};
		dialog.append(
			html(
				"h2",
				{ textContent: "Drag Search settings" },
				{
					font: "bold 16px/1.5 system-ui, sans-serif",
					margin: "0 0 12px",
				},
			),
			html(
				"div",
				{},
				{ display: "grid", gap: "8px" },
				rows.map(([, { row }]) => row),
			),
			error,
			html(
				"div",
				{},
				{ display: "flex", gap: "8px", justifyContent: "flex-end" },
				[
					button("Reset to defaults", reset),
					html("span", {}, { flex: "1" }),
					button("Cancel", close),
					button("Save", save),
				],
			),
		);
		// Escape closes the dialog too, without a click on Cancel.
		dialog.addEventListener("close", () => {
			host.remove();
			settingsHost = null;
		});
		host.attachShadow({ mode: "closed" }).append(dialog);
		document.documentElement.append(host);
		dialog.showModal();
	};

	// Outside the closed shadow root, events from the dialog's fields seem to
	// come from its host, not a form field, and some carry what the user
	// typed, pasted, or dragged. So page shortcuts (such as "/" to focus a
	// search box) would take the keys, and page scripts could read a custom
	// URL that holds a private token. Stopping them on window while capturing
	// keeps them from every page listener, because the script runs at
	// document-start, before the page adds any; the fields still receive the
	// text, and Escape still closes the dialog.
	const SETTINGS_INPUT_EVENTS = [
		"dragstart",
		"drag",
		"dragend",
		"dragenter",
		"dragover",
		"dragleave",
		"drop",
		"keydown",
		"keypress",
		"keyup",
		"beforeinput",
		"input",
		"paste",
		"copy",
		"cut",
		"compositionstart",
		"compositionupdate",
		"compositionend",
	];
	for (const type of SETTINGS_INPUT_EVENTS) {
		window.addEventListener(
			type,
			(event) => {
				if (
					settingsHost !== null &&
					event.composedPath().includes(settingsHost)
				) {
					event.stopImmediatePropagation();
				}
			},
			{ capture: true },
		);
	}

	// Every frame runs the script; one menu entry is enough.
	if (window.top === window) GM_registerMenuCommand("Settings", openSettings);
})();
