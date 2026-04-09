# Ingest Stage Design

The first stage of the Seisei pipeline. Takes source files in various
formats and produces KXDocuments — one per source.

The goal is normalization: every downstream stage works with KX only.
Ingest adapters are format-specific; the rest of Seisei is
format-agnostic.

## Constraints

- **One KXDocument per source.** Each source file produces exactly one
  KXDocument. Multi-source merging happens in Stage 2, not here.
- **No cross-source awareness.** An adapter processes one file at a
  time. It doesn't know about other sources.
- **KX passthrough is free.** If the input is already a `.kx.json`
  file, validate and pass through — no LLM call.
- **Cheap model for extraction.** Text-based adapters use a cheap
  model (Haiku tier). This is lightweight extraction, not deep
  comprehension.
- **Fail per source.** A failed adapter doesn't halt the pipeline.
  Log the error, skip the source, continue with others.

---

## Adapter Interface

Every adapter implements this contract:

```typescript
interface IngestAdapter {
  /** File extensions this adapter handles */
  extensions: string[];

  /** Whether this adapter needs an LLM */
  requiresLLM: boolean;

  /** Convert a source file to KX */
  ingest(input: IngestInput): Promise<IngestResult>;
}

interface IngestInput {
  filePath: string;
  content: string | Buffer;       // text or binary
  provider?: LLMProvider;         // only if requiresLLM
  options?: IngestOptions;
}

interface IngestOptions {
  maxUnits?: number;              // cap extraction (default: 200)
  minConfidence?: number;         // drop units below this (default: 0.5)
  domains?: string[];             // hint: expected domains
}

interface IngestResult {
  document: KXDocument;
  stats: {
    unitsExtracted: number;
    unitsDropped: number;         // below confidence threshold
    inputTokens: number;
    outputTokens: number;
  };
  warnings: string[];             // non-fatal issues
}
```

---

## Adapters

### KX Reader (`kx-reader`)

**Extensions:** `.kx.json`

Passthrough adapter. Reads the file, validates against the KX schema,
and returns it. No LLM needed.

**Validation checks:**
1. `version` field present and major version is recognized.
2. Every unit has `id`, `kind`, `content`, `confidence`, `source`.
3. Every relation references valid unit IDs.
4. No duplicate unit IDs.

Invalid documents are rejected with a descriptive error. No partial
results — a KX document is valid or it isn't.

```typescript
class KXReader implements IngestAdapter {
  extensions = [".kx.json"];
  requiresLLM = false;

  async ingest(input: IngestInput): Promise<IngestResult> {
    const doc = JSON.parse(input.content as string);
    validate(doc);  // throws on invalid
    return {
      document: doc,
      stats: { unitsExtracted: doc.units.length, unitsDropped: 0,
               inputTokens: 0, outputTokens: 0 },
      warnings: [],
    };
  }
}
```

### Text Extractor (`text-extractor`)

**Extensions:** `.md`, `.txt`, `.text`

Extracts knowledge units from unstructured or semi-structured text.
Uses one LLM call per source file (or chunked if the file exceeds
the context window).

**Extraction strategy:**

1. **Chunk** the text into segments that fit the model's context
   window (leave room for the prompt and output). Prefer splitting
   on section headers, paragraph breaks, or sentence boundaries.
2. **Extract** units from each chunk with a prompt that asks for:
   - Heuristics, principles, procedures, definitions, comparisons,
     examples, evaluations, deviations.
   - Each unit as a natural language `content` statement + a `kind`.
   - Conditions under which the knowledge applies.
   - A confidence score (how clearly the text states this vs implies it).
3. **Assemble** extracted units into a KXDocument with source metadata.

**Prompt design:**

The prompt provides:
- The KX kind taxonomy (12 types with descriptions and examples).
- The text chunk.
- Instructions to extract only claims explicitly stated or strongly
  implied — not inferences or interpretations.
- Instructions to write `content` as a standalone statement (no
  "the author says" or "according to the text").

**Chunking strategy:**

```typescript
interface ChunkOptions {
  maxTokens: number;          // per chunk (default: 6000)
  overlap: number;            // tokens of overlap between chunks (default: 200)
  splitOn: "headers" | "paragraphs" | "sentences";
}
```

Headers preferred for markdown. Paragraphs for plain text. Sentences
as last resort for dense text.

