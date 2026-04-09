# Apply Pipeline Design

The second pipeline in Metis. Takes a query, retrieves relevant
knowledge from the graph, traverses connections, detects gaps, and
composes a structured context package.

The Apply pipeline is a **general-purpose knowledge query system**.
Its output is useful to chatbots, skill generators, documentation
tools, or any system that needs expert knowledge to reason with.
It is not shaped around any single consumer.

## Reference

- **Architecture:** `design/01-architecture.md` (Apply Pipeline section)
- **KX format:** `design/07-knowledge-exchange.md`
- **Retrieve (built):** `engine/src/retrieve/`
- **Eval (built):** `engine/src/eval/`

---

## Pipeline Overview

```
Query
  │
  ▼
Stage 1: Understand ──→ QueryPlan
  │                      (domains, frame types, entities, analysis type)
  ▼
Stage 2: Retrieve ──→ RankedAtoms         [BUILT — engine/src/retrieve/]
  │                    (BM25 + vector + hybrid fusion)
  ▼
Stage 3: Traverse ──→ ExpandedAtoms
  │                    (follow graph edges, spreading activation)
  ▼
Stage 4: Detect Gaps ──→ Gaps
  │                       (what's needed vs what was found)
  ▼
Stage 5: Compose ──→ ContextPackage
                      (structured, ready for any consumer)
  │
  ├──→ Native format (full atom detail, graph metadata)
  └──→ KX export (portable interchange)
```

---

## Stage 1: Query Understanding

Map a query to a structured plan that guides retrieval.

### Input

```typescript
interface QueryInput {
  query: string;                // natural language question or intent
  scope?: {
    domains?: string[];         // limit to these domains
    sources?: string[];         // limit to these source books/articles
    frameTypes?: string[];      // limit to these frame types
  };
}
```

### Output

```typescript
interface QueryPlan {
  // What the user is trying to do
  intent: string;               // "evaluate a product's usability"
  analysisType: string;         // "heuristic evaluation"

  // What to search for
  targetDomains: string[];      // ["usability", "interaction-design"]
  targetFrameTypes: string[];   // ["heuristic", "principle", "evaluation_matrix"]
  targetEntities: string[];     // ["affordance", "cognitive load", "feedback"]

  // How to weight results
  weights: {
    domainMatch: number;        // 0–1, how much to boost domain matches
    frameTypeMatch: number;     // 0–1, how much to boost matching frame types
    entityMatch: number;        // 0–1, how much to boost entity matches
  };
}
```

### Implementation

An LLM call that takes the query + the graph's domain/entity/frame
inventory and produces a structured plan. The inventory is precomputed
from the graph index — a summary of available domains, entities, and
frame type distribution.

**Model requirement: cheap model.** This is a classification and
extraction task, not deep reasoning. The graph inventory constrains
the output space.

### Pre-computed Inventory

Built once when the graph is loaded, cached in memory:

```typescript
interface GraphInventory {
  domains: Array<{ name: string; atomCount: number }>;
  entities: Array<{ name: string; aliases: string[]; domain: string }>;
  frameTypes: Array<{ name: string; count: number }>;
  sources: Array<{ title: string; atomCount: number }>;
}
```

---

## Stage 2: Retrieve

**Already built.** `engine/src/retrieve/` provides BM25 + vector +
hybrid fusion.

For the Apply pipeline, retrieval is enhanced with the QueryPlan:

- **Domain filter:** Drop atoms outside `targetDomains` (or weight them
  down in fusion).
- **Frame type boost:** Atoms matching `targetFrameTypes` get a score
  multiplier.
- **Entity boost:** Atoms containing `targetEntities` in their roles
  get a score multiplier.

These boosts are applied post-fusion as a re-ranking step, not baked
into BM25/vector search.

### Extended Retrieve Options

