# Comprehend Stage Design

The second stage of the Learn pipeline. Takes a DocumentTree from Parse and
produces a ComprehensionMap for each chapter — a structured understanding of
what knowledge exists in the chapter and how it's organized. This map becomes
context for the Extract stage (cheap model).

This is the first stage that calls an LLM. It also establishes the LLM
provider interface that all future pipeline stages will use.

## Constraints

- **One capable-model call per chapter + one synthesis call for the book.**
  Total cost: N+1 calls where N = number of chapters.
- **Multi-provider.** Must support Anthropic, OpenAI, Gemini, and Kimi behind
  a common interface. Only Anthropic adapter ships in v1.
- **Fail gracefully per chapter.** A failed comprehension call produces a
  minimal map. Does not halt the book.
- **Structure inference is rule-based.** Normalizing flat/broken parse trees
  into clean sections happens before any LLM call. Don't burn expensive
  tokens on mechanical work.

## Input/Output Contract

### Input

```typescript
ComprehendInput {
  documentTree: DocumentTree       // from Parse stage
  providerConfig: {
    provider: "anthropic" | "openai" | "gemini" | "kimi"
    model: string                  // e.g., "claude-sonnet-4-20250514"
    apiKey?: string                // optional — adapters fall back to env vars
  }
}
```

API keys should be sourced from environment variables (e.g.,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). The `apiKey` field allows explicit
configuration; adapters fall back to standard environment variable names
if not provided. Never hardcode keys.

### Output

```typescript
ComprehensionResult {
  bookSynthesis: BookSynthesis
  chapterMaps: ComprehensionMap[]
  usage: {
    totalInputTokens: number
    totalOutputTokens: number
    callCount: number
    failedChapters: string[]       // chapter IDs that fell back to minimal maps
  }
}

ComprehensionMap {
  chapterId: string
  chapterType: "framework" | "survey" | "argumentative" | "narrative" | "practical" | "unknown"
  summary: string                    // 2-3 sentence overview
  structures: KnowledgeStructure[]
  sectionAnalyses: SectionAnalysis[]
}

KnowledgeStructure {
  name: string                       // e.g., "Fogg Behavior Model"
  type: "model" | "comparison" | "taxonomy" | "progression" | "process" | "debate"
  components: string[]               // what it's made of
  sectionIds: string[]               // which sections contribute
}

SectionAnalysis {
  sectionId: string                  // from parse tree OR inferred from headings
  title: string                      // carried here because parse tree may not have it
  purpose: string                    // what this section is doing
  knowledgeTypes: string[]           // atom types to look for: "definition",
                                     // "comparison", "causal", "procedure", etc.
  conceptsIntroduced: string[]       // new terms/ideas defined here
  conceptsReferenced: string[]       // terms from other sections used here
  buildsOn: string[]                 // sectionIds this depends on understanding
  significance: string               // why this section matters to the chapter
}

BookSynthesis {
  crossCuttingThemes: Theme[]
  entityIndex: EntityEntry[]
  bookType: string                   // overall book classification
}

Theme {
  name: string
  description: string
  chapterIds: string[]               // which chapters touch this theme
}

EntityEntry {
  name: string
  aliases: string[]                  // different names for same concept
  chapterIds: string[]
}
```

Key decisions:

- **ComprehensionMap is a typed contract between Comprehend and Extract.** The
  Extract stage receives a chapter's raw content plus its ComprehensionMap and
  uses the map to know what atoms to look for in each section.
- **chapterType covers five real book patterns** discovered by testing against
  8 real books: framework/methodology (福格行为模型), survey/landscape (DDIA
  Ch3), argumentative/thesis (制度基因), narrative/essay (写出我心), and
  practical guide (我的最后一本减肥书).
- **KnowledgeStructure captures the shapes of knowledge** in a chapter —
  models, comparisons, taxonomies, progressions. This directly tells Extract
  what frame types to look for.
- **SectionAnalysis carries its own title** because the parse tree often
  doesn't have section-level structure (tested: Out of Control, 如何快速了解
  一个行业, 法国思想四百年 all had flat or broken nav).

## Three-Phase Architecture