### PDF Extractor (`pdf-extractor`)

**Extensions:** `.pdf`

Extracts text from PDF, then delegates to the text extractor.

```
PDF → text extraction (pdf-parse) → text-extractor pipeline
```

Two-step because PDF text extraction is a solved, non-LLM problem.
The LLM only sees clean text.

**Known issues:**
- Multi-column PDFs may produce interleaved text. The text extractor
  is instructed to tolerate some noise.
- Scanned PDFs (image-only) are not supported in v1. Fail with a
  clear error message.
- Tables in PDFs often lose structure. Accept lossy extraction.

### Notes Parser (`notes-parser`)

**Extensions:** `.notes`, or passed via `--source-type notes`

For rough, informal notes: bullet points, fragments, shorthand.
Uses the same LLM extraction as text-extractor but with a different
prompt that:

- Tolerates incomplete sentences and abbreviations.
- Infers structure from indentation and bullet patterns.
- Assigns lower default confidence (0.7) since notes are less
  authoritative than published material.
- Tags all units with `source.type = "notes"` so downstream stages
  can weight accordingly.

### Transcript Extractor (`transcript-extractor`)

**Extensions:** `.transcript`, `.vtt`, `.srt`, or passed via
`--source-type transcript`

For conversation transcripts, meeting notes, interview records.

**Differences from text extractor:**
- Filters out conversational filler ("um", "you know", "so basically").
- Attributes statements to speakers when speaker labels are present.
- Treats questions differently from assertions — questions are not
  extracted as knowledge unless answered in the transcript.
- Lower default confidence (0.7) since spoken statements are less
  precise than written ones.

---

## Source Metadata

Every adapter populates the KXDocument's `meta.sources` array:

```typescript
// Source type mapping
const sourceTypeMap: Record<string, KXSourceType> = {
  ".kx.json": "other",        // preserves original source types
  ".md": "guide",
  ".txt": "other",
  ".pdf": "other",             // could be book, article, etc.
  ".notes": "notes",
  ".transcript": "transcript",
};
```

For PDF and text files, the adapter attempts to extract title and
author from the content (first heading, metadata fields). Falls
back to filename.

---

## Adapter Selection

```typescript
function selectAdapter(filePath: string, sourceType?: string): IngestAdapter {
  if (sourceType) {
    // Explicit override: --source-type notes
    return adaptersByType[sourceType];
  }
  const ext = path.extname(filePath);
  const adapter = adaptersByExtension[ext];
  if (!adapter) {
    throw new Error(`No adapter for extension: ${ext}`);
  }
  return adapter;
}
```

The `--source-type` flag overrides extension-based selection. This
handles cases like a `.txt` file that's actually a transcript.

---

## Parallelism

Sources are independent, so ingestion runs in parallel:

```typescript
async function ingestAll(
  sources: string[],
  provider: LLMProvider,
  options: IngestOptions,
): Promise<IngestResult[]> {
  const results = await Promise.allSettled(
    sources.map(source => {
      const adapter = selectAdapter(source);
      return adapter.ingest({ filePath: source, content: readFile(source), provider, options });
    })
  );
  // Log failures, return successes
  return results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);
}
```

LLM rate limits may throttle parallelism. Use a concurrency limiter
(e.g., `p-limit`) to cap concurrent LLM calls.

---

## Cost Profile

```
KX passthrough:    0 tokens, 0 calls
Text (1 page):     ~2K input + ~1K output = ~3K tokens, 1 call
Text (20 pages):   ~40K input + ~10K output = ~50K tokens, 4-7 calls
PDF (10 pages):    same as text after extraction
Notes (1 page):    ~1K input + ~500 output = ~1.5K tokens, 1 call

All cheap-model calls. Total ingest cost for 5 mixed sources: <$0.05
```

---

## Open Questions

1. **Image extraction.** Should the PDF adapter extract diagrams and
   charts? Vision models could describe them, but adds cost and
   complexity. Probably v2.
2. **Deduplication within a source.** If a text repeats the same
   point in different words, should the adapter deduplicate? Or leave
   it to the merge stage?
3. **Language detection.** Should adapters detect source language and
   tag units? Useful for multi-language skill generation.
4. **Streaming large files.** For very large PDFs (100+ pages), should
   the adapter stream chunks to avoid memory pressure?
