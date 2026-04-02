# Metis: Implementation Plan (TDD)

## Reference

- **Spec:** `design/05-resume-demo-spec.md`
- **Architecture:** `design/01-architecture.md`
- **Branch:** `feat/comprehend-stage` (continue on current branch)

## Approach

Test-Driven Development throughout. For each module:
1. Write the test file with failing tests
2. Implement just enough code to pass
3. Refactor if needed
4. Move to the next module

Tests use Bun's native test runner (`bun:test`). Mock LLM/embedding calls in
unit tests. Integration tests use real data from `engine/graph/`.

---

## Phase 1: Hybrid Retrieval Engine

**Goal:** `bun run src/run-retrieve.ts "query"` returns ranked atoms.

### Step 1.1 — BM25 Tokenizer

**Test file:** `engine/test/retrieve/tokenizer.test.ts`

```
Tests to write FIRST:
- tokenizes English text into lowercase terms
- splits on non-alphanumeric characters
- filters common English stopwords ("the", "is", "a", "of", ...)
- handles CJK text with character bigrams ("行业生命" → ["行业", "业生", "生命"])
- handles mixed EN/CJK text correctly
- returns empty array for empty string
- deduplicates tokens (returns unique terms with counts)
```

**Implementation:** `engine/src/retrieve/tokenizer.ts`

```typescript
// Exports:
tokenize(text: string): string[]
tokenizeWithFrequency(text: string): Map<string, number>
```

~60 lines. Pure function, no dependencies.

### Step 1.2 — BM25 Index

**Test file:** `engine/test/retrieve/bm25.test.ts`

```
Tests to write FIRST:
- builds index from array of documents (id + text)
- computes correct IDF for terms (rare terms score higher)
- scores a single document against a query
- ranks documents by relevance (known-answer test with 5 sample atoms)
- returns empty results for query with no matching terms
- handles query terms not in corpus (IDF = 0, no crash)
- respects top-k limit
- documents with more matching terms rank higher than single-term matches
```

**Implementation:** `engine/src/retrieve/bm25.ts`

```typescript
// Exports:
buildBM25Index(docs: Array<{ id: string; text: string }>): BM25Index
queryBM25(index: BM25Index, query: string, topK: number): Array<{ id: string; score: number }>
```

~80 lines. Depends on `tokenizer.ts`. Uses standard BM25 formula:

```
score(D, Q) = Σ IDF(qi) · (tf(qi, D) · (k1 + 1)) / (tf(qi, D) + k1 · (1 - b + b · |D|/avgdl))
```

**Fixture:** `engine/test/retrieve/fixtures/sample-atoms.ts` — 10-15 atoms
with known text, covering different frame types and languages. Reuse pattern
from `test/integrate/fixtures/sample-atoms.ts`.

### Step 1.3 — Vector Search

**Test file:** `engine/test/retrieve/vector-search.test.ts`

```
Tests to write FIRST:
- finds nearest neighbors by cosine similarity
- returns results sorted by descending similarity
- respects top-k limit
- handles empty embedding index gracefully
- handles query embedding of all zeros (returns empty or zero scores)
- excludes atoms below minimum similarity threshold (0.0)
```

**Implementation:** `engine/src/retrieve/vector-search.ts`

```typescript
// Exports:
queryVectors(
  queryEmbedding: number[],
  index: VectorIndex,
  topK: number,
): Array<{ id: string; score: number }>
```

~40 lines. Reuses `cosineSimilarity()` from `integrate/embedding-service.ts`.

**Fixture:** Reuse `test/integrate/fixtures/mock-embeddings.ts` pattern —
short 8-dim vectors with known similarity relationships.

### Step 1.4 — Reciprocal Rank Fusion

**Test file:** `engine/test/retrieve/hybrid.test.ts`

```
Tests to write FIRST:
- fuses two ranked lists into one (known-answer test)
- atom ranked highly in both lists outranks atom ranked highly in only one
- handles atoms appearing in only one list (still gets a score)
- handles empty lists (returns empty)
- handles single-method mode (bm25-only, vector-only)
- respects top-k after fusion
- preserves per-method rank information in results
```

**Implementation:** `engine/src/retrieve/hybrid.ts`

```typescript
// Exports:
fuseResults(
  ranked: Array<{ method: string; results: Array<{ id: string; score: number }> }>,
  topK: number,
  k?: number,  // RRF constant, default 60
): RetrievalResult[]
```

~50 lines. Pure function.

### Step 1.5 — Retrieval Orchestrator