```typescript
interface ApplyRetrieveOptions extends RetrieveOptions {
  plan: QueryPlan;
  reRankWeights?: {
    domainMatch: number;
    frameTypeMatch: number;
    entityMatch: number;
  };
}
```

**Model requirement: none.** Re-ranking is algorithmic. The existing
retrieve stage handles BM25/vector, and the query embedding uses the
OpenAI embedding API (already built).

---

## Stage 3: Traverse

Starting from retrieved atoms, follow graph edges to pull connected
knowledge. This is **spreading activation** — the graph equivalent of
"and what else is related?"

### Algorithm

```
1. Start with top-K retrieved atoms as seed set.
2. For each seed atom, look up its edges in GraphIndex.
3. Score each neighbor:
   score = edge.confidence × decay^depth × relevance_to_query
4. Add neighbors above threshold to the expanded set.
5. Repeat up to max_depth (default: 2).
6. Deduplicate and merge with seed set.
```

### Edge Type Behavior

| Edge type | Traversal behavior |
|---|---|
| `reinforces` | Always follow. Reinforcing atoms strengthen the answer. |
| `contradicts` | Always follow. Contradictions must be surfaced. |
| `extends` | Follow at depth 1. Extensions add nuance. |
| `entity_link` | Follow if the linked atom matches a target entity or domain. |
| `cross_domain` | Follow if the query plan includes multiple domains. |

### Output

```typescript
interface TraversalResult {
  atoms: Atom[];                  // seed + expanded
  paths: TraversalPath[];         // how each atom was reached
  contradictions: Array<{         // explicitly surfaced
    atomA: string;
    atomB: string;
    topic: string;
  }>;
}

interface TraversalPath {
  atomId: string;
  reachedVia: "direct_retrieval" | "graph_traversal";
  depth: number;                  // 0 = seed, 1 = first hop, etc.
  edgeType?: EdgeType;
  score: number;
}
```

**Model requirement: none.** Pure graph traversal. The GraphIndex
adjacency list is loaded from `graph/graph.json`.

---

## Stage 4: Gap Detection

Compare what was retrieved against what the QueryPlan said was needed.

### Checks

1. **Missing domains.** QueryPlan targets `["usability", "accessibility"]`
   but no atoms have domain `"accessibility"` → gap.
2. **Missing frame types.** QueryPlan targets `["procedure"]` but
   no procedure atoms were retrieved → gap.
3. **Missing entities.** QueryPlan targets entity `"WCAG"` but it
   doesn't exist in the graph → gap.
4. **Thin coverage.** A target domain has fewer than 3 atoms → weak
   coverage warning.
5. **Unresolved contradictions.** Two atoms contradict with no
   scope differentiation in their conditions → flag.

### Output

```typescript
interface Gap {
  type: "missing_domain" | "missing_frame_type" | "missing_entity"
      | "thin_coverage" | "unresolved_contradiction";
  description: string;            // human-readable
  severity: "critical" | "notable" | "minor";
  suggestion?: string;            // "Consider ingesting WCAG guidelines"
}
```

**Model requirement: none.** Set comparison between QueryPlan targets
and retrieved atom metadata.

---

## Stage 5: Compose

Assemble retrieved atoms, traversal results, and gaps into a
structured context package.

### Native Output (ContextPackage)

The full-fidelity output with all Metis-specific metadata. For
consumers that understand Metis's data model (internal tools,
advanced integrations).

```typescript
interface ContextPackage {
  query: string;
  plan: QueryPlan;

  // Knowledge grouped by topic
  sections: ContextSection[];

  // Explicitly surfaced conflicts
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

  // What's missing
  gaps: Gap[];

  // Provenance
  sources: Array<{
    title: string;
    authors: string[];
    atomsUsed: number;
    chaptersReferenced: string[];
  }>;

  // Stats
  stats: {
    totalAtomsRetrieved: number;
    totalAtomsAfterTraversal: number;
    contradictionsFound: number;
    gapsFound: number;
  };
}

interface ContextSection {
  topic: string;                  // entity or domain name
  atoms: Atom[];
  summary?: string;               // optional LLM-generated section summary
}
```

