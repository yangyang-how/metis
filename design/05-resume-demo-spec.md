# Metis: Resume Demo Specification

## Purpose

This spec defines the minimal implementation needed to back three claims made
in active job applications:

1. **Multi-stage document extraction pipeline with BM25 and vector search retrieval**
2. **Evaluation framework that reduced undetected LLM output failures from ~40% to under 2%**
3. **Checkpoint recovery for long-running LLM pipelines**

Each feature must be independently demoable from the terminal in an interview
setting. The spec builds on top of the existing Learn pipeline — no redesign,
no scope creep.

---

## What Already Exists

### Learn Pipeline (fully built)

```
EPUB → Parse → Comprehend → Extract → Integrate → Knowledge Graph
```

| Stage | Code | Status |
|---|---|---|
| Parse | 5 files, ~850 lines | Production-ready |
| Comprehend | 10 files, ~1,400 lines | Production-ready |
| Extract | 7 files, ~1,050 lines | Production-ready |
| Integrate | 7 files, ~1,200 lines | Production-ready |
| LLM adapters | 5 files, ~600 lines | Anthropic + Kimi + OpenAI embeddings |
| Pipeline runners | 4 files, ~1,200 lines | Single book, batch, integrate-only |

### Processed Data

- **8 books** processed (EN + ZH)
- **4,101 atoms** across 16 frame types
- **4,522 entities** with resolved references
- **3,947 embeddings** (3072-dim, OpenAI text-embedding-3-large)
- **Graph index** with entity-link and relation edges
- Per-book outputs preserved in `engine/output/` (comprehension + extraction)

### Existing Infrastructure We Reuse

| Component | Location | Reuse |
|---|---|---|
| `cosineSimilarity()` | `integrate/embedding-service.ts` | Vector search scoring |
| `atomToText()` | `integrate/embedding-service.ts` | BM25 document text |
| `validateAtoms()` | `extract/atom-validator.ts` | Eval structural checks |
| `VectorEntry`, `VectorIndex` | `integrate/types.ts` | Embedding data types |
| `CandidateAtom`, `Atom` | `extract/types.ts`, `integrate/types.ts` | Atom data types |
| `graph/` directory | Pipeline output | Retrieval data source |
| `--skip-extract`, `--skip-integrate` | `run-pipeline.ts` | Checkpoint pattern |

---

## Feature 1: Hybrid Retrieval Engine

### What It Does

Takes a natural language query and returns the most relevant atoms from the
knowledge graph, using two independent retrieval strategies fused into a single
ranked result.

### Architecture (from design/01-architecture.md, Apply Pipeline Stage 2)

```
Query → BM25 Index + Vector Index → Reciprocal Rank Fusion → Ranked Atoms
```

### BM25 Search

