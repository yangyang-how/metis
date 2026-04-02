import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { XMLParser } from "fast-xml-parser";
/**
 * EPUB reader — cracks open the zip and extracts structural metadata.
 *
 * Returns an EpubData object that provides:
 * - metadata (title, authors, etc. from the OPF)
 * - spine (reading order)
 * - nav document location and type (epub2/epub3)
 * - readFile() / readBinary() to access content from the archive
 *
 * Everything stays in memory — no temp directories, no cleanup needed.
 */
import { unzipSync } from "fflate";
import { ParseError } from "./errors";
import type { DocumentMetadata } from "./types";

export interface SpineItem {
	id: string;
	href: string;
	index: number;
}

export interface EpubData {
	metadata: DocumentMetadata;
	spine: SpineItem[];
	navPath: string | null;
	navType: "epub2" | "epub3" | null;
	basePath: string;
	readFile: (href: string) => string;
	readBinary: (href: string) => Uint8Array;
}

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	isArray: (name) =>
		["rootfile", "item", "itemref", "dc:creator"].includes(name),
});

export async function readEpub(filePath: string): Promise<EpubData> {
	// 1. Read and unzip
	let fileData: Uint8Array;
	try {
		fileData = readFileSync(filePath);
	} catch {
		throw new ParseError(
			`Cannot read file: ${filePath}`,
			"INVALID_EPUB",
			filePath,
		);
	}

	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(new Uint8Array(fileData));
	} catch {
		throw new ParseError(
			`Not a valid zip/EPUB file: ${filePath}`,
			"INVALID_EPUB",
			filePath,
		);
	}

	// 2. DRM check — fail fast before doing any real work
	if (files["META-INF/encryption.xml"]) {
		throw new ParseError(
			"DRM-protected EPUBs are not supported",
			"DRM_PROTECTED",
			filePath,
		);
	}

	// 3. Find the OPF via container.xml
	const containerXml = readTextFromArchive(files, "META-INF/container.xml");
	if (!containerXml) {
		throw new ParseError(
			"Missing META-INF/container.xml",
			"INVALID_EPUB",
			filePath,
		);
	}

	const container = xmlParser.parse(containerXml);
	const rootfiles = container?.container?.rootfiles?.rootfile;
	const opfPath = rootfiles?.[0]?.["@_full-path"];
	if (!opfPath) {
		throw new ParseError(
			"Cannot find OPF path in container.xml",
			"MISSING_OPF",
			filePath,
		);
	}

	// 4. Parse the OPF
	const opfXml = readTextFromArchive(files, opfPath);
	if (!opfXml) {
		throw new ParseError(
			`OPF file not found in archive: ${opfPath}`,
			"MISSING_OPF",
			filePath,
		);
	}

	const opf = xmlParser.parse(opfXml);
	const pkg = opf?.package;
	if (!pkg) {
		throw new ParseError(
			"Invalid OPF: missing <package> element",
			"MISSING_OPF",
			filePath,
		);
	}

	const basePath = dirname(opfPath);

	// 5. Extract metadata
	const metadata = extractMetadata(pkg);

	// 6. Build manifest lookup (id -> { href, mediaType, properties })
	const manifestItems: Array<{
		id: string;
		href: string;
		mediaType: string;
		properties: string;
	}> = [];
	const rawItems = pkg.manifest?.item ?? [];
	for (const item of rawItems) {
		manifestItems.push({
			id: item["@_id"] ?? "",
			href: item["@_href"] ?? "",
			mediaType: item["@_media-type"] ?? "",
			properties: item["@_properties"] ?? "",
		});
	}

	// 7. Build spine
	const spineItemrefs = pkg.spine?.itemref ?? [];
	const spine: SpineItem[] = [];
	for (let i = 0; i < spineItemrefs.length; i++) {
		const ref = spineItemrefs[i];
		const idref = ref?.["@_idref"] ?? "";
		const manifestItem = manifestItems.find((m) => m.id === idref);
		if (manifestItem) {
			spine.push({
				id: idref,
				href: resolveHref(basePath, manifestItem.href),
				index: i,
			});
		}
	}

	// 8. Find navigation document
	let navPath: string | null = null;
	let navType: "epub2" | "epub3" | null = null;

	// EPUB3: look for item with properties="nav"
	const navItem = manifestItems.find((m) => m.properties.includes("nav"));
	if (navItem) {
		navPath = resolveHref(basePath, navItem.href);
		navType = "epub3";
	}

	// EPUB2: look for NCX (referenced by spine@toc or by media-type)
	if (!navPath) {
		const tocId = pkg.spine?.["@_toc"];
		const ncxItem = tocId
			? manifestItems.find((m) => m.id === tocId)
			: manifestItems.find((m) => m.mediaType === "application/x-dtbncx+xml");
		if (ncxItem) {
			navPath = resolveHref(basePath, ncxItem.href);
			navType = "epub2";
		}
	}

	// 9. Build file readers
	const readFile = (href: string): string => {
		return readTextFromArchive(files, href) ?? "";
	};

	const readBinary = (href: string): Uint8Array => {
		return files[href] ?? files[normalize(href)] ?? new Uint8Array();
	};

	return {
		metadata,
		spine,
		navPath,
		navType,
		basePath,
		readFile,
		readBinary,
	};
}

function extractMetadata(pkg: Record<string, unknown>): DocumentMetadata {
	const meta = pkg.metadata as Record<string, unknown> | undefined;
	if (!meta) {
		return { title: "Unknown", authors: [] };
	}

	const title = extractText(meta["dc:title"]) ?? "Unknown";
	const creators = meta["dc:creator"];
	const authors: string[] = [];
	if (Array.isArray(creators)) {
		for (const c of creators) {
			const name = extractText(c);
			if (name) authors.push(name);
		}
	} else if (creators) {
		const name = extractText(creators);
		if (name) authors.push(name);
	}

	return {
		title,
		authors,
		language: extractText(meta["dc:language"]) ?? undefined,
		publisher: extractText(meta["dc:publisher"]) ?? undefined,
		publishDate: extractText(meta["dc:date"]) ?? undefined,
		isbn: extractText(meta["dc:identifier"]) ?? undefined,
	};
}

/**
 * Extract text content from an XML element that might be:
 * - a plain string: "Title"
 * - an object with #text: { "#text": "Title", "@_id": "uid" }
 */
function extractText(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (value && typeof value === "object" && "#text" in value) {
		return String((value as { "#text": unknown })["#text"]);
	}
	return null;
}

function readTextFromArchive(
	files: Record<string, Uint8Array>,
	path: string,
): string | null {
	const data = files[path] ?? files[normalize(path)];
	if (!data) return null;
	return new TextDecoder("utf-8").decode(data);
}

function resolveHref(basePath: string, href: string): string {
	if (basePath === ".") return href;
	return join(basePath, href);
}
