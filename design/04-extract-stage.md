# Extract Stage Design

The third stage of the Learn pipeline. Takes a ComprehensionMap (from
Comprehend) and raw section content (from Parse) and produces candidate
atoms — micro-frames with typed roles following the atom design from
the vision doc.

Uses a cheap model (Haiku tier), one call per section. The ComprehensionMap
tells the cheap model what to look for — that's the leverage of the
two-tier design.

## Constraints

- **One cheap-model call per section.** Many calls per chapter, but each is
  small and inexpensive.
- **Skip trivial sections.** Sections with fewer than 3 content blocks
  (front matter, copyright, headings-only) produce no atoms.
- **Full frame type schema in every call.** All 17 core types + any
  registered domain types are included in the prompt. Explicit over clever.
- **Fail gracefully per section.** A failed extraction on one section does
  not halt the chapter. Log, skip, continue.
- **Atoms are candidates until Integrate validates them.**

## Input/Output Contract

### Input

```typescript
ExtractInput {
  chapter: NormalizedChapter         // from structure inference
  comprehensionMap: ComprehensionMap // from Comprehend
  bookMetadata: DocumentMetadata
  registry: FrameTypeRegistry       // core + any domain types registered so far
  provider: LLMProvider             // cheap model (Haiku tier)
}
```

### Output

```typescript
ExtractionResult {
  atoms: CandidateAtom[]
  proposedFrameTypes: ProposedFrameType[]
  usage: {
    inputTokens: number
    outputTokens: number
    callCount: number
  }
  skippedSections: string[]          // section IDs below content threshold
  flaggedAtoms: string[]             // atom IDs that are incomplete
}

CandidateAtom {
  id: string                         // deterministic: bookId-chapterId-sectionId-index
  frame: string                      // frame type name (core or proposed)
  roles: Record<string, string>      // named key-value pairs — the knowledge
  conditions: string[]               // when this atom applies
  confidence: number                 // 0.0-1.0, model-proposed then pipeline-adjusted
  source: {
    title: string
    authors: string[]
    chapterId: string
    sectionId: string
  }
  domain: string[]                   // topic tags
  examples: string[]                 // optional supporting illustrations
  flags: string[]                    // validation issues (empty = clean atom)
}

ProposedFrameType {
  name: string
  roles: Record<string, string>      // role name → description
  description: string
  proposedBy: string                 // sectionId where first proposed
}
```

Key decisions:

- **`CandidateAtom`, not `Atom`.** These are candidates until the Integrate
  stage validates and merges them. The "candidate" prefix signals they're
  not final.
- **`flags` field on atoms.** Validation issues are attached to the atom
  itself. The Integrate stage sees exactly what's wrong with each atom.
- **`ProposedFrameType`** collects new domain types proposed during
  extraction. Deduplicated across sections, registered if valid.
- **Deterministic IDs.** `{bookSlug}-{chapterId}-{sectionId}-{index}` where
  `bookSlug` is derived from `kebab-case(title)` truncated to 40 chars, and
  `index` is the 0-based ordinal position of the atom within the section's
  extraction result. Re-extracting may produce different ordering, so IDs
  are stable within a single extraction run but not across re-runs.

## Frame Type Registry

The central catalog of frame types. Core types ship with Metis; domain
types are proposed during extraction.

### Registry Interface

```typescript
FrameTypeRegistry {
  get(name: string): FrameType | undefined
  getAll(): FrameType[]
  getCoreTypes(): FrameType[]
  register(proposed: ProposedFrameType): FrameType
  has(name: string): boolean
}

FrameType {
  name: string                    // e.g., "definition", "causal_chain"
  roles: Record<string, string>  // role name → description of what fills it
  requiredRoles: string[]        // role names that must be filled for a valid atom
  description: string
  category: "core" | "domain-specific"
  domain?: string                // null for core, e.g., "industry-analysis"
  version: number                // starts at 1, incremented if schema changes
}
```

### Core Frame Types (17)

From the vision doc, pre-registered:

| Type | Roles | Purpose |
|------|-------|---------|
| `definition` | term, meaning | What something means |
| `has_property` | entity, property | Attributes of an entity |
| `is_a` | instance, category | Classification |
| `consists_of` | whole, dimension, description | Composition/structure |
| `example_of` | instance, concept, detail | Instantiation |
| `taxonomy` | concept, categories, basis | Ordered classifications |
| `causal` | cause, effect | Simple causation |
| `causal_chain` | trigger, mechanism, outcome | Multi-step causation |
| `heuristic` | situation, action, rationale | Actionable guidance |
| `principle` | statement, implication, scope | Deep truths |
| `procedure` | goal, steps, context | Ordered action steps |
| `formula` | name, expression, terms | Mathematical/logical relationships |
| `deviation` | theory, reality, implication | Theory vs. reality gaps |
| `threshold` | metric, threshold_value, transition, direction | Numeric boundaries |
| `method_comparison` | method_a, method_b, difference, when_to_use | Comparing approaches |
| `sequence` | name, layers, rule | Ordered layers/stages |
| `evaluation_matrix` | name, dimensions, quadrants, rule | Multi-dimensional assessment |

### Domain Type Registration Flow

1. Model proposes a new type during extraction (inline with atoms).
2. Pipeline checks: does a type with this name already exist? If yes, skip.
3. Pipeline checks: is the proposed type structurally valid? (has name,
   ≥2 roles, has description)
4. If valid and new, register it. Future sections in the same book can use it.
5. After the full book is extracted, proposed types are persisted alongside
   the atoms.

**Deduplication:** If two sections propose the same type name with slightly
different role schemas, the first registration wins. The second proposal
is logged but skipped.

### Storage

