# Apply Pipeline — Implementation Spec

**Date:** 2026-04-09
**Issue:** #11
**Design refs:** `design/08-apply-pipeline.md`, `design/07-knowledge-exchange.md`
**Status:** Approved

---

## Overview

Build the complete Apply pipeline: query a knowledge graph built by the
Learn pipeline and produce a structured ContextPackage (or portable KX
document) with relevant atoms, traversed relationships, detected gaps,
and contradiction notes.

```
Query → Understand → Retrieve → Re-rank → Traverse → DetectGaps → Compose → Output
                                                                         ├─ native (ContextPackage)
                                                                         └─ kx (KXDocument + gaps sidecar)
```

## Build Order

Algorithmic stages first, LLM last. Each phase produces a working CLI.

1. **Types + Traverse** — no LLM
2. **Gap Detection** — no LLM
3. **Compose + KX Export** — optional LLM (section summaries)
4. **Understand + Re-rank** — LLM required
5. **CLI + Polish** — wire everything, error handling

---

## Module Structure

```
engine/src/apply/
  types.ts          — QueryPlan, ContextPackage, Gap, TraversalResult, GraphInventory
  understand.ts     — Stage 1: query → QueryPlan via LLM
  rerank.ts         — Stage 2: post-fusion re-ranking with QueryPlan boosts
  traverse.ts       — Stage 3: spreading activation over graph edges
  gaps.ts           — Stage 4: set comparison (plan targets vs retrieved atoms)
  compose.ts        — Stage 5: group atoms → ContextSections + LLM summaries
  inventory.ts      — GraphInventory builder (precomputed from loaded graph)
  prompts.ts        — LLM prompts for Understand + section summaries
  index.ts          — Pipeline orchestrator

engine/src/kx/
  types.ts          — KXDocument, KXUnit, KXRelation, KXSource, KXKind
  export.ts         — ContextPackage → KXDocument mapper
  content.ts        — Frame-type → natural language content templates
  gaps-export.ts    — Gap[] → GapsDocument sidecar

engine/src/run-apply.ts  — CLI entry point
```

### Test Structure

```
engine/test/apply/
  fixtures/
    mock-provider.ts      — mock LLM for understand/summary tests
    sample-graph.ts       — synthetic KnowledgeGraph for unit tests
    ddia-graph-loader.ts  — loads real DDIA output for integration tests
  traverse.test.ts
  gaps.test.ts
  compose.test.ts
  understand.test.ts
  rerank.test.ts
  inventory.test.ts
  integration.test.ts    — full pipeline end-to-end

engine/test/kx/
  fixtures/
    sample-atoms.ts
  export.test.ts
  content.test.ts
  gaps-export.test.ts
  types.test.ts
```

---

## Resolved Design Decisions

### Section Grouping Strategy

The QueryPlan's `analysisType` determines grouping:

| analysisType pattern | Grouping | Rationale |
|---|---|---|
| Entity-focused ("What is X?", "Tell me about X") | entity-first | Asking about a thing |
| Domain-focused ("What about topic Y?") | domain-first | Asking about a topic area |
| Method-focused ("How do I X?", "Steps for X") | frame-type-first | Want procedures/heuristics together |
| Ambiguous / multi-domain | entity-first | Safest default |

Before the Understand stage exists (phases 1-3), defaults to entity-first.
CLI override: `--group-by entity|domain|frame-type`.

### Traversal Depth vs Noise

Confidence threshold tightens per hop instead of a flat depth limit:

| Hop | Min confidence | Rationale |
|---|---|---|
| 1 | >= 0.5 | Generous — pull related knowledge |
| 2 | >= 0.7 | Strict — only strong connections |
| 3+ | not followed | Default max depth |

Hard cap: 50 atoms total after traversal. If cap is reached, stop
expanding even if depth budget remains.

CLI overrides: `--max-depth <n>`, `--min-confidence <n>`.

### Edge Type Behavior

From design doc, unchanged:

| Edge type | Traversal behavior |
|---|---|
| `reinforces` | Always follow |
| `contradicts` | Always follow (must surface) |
| `extends` | Follow at depth 1 only |
| `entity_link` | Follow if linked atom matches target entity or domain |
| `cross_domain` | Follow if query plan includes multiple domains |

### Section Summaries

On by default. One cheap LLM call per ContextSection. Produces a 2-3
sentence summary of the section's atoms. `--no-summarize` flag skips it
(useful for testing and cost control).

