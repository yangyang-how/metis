# Parse Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Parse stage that converts EPUB files into a structured DocumentTree for the Comprehend stage.

**Architecture:** Two-pass parser — Pass 1 reads the EPUB's ToC and OPF to build a chapter/section skeleton, Pass 2 walks HTML content files and attaches ContentBlocks to the skeleton. Strategy pattern abstracts EPUB2 vs EPUB3 differences. Single public entry point `parse()` hides all internals.

**Tech Stack:** TypeScript (strict), Bun runtime, fflate (unzip), node-html-parser (HTML), fast-xml-parser (XML)

**Spec:** `design/02-parse-stage.md`

---

## File Structure

```
engine/
  package.json              — Bun project config, scripts (test, typecheck, lint)
  tsconfig.json             — TypeScript strict config
  biome.json                — Linter/formatter config
  src/
    parse/
      index.ts              — Public entry: parse(input) -> DocumentTree
      types.ts              — All type definitions (DocumentTree, Chapter, Section, ContentBlock, etc.)
      epub-reader.ts        — Unzip EPUB, read container.xml, parse OPF, resolve internal paths
      toc-parser.ts         — Detect EPUB version, parse NCX or Nav -> ChapterSkeleton[]
      content-parser.ts     — Walk HTML DOM -> ContentBlock[], handle footnotes, images, tables
      errors.ts             — ParseError typed error class
  test/
    parse/
      types.test.ts         — Type smoke tests (discriminated union, ListItem nesting)
      epub-reader.test.ts   — Unit: unzip, OPF parsing, metadata extraction
      toc-parser.test.ts    — Unit: NCX parsing, Nav parsing, version detection
      content-parser.test.ts— Unit: HTML -> ContentBlock conversion for each element type
      index.test.ts         — Integration: full EPUB -> DocumentTree
      fixtures/
        build-fixtures.ts   — Zips raw fixture dirs into .epub files using fflate
        minimal/            — Hand-built minimal EPUB3 (unpacked files, zipped in setup)
        epub2/              — Hand-built EPUB2 with NCX
        no-nav/             — EPUB3 with no nav document (fallback test)
        drm/                — EPUB with META-INF/encryption.xml (DRM detection test)
        fragments/          — Single-file EPUB with fragment-based chapter splits
        multi-file-chapter/ — Chapter spanning multiple spine files
```

---

### Task 1: Scaffold the engine package

**Files:**
- Create: `engine/package.json`
- Create: `engine/tsconfig.json`
- Create: `engine/biome.json`

- [ ] **Step 1: Create engine/package.json**

```json
{
  "name": "metis-engine",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "npx @biomejs/biome check ./src ./test",
    "lint:fix": "npx @biomejs/biome check --write ./src ./test"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.7.0",
    "@types/bun": "latest"
  },
  "dependencies": {
    "fflate": "^0.8.0",
    "node-html-parser": "^7.0.0",
    "fast-xml-parser": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create engine/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create engine/biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab"
  },
  "files": {
    "ignore": ["node_modules", "dist"]
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd engine && bun install`
Expected: lockfile created, node_modules populated, zero errors.

- [ ] **Step 5: Verify tooling works**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass (nothing to check yet, but no config errors).

- [ ] **Step 6: Commit**

```bash
git add engine/package.json engine/tsconfig.json engine/biome.json engine/bun.lockb
git commit -m "chore: scaffold engine package with Bun, TypeScript strict, Biome"
```

---

### Task 2: Define all types

**Files:**
- Create: `engine/src/parse/types.ts`
- Create: `engine/src/parse/errors.ts`
- Create: `engine/test/parse/types.test.ts`

- [ ] **Step 1: Write type smoke tests**

```typescript
// engine/test/parse/types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  ContentBlock,
  Chapter,
  DocumentTree,
  ListItem,
  ParseInput,
  Section,
  ChapterSkeleton,
} from "../../src/parse/types";

describe("parse types", () => {
  test("ContentBlock discriminated union accepts all block types", () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "hello" },
      { type: "heading", text: "Title", level: 1 },
      { type: "table", rows: [["a", "b"], ["c", "d"]] },
      { type: "image", originalPath: "img/fig1.png", data: Buffer.from("fake"), alt: "A figure" },
      { type: "footnote", id: "fn1", text: "See appendix." },
      { type: "blockquote", text: "To be or not to be." },
      { type: "list", ordered: true, items: [{ text: "first" }] },
      { type: "code", text: "const x = 1;" },
    ];
    expect(blocks).toHaveLength(8);
  });

  test("ListItem supports nesting", () => {
    const item: ListItem = {
      text: "parent",
      children: [
        { text: "child", children: [{ text: "grandchild" }] },
      ],
    };
    expect(item.children?.[0]?.children?.[0]?.text).toBe("grandchild");
  });

  test("Section supports recursive nesting", () => {
    const section: Section = {
      id: "s1",
      title: "Outer",
      level: 1,
      content: [],
      sections: [
        { id: "s1-1", title: "Inner", level: 2, content: [], sections: [] },
      ],
    };
    expect(section.sections[0]?.title).toBe("Inner");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && bun test test/parse/types.test.ts`