**Test file:** `engine/test/retrieve/index.test.ts`

```
Tests to write FIRST:
- loads atoms and embeddings from graph directory
- runs hybrid search end-to-end (with mock data)
- runs bm25-only mode
- runs vector-only mode (with pre-computed query embedding)
- returns structured RetrievalResult with atom, score, and ranks
- handles missing embeddings.json gracefully (falls back to BM25-only)
```

**Implementation:** `engine/src/retrieve/index.ts`

```typescript
// Exports:
interface RetrieveOptions {
  query: string;
  topK?: number;
  method?: "hybrid" | "bm25" | "vector";
  graphDir?: string;
  queryEmbedding?: number[];  // pre-computed, avoids API call in tests
}

retrieve(options: RetrieveOptions): Promise<RetrievalResult[]>
```

~70 lines. Loads JSON files, builds BM25 index, calls vector search, fuses.

### Step 1.6 — CLI Runner

**Implementation:** `engine/src/run-retrieve.ts`

~80 lines. Arg parsing, loads data, calls `retrieve()`, formats output.
No unit test needed — this is a thin CLI wrapper. Tested via manual demo.

### Step 1.7 — Integration Test with Real Data

**Test file:** `engine/test/retrieve/integration.test.ts`

```
Tests to write:
- retrieves relevant atoms for "What determines industry lifecycle stage?"
  from real graph data (top-5 should include threshold/taxonomy atoms from
  如何快速了解一个行业)
- BM25 and vector return different rankings for the same query
- hybrid results are a superset of top results from both methods
```

Uses real `engine/graph/` data. Marked with a tag so they can be skipped in
CI (they depend on the graph directory existing).

**Total for Phase 1: ~380 lines implementation + ~250 lines tests**

---

## Phase 2: Evaluation Framework

**Goal:** `bun run src/run-eval.ts graph/atoms.json` prints quality report.

### Step 2.1 — Structural Checks

**Test file:** `engine/test/eval/checks.test.ts`

```
Tests to write FIRST:

structural:missing-frame
- atom with empty string frame → fail
- atom with undefined frame → fail
- atom with valid frame → pass

structural:empty-roles
- atom with {} roles → fail
- atom with at least one role → pass

structural:unregistered-frame
- atom with frame not in registry → fail
- atom with registered frame → pass
- works with both core and domain-specific frames

schema:missing-required-role
- atom missing a required role for its frame type → fail with detail
- atom with all required roles → pass
- atom with unknown frame type → skip (not this check's job)

schema:missing-optional-role
- atom missing an optional role → fail (informational)
- atom with all roles filled → pass

semantic:compound-role
- role value with 3+ sentences → fail ("compound role value")
- role value with "and" + "also" + "furthermore" → fail
- role value with single clear statement → pass
- short role value (<20 chars) → always pass (can't be compound)

semantic:vague-content
- role value "various factors" → fail
- role value "important concept" → fail
- role value < 10 chars (e.g., "stuff") → fail
- role value with specific content → pass

semantic:confidence-outlier
- atom with confidence 0.3 when frame-type mean is 0.9 → fail
- atom with confidence 0.85 when frame-type mean is 0.9 → pass
- requires frame-type stats to be pre-computed

semantic:empty-conditions
- atom with empty conditions array → fail
- atom with at least one condition → pass
```

**Implementation:** `engine/src/eval/checks.ts`

```typescript
// Exports:
const CHECKS: EvalCheck[]

// Each check implements:
interface EvalCheck {
  id: string;
  name: string;
  layer: "structural" | "schema" | "semantic";
  severity: "reject" | "flag";
  run(atom: CandidateAtom, context?: CheckContext): EvalResult;
}

interface CheckContext {
  registry?: FrameTypeRegistry;
  frameStats?: Map<string, { meanConfidence: number; stdConfidence: number }>;
}
```

~120 lines. Structural and schema checks reuse logic from
`extract/atom-validator.ts` but exposed as individual check functions.
Semantic checks are new.

**Fixture:** `engine/test/eval/fixtures/sample-atoms.ts` — atoms designed to
trigger specific checks. Include both passing and failing examples for each.

### Step 2.2 — Eval Runner

**Test file:** `engine/test/eval/runner.test.ts`

```
Tests to write FIRST:
- runs all checks against a batch of atoms
- counts pass/fail per check correctly
- computes aggregate "atoms with at least one issue" count
- computes failure rate as proportion
- includes up to 3 sample atom IDs per failed check
- handles empty atom array without crashing
- handles atoms with multiple failing checks (counted once in aggregate)
```

