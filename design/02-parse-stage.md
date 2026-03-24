# Parse Stage Design

The first stage of the Learn pipeline. Converts EPUB files into a structured
document tree that the Comprehend stage can reason over.

## Constraints

- **Rule-based only.** No LLM calls. Regex, HTML/XML parsers, file I/O.
- **EPUB focus.** The architecture doc describes future support for video
  transcripts, articles (HTML/Markdown), and PDF. This spec covers EPUB only.
  Other formats will be separate parser implementations behind the same
  `parse()` interface, added in future iterations.
- **Fail gracefully.** A broken chapter or missing footnote should not halt the
  entire book. Log the error, skip the element, continue.

## Input/Output Contract

### Input

```typescript
ParseInput {
  filePath: string          // path to .epub file
  options?: {
    extractImages: boolean  // default true
  }
}
```

### Output

```typescript
DocumentTree {
  metadata: {
    title: string
    authors: string[]
    language?: string
    publisher?: string
    publishDate?: string
    isbn?: string
  }
  chapters: Chapter[]
}

Chapter {
  id: string                // stable identifier (see ID Strategy below)
  title: string
  order: number             // position in spine
  sections: Section[]
  content: ContentBlock[]   // content before the first section
}

Section {
  id: string
  title: string
  level: number             // nesting depth (1 = direct child of chapter)
  content: ContentBlock[]
  sections: Section[]       // recursive sub-sections
}

ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; level: number }
  | { type: "table"; rows: string[][]; caption?: string }
  | { type: "image"; originalPath: string; alt?: string; caption?: string; data: Buffer }
  | { type: "footnote"; id: string; text: string }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; text: string; language?: string }

ListItem {
  text: string
  children?: ListItem[]     // nested list items
}
```

Key decisions:

- **Sections are recursive** to mirror how books nest (chapter > section > subsection).
- **ContentBlock is a discriminated union.** Each block type carries exactly the
  data it needs.
- **Images carry their binary data** so Comprehend can pass them to Opus vision
  without reaching back into the EPUB archive. `originalPath` is the filename
  from the EPUB manifest, kept for labeling and debugging.
- **Footnotes are inline-referenced but block-stored.** Footnote reference
  markers in paragraph text are replaced with `[footnote:ID]` where ID matches
  the footnote ContentBlock's `id` field. Example: `"Price elasticity [footnote:fn3]
  varies by market."` The footnote content itself lives as a separate ContentBlock.
  This convention is simple for Comprehend to parse and unambiguous.
- **Code blocks** are preserved for technical books (`<pre>` and `<code>` elements).
- **Lists support nesting** via recursive `ListItem` to preserve hierarchical
  structure common in non-fiction.
- **Inline formatting is stripped.** Paragraph, blockquote, and other text fields
  contain plain text. Bold, italic, and links are removed. The Comprehend stage
  reasons about argument structure, not typographic emphasis. If this proves too
  lossy, a future iteration can preserve formatting as Markdown-style markup.
- **Unrecognized HTML elements** (e.g., `<dl>`, `<aside>` without footnote
  semantics, custom elements) are converted to `paragraph` with their text
  content extracted. Inline elements are stripped, preserving their text.

### ID Strategy

Chapter and section IDs must be deterministic — re-parsing the same EPUB
produces the same IDs. Strategy: use the EPUB's own fragment identifiers where
available (these are stable across re-parses). Fall back to
`kebab-case(title)-order` (e.g., `market-structures-3`) when no fragment ID
exists.

### Output Validation

After building the DocumentTree, assert:

- `chapters.length > 0` — an EPUB with no chapters is a parse failure.
- Each chapter has at least one ContentBlock (across its own content and its
  sections). Log a warning for empty chapters but do not fail.

## Two-Pass Architecture

### Pass 1 — Build the skeleton

1. Unzip the EPUB to a temp directory.
2. Read `META-INF/container.xml` to locate the OPF (package document).
3. Parse the OPF to extract metadata (title, authors, language, etc.) and the
   spine (reading order).
4. Locate the navigation document (EPUB3 nav or EPUB2 NCX).
5. Walk ToC entries to build the `ChapterSkeleton` tree (see below) with titles,
   IDs, and order — no content yet.
6. Build the spine-to-tree mapping (see below).

**ChapterSkeleton** — the intermediate type produced by ToC parsing:

```typescript
ChapterSkeleton {
  id: string
  title: string
  order: number
  spineFileRef: string      // which content file this entry points to
  fragmentId?: string       // optional anchor within that file
  children: ChapterSkeleton[]
}
```

Both `parseNcx` and `parseNav` produce `ChapterSkeleton[]`. The rest of the
pipeline does not know which parser generated them.

### Spine-to-tree mapping

ToC entries do not always map 1:1 to content files. The mapping algorithm
handles two cases:

**Multiple chapters in one file (fragment-based splitting):**
When several ToC entries point to the same file with different fragment IDs,
content is split at fragment anchors. Build a list of
`{ node: TreeNode, startId: string, endId?: string }` entries per file.
During Pass 2, content between `startId` and `endId` is assigned to the
corresponding tree node.

**One chapter spanning multiple files:**
When consecutive spine files have no ToC entry of their own, they belong to the
preceding chapter. During Pass 2, their content is appended to that chapter's
content in spine order.

