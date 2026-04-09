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

## Appendix A: Query Understanding Prompt

The query understanding stage uses a cheap model (Haiku tier) with
one call. The prompt constrains the output to the graph's actual
inventory — the model can only target domains, entities, and frame
types that exist.

### System Prompt

```
You are a query planner for a knowledge retrieval system. Given a
user's question and an inventory of available knowledge, produce a
structured query plan.

You will receive:
- The user's question
- An inventory of available domains, entities, and frame types
  with their counts

Respond with a JSON object using EXACTLY these field names (camelCase):

{
  "intent": "<what the user is trying to do>",
  "analysisType": "<type of analysis needed>",
  "targetDomains": ["<domain1>", "<domain2>"],
  "targetFrameTypes": ["<frameType1>", "<frameType2>"],
  "targetEntities": ["<entity1>", "<entity2>"],
  "weights": {
    "domainMatch": 0.0-1.0,
    "frameTypeMatch": 0.0-1.0,
    "entityMatch": 0.0-1.0
  }
}

Rules:
1. Only use domains, entities, and frame types from the inventory.
   Do NOT invent domains or entities that don't exist.
2. Select 1-5 target domains (most relevant to the question).
3. Select 2-6 target frame types based on what the question needs:
   - "How do I..." → procedure, heuristic
   - "What is..." → definition, has_property
   - "Compare..." → method_comparison, evaluation_matrix
   - "Why does..." → causal, causal_chain
   - "Evaluate..." → evaluation_matrix, heuristic, principle
   - "What are the risks..." → deviation, threshold
4. Select 2-8 target entities (concepts the question is about).
5. Set weights based on query specificity:
   - Broad questions → higher domainMatch (cast a wide net)
   - Specific questions → higher entityMatch (precise retrieval)
   - "How to" questions → higher frameTypeMatch (method-focused)

IMPORTANT: Use camelCase field names exactly as shown. Do NOT use
snake_case. Respond with valid JSON only.
```

### User Prompt

```
Question: "{query}"

{scope constraints if provided via CLI flags}

--- Available Knowledge Inventory ---

Domains ({count} total):
{domain_name} ({atom_count} atoms)
...

Entities ({count} total):
{entity_name} [aliases: {alias1}, {alias2}] — domain: {domain}
...

Frame Types ({count} total):
{frame_type_name} ({count} atoms) — {description}
...
```

### Response Schema

```typescript
function getQueryPlanSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      intent: { type: "string" },
      analysisType: { type: "string" },
      targetDomains: {
        type: "array",
        items: { type: "string" },
      },
      targetFrameTypes: {
        type: "array",
        items: { type: "string" },
      },
      targetEntities: {
        type: "array",
        items: { type: "string" },
      },
      weights: {
        type: "object",
        properties: {
          domainMatch: { type: "number" },
          frameTypeMatch: { type: "number" },
          entityMatch: { type: "number" },
        },
        required: ["domainMatch", "frameTypeMatch", "entityMatch"],
      },
    },
    required: [
      "intent",
      "analysisType",
      "targetDomains",
      "targetFrameTypes",
      "targetEntities",
      "weights",
    ],
  };
}
```

### Inventory Construction

The inventory is pre-computed once when the graph is loaded. It's a
compact summary — not the full graph — small enough to fit in a
cheap model's context.

```typescript
function buildInventory(graph: KnowledgeGraph): GraphInventory {
  const domainCounts = new Map<string, number>();
  const frameTypeCounts = new Map<string, number>();

  for (const atom of graph.atoms) {
    for (const d of atom.domain) {
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    frameTypeCounts.set(
      atom.frame,
      (frameTypeCounts.get(atom.frame) ?? 0) + 1,
    );
  }

  return {
    domains: [...domainCounts.entries()]
      .map(([name, atomCount]) => ({ name, atomCount }))
      .sort((a, b) => b.atomCount - a.atomCount),
    entities: Object.values(graph.entities)
      .map(e => ({
        name: e.canonicalName,
        aliases: e.aliases,
        domain: e.domain,
      })),
    frameTypes: [...frameTypeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    sources: extractSourceList(graph.atoms),
  };
}
```

