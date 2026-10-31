// ==UserScript==
// @name         Drag Search
// @namespace    https://github.com/oooooooo/drag-search.user.js
// @homepageURL  https://github.com/oooooooo/drag-search.user.js
// @downloadURL  https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js
// @updateURL    https://raw.githubusercontent.com/oooooooo/drag-search.user.js/main/drag-search.user.js
// @license      MIT
// @version      1.1.0
// @description  Drag a link to open it, or drag selected text to search it, in a new tab
// @match        http://*/*
// @match        https://*/*
// @run-at       document-end
// @grant        GM_openInTab
// ==/UserScript==

(() => {
	// Settings: the engine (a key of ENGINES) that searches text dragged in
	// each direction. Set a direction to null to ignore text dragged that way.
	const DIRECTIONS = {
		right: "google",
		left: "translate",
		up: "wikipedia",
		down: "images",
	};
	// %s becomes the dragged text.
	const ENGINES = {
		google: "https://www.google.com/search?q=%s",
		images: "https://www.google.com/search?udm=2&q=%s",
		youtube: "https://www.youtube.com/results?search_query=%s",
		translate: `https://translate.google.com/?sl=auto&tl=${translateLanguage(navigator.language)}&op=translate&text=%s`,
		wikipedia: `https://${wikipediaLanguage(navigator.language)}.wikipedia.org/w/index.php?search=%s`,
	};
	// A click that wobbles while pressed starts a short drag; ignore those.
	const MIN_DISTANCE = 10;
	const EDITABLE =
		'input, textarea, [contenteditable=""], [contenteditable="true"]';

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

	const toElement = (node) =>
		node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;

	const isEditable = (node) => toElement(node)?.closest?.(EDITABLE) != null;

	const isPageDraggable = (node) =>
		toElement(node)?.closest?.('[draggable="true"]') != null;

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

	// Links and images arrive as text/uri-list; selected text only as text/plain.
	const urlToOpen = (dataTransfer, direction) => {
		const uri = firstUri(dataTransfer.getData("text/uri-list"));
		const text = dataTransfer.getData("text/plain").trim();
		if (uri !== "") return webUrl(uri);
		if (text === "") return null;
		const engine = ENGINES[DIRECTIONS[direction]];
		return (
			webUrl(text) ?? engine?.replace("%s", encodeURIComponent(text)) ?? null
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

	document.addEventListener("dragstart", (event) => {
		const ours = !isEditable(event.target) && !isPageDraggable(event.target);
		origin = ours ? { x: event.clientX, y: event.clientY } : null;
	});

	document.addEventListener("dragover", (event) => {
		if (origin === null || isEditable(event.target)) return;
		// Without this the browser refuses the drop.
		event.preventDefault();
	});

	document.addEventListener("drop", (event) => {
		const start = origin;
		origin = null;
		if (start === null || event.defaultPrevented) return;
		if (isEditable(event.target)) return;
		// Otherwise the browser navigates this tab to the dropped link.
		event.preventDefault();

		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.hypot(dx, dy) < MIN_DISTANCE) return;
		const url = urlToOpen(event.dataTransfer, directionOf(dx, dy));
		if (url !== null) openTab(url, event.shiftKey);
	});

	document.addEventListener("dragend", () => {
		origin = null;
	});
})();