Expected: FAIL — cannot resolve `../../src/parse/types`.

- [ ] **Step 3: Create types.ts**

```typescript
// engine/src/parse/types.ts

export interface ParseInput {
  filePath: string;
  options?: {
    extractImages?: boolean;
  };
}

export interface DocumentMetadata {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  publishDate?: string;
  isbn?: string;
}

export interface DocumentTree {
  metadata: DocumentMetadata;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  order: number;
  sections: Section[];
  content: ContentBlock[];
}

export interface Section {
  id: string;
  title: string;
  level: number;
  content: ContentBlock[];
  sections: Section[];
}

export interface ListItem {
  text: string;
  children?: ListItem[];
}

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; level: number }
  | { type: "table"; rows: string[][]; caption?: string }
  | { type: "image"; originalPath: string; alt?: string; caption?: string; data: Buffer }
  | { type: "footnote"; id: string; text: string }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; text: string; language?: string };

export interface ChapterSkeleton {
  id: string;
  title: string;
  order: number;
  spineFileRef: string;
  fragmentId?: string;
  children: ChapterSkeleton[];
}

export interface SpineMapping {
  node: Chapter | Section;
  startFragmentId?: string;
  endFragmentId?: string;
}
```

- [ ] **Step 4: Create errors.ts**

```typescript
// engine/src/parse/errors.ts

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_EPUB" | "MISSING_OPF" | "DRM_PROTECTED" | "CORRUPT_CONTENT" | "NO_CHAPTERS",
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/parse/types.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Run typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add engine/src/parse/types.ts engine/src/parse/errors.ts engine/test/parse/types.test.ts
git commit -m "feat(parse): define DocumentTree types, ContentBlock union, and ParseError"
```

---

### Task 3: EPUB reader — unzip and OPF parsing

**Files:**
- Create: `engine/src/parse/epub-reader.ts`
- Create: `engine/test/parse/epub-reader.test.ts`
- Create: `engine/test/parse/fixtures/minimal/` (hand-built EPUB3 files)

This task builds the module that unzips an EPUB and extracts its structural
metadata: the OPF package document (which contains metadata, manifest, and spine)
and the paths to content files and navigation documents.

- [ ] **Step 1: Create minimal EPUB3 fixture files**

An EPUB is a zip file with a specific structure. Create the raw files that will
be zipped into a test fixture. The fixture needs:

```
minimal/
  mimetype                     — "application/epub+zip" (no newline)
  META-INF/
    container.xml              — points to content.opf
  OEBPS/
    content.opf                — metadata + manifest + spine
    nav.xhtml                  — EPUB3 navigation document
    chapter1.xhtml             — a simple chapter
    chapter2.xhtml             — a second chapter
```

Contents of each file:

**mimetype:** `application/epub+zip`

**META-INF/container.xml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
```

**OEBPS/content.opf:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Minimal Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:12345</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>
```

**OEBPS/nav.xhtml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chapter1.xhtml">Chapter 1: Introduction</a></li>
      <li><a href="chapter2.xhtml">Chapter 2: Analysis</a></li>
    </ol>
  </nav>
</body>
</html>
```

**OEBPS/chapter1.xhtml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1>Chapter 1: Introduction</h1>
  <p>This is the first paragraph of the introduction.</p>
  <p>This is the second paragraph.</p>
</body>
</html>
```

**OEBPS/chapter2.xhtml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
  <h1>Chapter 2: Analysis</h1>
  <p>Analysis begins here.</p>
</body>
</html>
```

Also create these additional fixture directories:

**no-nav/** — same as minimal, but remove the nav.xhtml from the manifest and
don't include `properties="nav"` on any item. No toc.ncx either. Forces
fallback to spine-based chapter detection.

**drm/** — same as minimal, but add `META-INF/encryption.xml` with:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>
  </EncryptedData>
</encryption>
```