### Field Normalization

LLMs return snake_case despite instructions. Normalize:

```typescript
function normalizeQueryPlan(raw: Record<string, unknown>): QueryPlan {
  return {
    intent: (raw.intent ?? raw["intent"]) as string,
    analysisType: (raw.analysisType ?? raw["analysis_type"]) as string,
    targetDomains: (raw.targetDomains ?? raw["target_domains"]) as string[],
    targetFrameTypes: (raw.targetFrameTypes ?? raw["target_frame_types"]) as string[],
    targetEntities: (raw.targetEntities ?? raw["target_entities"]) as string[],
    weights: normalizeWeights(raw.weights ?? raw["weights"]),
  };
}
```

---

## Appendix B: KX Export Mapping

How ContextPackage maps to KXDocument. This is the concrete
implementation of the mapping table in Stage 5.

### Frame Type → KX Kind

```typescript
const FRAME_TO_KX_KIND: Record<string, KXKind> = {
  // Direct mappings
  definition: "definition",
  has_property: "property",
  is_a: "classification",
  consists_of: "classification",
  taxonomy: "classification",
  example_of: "example",
  causal: "causal",
  causal_chain: "causal",
  heuristic: "heuristic",
  principle: "principle",
  procedure: "procedure",
  method_comparison: "comparison",
  threshold: "threshold",
  deviation: "deviation",
  formula: "evaluation",
  sequence: "evaluation",
  evaluation_matrix: "evaluation",
};

function frameToKXKind(frameType: string): KXKind {
  return FRAME_TO_KX_KIND[frameType] ?? "property";
  // Fallback: unknown domain-specific frames → "property"
  // (safest generic — a claim about something)
}
```

### Atom → KXUnit

```typescript
function atomToKXUnit(atom: Atom, sourceRef: string): KXUnit {
  // Build content from roles — a readable natural language sentence.
  // Each frame type has a content template.
  const content = buildContent(atom);

  return {
    id: atom.id,
    kind: frameToKXKind(atom.frame),
    content,
    roles: atom.roles,         // Passed through directly. Metis roles
                               // ARE KX roles — same key-value structure.
    conditions: atom.conditions,
    confidence: atom.confidence,
    source: {
      ref: sourceRef,
      location: formatLocation(atom.source),
    },
    domains: atom.domain,
  };
}
```

### Content Templates

Each frame type has a template for generating the `content` field —
a natural language sentence that any consumer can understand without
knowing the frame schema.

```typescript
const CONTENT_TEMPLATES: Record<string, (roles: Record<string, string>) => string> = {
  definition: (r) =>
    `${r.term} means ${r.meaning}.`,
  has_property: (r) =>
    `${r.entity} has the property: ${r.property}.`,
  is_a: (r) =>
    `${r.instance} is a type of ${r.category}.`,
  consists_of: (r) =>
    `${r.whole} consists of ${r.dimension}${r.description ? `: ${r.description}` : ""}.`,
  example_of: (r) =>
    `${r.instance} is an example of ${r.concept}${r.detail ? ` — ${r.detail}` : ""}.`,
  taxonomy: (r) =>
    `${r.concept} is classified into: ${r.categories}${r.basis ? ` (by ${r.basis})` : ""}.`,
  causal: (r) =>
    `${r.cause} causes ${r.effect}.`,
  causal_chain: (r) =>
    `${r.trigger} leads to ${r.outcome}${r.mechanism ? ` via ${r.mechanism}` : ""}.`,
  heuristic: (r) =>
    `When ${r.situation}, ${r.action}${r.rationale ? ` because ${r.rationale}` : ""}.`,
  principle: (r) =>
    `${r.statement}${r.implication ? ` This implies: ${r.implication}` : ""}.`,
  procedure: (r) =>
    `To ${r.goal}: ${r.steps}.`,
  method_comparison: (r) =>
    `${r.method_a} vs ${r.method_b}: ${r.difference}${r.when_to_use ? `. ${r.when_to_use}` : ""}.`,
  formula: (r) =>
    `${r.name}: ${r.expression}${r.terms ? ` where ${r.terms}` : ""}.`,
  threshold: (r) =>
    `${r.metric} at ${r.threshold_value}: ${r.transition ?? "behavior changes"}${r.direction ? ` (${r.direction})` : ""}.`,
  deviation: (r) =>
    `Theory says ${r.theory}, but reality is ${r.reality}${r.implication ? `. ${r.implication}` : ""}.`,
  sequence: (r) =>
    `${r.name}: ${r.layers}${r.rule ? ` (${r.rule})` : ""}.`,
  evaluation_matrix: (r) =>
    `${r.name} evaluates along ${r.dimensions}${r.quadrants ? `: ${r.quadrants}` : ""}${r.rule ? `. ${r.rule}` : ""}.`,
};

function buildContent(atom: Atom): string {
  const template = CONTENT_TEMPLATES[atom.frame];
  if (template) {
    return template(atom.roles);
  }
  // Fallback for domain-specific frames: concatenate role values
  return Object.values(atom.roles).join(". ");
}
```