### Phase 1: Structure Inference (rule-based, no LLM)

Before any LLM calls, normalize the parse tree so every book looks
well-structured regardless of EPUB quality.

Input: `DocumentTree` from Parse.
Output: `NormalizedChapter[]` where every chapter has sections.

Algorithm:

1. Walk each chapter in the document tree.
2. If the chapter already has sections from the parse tree, use them as-is.
3. If the chapter is flat (0 sections) but has heading blocks (H2, H3) in
   its content, split content at heading boundaries to create synthetic
   sections with deterministic IDs (`inferred-{kebab-title}-{index}`).
4. If the chapter has no headings and exceeds 100 blocks, split into chunks
   of ~50 blocks at paragraph boundaries. Use "Part 1", "Part 2" as titles.
5. If the chapter is small and flat, treat the whole thing as a single section.

```typescript
NormalizedChapter {
  id: string
  title: string
  order: number
  sections: NormalizedSection[]
  metadata: ChapterMetadata
}

NormalizedSection {
  id: string
  title: string
  level: number
  content: ContentBlock[]
  sections: NormalizedSection[]      // recursive
}

ChapterMetadata {
  totalBlockCount: number            // across all sections
  hasImages: boolean
  estimatedTokens: number            // for context window checks
}
```

**Relationship to Parse types:** `NormalizedChapter` replaces `Chapter` for
comprehend processing. The Parse stage's `Chapter.content` (blocks before
the first section) becomes the content of a synthetic first section titled
with the chapter title, or is prepended to the first existing section.
No content is dropped.

This phase fixes the problems observed in real EPUBs:

- 如何快速了解一个行业: Part 1 (2129 blocks, 0 sections) → 8 chapters with
  sections, split at H2/H3 boundaries
- 法国思想四百年: Section0001-0068 with no meaningful titles → headings in
  content used for section titles
- Out of Control: 24 chapters with 0 sections → H3 headings create sections
- 我的最后一本减肥书: 3 giant "parts" → split into chapters at H2 boundaries

### Phase 2: Chapter Comprehension (one LLM call per chapter)

For each normalized chapter, send the content and section structure to the
capable model. The model produces a `ComprehensionMap` as structured JSON.

The model receives:
- Chapter title, position in the book, and book metadata
- All section titles and their content as text
- Images (if the provider supports vision)
- The response schema (as JSON Schema for providers with structured output,
  or as instructions in the system prompt for those without)

Processing:
- Chapters are processed **sequentially** (not parallel) to keep cost
  predictable and avoid rate limit issues
- Before sending, estimate token count. If a chapter exceeds the provider's
  context window, split at section boundaries into multiple calls and merge
  the resulting maps
- If a call fails after 2 retries, produce a **minimal map**: chapterType
  "unknown", empty structures, section analyses with just IDs and titles

### Phase 3: Book Synthesis (one LLM call for the whole book)

After all chapter maps are built, one final call sees:
- Book metadata (title, authors)
- All chapter maps (NOT raw content — maps are compact)

The model produces a `BookSynthesis` with cross-cutting themes and entity
index. This is cheap because it reads maps, not full text.

If the synthesis call fails, log and skip. Chapter maps are the primary
output; synthesis is valuable but not critical.

## LLM Provider Interface

All LLM calls go through this interface. Pipeline stages never import an
SDK directly.

### Core Interface

```typescript
interface LLMProvider {
  sendMessage(request: LLMRequest): Promise<LLMResponse>
  capabilities: ProviderCapabilities
}

interface LLMRequest {
  messages: Message[]
  responseSchema?: JsonSchema      // structured output
  maxTokens?: number
  temperature?: number
}

interface Message {
  role: "system" | "user" | "assistant"
  content: MessageContent[]
}

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; data: Uint8Array; mediaType: string }

interface LLMResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

interface ProviderCapabilities {
  vision: boolean
  structuredOutput: boolean        // native JSON schema support
  maxContextTokens: number
}
```

### Provider Adapters

Each provider gets an adapter that implements `LLMProvider`:

- `anthropic-adapter.ts` — translates to Anthropic SDK calls (v1)
- `openai-adapter.ts` — future
- `gemini-adapter.ts` — future
- `kimi-adapter.ts` — future