Core types stored in `engine/data/core-frames.json` (checked into git).
Domain types stored in memory during extraction, persisted alongside
extraction output.

## Extraction Pipeline

### Per-Section Flow

For each section in the normalized chapter:

1. **Filter:** If section has fewer than 3 content blocks, skip it. Add
   section ID to `skippedSections`.
2. **Build prompt:** Section content (serialized to markdown) +
   SectionAnalysis context from ComprehensionMap + full frame type
   schemas (all 17 core + any registered domain types).
3. **Call cheap model** (Haiku tier) with the prompt.
4. **Parse response** into `CandidateAtom[]` and optional
   `ProposedFrameType[]`.
5. **Register proposed types** in the registry (if valid and new).
6. **If section fails** (bad JSON, LLM error): log, skip, continue to next
   section. Zero atoms from this section.

### Prompt Design

The extraction prompt includes:

- **System message:** "You are a knowledge extractor. Given a section of a
  book, produce atomic knowledge units (atoms) as JSON."
- **Frame type reference:** All frame types with their role schemas, so the
  model knows exactly what shapes to produce.
- **SectionAnalysis context:** From the ComprehensionMap — tells the model
  what kind of knowledge is in this section and what concepts to look for.
- **Section content:** The actual text, serialized as markdown.
- **Output format:** JSON array of atoms + optional array of proposed types.

Prompts live in `prompts.ts`, separate from pipeline logic.

### Atom Validation (Lenient)

After extraction, each atom goes through validation:

**Accept (clean atom):**
- Has a valid frame type (core or registered domain)
- All `requiredRoles` for that frame type are filled

**Accept with flags:**
- Missing optional roles (not in `requiredRoles`) → flag `"missing_role:{name}"`
- Missing a required role → flag `"missing_required_role:{name}"`, confidence penalty
- Empty conditions array → flag `"no_conditions"`
- Frame type doesn't match SectionAnalysis prediction → flag `"unexpected_frame_type"`

**Reject (dropped):**
- No frame type → reject
- Zero roles filled → reject
- Frame type not in registry (core or domain) → reject

### Confidence Scoring

Model proposes initial confidence (0.0-1.0). Pipeline adjusts:

| Condition | Adjustment |
|-----------|------------|
| All roles for the frame type filled | +0.05 |
| Has conditions | +0.05 |
| Frame type matches SectionAnalysis `knowledgeTypes` | +0.05 |
| Missing required roles | −0.1 |
| Has validation flags | −0.1 |

Clamped to [0.0, 1.0] after adjustments.

## Context Window and Rate Limiting

**Token estimation:** Reuse the CJK-aware heuristic from the Comprehend
stage (`estimateTokens`). Before each call, estimate: section content +
frame type schemas (~2-3k tokens) + SectionAnalysis context (~200 tokens)
+ prompt overhead (~500 tokens). If total exceeds 80% of the cheap model's
context window, truncate the section content with a `[Content truncated]`
marker and log a warning.

**Concurrency:** Sections within a chapter are processed **sequentially**.
Same rationale as Comprehend: predictable cost, no rate limit storms, and
the registry is shared mutable state (new domain types register as
sections are processed). Sequential ensures a type proposed in section 3
is available for section 4.

**Rate limiting:** The `withRetry` wrapper from the LLM provider module
handles rate limit errors with exponential backoff. For books with many
sections (100+), add a small delay (100ms) between calls to stay under
rate limits proactively.

## NormalizedChapter Access

The Extract stage needs `NormalizedChapter` from the Comprehend stage's
structure inference. This type is re-exported from `comprehend/index.ts`
as part of the Comprehend module's public API. Extract imports it from
the comprehend module, not from internal files.

## Error Handling

- **Section-level failure:** Log the error, skip the section, continue.
  Zero atoms from that section. Same philosophy as Parse and Comprehend:
  partial results are better than no results.
- **Auth / config error:** Fail immediately with `ExtractError` code
  `PROVIDER_AUTH_FAILED`. No point processing more sections with bad
  credentials.
- **Malformed JSON response:** Inner retry (up to 2 attempts) for JSON
  parse failures, same pattern as chapter-comprehender.

```typescript
class ExtractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "LLM_CALL_FAILED"
      | "RESPONSE_PARSE_FAILED"
      | "PROVIDER_AUTH_FAILED",
    public readonly sectionId?: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}
```

## Module Structure

```
engine/src/extract/
  index.ts              — public entry: extract(input) → ExtractionResult
  types.ts              — CandidateAtom, ProposedFrameType, ExtractionResult
  errors.ts             — ExtractError typed error
  frame-registry.ts     — load core types, register domain types, query
  section-extractor.ts  — one section → CandidateAtom[] via LLM
  atom-validator.ts     — validate atoms, flag issues, adjust confidence
  prompts.ts            — extraction prompt templates

engine/data/
  core-frames.json      — 17 core frame types with role schemas

engine/test/extract/
  frame-registry.test.ts     — load, register, deduplicate
  section-extractor.test.ts  — with mock provider
  atom-validator.test.ts     — validation rules, confidence adjustment
  index.test.ts              — integration with mock provider
  fixtures/
    mock-provider.ts         — reuse from comprehend tests
    sample-section.ts        — sample section content for testing
```

**Information hiding:** `extract/index.ts` is the only public surface.
The frame registry, section extractor, validator, and prompts are internal.

## Dependencies

No new dependencies. Reuses:
- `engine/src/llm/` — LLMProvider interface (same as Comprehend)
- `engine/src/comprehend/` — ComprehensionMap, NormalizedChapter types
- `engine/src/comprehend/` — NormalizedChapter, ComprehensionMap types, and
  content serialization (all accessed via comprehend module's public API)