### Relation Mapping

```typescript
function graphEdgeToKXRelation(
  edge: GraphEdge,
  fromId: string,
): KXRelation | null {
  // Only map semantic relations, not structural ones
  const typeMap: Record<string, KXRelationType | null> = {
    reinforces: "reinforces",
    contradicts: "contradicts",
    extends: "extends",
    entity_link: null,        // Skip — structural, not semantic
    cross_domain: null,       // Skip — structural, not semantic
  };

  const kxType = typeMap[edge.type];
  if (!kxType) return null;

  return {
    from: fromId,
    to: edge.target,
    type: kxType,
    confidence: edge.confidence,
  };
}
```

### Source Mapping

```typescript
function atomSourcesToKXSources(atoms: Atom[]): KXSource[] {
  const seen = new Map<string, KXSource>();

  for (const atom of atoms) {
    const key = atom.source.title;
    if (!seen.has(key)) {
      seen.set(key, {
        id: slugify(key),
        type: "book",           // Default. Could infer from metadata.
        title: atom.source.title,
        authors: atom.source.authors,
      });
    }
  }

  return [...seen.values()];
}

function formatLocation(source: Atom["source"]): string {
  const parts: string[] = [];
  if (source.chapterId) parts.push(`Ch.${source.chapterId}`);
  if (source.sectionId) parts.push(`§${source.sectionId}`);
  return parts.join(", ") || undefined;
}
```

### Full Export Function

```typescript
function exportToKX(pkg: ContextPackage): KXDocument {
  const sources = atomSourcesToKXSources(
    pkg.sections.flatMap(s => s.atoms),
  );
  const sourceRefMap = new Map(sources.map(s => [s.title, s.id]));

  const units = pkg.sections.flatMap(section =>
    section.atoms.map(atom =>
      atomToKXUnit(atom, sourceRefMap.get(atom.source.title) ?? "unknown")
    )
  );

  const relations = buildKXRelations(pkg);

  return {
    version: "kx/1.0",
    meta: {
      domains: [...new Set(units.flatMap(u => u.domains))],
      sources,
      generatedBy: "metis/0.1",
      generatedAt: new Date().toISOString(),
    },
    units,
    relations,
  };
}
```

### Gaps Sidecar Export

Gaps are not knowledge — they're meta-information about coverage.
Exported as a separate file alongside the KX document.

```typescript
interface GapsDocument {
  version: "gaps/1.0";
  query: string;
  gaps: GapEntry[];
  stats: {
    totalAtomsRetrieved: number;
    contradictionsFound: number;
    gapsFound: number;
  };
}

interface GapEntry {
  type: "missing_domain" | "missing_frame_type" | "missing_entity"
      | "thin_coverage" | "unresolved_contradiction";
  description: string;
  severity: "critical" | "notable" | "minor";
  suggestion?: string;
}
```

Output convention:
```
output/
  {query-slug}.kx.json          # KX document
  {query-slug}.gaps.json        # Gap analysis sidecar
```

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
