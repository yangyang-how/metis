import { XMLParser } from "fast-xml-parser";
/**
 * ToC parser — strategy pattern for EPUB2 NCX and EPUB3 Nav.
 *
 * Both formats produce the same ChapterSkeleton[] output. The rest of
 * the pipeline never knows which format it's dealing with.
 *
 * Fallback: when no nav document exists, each spine file becomes a chapter.
 */
import { parse as parseHTML } from "node-html-parser";
import type { EpubData } from "./epub-reader";
import type { ChapterSkeleton } from "./types";

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	isArray: (name) => name === "navPoint",
});

export function parseToc(epub: EpubData): ChapterSkeleton[] {
	if (!epub.navPath || !epub.navType) {
		return fallbackToSpine(epub);
	}

	const navContent = epub.readFile(epub.navPath);
	if (!navContent) {
		return fallbackToSpine(epub);
	}

	if (epub.navType === "epub3") {
		return parseEpub3Nav(navContent, epub);
	}
	return parseEpub2Ncx(navContent, epub);
}

/**
 * EPUB3: Parse <nav epub:type="toc"> element.
 * Structure: <nav> > <ol> > <li> > <a href="...">Title</a> [> <ol>children</ol>]
 */
function parseEpub3Nav(html: string, epub: EpubData): ChapterSkeleton[] {
	const root = parseHTML(html);

	// Find the toc nav — look for nav with epub:type="toc"
	// node-html-parser doesn't handle namespaced attributes well,
	// so we search all nav elements and check attributes manually
	const navElements = root.querySelectorAll("nav");
	let tocNav = navElements.find(
		(n) =>
			n.getAttribute("epub:type") === "toc" || n.getAttribute("type") === "toc",
	);

	// Fallback: just use the first nav if no toc-typed one found
	if (!tocNav && navElements.length > 0) {
		tocNav = navElements[0];
	}

	if (!tocNav) {
		return fallbackToSpine(epub);
	}

	const ol = tocNav.querySelector("ol");
	if (!ol) {
		return fallbackToSpine(epub);
	}

	let order = 0;
	const items = ol.querySelectorAll(":scope > li");

	return items.map((li) => parseNavItem(li, epub, () => order++));
}

function parseNavItem(
	li: ReturnType<ReturnType<typeof parseHTML>["querySelector"]>,
	epub: EpubData,
	nextOrder: () => number,
): ChapterSkeleton {
	const link = li?.querySelector("a");
	const title = link?.textContent?.trim() ?? "Untitled";
	const href = link?.getAttribute("href") ?? "";

	const { fileRef, fragmentId } = splitHref(href, epub.basePath);

	// Check for nested <ol> (child sections)
	const childOl = li?.querySelector(":scope > ol");
	const children: ChapterSkeleton[] = [];
	if (childOl) {
		const childItems = childOl.querySelectorAll(":scope > li");
		for (const childLi of childItems) {
			children.push(parseNavItem(childLi, epub, nextOrder));
		}
	}

	const order = nextOrder();

	return {
		id: fragmentId ?? toKebabCase(title, order),
		title,
		order,
		spineFileRef: fileRef,
		fragmentId: fragmentId ?? undefined,
		children,
	};
}

/**
 * EPUB2: Parse NCX <navMap> element.
 * Structure: <navMap> > <navPoint> > <navLabel><text>Title</text></navLabel>
 *                                    <content src="..."/>
 *                                    [<navPoint>children</navPoint>]
 */
function parseEpub2Ncx(ncxXml: string, epub: EpubData): ChapterSkeleton[] {
	const parsed = xmlParser.parse(ncxXml);
	const navMap = parsed?.ncx?.navMap;
	if (!navMap) {
		return fallbackToSpine(epub);
	}

	const navPoints = navMap.navPoint ?? [];
	let order = 0;

	return navPoints.map((np: Record<string, unknown>) =>
		parseNavPoint(np, epub, () => order++),
	);
}

function parseNavPoint(
	np: Record<string, unknown>,
	epub: EpubData,
	nextOrder: () => number,
): ChapterSkeleton {
	const title = extractNavPointTitle(np) ?? "Untitled";
	const src = (np.content as Record<string, unknown> | undefined)?.["@_src"] as
		| string
		| undefined;
	const href = src ?? "";

	const { fileRef, fragmentId } = splitHref(href, epub.basePath);

	// Nested navPoints
	const childNavPoints =
		(np.navPoint as Record<string, unknown>[] | undefined) ?? [];
	const children = childNavPoints.map((cnp) =>
		parseNavPoint(cnp, epub, nextOrder),
	);

	const order = nextOrder();

	return {
		id:
			(np["@_id"] as string | undefined) ??
			fragmentId ??
			toKebabCase(title, order),
		title,
		order,
		spineFileRef: fileRef,
		fragmentId: fragmentId ?? undefined,
		children,
	};
}

function extractNavPointTitle(np: Record<string, unknown>): string | null {
	const navLabel = np.navLabel as Record<string, unknown> | undefined;
	if (!navLabel) return null;

	const text = navLabel.text;
	if (typeof text === "string") return text.trim();
	if (text && typeof text === "object" && "#text" in text) {
		return String((text as { "#text": unknown })["#text"]).trim();
	}
	return null;
}

/**
 * Fallback when no ToC exists: treat each spine file as a chapter.
 * Use the filename (without extension) as a rough title.
 */
function fallbackToSpine(epub: EpubData): ChapterSkeleton[] {
	return epub.spine.map((item, index) => {
		const filename = item.href.split("/").pop() ?? item.href;
		const title = filename.replace(/\.\w+$/, "").replace(/[-_]/g, " ");

		return {
			id: toKebabCase(title, index),
			title: title || `Chapter ${index + 1}`,
			order: index,
			spineFileRef: item.href,
			children: [],
		};
	});
}

/**
 * Split an href like "chapter2.xhtml#section-data" into
 * { fileRef: "OEBPS/chapter2.xhtml", fragmentId: "section-data" }
 */
function splitHref(
	href: string,
	basePath: string,
): { fileRef: string; fragmentId: string | null } {
	const [filePart, fragment] = href.split("#");
	const resolvedFile =
		basePath && basePath !== "." ? `${basePath}/${filePart}` : (filePart ?? "");

	return {
		fileRef: resolvedFile,
		fragmentId: fragment ?? null,
	};
}

function toKebabCase(text: string, order: number): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? `${slug}-${order}` : `chapter-${order}`;
}