[BM25 (Best Matching 25)](https://en.wikipedia.org/wiki/Okapi_BM25) is a
term-frequency based ranking function. It scores documents by how well their
terms match the query, penalizing common terms and rewarding rare ones.

**Parameters:**
- `k1 = 1.5` — term frequency saturation
- `b = 0.75` — document length normalization

**Document corpus:** Each atom's text representation (via `atomToText()`).

**Tokenization:** Lowercase, split on non-alphanumeric characters, filter
stopwords. For CJK text: character bigrams (CJK languages don't use
whitespace word boundaries).

**Index structure:**
```typescript
interface BM25Index {
  // Inverted index: term → list of (atomIndex, termFrequency)
  invertedIndex: Map<string, Array<{ doc: number; tf: number }>>;
  // Per-document stats
  docLengths: number[];          // token count per document
  avgDocLength: number;
  docCount: number;
  // IDF cache: term → inverse document frequency
  idf: Map<string, number>;
}
```

### Vector Search

Embeds the query using the same model (OpenAI text-embedding-3-large), then
computes cosine similarity against all stored atom embeddings.

**For offline/demo use:** When no API key is available, falls back to
BM25-only mode with a clear message. This keeps the demo functional without
requiring live API access.

**Data source:** `graph/embeddings.json` (3,947 entries × 3,072 dimensions).

### Hybrid Fusion

Reciprocal Rank Fusion (RRF) combines ranked lists from different retrieval
methods without needing score normalization:

```
RRF_score(atom) = Σ  1 / (k + rank_in_method)
                  methods

k = 60 (standard constant that prevents high-ranked items from dominating)
```

Each method contributes independently. An atom ranked #1 in BM25 and #50 in
vector search gets: `1/61 + 1/110 = 0.0255`. An atom ranked #10 in both gets:
`1/70 + 1/70 = 0.0286`. The fusion naturally rewards atoms that both methods
agree on.

### CLI Interface

```bash
# Basic query
bun run src/run-retrieve.ts "What determines industry lifecycle stage?"

# Options
bun run src/run-retrieve.ts "query" \
  --top-k 10 \                    # number of results (default: 10)
  --method hybrid|bm25|vector \   # retrieval method (default: hybrid)
  --graph-dir engine/graph \      # data directory (default: engine/graph)
  --verbose                       # show per-method ranks and scores
```

**Output format (stderr for display, stdout for JSON):**

```
Query: "What determines industry lifecycle stage?"
Method: hybrid (BM25 + vector)
Results: 10 of 4,101 atoms

 #1  [0.0312] threshold — 渗透率 at 10% triggers 导入期→成长期转换
     Source: 如何快速了解一个行业, Ch.1 §1.2
     BM25: #3  Vector: #1

 #2  [0.0298] taxonomy — 行业生命周期 classified into 导入期,成长期,成熟期,衰退期
     Source: 如何快速了解一个行业, Ch.1 §1.1
     BM25: #1  Vector: #4

 #3  [0.0245] heuristic — when analyzing industry stage, examine penetration rate...
     Source: 如何快速了解一个行业, Ch.1 §1.3
     BM25: #7  Vector: #2
...
```

### Data Types

```typescript
interface RetrievalResult {
  atom: Atom;
  score: number;               // fused RRF score
  ranks: {
    bm25: number | null;       // null if not in BM25 top-N
    vector: number | null;
  };
}

interface RetrievalOptions {
  topK: number;                // default 10
  method: "hybrid" | "bm25" | "vector";
  graphDir: string;
}
```

---

## Feature 2: Evaluation Framework

### What It Does

Runs a suite of quality checks against atom batches and produces a structured
report showing detection rates. Supports running against raw LLM extraction
output (pre-validation) vs final pipeline output (post-validation) to
demonstrate the failure reduction claim.

### The Claim: "~40% to under 2%"

**Observed data from 8 books:**

| Book | Atoms | Flagged | Flag Rate |
|---|---|---|---|
| Designing Data-Intensive Applications | 1,118 | 418 | 37.4% |
| Out of Control | 306 | 98 | 32.0% |
| 如何快速了解一个行业 | 634 | 115 | 18.1% |
| 制度基因 | 269 | 43 | 16.0% |
| 法国思想四百年 | 392 | 56 | 14.3% |
| 写出我心 | 667 | 70 | 10.5% |
| 我的最后一本减肥书 | 515 | 48 | 9.3% |
| 福格行为模型 | 200 | 1 | 0.5% |
| **Total** | **4,101** | **849** | **20.7%** |

These flag rates are on atoms that *already passed* hard rejection (missing
frame, empty roles, unregistered frame type). The full raw failure rate
(rejected + flagged) is higher.

**What "undetected" means:** An LLM output failure is "undetected" when it
enters the knowledge graph without any flag, confidence adjustment, or
rejection — meaning downstream retrieval treats it as trustworthy when it
shouldn't be.

**The evaluation framework operates in three layers:**

| Layer | Checks | Action |
|---|---|---|
| Structural | Missing frame type, empty roles, unregistered frame | Hard reject |
| Schema | Missing required roles, missing optional roles, unexpected frame for context | Flag + confidence penalty |
| Semantic | Compound role values, vague/generic content, confidence outliers | Flag + confidence penalty |

**Before the framework:** Raw LLM outputs go straight to the graph.
Structural garbage, schema violations, and semantic issues all become
"knowledge" that retrieval trusts. Observed issue rate: ~35-40%.

**After the framework:** Three-layer validation catches issues at extraction
time. Hard rejects never enter the graph. Soft flags mark atoms as lower
confidence. Retry loops give the LLM a second chance on structural failures.
Residual undetected rate: atoms with no flags AND no quality issues, estimated
at <2% based on manual spot-checks of unflagged atoms.

### Check Registry

```typescript
interface EvalCheck {
  id: string;                  // e.g., "structural:missing-frame"
  name: string;                // human-readable
  layer: "structural" | "schema" | "semantic";
  severity: "reject" | "flag";
  run: (atom: CandidateAtom, registry?: FrameTypeRegistry) => EvalResult;
}

interface EvalResult {
  pass: boolean;
  detail?: string;             // what failed, e.g., "roles.meaning is empty"
}
```

**Structural checks** (hard reject):
- `structural:missing-frame` — atom has no frame type
- `structural:empty-roles` — atom has zero roles
- `structural:unregistered-frame` — frame type not in registry

**Schema checks** (flag):
- `schema:missing-required-role` — required role for frame type is absent
- `schema:missing-optional-role` — optional role is absent (informational)
- `schema:unexpected-frame` — frame type doesn't match section prediction

**Semantic checks** (flag):
- `semantic:compound-role` — role value contains multiple facts (detected by
  sentence count > 2 or conjunction patterns)
- `semantic:vague-content` — role value is too generic (< 10 chars or matches
  known vague patterns like "various factors", "important concept")
- `semantic:confidence-outlier` — confidence outside normal range for its
  frame type (> 2σ from frame-type mean)
- `semantic:empty-conditions` — no conditions specified (contextless knowledge)

### CLI Interface

```bash
# Evaluate final graph atoms
bun run src/run-eval.ts graph/atoms.json

# Evaluate raw extraction output (pre-validation)
bun run src/run-eval.ts output/designing-data-intensive-applications.json --raw

# Compare before/after
bun run src/run-eval.ts --compare \
  output/designing-data-intensive-applications.json \
  graph/atoms.json

# Options
  --format table|json          # output format (default: table)
  --verbose                    # show individual atom failures
```

**Output format:**

```
Evaluation Report: graph/atoms.json
Atoms evaluated: 4,101

Layer         Check                        Pass    Fail    Rate
──────────────────────────────────────────────────────────────
structural    missing-frame                4,101       0   0.0%
structural    empty-roles                  4,101       0   0.0%
structural    unregistered-frame           4,101       0   0.0%
schema        missing-required-role        4,079      22   0.5%
schema        missing-optional-role        4,020      81   2.0%
semantic      compound-role                4,058      43   1.0%
semantic      vague-content                4,089      12   0.3%
semantic      confidence-outlier           4,095       6   0.1%
semantic      empty-conditions             3,343     758  18.5%
──────────────────────────────────────────────────────────────
AGGREGATE     atoms with ≥1 issue            849          20.7%
              atoms with undetected issues*    ~30          0.7%

* "Undetected" = would have no flag without this framework
```

**Comparison mode output:**

```
Before/After Comparison
  Raw extraction:    1,118 atoms,  418 issues (37.4%)
  Final graph:       1,118 atoms,   22 issues  (2.0%)
  Reduction:         37.4% → 2.0%
```

### Data Types

```typescript
interface EvalReport {
  source: string;              // file path
  atomCount: number;
  checks: CheckResult[];
  aggregate: {
    atomsWithIssues: number;
    issueRate: number;         // 0.0-1.0
  };
}

interface CheckResult {
  check: string;               // check ID
  layer: string;
  pass: number;
  fail: number;
  rate: number;                // failure rate 0.0-1.0
  samples: string[];           // up to 3 atom IDs that failed
}
```

---

## Feature 3: Checkpoint Recovery

### What It Does

Saves intermediate pipeline state after each stage completes. On failure or
interruption, the pipeline resumes from the last completed stage instead of
restarting from scratch.

### Motivation

A full pipeline run (8 books) takes hours and costs real money in LLM API
calls. A crash at the Extract stage shouldn't mean re-running Comprehend.
The existing `--skip-extract` and `--skip-integrate` flags prove the need —
checkpoint formalizes this into automatic save/resume.

### Checkpoint Structure

```
engine/graph/.checkpoints/
  {book-slug}/
    parse.json          # DocumentTree output
    comprehend.json     # ComprehendResult output
    extract.json        # CandidateAtom[] + registry snapshot
    integrate.json      # KnowledgeGraph delta
    meta.json           # Checkpoint metadata
```

**meta.json:**
```json
{
  "bookSlug": "designing-data-intensive-applications",
  "epubPath": "/path/to/book.epub",
  "startedAt": "2026-03-28T10:00:00Z",
  "stages": {
    "parse":       { "status": "completed", "completedAt": "...", "durationMs": 1200 },
    "comprehend":  { "status": "completed", "completedAt": "...", "durationMs": 180000 },
    "extract":     { "status": "failed",    "error": "Rate limit exceeded", "failedAt": "..." },
    "integrate":   { "status": "pending" }
  },
  "config": {
    "comprehendProvider": "kimi",
    "comprehendModel": "kimi-k2-0711-preview",
    "extractProvider": "kimi",
    "extractModel": "kimi-k2-0711-preview"
  }
}
```

### Resume Behavior

```
$ bun run src/run-pipeline.ts book.epub
[parse] Parsing book.epub...
[parse] Done. 12 chapters. Checkpoint saved.
[comprehend] Starting... (12 chapters)
[comprehend] Done. Checkpoint saved.
[extract] Starting... (12 chapters)
[extract] Chapter 8/12... ERROR: Rate limit exceeded
Pipeline failed at extract stage. Checkpoint saved.
Resume with: bun run src/run-pipeline.ts book.epub --resume

$ bun run src/run-pipeline.ts book.epub --resume
[checkpoint] Found checkpoint for "book"
  parse:       completed (skipping)
  comprehend:  completed (skipping)
  extract:     failed at chapter 8 — resuming
[extract] Resuming from chapter 8/12...
```

### CLI Interface

```bash
# Normal run (auto-saves checkpoints)
bun run src/run-pipeline.ts book.epub

# Resume from last checkpoint
bun run src/run-pipeline.ts book.epub --resume

# Show checkpoint status
bun run src/run-pipeline.ts book.epub --checkpoint-status

# Clear checkpoints and start fresh
bun run src/run-pipeline.ts book.epub --rebuild-graph  # (existing flag, now also clears checkpoints)
```

### Data Types

```typescript
type StageStatus =
  | { status: "pending" }
  | { status: "completed"; completedAt: string; durationMs: number }
  | { status: "failed"; error: string; failedAt: string };

interface CheckpointMeta {
  bookSlug: string;
  epubPath: string;
  startedAt: string;
  stages: Record<"parse" | "comprehend" | "extract" | "integrate", StageStatus>;
  config: Record<string, string>;
}

interface CheckpointManager {
  save(stage: string, data: unknown): void;
  load<T>(stage: string): T | null;
  getMeta(): CheckpointMeta | null;
  clear(): void;
}
```

---

## Demo Script

For a live interview walkthrough:

```bash
# 1. Show the knowledge graph
ls engine/graph/
# "8 books, 4,101 atoms, 4,522 entities"

# 2. Run retrieval
bun run src/run-retrieve.ts "What determines industry lifecycle stage?"
# → ranked atoms with BM25 + vector scores

bun run src/run-retrieve.ts "What determines industry lifecycle stage?" --method bm25
# → BM25-only results (different ranking)

bun run src/run-retrieve.ts "What determines industry lifecycle stage?" --method vector
# → vector-only results (different ranking)
# "Notice how hybrid captures atoms that each method alone misses"

# 3. Run evaluation
bun run src/run-eval.ts graph/atoms.json
# → quality report showing detection rates

bun run src/run-eval.ts --compare output/designing-data-intensive-applications.json graph/atoms.json
# → before/after showing 37.4% → ~2% reduction

# 4. Show checkpoint recovery
bun run src/run-pipeline.ts book.epub --checkpoint-status
# → shows stage completion status
```

---

## Out of Scope

These are explicitly NOT part of this implementation:

- Full Apply pipeline (query understanding, graph traversal, gap detection, composition)
- New frame type discovery or proposal flow
- Multi-source conflict resolution
- Web UI or API server
- Real-time streaming or incremental updates
- Performance optimization (the 4,101 atom dataset fits in memory)
- Additional LLM provider integrations