**Implementation:** `engine/src/eval/runner.ts`

```typescript
// Exports:
runEval(
  atoms: CandidateAtom[],
  options?: { registry?: FrameTypeRegistry; checks?: string[] },
): EvalReport
```

~70 lines. Iterates atoms × checks, tallies results.

### Step 2.3 — Comparison Mode

**Test file:** `engine/test/eval/comparison.test.ts`

```
Tests to write FIRST:
- compares two eval reports and computes delta
- handles different atom counts (raw may have more due to rejections)
- produces human-readable summary with before/after rates
- identifies which checks improved most
```

**Implementation:** `engine/src/eval/comparison.ts`

```typescript
// Exports:
compareReports(before: EvalReport, after: EvalReport): ComparisonReport

interface ComparisonReport {
  before: { source: string; issueRate: number };
  after: { source: string; issueRate: number };
  reduction: number;  // e.g., 0.374 → 0.020 = 94.7% reduction
  perCheck: Array<{ check: string; beforeRate: number; afterRate: number }>;
}
```

~40 lines. Pure data transformation.

### Step 2.4 — CLI Runner

**Implementation:** `engine/src/run-eval.ts`

~60 lines. Arg parsing, loads atoms from JSON (handles both raw output format
and graph atoms format), calls `runEval()`, formats table output.

### Step 2.5 — Integration Test with Real Data

**Test file:** `engine/test/eval/integration.test.ts`

```
Tests to write:
- evaluates real graph/atoms.json — structural checks all pass (they were
  already filtered)
- evaluates real output/designing-data-intensive-applications.json — flag rate
  matches known 37.4%
- comparison mode shows meaningful reduction between raw and graph atoms
```

**Total for Phase 2: ~290 lines implementation + ~200 lines tests**

---

## Phase 3: Checkpoint Recovery

**Goal:** `bun run src/run-pipeline.ts book.epub --resume` resumes from last
completed stage.

### Step 3.1 — Checkpoint Manager

**Test file:** `engine/test/checkpoint/checkpoint.test.ts`

```
Tests to write FIRST:
- saves stage data to disk as JSON
- loads stage data back with correct types
- returns null for stage that hasn't been saved
- saves and loads metadata (stage statuses, config, timestamps)
- clear() removes all checkpoint files for a book
- handles missing checkpoint directory gracefully (creates it)
- different books have isolated checkpoints
- getResumePoint() returns first non-completed stage
- getResumePoint() returns null when all stages completed
- getResumePoint() returns the failed stage (not the next one)
```

**Implementation:** `engine/src/checkpoint.ts`

```typescript
// Exports:
interface CheckpointManager {
  save(stage: string, data: unknown): void;
  load<T>(stage: string): T | null;
  getMeta(): CheckpointMeta | null;
  updateStage(stage: string, status: StageStatus): void;
  getResumePoint(): string | null;
  clear(): void;
}

createCheckpointManager(bookSlug: string, graphDir: string): CheckpointManager
```

~90 lines. File I/O with JSON serialization. Uses
`graph/.checkpoints/{book-slug}/` directory.

### Step 3.2 — Pipeline Integration

**Test file:** `engine/test/checkpoint/pipeline-integration.test.ts`

```
Tests to write FIRST:
- saves checkpoint after parse stage completes
- saves checkpoint after comprehend stage completes
- on --resume, skips parse when parse checkpoint exists
- on --resume, skips parse+comprehend when both checkpoints exist
- on --resume with no checkpoints, runs from beginning
- --rebuild-graph clears checkpoints
- --checkpoint-status prints stage completion summary
- checkpoint config mismatch warns (e.g., different model than original run)
```

**Implementation:** Modify `engine/src/run-pipeline.ts`

~80 lines of changes to existing file:
- Import `CheckpointManager`
- Add `--resume` and `--checkpoint-status` arg parsing
- After each stage: `checkpoint.save(stage, result)` +
  `checkpoint.updateStage(stage, { status: "completed", ... })`
- Before each stage: if resuming, check for checkpoint and skip
- On failure: `checkpoint.updateStage(stage, { status: "failed", ... })`

### Step 3.3 — Checkpoint Status Display

Part of the `--checkpoint-status` flag in `run-pipeline.ts`:

```
$ bun run src/run-pipeline.ts book.epub --checkpoint-status

Checkpoint: designing-data-intensive-applications
Started: 2026-03-28T10:00:00Z
Config: kimi/kimi-k2-0711-preview

  parse:       ✓ completed (1.2s)
  comprehend:  ✓ completed (3m 12s)
  extract:     ✗ failed — "Rate limit exceeded"
  integrate:   · pending

Resume with: bun run src/run-pipeline.ts book.epub --resume
```

~30 lines within the CLI runner.

**Total for Phase 3: ~200 lines implementation + ~150 lines tests**

---

## Build Order

The phases are independent — no code dependencies between retrieval, eval,
and checkpoint. But this order optimizes for demo impact:

```
Phase 1: Retrieval    (most visual demo, highest interview impact)
  1.1 Tokenizer           ████░░░░  tests → impl
  1.2 BM25 Index          ████░░░░  tests → impl
  1.3 Vector Search       ██░░░░░░  tests → impl
  1.4 Hybrid Fusion       ██░░░░░░  tests → impl
  1.5 Orchestrator        ███░░░░░  tests → impl
  1.6 CLI Runner          ██░░░░░░  impl only
  1.7 Integration Test    █░░░░░░░  tests with real data

Phase 2: Eval           (validates the "40% → <2%" claim with real numbers)
  2.1 Checks              █████░░░  tests → impl
  2.2 Runner              ███░░░░░  tests → impl
  2.3 Comparison          ██░░░░░░  tests → impl
  2.4 CLI Runner          ██░░░░░░  impl only
  2.5 Integration Test    █░░░░░░░  tests with real data

Phase 3: Checkpoint     (smallest scope, modifies existing code)
  3.1 Manager             ████░░░░  tests → impl
  3.2 Pipeline Changes    ████░░░░  tests → impl
  3.3 Status Display      █░░░░░░░  part of CLI
```

Each phase ends with a working CLI command. Sam can demo after any phase.

---

## File Summary

### New Files

| File | Phase | Lines | Purpose |
|---|---|---|---|
| `src/retrieve/tokenizer.ts` | 1 | ~60 | Text tokenization (EN + CJK) |
| `src/retrieve/bm25.ts` | 1 | ~80 | BM25 index and scoring |
| `src/retrieve/vector-search.ts` | 1 | ~40 | Vector similarity search |
| `src/retrieve/hybrid.ts` | 1 | ~50 | Reciprocal Rank Fusion |
| `src/retrieve/index.ts` | 1 | ~70 | Retrieval orchestrator |
| `src/run-retrieve.ts` | 1 | ~80 | Retrieval CLI |
| `src/eval/checks.ts` | 2 | ~120 | Quality check definitions |
| `src/eval/runner.ts` | 2 | ~70 | Eval batch runner |
| `src/eval/comparison.ts` | 2 | ~40 | Before/after comparison |
| `src/run-eval.ts` | 2 | ~60 | Eval CLI |
| `src/checkpoint.ts` | 3 | ~90 | Checkpoint save/load |
| **Total new** | | **~760** | |

### Modified Files

| File | Phase | Changes |
|---|---|---|
| `src/run-pipeline.ts` | 3 | +~80 lines (checkpoint integration) |

### New Test Files

| File | Phase | Lines | Tests |
|---|---|---|---|
| `test/retrieve/tokenizer.test.ts` | 1 | ~60 | 7 |
| `test/retrieve/bm25.test.ts` | 1 | ~80 | 8 |
| `test/retrieve/vector-search.test.ts` | 1 | ~50 | 6 |
| `test/retrieve/hybrid.test.ts` | 1 | ~60 | 7 |
| `test/retrieve/index.test.ts` | 1 | ~70 | 6 |
| `test/retrieve/integration.test.ts` | 1 | ~50 | 3 |
| `test/retrieve/fixtures/sample-atoms.ts` | 1 | ~80 | — |
| `test/eval/checks.test.ts` | 2 | ~150 | 18 |
| `test/eval/runner.test.ts` | 2 | ~60 | 7 |
| `test/eval/comparison.test.ts` | 2 | ~40 | 4 |
| `test/eval/integration.test.ts` | 2 | ~40 | 3 |
| `test/eval/fixtures/sample-atoms.ts` | 2 | ~60 | — |
| `test/checkpoint/checkpoint.test.ts` | 3 | ~80 | 10 |
| `test/checkpoint/pipeline-integration.test.ts` | 3 | ~70 | 8 |
| **Total tests** | | **~950** | **87** |

### Grand Total

- **Implementation:** ~840 lines (760 new + 80 modified)
- **Tests:** ~950 lines (87 test cases)
- **Test-to-code ratio:** ~1.1:1