The `createProvider(config)` factory function returns the right adapter
based on `config.provider`.

### Structured Output Handling

When `responseSchema` is provided:
- If the provider supports native structured output (Anthropic, OpenAI,
  Gemini all do), the adapter passes the schema to the API
- For providers without native support, the adapter injects "respond with
  this JSON format" into the system prompt and parses the response
- Response validation has two levels:
  1. **Structural:** JSON parses and matches the schema shape. If not, retry.
  2. **Quality:** sectionAnalyses count roughly matches section count,
     at least one KnowledgeStructure exists, no empty-string fields. If
     quality checks fail, log a warning but accept the response — sparse
     output is better than no output.

### Retry Logic

Retry logic lives in a shared wrapper above adapters, not in each adapter:
- Retry on network errors, rate limits, and malformed JSON responses
- Up to 2 retries per call
- Exponential backoff on rate limits
- If retries exhausted, throw `ComprehendError` with code

### Capabilities and Graceful Degradation

Pipeline stages check `provider.capabilities` before using optional features:
```
if (provider.capabilities.vision) {
  // include images in the message
}
```
If a provider doesn't support vision, images are omitted and the model
works with text only. The comprehension quality may decrease for
diagram-heavy chapters, but the pipeline doesn't fail.

## Prompt Design

Prompts live in a dedicated `prompts.ts` file, separate from pipeline logic.
Prompt engineering is iterative — this file changes frequently without
touching the pipeline.

### Chapter Comprehension Prompt

```
System: You are an expert reader analyzing a book chapter. Your job is to
produce a structured comprehension map that will guide a downstream system
in extracting atomic knowledge from each section.

You will receive:
- The chapter's title, position in the book, and metadata
- The chapter's sections with their content

Produce a JSON object matching the provided schema. Focus on:
1. What TYPE of chapter is this? (framework, survey, argumentative,
   narrative, practical)
2. What KNOWLEDGE STRUCTURES does it contain? (models, comparisons,
   taxonomies, progressions, processes, debates)
3. For EACH SECTION: what is its purpose, what kinds of knowledge should
   be extracted, and what concepts does it introduce or reference?

Think about what an extractor needs to know to pull the right atoms from
each section. Do not extract atoms yourself — describe what's there so the
extractor knows what to look for.
```

### Book Synthesis Prompt

```
System: You have read comprehension maps for every chapter of a book.
Identify cross-cutting themes that span multiple chapters and build an
entity index of key concepts with their aliases.

You do NOT have the raw chapter content — only the chapter maps.
Work from those.
```

### Content Serialization

Each `ContentBlock` type is serialized into the LLM message as follows:

- **paragraph** → text as-is
- **heading** → `## Title` (with # count matching the level)
- **table** → markdown table format (`| A | B |\n|---|---|\n| C | D |`)
- **list** → markdown list (`- item` or `1. item`, with indentation for nesting)
- **code** → fenced code block (`` ```language\ncode\n``` ``)
- **blockquote** → `> text`
- **footnote** → `[Footnote {id}]: text` appended after the paragraph that
  references it
- **image** → if provider supports vision, sent as a separate `MessageContent`
  image part. Otherwise, `[Image: {alt text or originalPath}]` placeholder.

Section boundaries are marked with clear delimiters:

```
=== Section: {title} (id: {sectionId}) ===
{serialized content blocks}
```

This format is unambiguous for the LLM and easy to reference in the response.

### Token Estimation

Before sending a chapter, estimate token count to check against the
provider's context window.

Strategy: conservative character-based heuristic with a safety margin.

- **English text:** chars / 4
- **CJK text:** chars / 2 (CJK characters typically tokenize to 1-2 tokens each)
- **Mixed text:** detect CJK ratio, interpolate between the two rates
- **Safety margin:** use 80% of `provider.capabilities.maxContextTokens`

This is intentionally conservative. Oversplitting a chapter into two calls
is cheaper than hitting a context overflow error and retrying.

### Token Budget

For a typical 100-block chapter, content is roughly 5-10k tokens. Prompt
and schema instructions add ~1k. Response (one ComprehensionMap) is ~1-2k.
Well within context limits for capable models. Monster chapters are split
at section boundaries during Phase 2.

## Error Handling

- **Chapter-level failure:** After 2 retries, produce a minimal map
  (chapterType "unknown", section analyses with IDs/titles only). Log the
  error. Don't halt the book.
- **Synthesis failure:** Log and skip. Chapter maps are the primary output.
- **Provider auth failure:** Fail immediately with `PROVIDER_AUTH_FAILED`.
  No point retrying.
- **Context too long:** Split chapter at section boundaries and retry as
  multiple calls. If individual sections are still too long, truncate with
  a warning.

```typescript
class ComprehendError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "LLM_CALL_FAILED"
      | "RESPONSE_PARSE_FAILED"
      | "CONTEXT_TOO_LONG"
      | "PROVIDER_AUTH_FAILED",
    public readonly chapterId?: string,
  ) {
    super(message);
    this.name = "ComprehendError";
  }
}
```

**Partial results are better than no results.** If 11 of 12 chapters
succeed, we return 11 good maps + 1 minimal map. The Extract stage works
with what it gets.

## Module Structure

```
engine/src/
  llm/
    types.ts              — LLMProvider, LLMRequest, LLMResponse, capabilities
    provider.ts           — createProvider() factory, retry wrapper
    anthropic-adapter.ts  — Anthropic SDK → LLMProvider
  comprehend/
    types.ts              — ComprehensionMap, KnowledgeStructure, SectionAnalysis
    index.ts              — public entry: comprehend(input) → ComprehensionResult
    structure-inference.ts — rule-based: DocumentTree → NormalizedChapter[]
    chapter-comprehender.ts — one chapter → ComprehensionMap (prompt + LLM call)
    book-synthesizer.ts   — all chapter maps → BookSynthesis (prompt + LLM call)
    prompts.ts            — prompt templates, separate for easy iteration
    errors.ts             — ComprehendError typed error

engine/test/
  llm/
    provider.test.ts      — retry logic, schema validation
    anthropic-adapter.test.ts — against mock/recorded responses
  comprehend/
    structure-inference.test.ts — flat chapters → normalized sections
    chapter-comprehender.test.ts — with mock LLM provider
    book-synthesizer.test.ts — with mock LLM provider
    index.test.ts         — full DocumentTree → ComprehensionResult
    fixtures/             — sample content + expected maps
```

**Information hiding:** `comprehend/index.ts` is the only public surface.
Prompts are isolated from pipeline logic for independent iteration.

`engine/src/llm/` is a **shared module** used by all pipeline stages that
make LLM calls. It is defined in this spec because Comprehend is the first
stage to need it, but it has no dependency on the comprehend module.

**Concurrency:** Sequential chapter processing is a v1 simplification. A
future iteration may add a `concurrency` option to process N chapters in
parallel, with rate-limit-aware scheduling.

## Dependencies

New dependency for v1:
- `@anthropic-ai/sdk` — Anthropic API client

Future (not v1):
- `openai` — OpenAI adapter
- Provider SDKs for Gemini and Kimi

## Empirical Validation

This design was informed by parsing 8 real books spanning five knowledge
patterns:

| Book | Language | Pattern | Key challenge |
|------|----------|---------|---------------|
| Designing Data-Intensive Applications | EN | survey/framework | Deep technical comparisons |
| 如何快速了解一个行业 | ZH | framework/methodology | Flat EPUB (2129 blocks, 0 sections) |
| 写出我心 | ZH | narrative/essay | 72 micro-chapters (5-30 blocks each) |
| 制度基因 | ZH | argumentative/thesis | Dense historical argumentation |
| Out of Control | EN | narrative/survey | No sections, H3 headings in content |
| 我的最后一本减肥书 | ZH | practical guide | 3 giant "parts" as chapters |
| 法国思想四百年 | ZH | narrative/historical | Section0001-0068, no meaningful nav |
| 福格行为模型 | ZH | framework/practical | Model + application pattern |

The five chapter types, structure inference algorithm, and KnowledgeStructure
taxonomy were derived from these real examples, not theoretical design.