### Atom Type in Apply Pipeline

The Apply pipeline operates on finalized `Atom` (from integrate/types),
not `CandidateAtom` (from extract/types). The graph directory contains
fully integrated atoms with `entityRefs`, `reinforcedBy`, `contradictedBy`,
and `extendedBy` fields populated. The retrieve module will need to load
`Atom[]` when called from the Apply pipeline context.

### Re-rank as Separate Module

The design doc describes re-ranking as part of Stage 2 (Retrieve). This
spec separates it into its own module (`rerank.ts`) for clarity and
testability. It runs immediately after retrieve, before traverse. The
re-rank function accepts `RetrievalResult[]` (atom + score pairs) plus
a `QueryPlan`, and returns re-ordered `RetrievalResult[]`. It accesses
atom metadata (domain, frame, entityRefs) via the atom reference in
`RetrievalResult`, not from `FusedResult` (which only carries id/score).

### CLI Flags Added Beyond Design Doc

The following CLI flags are additions to the design doc's CLI section,
based on resolved design decisions:
- `--no-summarize` — skip section summary LLM calls
- `--min-confidence` — base traversal confidence threshold
- `--max-expanded` — cap on traversal expansion
- `--group-by` — manual section grouping override
- `--output` — write to file instead of stdout
- `--domains`, `--frame-types`, `--entities` — manual QueryPlan flags
  for use before the Understand stage exists

### Caching

Skip for v1. One cheap LLM call per query is not worth cache
invalidation complexity.

### Storage

JSON flat files. No external DB. The retrieve module loads
atoms.json, embeddings.json, graph.json, entities.json from disk.

---

## Type Definitions

### Apply Pipeline Types

```typescript
// --- Stage 1: Understand ---

interface QueryInput {
  query: string;
  scope?: {
    domains?: string[];
    sources?: string[];
    frameTypes?: string[];
  };
}

interface QueryPlan {
  intent: string;
  analysisType: string;
  targetDomains: string[];
  targetFrameTypes: string[];
  targetEntities: string[];
  weights: {
    domainMatch: number;      // 0-1
    frameTypeMatch: number;   // 0-1
    entityMatch: number;      // 0-1
  };
  groupingStrategy: "entity" | "domain" | "frame-type";
}

interface GraphInventory {
  domains: Array<{ name: string; atomCount: number }>;
  entities: Array<{ name: string; aliases: string[]; domain: string }>;
  frameTypes: Array<{ name: string; count: number }>;
  sources: Array<{ title: string; atomCount: number }>;
}

// --- Stage 2: Retrieve + Re-rank ---
// retrieve() returns RetrievalResult[] with Atom (not CandidateAtom)
// when loading from a finalized graph directory.
// Re-rank takes the retrieve output and boosts scores using the plan.

interface RerankOptions {
  results: RetrievalResult[];
  plan: QueryPlan;
}

// --- Stage 3: Traverse ---

interface TraversalResult {
  atoms: Atom[];
  paths: TraversalPath[];
  contradictions: Array<{
    atomA: string;
    atomB: string;
    topic: string;
  }>;
}

interface TraversalPath {
  atomId: string;
  reachedVia: "direct_retrieval" | "graph_traversal";
  depth: number;
  edgeType?: EdgeType;
  score: number;
}

interface TraversalOptions {
  maxDepth?: number;          // default: 2
  minConfidence?: number[];   // per-hop thresholds, default: [0.5, 0.7]
  maxExpanded?: number;       // default: 50
  plan?: QueryPlan;           // for entity_link and cross_domain decisions
}

// --- Stage 4: Gap Detection ---

interface Gap {
  type: "missing_domain" | "missing_frame_type" | "missing_entity"
      | "thin_coverage" | "unresolved_contradiction";
  description: string;
  severity: "critical" | "notable" | "minor";
  suggestion?: string;
}

// --- Stage 5: Compose ---

interface ContextPackage {
  query: string;
  plan: QueryPlan;
  sections: ContextSection[];
  contradictions: Array<{
    topic: string;
    sides: Array<{
      atomIds: string[];
      claim: string;
      sources: string[];
      conditions: string[];
    }>;
    note: string;
  }>;
  gaps: Gap[];
  sources: Array<{
    title: string;
    authors: string[];
    atomsUsed: number;
    chaptersReferenced: string[];
  }>;
  stats: {
    totalAtomsRetrieved: number;
    totalAtomsAfterTraversal: number;
    contradictionsFound: number;
    gapsFound: number;
  };
}

interface ContextSection {
  topic: string;
  atoms: Atom[];
  summary?: string;
}
```