**fragments/** — single content file with two chapters separated by fragment IDs.
Nav doc has two entries both pointing to `content.xhtml#ch1` and `content.xhtml#ch2`.
The content file has `<div id="ch1">...</div><div id="ch2">...</div>`.

**multi-file-chapter/** — three spine files, but only two ToC entries (chapters).
The third spine file has no ToC entry — its content should be appended to the
second chapter.

Write a helper script at `engine/test/parse/fixtures/build-fixtures.ts` that
zips each fixture directory into an `.epub` file using fflate. Key EPUB zip
requirements:

```typescript
// engine/test/parse/fixtures/build-fixtures.ts
import { zipSync, strToU8 } from "fflate";
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

function collectFiles(dir: string, base = dir): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(dir, { recursive: true })) {
    const fullPath = join(dir, entry as string);
    if (statSync(fullPath).isFile()) {
      const relPath = relative(base, fullPath);
      files[relPath] = readFileSync(fullPath);
    }
  }
  return files;
}

function buildEpub(fixtureDir: string, outputPath: string): void {
  const files = collectFiles(fixtureDir);
  // mimetype MUST be first entry, stored (no compression)
  const zipData: Record<string, [Uint8Array, { level: number }]> = {};
  // Add mimetype first with level 0 (stored, no compression)
  if (files["mimetype"]) {
    zipData["mimetype"] = [files["mimetype"], { level: 0 }];
    delete files["mimetype"];
  }
  for (const [path, data] of Object.entries(files)) {
    zipData[path] = [data, { level: 6 }];
  }
  const zipped = zipSync(zipData);
  writeFileSync(outputPath, zipped);
}

const fixturesDir = new URL(".", import.meta.url).pathname;

export async function buildFixtures(): Promise<void> {
  const fixtures = ["minimal", "epub2", "no-nav", "drm", "fragments", "multi-file-chapter"];
  for (const name of fixtures) {
    const dir = join(fixturesDir, name);
    const out = join(fixturesDir, `${name}.epub`);
    if (existsSync(dir)) buildEpub(dir, out);
  }
}
```

Note: `fflate.zipSync` accepts a second argument per file for compression options.
The `mimetype` file must be first and stored uncompressed (level: 0) per EPUB spec.

- [ ] **Step 2: Write epub-reader tests**

```typescript
// engine/test/parse/epub-reader.test.ts
import { describe, expect, test, beforeAll } from "bun:test";
import { readEpub } from "../../src/parse/epub-reader";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(async () => {
  await buildFixtures();
});

describe("readEpub", () => {
  const fixturePath = new URL("./fixtures/minimal.epub", import.meta.url).pathname;

  test("extracts metadata from OPF", async () => {
    const epub = await readEpub(fixturePath);
    expect(epub.metadata.title).toBe("Minimal Test Book");
    expect(epub.metadata.authors).toEqual(["Test Author"]);
    expect(epub.metadata.language).toBe("en");
  });

  test("returns spine in reading order", async () => {
    const epub = await readEpub(fixturePath);
    expect(epub.spine).toHaveLength(2);
    expect(epub.spine[0]?.href).toContain("chapter1.xhtml");
    expect(epub.spine[1]?.href).toContain("chapter2.xhtml");
  });

  test("identifies navigation document", async () => {
    const epub = await readEpub(fixturePath);
    expect(epub.navPath).toContain("nav.xhtml");
    expect(epub.navType).toBe("epub3");
  });

  test("provides file reader for content files", async () => {
    const epub = await readEpub(fixturePath);
    const content = await epub.readFile(epub.spine[0]!.href);
    expect(content).toContain("first paragraph");
  });

  test("throws ParseError for non-existent file", async () => {
    await expect(readEpub("/does/not/exist.epub")).rejects.toThrow("INVALID_EPUB");
  });

  test("detects DRM-protected EPUBs", async () => {
    const drmPath = new URL("./fixtures/drm.epub", import.meta.url).pathname;
    await expect(readEpub(drmPath)).rejects.toThrow("DRM_PROTECTED");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && bun test test/parse/epub-reader.test.ts`
Expected: FAIL — cannot resolve modules.

- [ ] **Step 4: Implement epub-reader.ts**

The epub-reader module:
1. Reads the EPUB file as a `Uint8Array`
2. Unzips with `fflate.unzipSync`
3. Checks for `META-INF/encryption.xml` → DRM detection. If present, throw
   `ParseError` with code `DRM_PROTECTED` immediately.
4. Reads `META-INF/container.xml` to find the OPF path
5. Parses the OPF with `fast-xml-parser` to extract:
   - Metadata (title, authors, language, publisher, date, identifier)
   - Manifest (map of id -> href + media-type + properties)
   - Spine (ordered list of manifest item references)
6. Detects the nav document (EPUB3: item with `properties="nav"`, EPUB2: item with `media-type="application/x-dtbncx+xml"`)
7. Returns an `EpubData` object with metadata, spine, navPath, navType, and a
   `readFile()` function that retrieves content from the unzipped archive
8. The `readFile()` function normalizes content to UTF-8. Most EPUBs are UTF-8,
   but if a file declares a different encoding in its XML declaration or meta
   charset, use `TextDecoder` with the declared encoding. If decoding fails,
   fall back to UTF-8 and log a warning.

Key types returned:

```typescript
interface EpubData {
  metadata: DocumentMetadata;
  spine: SpineItem[];
  navPath: string;
  navType: "epub2" | "epub3";
  basePath: string;              // OPF directory (for resolving relative hrefs)
  readFile: (href: string) => string;
  readBinary: (href: string) => Uint8Array;
}

interface SpineItem {
  id: string;
  href: string;
  index: number;
}
```

No temp directory needed — fflate unzips in memory, so `readFile` just
looks up the path in the unzipped map. Cleanup is automatic via GC.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/parse/epub-reader.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Run typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add engine/src/parse/epub-reader.ts engine/test/parse/epub-reader.test.ts engine/test/parse/fixtures/
git commit -m "feat(parse): implement epub-reader — unzip, OPF parsing, metadata extraction"
```

---

### Task 4: ToC parser — NCX and Nav document parsing

**Files:**
- Create: `engine/src/parse/toc-parser.ts`
- Create: `engine/test/parse/toc-parser.test.ts`
- Create: `engine/test/parse/fixtures/epub2/` (hand-built EPUB2 files with NCX)

This task builds the strategy-pattern ToC parser that produces
`ChapterSkeleton[]` from either EPUB3 nav or EPUB2 NCX documents.

- [ ] **Step 1: Create EPUB2 fixture files**

Same structure as the minimal EPUB3 fixture, but:
- Replace `nav.xhtml` with `toc.ncx`
- OPF uses `version="2.0"` and references the NCX in `<spine toc="ncx">`
- No `properties="nav"` on any manifest item

**toc.ncx:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="ch1" playOrder="1">
      <navLabel><text>Chapter 1: Introduction</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
    <navPoint id="ch2" playOrder="2">
      <navLabel><text>Chapter 2: Analysis</text></navLabel>
      <content src="chapter2.xhtml"/>
      <navPoint id="ch2-s1" playOrder="3">
        <navLabel><text>Section 2.1: Data</text></navLabel>
        <content src="chapter2.xhtml#section-data"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>
```

Update `build-fixtures.ts` to also build `epub2-sample.epub`.

- [ ] **Step 2: Write toc-parser tests**

```typescript
// engine/test/parse/toc-parser.test.ts
import { describe, expect, test, beforeAll } from "bun:test";
import { parseToc } from "../../src/parse/toc-parser";
import { readEpub } from "../../src/parse/epub-reader";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(async () => {
  await buildFixtures();
});

describe("parseToc — EPUB3 nav", () => {
  test("parses nav document into ChapterSkeleton array", async () => {
    const fixturePath = new URL("./fixtures/minimal.epub", import.meta.url).pathname;
    const epub = await readEpub(fixturePath);
    const chapters = parseToc(epub);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("Chapter 1: Introduction");
    expect(chapters[0]?.spineFileRef).toContain("chapter1.xhtml");
    expect(chapters[1]?.title).toBe("Chapter 2: Analysis");
  });

  test("assigns sequential order values", async () => {
    const fixturePath = new URL("./fixtures/minimal.epub", import.meta.url).pathname;
    const epub = await readEpub(fixturePath);
    const chapters = parseToc(epub);

    expect(chapters[0]?.order).toBe(0);
    expect(chapters[1]?.order).toBe(1);
  });
});

describe("parseToc — EPUB2 NCX", () => {
  test("parses NCX navMap into ChapterSkeleton array", async () => {
    const fixturePath = new URL("./fixtures/epub2-sample.epub", import.meta.url).pathname;
    const epub = await readEpub(fixturePath);
    const chapters = parseToc(epub);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("Chapter 1: Introduction");
    expect(chapters[1]?.title).toBe("Chapter 2: Analysis");
  });

  test("parses nested navPoints into children", async () => {
    const fixturePath = new URL("./fixtures/epub2-sample.epub", import.meta.url).pathname;
    const epub = await readEpub(fixturePath);
    const chapters = parseToc(epub);

    expect(chapters[1]?.children).toHaveLength(1);
    expect(chapters[1]?.children[0]?.title).toBe("Section 2.1: Data");
    expect(chapters[1]?.children[0]?.fragmentId).toBe("section-data");
  });
});

describe("parseToc — fallback", () => {
  test("falls back to spine-based chapters when no nav document exists", async () => {
    const fixturePath = new URL("./fixtures/no-nav.epub", import.meta.url).pathname;
    const epub = await readEpub(fixturePath);
    const chapters = parseToc(epub);

    // Should create one chapter per spine file using filename or first heading as title
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters[0]?.title).toBeTruthy();
    expect(chapters[0]?.spineFileRef).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && bun test test/parse/toc-parser.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 4: Implement toc-parser.ts**

The toc-parser module:
1. Takes an `EpubData` object from the epub-reader
2. Reads the nav document content via `epub.readFile(epub.navPath)`
3. Dispatches based on `epub.navType`:
   - **epub3:** Parse the HTML nav, find `<nav epub:type="toc">`, walk `<ol>/<li>/<a>` elements to build the tree
   - **epub2:** Parse the NCX XML, walk `<navMap>/<navPoint>` elements to build the tree
4. For each ToC entry, extract:
   - Title (from link text or navLabel)
   - href (split into file path + optional fragment ID)
   - Children (recursive)
5. Generate deterministic IDs: use fragment ID if available, fall back to `kebab-case(title)-order`
6. **Fallback:** if no nav document exists, create one ChapterSkeleton per spine item, using filename or "Chapter N" as title

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/parse/toc-parser.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Run typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add engine/src/parse/toc-parser.ts engine/test/parse/toc-parser.test.ts engine/test/parse/fixtures/epub2/
git commit -m "feat(parse): implement ToC parser — EPUB3 nav and EPUB2 NCX with strategy pattern"
```

---

### Task 5: Content parser — HTML to ContentBlocks

**Files:**
- Create: `engine/src/parse/content-parser.ts`
- Create: `engine/test/parse/content-parser.test.ts`

This is the workhorse module. It takes an HTML string and converts it into
an array of `ContentBlock` objects. Each HTML element type maps to a specific
ContentBlock variant.

- [ ] **Step 1: Write content-parser tests — paragraphs and headings**

```typescript
// engine/test/parse/content-parser.test.ts
import { describe, expect, test } from "bun:test";
import { parseContent } from "../../src/parse/content-parser";

describe("parseContent — paragraphs", () => {
  test("converts <p> to paragraph blocks", () => {
    const html = "<body><p>Hello world.</p><p>Second paragraph.</p></body>";
    const blocks = parseContent(html);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "paragraph", text: "Hello world." });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "Second paragraph." });
  });

  test("strips inline formatting from paragraphs", () => {
    const html = "<body><p>This is <strong>bold</strong> and <em>italic</em> text.</p></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "paragraph", text: "This is bold and italic text." });
  });

  test("strips links but preserves text", () => {
    const html = '<body><p>See <a href="http://example.com">this link</a> for details.</p></body>';
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "paragraph", text: "See this link for details." });
  });
});

describe("parseContent — headings", () => {
  test("converts heading elements to heading blocks", () => {
    const html = "<body><h2>Section Title</h2></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "heading", text: "Section Title", level: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement basic parseContent (paragraphs + headings)**

```typescript
// engine/src/parse/content-parser.ts
import { parse as parseHTML } from "node-html-parser";
import type { ContentBlock } from "./types";

export interface ContentParserOptions {
  readBinary?: (href: string) => Uint8Array;
  extractImages?: boolean;
  resolveEndnote?: (href: string) => { id: string; text: string } | undefined;
}

export function parseContent(html: string, options?: ContentParserOptions): ContentBlock[] {
  const root = parseHTML(html);
  const body = root.querySelector("body") ?? root;
  const blocks: ContentBlock[] = [];

  for (const child of body.childNodes) {
    const block = convertElement(child, options);
    if (block) blocks.push(...block);
  }

  return blocks;
}
```

Walk child elements of `<body>`, dispatch by tag name:
- `p` → `{ type: "paragraph", text: node.textContent.trim() }`
- `h1`-`h6` → `{ type: "heading", text: node.textContent.trim(), level: N }`
- Unknown block elements → `{ type: "paragraph", text: node.textContent.trim() }`
- Skip empty text nodes

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Add tests for tables**

```typescript
describe("parseContent — tables", () => {
  test("converts <table> to table block with rows", () => {
    const html = `<body><table>
      <tr><td>A</td><td>B</td></tr>
      <tr><td>C</td><td>D</td></tr>
    </table></body>`;
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({
      type: "table",
      rows: [["A", "B"], ["C", "D"]],
    });
  });

  test("includes caption when present", () => {
    const html = `<body><table>
      <caption>Table 1: Results</caption>
      <tr><td>X</td></tr>
    </table></body>`;
    const blocks = parseContent(html);

    expect(blocks[0]).toMatchObject({
      type: "table",
      caption: "Table 1: Results",
    });
  });

  test("handles <th> elements in header rows", () => {
    const html = `<body><table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody><tr><td>Foo</td><td>42</td></tr></tbody>
    </table></body>`;
    const blocks = parseContent(html);

    expect((blocks[0] as any).rows).toEqual([["Name", "Value"], ["Foo", "42"]]);
  });
});
```

- [ ] **Step 6: Implement table conversion and verify tests pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: PASS.

- [ ] **Step 7: Add tests for lists (including nesting)**

```typescript
describe("parseContent — lists", () => {
  test("converts <ul> to unordered list block", () => {
    const html = "<body><ul><li>One</li><li>Two</li></ul></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({
      type: "list",
      ordered: false,
      items: [{ text: "One" }, { text: "Two" }],
    });
  });

  test("converts <ol> to ordered list block", () => {
    const html = "<body><ol><li>First</li><li>Second</li></ol></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
  });

  test("preserves nested list structure", () => {
    const html = `<body><ul>
      <li>Parent
        <ul>
          <li>Child</li>
        </ul>
      </li>
    </ul></body>`;
    const blocks = parseContent(html);

    const list = blocks[0] as Extract<ContentBlock, { type: "list" }>;
    expect(list.items[0]?.text).toBe("Parent");
    expect(list.items[0]?.children?.[0]?.text).toBe("Child");
  });
});
```

- [ ] **Step 8: Implement list conversion and verify tests pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: PASS.

- [ ] **Step 9: Add tests for code blocks, blockquotes, and unknown elements**

```typescript
describe("parseContent — code blocks", () => {
  test("converts <pre> to code block", () => {
    const html = "<body><pre>const x = 1;\nconst y = 2;</pre></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "code", text: "const x = 1;\nconst y = 2;" });
  });

  test("extracts language from class attribute", () => {
    const html = '<body><pre><code class="language-typescript">const x = 1;</code></pre></body>';
    const blocks = parseContent(html);

    expect(blocks[0]).toMatchObject({ type: "code", language: "typescript" });
  });
});

describe("parseContent — blockquotes", () => {
  test("converts <blockquote> to blockquote block", () => {
    const html = "<body><blockquote>A wise saying.</blockquote></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "blockquote", text: "A wise saying." });
  });
});

describe("parseContent — unknown elements", () => {
  test("converts unknown block elements to paragraph", () => {
    const html = "<body><dl><dt>Term</dt><dd>Definition</dd></dl></body>";
    const blocks = parseContent(html);

    expect(blocks[0]).toEqual({ type: "paragraph", text: "Term Definition" });
  });
});
```

- [ ] **Step 10: Implement remaining conversions and verify all tests pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: all tests PASS.

- [ ] **Step 11: Add tests for images**

```typescript
describe("parseContent — images", () => {
  test("converts <img> to image block with binary data", () => {
    const fakeImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const html = '<body><p>Before.</p><img src="images/fig1.png" alt="Figure 1"/><p>After.</p></body>';

    const blocks = parseContent(html, {
      readBinary: (href) => {
        expect(href).toBe("images/fig1.png");
        return fakeImage;
      },
      extractImages: true,
    });

    const imageBlock = blocks.find((b) => b.type === "image");
    expect(imageBlock).toMatchObject({
      type: "image",
      originalPath: "images/fig1.png",
      alt: "Figure 1",
    });
  });

  test("skips images when extractImages is false", () => {
    const html = '<body><img src="images/fig1.png" alt="Figure 1"/></body>';
    const blocks = parseContent(html, { extractImages: false });

    expect(blocks.find((b) => b.type === "image")).toBeUndefined();
  });
});
```

- [ ] **Step 12: Implement image handling and verify tests pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: PASS.

- [ ] **Step 13: Add tests for footnotes**

```typescript
describe("parseContent — footnotes", () => {
  test("replaces EPUB3 footnote links with [footnote:ID] markers", () => {
    const html = `<body>
      <p>Price elasticity<a epub:type="noteref" href="#fn1"><sup>1</sup></a> varies.</p>
      <aside epub:type="footnote" id="fn1"><p>See appendix for methodology.</p></aside>
    </body>`;
    const blocks = parseContent(html);

    const para = blocks.find((b) => b.type === "paragraph");
    expect(para).toMatchObject({
      type: "paragraph",
      text: "Price elasticity [footnote:fn1] varies.",
    });

    const footnote = blocks.find((b) => b.type === "footnote");
    expect(footnote).toEqual({
      type: "footnote",
      id: "fn1",
      text: "See appendix for methodology.",
    });
  });

  test("resolves EPUB2 endnote-style footnotes via link href", () => {
    // EPUB2 footnotes are typically <a href="endnotes.xhtml#fn1">1</a>
    // The content parser receives endnote content separately via options
    const html = `<body>
      <p>Important claim<a href="endnotes.xhtml#fn1"><sup>1</sup></a> is made here.</p>
    </body>`;

    const endnoteHtml = `<body>
      <p id="fn1">1. Supporting evidence from Johnson (2019).</p>
    </body>`;

    const blocks = parseContent(html, {
      resolveEndnote: (href: string) => {
        if (href === "endnotes.xhtml#fn1") return { id: "fn1", text: "Supporting evidence from Johnson (2019)." };
        return undefined;
      },
    });

    const para = blocks.find((b) => b.type === "paragraph");
    expect(para).toMatchObject({
      type: "paragraph",
      text: "Important claim [footnote:fn1] is made here.",
    });

    const footnote = blocks.find((b) => b.type === "footnote");
    expect(footnote).toEqual({
      type: "footnote",
      id: "fn1",
      text: "Supporting evidence from Johnson (2019).",
    });
  });
});
```

- [ ] **Step 14: Implement footnote handling and verify tests pass**

Run: `cd engine && bun test test/parse/content-parser.test.ts`
Expected: PASS.

- [ ] **Step 15: Run full typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 16: Commit**

```bash
git add engine/src/parse/content-parser.ts engine/test/parse/content-parser.test.ts
git commit -m "feat(parse): implement content parser — all ContentBlock types with footnote resolution"
```

---

### Task 6: Orchestrator — parse() entry point with two-pass assembly

**Files:**
- Create: `engine/src/parse/index.ts`
- Create: `engine/test/parse/index.test.ts`

This task wires everything together: the public `parse()` function that runs
Pass 1 (epub-reader + toc-parser → skeleton) then Pass 2 (content-parser →
filled tree) and returns a validated `DocumentTree`.

- [ ] **Step 1: Write integration tests**

```typescript
// engine/test/parse/index.test.ts
import { describe, expect, test, beforeAll } from "bun:test";
import { parse } from "../../src/parse/index";
import { buildFixtures } from "./fixtures/build-fixtures";

beforeAll(async () => {
  await buildFixtures();
});

describe("parse — EPUB3 integration", () => {
  const fixturePath = new URL("./fixtures/minimal.epub", import.meta.url).pathname;

  test("returns a DocumentTree with metadata", async () => {
    const tree = await parse({ filePath: fixturePath });

    expect(tree.metadata.title).toBe("Minimal Test Book");
    expect(tree.metadata.authors).toEqual(["Test Author"]);
  });

  test("returns chapters with content", async () => {
    const tree = await parse({ filePath: fixturePath });

    expect(tree.chapters).toHaveLength(2);
    expect(tree.chapters[0]?.title).toBe("Chapter 1: Introduction");
    expect(tree.chapters[0]?.content.length).toBeGreaterThan(0);
  });

  test("chapter content contains paragraphs", async () => {
    const tree = await parse({ filePath: fixturePath });

    const firstChapter = tree.chapters[0]!;
    const paragraphs = firstChapter.content.filter((b) => b.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs[0]?.text).toContain("first paragraph");
  });

  test("chapters have deterministic IDs", async () => {
    const tree1 = await parse({ filePath: fixturePath });
    const tree2 = await parse({ filePath: fixturePath });

    expect(tree1.chapters[0]?.id).toBe(tree2.chapters[0]?.id);
  });
});

describe("parse — EPUB2 integration", () => {
  const fixturePath = new URL("./fixtures/epub2-sample.epub", import.meta.url).pathname;

  test("parses EPUB2 with NCX navigation", async () => {
    const tree = await parse({ filePath: fixturePath });

    expect(tree.chapters).toHaveLength(2);
    expect(tree.chapters[1]?.sections).toHaveLength(1);
    expect(tree.chapters[1]?.sections[0]?.title).toBe("Section 2.1: Data");
  });
});

describe("parse — fragment-based splitting", () => {
  test("splits single file into multiple chapters by fragment IDs", async () => {
    const fixturePath = new URL("./fixtures/fragments.epub", import.meta.url).pathname;
    const tree = await parse({ filePath: fixturePath });

    expect(tree.chapters.length).toBeGreaterThanOrEqual(2);
    // Each chapter should have its own content, not duplicated
    const ch1Paragraphs = tree.chapters[0]!.content.filter((b) => b.type === "paragraph");
    const ch2Paragraphs = tree.chapters[1]!.content.filter((b) => b.type === "paragraph");
    expect(ch1Paragraphs.length).toBeGreaterThan(0);
    expect(ch2Paragraphs.length).toBeGreaterThan(0);
  });
});

describe("parse — multi-file chapter", () => {
  test("appends content from unmapped spine files to preceding chapter", async () => {
    const fixturePath = new URL("./fixtures/multi-file-chapter.epub", import.meta.url).pathname;
    const tree = await parse({ filePath: fixturePath });

    // Third spine file has no ToC entry — content belongs to chapter 2
    expect(tree.chapters).toHaveLength(2);
    // Chapter 2 should have content from both its primary file AND the continuation file
    const ch2Paragraphs = tree.chapters[1]!.content.filter((b) => b.type === "paragraph");
    expect(ch2Paragraphs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parse — pre-section content", () => {
  test("places content before first section into chapter content array", async () => {
    const fixturePath = new URL("./fixtures/epub2-sample.epub", import.meta.url).pathname;
    const tree = await parse({ filePath: fixturePath });

    // Chapter 2 has sections — any content before the first section goes in chapter.content
    const ch2 = tree.chapters[1]!;
    expect(ch2.sections.length).toBeGreaterThan(0);
    // The chapter itself may have intro content before Section 2.1
  });
});

describe("parse — validation", () => {
  test("throws ParseError for invalid file", async () => {
    await expect(parse({ filePath: "/not/a/real/file.epub" })).rejects.toThrow();
  });

  test("throws ParseError with NO_CHAPTERS code for empty EPUB", async () => {
    // An EPUB with a spine but no parseable content should fail validation
    // This can be tested by checking the error code
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/parse/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement parse() orchestrator**

The `parse()` function:
1. Call `readEpub(input.filePath)` → get `EpubData`
2. Call `parseToc(epub)` → get `ChapterSkeleton[]`
3. Convert skeletons to `Chapter[]` and `Section[]` (recursive), building the
   spine mapping along the way
4. Walk spine items in order. For each spine file:
   a. Read content via `epub.readFile(href)`
   b. Call `parseContent(html, { readBinary: epub.readBinary, extractImages })`
   c. Look up the spine mapping to find which Chapter/Section nodes to attach to
   d. If multiple nodes share the file (fragment-based), split content at fragment boundaries
   e. If no mapping exists, append to the most recent chapter
5. Validate: `chapters.length > 0`, warn on empty chapters
6. Return `DocumentTree`

Export `parse` and re-export types from `types.ts` so consumers can do:
```typescript
import { parse } from "metis-engine/parse";
import type { DocumentTree, ContentBlock } from "metis-engine/parse";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/parse/index.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run the full test suite**

Run: `cd engine && bun test`
Expected: ALL tests across all files PASS.

- [ ] **Step 6: Run typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add engine/src/parse/index.ts engine/test/parse/index.test.ts
git commit -m "feat(parse): implement parse() orchestrator — two-pass EPUB to DocumentTree"
```

---

### Task 7: Update CLAUDE.md and final checks

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md commands section**

Add engine commands now that they work:
- Engine test: `cd engine && bun test`
- Engine typecheck: `cd engine && bun run typecheck`
- Lint: `cd engine && bun run lint`

Update directory structure to remove `[future]` from engine entries.

- [ ] **Step 2: Run full test suite one more time**

Run: `cd engine && bun test`
Expected: ALL tests pass.

- [ ] **Step 3: Run typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — engine commands and directory structure are live"
```