### KX Export

The portable output for external consumers. Produced by mapping
ContextPackage to a KXDocument per the spec in
`design/07-knowledge-exchange.md`.

The mapping:

| ContextPackage | KXDocument |
|---|---|
| `sections[].atoms[]` | `units[]` (frame type → KX kind, roles preserved) |
| `contradictions[]` | `relations[]` with type `"contradicts"` |
| `sources[]` | `meta.sources[]` |
| `gaps[]` | Not in KX (KX is knowledge, not meta-analysis). Exported as a sidecar. |

Gaps are exported as a separate file (`*.gaps.json`) alongside the
KX document, because gaps are meta-information about the knowledge,
not knowledge itself.

```
output/
  usability-review.kx.json       # KX document
  usability-review.gaps.json     # gap analysis
```

**Model requirement: optional.** Section summaries use a cheap LLM
call if available, but the compose stage works without them (atoms
are self-contained).

---

## CLI Runner

```
bun run src/run-apply.ts "query" [options]

Options:
  --graph-dir <path>          data directory (default: engine/graph)
  --format native|kx          output format (default: native)
  --top-k <n>                 initial retrieval count (default: 20)
  --max-depth <n>             traversal depth (default: 2)
  --provider anthropic|kimi   for query understanding (default: kimi)
  --model <model>             model for query understanding
  --no-traverse               skip graph traversal
  --no-gaps                   skip gap detection
  --json                      raw JSON to stdout

Environment:
  KIMI_API_KEY | ANTHROPIC_API_KEY — for query understanding
  OPENAI_API_KEY — for query embedding (vector search)
```

### Examples

```bash
# Full apply pipeline, native format
bun run src/run-apply.ts "How do I evaluate a product's usability?" \
  --graph-dir graph/

# KX export for Seisei consumption
bun run src/run-apply.ts "What do these books say about visual hierarchy?" \
  --format kx \
  --graph-dir graph/ \
  > visual-hierarchy.kx.json

# Quick retrieval only (no traversal, no gaps)
bun run src/run-apply.ts "affordance" \
  --no-traverse --no-gaps --top-k 5
```

---

## Cost Profile

```
                     Model tier        Calls per query    Cost
Query Understanding: cheap (Haiku)    1                  $
Retrieve:            none + embedding  1 embed call       $
Traverse:            none             —                  free
Gap Detection:       none             —                  free
Compose:             optional cheap    0–1                $ or free

Total per query: 1–2 cheap calls + 1 embedding call.
~100x cheaper than the Learn pipeline.
```

---

## Implementation Order

Build order optimizes for incremental value — each step produces a
working CLI command:

### Step 1: Traverse (no LLM needed)

Add graph traversal on top of existing retrieve. This alone makes
`run-retrieve.ts` significantly better — following graph edges to pull
connected knowledge.

### Step 2: Gap Detection (no LLM needed)

Compare retrieved domains/frame types against a simple target list
(can be provided via CLI flags before query understanding exists).

### Step 3: Compose + KX Export (no LLM needed)

Group atoms into sections, format contradictions, output KX.

### Step 4: Query Understanding (LLM needed)

Add the LLM-powered query planner to replace manual CLI flags.

---

## Open Questions

1. **Section grouping strategy.** Group by entity, by domain, or by
   frame type? Probably entity-first with domain as fallback.
2. **Traversal depth vs noise.** Depth 2 may pull too much loosely
   related knowledge. May need a relevance threshold per hop.
3. **Summary generation.** Is an LLM-generated section summary worth
   the cost per query? Could be opt-in.
4. **Caching.** Should QueryPlans be cached for repeated queries?
   The graph inventory changes rarely — plans could be memoized.
5. **Streaming.** For large knowledge bases, should compose stream
   sections as they're ready, or buffer the full package?