### KX Types

```typescript
interface KXDocument {
  version: "kx/1.0";
  meta: {
    domains: string[];
    sources: KXSource[];
    generatedBy?: string;
    generatedAt?: string;
  };
  units: KXUnit[];
  relations: KXRelation[];
}

interface KXUnit {
  id: string;
  kind: KXKind;
  content: string;
  roles?: Record<string, string>;
  conditions: string[];
  confidence: number;
  source: {
    ref: string;
    location?: string;
  };
  domains: string[];
}

type KXKind =
  | "definition" | "property" | "classification" | "causal"
  | "heuristic" | "principle" | "procedure" | "comparison"
  | "threshold" | "deviation" | "example" | "evaluation";

interface KXRelation {
  from: string;
  to: string;
  type: KXRelationType;
  confidence: number;
  note?: string;
}

type KXRelationType =
  | "reinforces" | "contradicts" | "extends"
  | "requires" | "exemplifies";

interface KXSource {
  id: string;
  type: "book" | "article" | "case-study" | "notes"
      | "guide" | "transcript" | "other";
  title: string;
  authors?: string[];
  url?: string;
}

interface GapsDocument {
  version: "gaps/1.0";
  query: string;
  gaps: Gap[];
  stats: {
    totalAtomsRetrieved: number;
    contradictionsFound: number;
    gapsFound: number;
  };
}
```

---

## Algorithms

### Spreading Activation (Traverse)

```
Input:  seed atoms (from Retrieve), GraphIndex, TraversalOptions
Output: TraversalResult

1. Initialize expanded = Map<atomId, TraversalPath>
2. Add all seed atoms with depth=0, reachedVia="direct_retrieval"
3. Initialize frontier = seed atom IDs
4. For depth = 1 to maxDepth:
   a. minConf = minConfidence[depth-1] ?? 0.7
   b. For each atom in frontier:
      - Look up edges in GraphIndex
      - For each edge:
        * Skip if target already in expanded
        * Skip if edge.confidence < minConf
        * Apply edge-type rules (see table above)
        * Score = edge.confidence × (1 / depth)  [decay]
        * Add to expanded and next frontier
   c. If |expanded| >= maxExpanded, stop
   d. frontier = next frontier
5. Collect contradictions: all pairs where edge.type === "contradicts"
6. Return TraversalResult
```

### Gap Detection

```
Input:  QueryPlan, TraversalResult atoms
Output: Gap[]

1. Collect retrieved domains = unique domains from all atoms
2. Collect retrieved frameTypes = unique frame types from all atoms
3. Collect retrieved entities = unique entity refs from all atoms

4. For each targetDomain not in retrieved domains:
   → Gap(missing_domain, critical)
5. For each targetFrameType not in retrieved frameTypes:
   → Gap(missing_frame_type, notable)
6. For each targetEntity not in retrieved entities:
   → Gap(missing_entity, notable)
7. For each targetDomain with < 3 atoms:
   → Gap(thin_coverage, minor)
8. For each contradiction without differing conditions:
   → Gap(unresolved_contradiction, notable)
```

### Re-ranking

```
Input:  RetrievalResult[] (atom + score pairs), QueryPlan
Output: RetrievalResult[] (re-ordered)

For each result:
  atom = result.atom  // Atom with entityRefs, domain, frame
  boost = 1.0
  if atom.domain intersects plan.targetDomains:
    boost += plan.weights.domainMatch × 0.5
  if atom.frame in plan.targetFrameTypes:
    boost += plan.weights.frameTypeMatch × 0.5
  if atom.entityRefs intersects plan.targetEntities:
    boost += plan.weights.entityMatch × 0.5
  result.score *= boost

Re-sort by boosted score.
```

### Section Grouping

```
Input:  atoms[], groupingStrategy
Output: ContextSection[]

Switch on groupingStrategy:
  "entity":
    Group atoms by primary entityRef. Atoms with no entityRef
    fall into a section named by their first domain.
  "domain":
    Group atoms by first domain tag.
  "frame-type":
    Group atoms by frame type.

Sort sections by total atom count descending (richest first).
```

---

## LLM Prompts

### Query Understanding