The mapping is stored as
`Map<spinePosition, Array<{ node: TreeNode, startFragmentId?: string, endFragmentId?: string }>>`
— an array because a single spine file may contain multiple tree nodes
(the fragment-based splitting case).

### Pass 2 — Fill in content

1. Walk spine files in reading order.
2. For each file, parse the HTML into a DOM.
3. Walk the DOM, converting elements to ContentBlocks:
   - `<p>` to paragraph
   - `<table>` to table (extract rows/cells as text)
   - `<img>` to image (read binary from EPUB archive, capture alt/caption)
   - `<blockquote>` to blockquote
   - `<ol>` / `<ul>` to list (with nesting)
   - `<pre>` / `<code>` to code
   - Footnote links resolved to footnote content (EPUB3 `<aside epub:type="footnote">`
     or EPUB2 endnote file links)
   - Unrecognized block elements to paragraph (text content extracted)
4. Attach each ContentBlock to the correct Chapter/Section node using the
   mapping from Pass 1.
5. Content between the start of a chapter and its first section goes into the
   chapter's own `content[]` array.

### Cleanup

The temp directory is deleted after both passes complete. Cleanup runs in a
`finally` block so it executes on both success and error paths.

### Error handling

If a content file fails to parse, log the error and skip it. The Comprehend
stage can work with a chapter that has gaps. Matches the architecture principle:
"failed extraction on one section doesn't halt chapter."

## EPUB Version Handling

Both EPUB2 and EPUB3 are common and must be supported.

| Concern    | EPUB2                                    | EPUB3                                         |
| ---------- | ---------------------------------------- | --------------------------------------------- |
| ToC        | NCX (`<navMap>` / `<navPoint>`)          | Nav document (`<nav epub:type="toc">` / `<ol>`) |
| Content    | XHTML                                    | XHTML (same)                                  |
| Footnotes  | Links to endnote files, no semantic markup | `<aside epub:type="footnote">` or `noteref`  |
| Images     | Same                                     | Same                                          |
| Package    | OPF with `<spine>` and `<manifest>`      | Same structure, more metadata options          |

**Strategy pattern:** Abstract ToC parsing behind an interface. Detect EPUB
version from the OPF, dispatch to the right parser. Both produce the same
`ChapterSkeleton` type. The rest of the pipeline does not know which version
it is working with.

```
detectVersion(opf) -> "epub2" | "epub3"

epub2: parseNcx(ncxDoc)  -> ChapterSkeleton[]
epub3: parseNav(navDoc)  -> ChapterSkeleton[]
```

Footnote resolution follows the same detect-and-dispatch pattern. Unrecognized
footnote conventions result in missing footnotes, not crashes.

## Hierarchy Strategy

**ToC-first.** The EPUB navigation document is the primary source of chapter
and section hierarchy. HTML heading enrichment (merging h1/h2/h3 tags into the
tree) is deferred to a future iteration and will only be added if it can be
proven reliable across a variety of EPUBs.

## Known Edge Cases

- **Missing or absent nav/NCX:** Some EPUBs ship without a ToC. Fall back to
  treating each spine file as a chapter, using the filename or first heading as
  the title.
- **Corrupt or missing OPF:** Unrecoverable. Fail with a clear `ParseError`
  explaining what went wrong.
- **Encoding issues:** Normalize all content to UTF-8. If a file declares a
  different encoding, convert it. If conversion fails, skip the file and log.
- **DRM-protected EPUBs:** Detect DRM (encrypted.xml in META-INF) and fail
  immediately with a clear "DRM-protected files are not supported" error.
  Do not attempt to process.
- **Large images:** For v1, all images are loaded into memory. This is a known
  limitation. If an EPUB has very large images (100MB+), memory pressure is
  possible. A future iteration can externalize images to disk and store paths
  instead of buffers.

## Dependencies

| Need             | Library            | Rationale                                          |
| ---------------- | ------------------ | -------------------------------------------------- |
| Unzip EPUB       | `fflate`           | Pure JS, fast, no native bindings. Works in Bun.   |
| Parse HTML/XHTML | `node-html-parser` | Lightweight, fast. Full DOM API not needed.         |
| Parse XML        | `fast-xml-parser`  | OPF and NCX are XML. Minimal, no native deps.      |

No native dependencies. Everything runs in Bun without build steps.

## Module Structure

```
engine/src/parse/
  index.ts          — public entry: parse(input) -> DocumentTree
  epub-reader.ts    — unzip, read OPF, resolve paths within the archive
  toc-parser.ts     — detect version, parse NCX or Nav -> ChapterSkeleton[]
  content-parser.ts — walk HTML DOM -> ContentBlock[]
  types.ts          — DocumentTree, Chapter, Section, ContentBlock, etc.

engine/test/parse/
  index.test.ts          — integration: full EPUB -> DocumentTree
  epub-reader.test.ts    — unit: unzip, OPF parsing
  toc-parser.test.ts     — unit: NCX and Nav parsing
  content-parser.test.ts — unit: HTML -> ContentBlock conversion
  fixtures/
    minimal.epub         — simple well-formed EPUB3
    epub2-sample.epub    — EPUB2 with NCX
    multi-chapter.epub   — chapters, sections, images, tables
    footnotes.epub       — various footnote patterns
```

**Information hiding:** `parse/index.ts` is the only public surface. Downstream
stages import `parse()` and `DocumentTree`. Internal modules, the two-pass
strategy, library choices, and footnote resolution logic do not leak out.