System and user prompts as specified in design/08-apply-pipeline.md
Appendix A. Key additions:

- GroupingStrategy inference added to the response schema
- Field normalization handles snake_case → camelCase (reuse existing
  pattern from comprehend/extract stages)

### Section Summary

```
System: You are summarizing a group of knowledge atoms for a human reader.
        Write 2-3 sentences that capture the key insights. Be specific —
        reference concrete claims, not vague generalities.

User:   Topic: "{section.topic}"
        Query context: "{query}"

        Atoms:
        {atoms.map(a => `- ${a.content}`).join('\n')}

        Summarize these atoms in 2-3 sentences.
```

Model: cheap tier (Haiku). One call per section.

---

## CLI Interface

```
bun run src/run-apply.ts <query> [options]

Options:
  --graph-dir <path>           Data directory (default: engine/graph)
  --format native|kx           Output format (default: native)
  --top-k <n>                  Initial retrieval count (default: 20)
  --max-depth <n>              Traversal depth (default: 2)
  --min-confidence <n>         Base confidence threshold (default: 0.5)
  --max-expanded <n>           Max atoms after traversal (default: 50)
  --group-by entity|domain|frame-type
                               Section grouping (default: auto from QueryPlan)
  --no-traverse                Skip graph traversal
  --no-gaps                    Skip gap detection
  --no-summarize               Skip section summaries (no LLM for compose)
  --provider anthropic|kimi    For query understanding
  --model <model>              Model for query understanding
  --domains <list>             Manual target domains (comma-separated, before Understand exists)
  --frame-types <list>         Manual target frame types (comma-separated)
  --entities <list>            Manual target entities (comma-separated)
  --json                       Raw JSON to stdout (no formatting)
  --output <path>              Write to file instead of stdout

Environment:
  KIMI_API_KEY | ANTHROPIC_API_KEY — query understanding + summaries
  OPENAI_API_KEY — query embedding (vector search)
```

### Manual Mode (Phases 1-3, before Understand exists)

```
bun run src/run-apply.ts <query> \
  --domains "usability,interaction-design" \
  --frame-types "heuristic,principle" \
  --entities "affordance,cognitive load" \
  --graph-dir graph/
```

These flags construct a synthetic QueryPlan without an LLM call.

---

## Error Handling

Typed errors following the existing pattern:

```typescript
class ApplyError extends Error {
  constructor(
    public stage: "understand" | "retrieve" | "rerank" | "traverse" | "gaps" | "compose",
    message: string,
    public cause?: Error,
  ) {
    super(`[apply/${stage}] ${message}`);
  }
}
```

Stage failures are non-fatal where possible:
- Understand fails → fall back to manual flags or keyword-only retrieval
- Traverse fails → return seed atoms without expansion
- Gaps fails → return empty gaps array
- Compose summary fails → section.summary = undefined
- KX export fails → surface error (this is the output)

---

## Test Strategy

### Unit Tests (synthetic fixtures)

Each module gets a test file with a small synthetic KnowledgeGraph:
~20 atoms, ~10 entities, known edge structure. Tests verify:

- Traverse: correct hop behavior, edge-type rules, confidence decay,
  max-expanded cap, contradiction surfacing
- Gaps: each gap type detected correctly, severity assignment
- Compose: grouping strategies produce correct sections, stats are accurate
- Rerank: boost calculation, re-ordering
- Understand: prompt construction, field normalization, inventory building
- KX export: frame→kind mapping, content templates, relation filtering,
  source deduplication, gaps sidecar

### Integration Tests (real DDIA output)

Load the actual DDIA processed output from `engine/output/`. Run
queries through the full pipeline. Verify:

- Non-empty results for domain-relevant queries
- Traversal expands the seed set
- Gaps are detected for out-of-domain queries
- KX output validates against the KXDocument schema
- Section summaries are generated (mock LLM returns canned text)

### Existing Tests

All Learn pipeline tests must continue to pass. No modifications to
existing modules except adding exports where Apply needs to import
existing types.

---

## File Output Convention

```
output/
  {query-slug}.native.json     # ContextPackage (native format)
  {query-slug}.kx.json         # KXDocument (KX format)
  {query-slug}.gaps.json       # GapsDocument sidecar (KX mode only)
```

When `--json` is used, output goes to stdout (no file written).
When `--output <path>` is used, writes to the specified path.
Default: stdout with human-readable formatting.
