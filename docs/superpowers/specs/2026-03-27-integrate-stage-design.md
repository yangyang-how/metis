# Integrate Stage Design Spec

**Date:** 2026-03-27
**Status:** Approved (pending implementation)
**Branch:** `feat/comprehend-stage` (will branch from here)

## Overview

The Integrate stage is the fourth and final stage of the Metis Learn pipeline. It takes `CandidateAtom[]` from the Extract stage and produces a unified knowledge graph by resolving entities, detecting cross-source relationships, and constructing the graph index.

```
Parse → Comprehend → Extract → **Integrate** → KnowledgeGraph
```

### Execution Model

- **Incremental (primary):** After each book is processed, new atoms integrate into the existing graph.
- **Batch rebuild:** Wipe the graph and re-integrate all books from scratch. Implemented as incremental integration called N times on an empty graph — same code path.

### Cost Profile

- **LLM calls:** Cheap model (Haiku tier). Batched entity disambiguation (~50-200 calls) + relation classification (~20-100 calls) per book.
- **Embedding calls:** OpenAI `text-embedding-3-large` (3072 dimensions). ~$0.13/1M tokens. Full corpus cost: ~$0.05.
- **Algorithmic:** Most entity clustering and relation classification is embedding math, not LLM calls.

---

## Architecture

### File Structure

```
engine/src/integrate/
  ├── index.ts               # integrate() — orchestrator
  ├── embedding-service.ts   # Atom→text, batch embedding, cache, cosine similarity
  ├── entity-resolver.ts     # Mention extraction, clustering, LLM disambiguation, cross-domain links
  ├── relation-detector.ts   # Candidate pair finding, scoring, classification
  ├── graph-builder.ts       # Atom finalization, adjacency list construction
  ├── types.ts               # All Integrate types
  ├── prompts.ts             # LLM prompt templates
  └── errors.ts              # IntegrateError class

engine/src/llm/
  ├── embedding-types.ts     # EmbeddingProvider interface
  └── openai-embedding.ts    # OpenAI adapter

engine/graph/                # Shared knowledge graph output
  ├── atoms.json
  ├── entities.json
  ├── graph.json
  └── embeddings.json
```

### Data Flow

```
CandidateAtom[] + existing KnowledgeGraph (or null)
  │
  ├─① embedding-service.ts ──→ Map<atomId, float[3072]>
  │
  ├─② entity-resolver.ts ───→ EntityIndex
  │
  ├─③ relation-detector.ts ─→ Relation[]
  │
  └─④ graph-builder.ts ─────→ KnowledgeGraph
                                 ├── atoms.json      (finalized Atom[])
                                 ├── entities.json   (EntityIndex)
                                 ├── graph.json      (GraphIndex)
                                 └── embeddings.json  (VectorIndex)
```

---

## Type Definitions

### Input

```typescript
interface IntegrateInput {
  /** New atoms from Extract stage */
  atoms: CandidateAtom[];
  /** Document metadata for provenance (from Parse stage) */
  metadata: DocumentMetadata;
  /** Existing graph to integrate into (null for first book / batch rebuild) */
  existingGraph: KnowledgeGraph | null;
  /** Provider configs */
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
}
```

### Output

```typescript
interface KnowledgeGraph {
  atoms: Atom[];
  entities: EntityIndex;
  graph: GraphIndex;
  embeddings: VectorIndex;
  stats: IntegrationStats;
}

interface IntegrationStats {
  totalAtoms: number;
  totalEntities: number;
  newEntities: number;
  mergedEntities: number;
  reinforcements: number;
  contradictions: number;
  extensions: number;
  crossDomainLinks: number;
  llmCalls: number;
  embeddingTokens: number;
}
```

### Finalized Atom

```typescript
interface Atom extends CandidateAtom {
  /** Resolved entity IDs referenced by this atom's roles */
  entityRefs: string[];
  /** Atom IDs that assert the same claim from different sources */
  reinforcedBy: string[];
  /** Atom IDs that contradict this atom */
  contradictedBy: string[];
  /** Atom IDs that extend/add nuance to this atom */
  extendedBy: string[];
}
```

### Entity Index

```typescript
interface Entity {
  id: string;                  // "entity:{slug}"
  canonicalName: string;       // "replication lag"
  aliases: string[];           // ["replica delay", "复制延迟"]
  domain: string;              // primary domain (first element of atom.domain[])
  atomIds: string[];           // atoms that reference this entity
  crossDomainLinks: string[];  // entity IDs in other domains
}

type EntityIndex = Record<string, Entity>;
```

### Graph Index

```typescript
type EdgeType =
  | "reinforces"      // same claim, different source
  | "contradicts"     // conflicting claims
  | "extends"         // adds nuance/detail
  | "entity_link"     // atoms share a resolved entity
  | "cross_domain";   // related entities across domains

interface GraphEdge {
  target: string;       // target atom or entity ID
  type: EdgeType;
  confidence: number;   // how certain we are about this edge
  source?: string;      // which book integration created this edge
}

/** Adjacency list: nodeId → outgoing edges */
type GraphIndex = Record<string, GraphEdge[]>;
```

### Vector Index

```typescript
interface VectorEntry {
  atomId: string;
  text: string;           // the sentence that was embedded
  embedding: number[];    // float[3072]
}

type VectorIndex = VectorEntry[];
```

### Embedding Provider

```typescript
interface EmbeddingProvider {
  /** Embed a batch of texts. Returns embeddings in same order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Model dimensions (e.g., 3072 for text-embedding-3-large) */
  dimensions: number;
  /** Max batch size the provider supports */
  maxBatchSize: number;
}

interface EmbeddingConfig {
  provider: "openai";     // extensible: "ollama" | "voyage"
  model: string;          // "text-embedding-3-large"
  apiKey?: string;        // defaults to OPENAI_API_KEY env var
}
```

### Internal Types

```typescript
interface EntityMention {
  text: string;          // raw role value
  normalized: string;    // lowercase, trimmed
  atomId: string;
  role: string;          // "cause", "term", "entity"
  frame: string;         // "definition", "causal"
  domain: string;        // primary domain (first element of atom.domain[])
}

interface Relation {
  type: "reinforces" | "contradicts" | "extends";
  atomA: string;
  atomB: string;
  confidence: number;
  method: "algorithmic" | "llm";
}
```

---

## Module Responsibilities

### index.ts — Orchestrator (~80 lines)

Exports `integrate(input: IntegrateInput): Promise<KnowledgeGraph>`. Calls the four sub-steps in order. Handles loading/saving knowledge graph files. Collects stats. No business logic.

```typescript
async function integrate(input): KnowledgeGraph {
  const embeddings = await embedAtoms(input.atoms, input.embeddingProvider, existing.embeddings)
  const entities = await resolveEntities(input.atoms, existing.entities, embeddings, input.llmProvider)
  const relations = await detectRelations(input.atoms, existing.atoms, entities, embeddings, input.llmProvider)
  return buildGraph(input.atoms, existing, entities, relations, embeddings)
}
```

### embedding-service.ts — Embed & Cache (~120 lines)

**Functions:**

- `atomToText(atom: CandidateAtom): string` — Concatenates role values into a natural language sentence. Format varies by frame type (e.g., causal: "{cause} causes {effect}", definition: "{term} means {meaning}").
- `embedAtoms(atoms, provider, existingCache): Promise<VectorIndex>` — Skips already-cached atoms. Batches new atoms according to provider's `maxBatchSize`. Returns merged index.
- `cosineSimilarity(a: number[], b: number[]): number` — Utility for comparing embeddings.

### entity-resolver.ts — Entity Resolution (~250 lines)

The most complex module. Four sub-steps:

**1. `extractMentions(atoms): EntityMention[]`**

Walks all atoms. Extracts entity mentions from "entity-bearing" roles. Which roles are entity-bearing is defined per frame type as configuration:

| Frame | Entity-bearing roles |
|-------|---------------------|
| `definition` | term |
| `has_property` | entity |
| `is_a` | instance, category |
| `causal` | cause, effect |
| `causal_chain` | trigger, outcome |
| `threshold` | metric |
| `heuristic` | situation |
| `principle` | statement (first 60 chars) |
| `method_comparison` | method_a, method_b |
| `formula` | name |
| `procedure` | goal |
| `sequence` | name |
| `evaluation_matrix` | name |
| `taxonomy` | concept |
| `consists_of` | whole |
| `example_of` | concept |
| `deviation` | theory |

**2. `clusterMentions(mentions, embeddings): MentionCluster[]`**

Within each domain:
- First pass: exact normalized match (lowercase, trim, remove articles).
- Second pass: embed mention text, merge clusters where centroid similarity >= 0.85.
- Incremental: new mentions compared against existing entity canonical names + aliases first.

**3. `disambiguate(ambiguousClusters, llm): MergeDecision[]`**

For clusters with similarity 0.70-0.85: batch to LLM. Prompt: "Given these mentions in [domain], are they the same concept?" Responds: merge / separate / unsure. Up to 20 pairs per LLM call.

**4. `linkCrossDomain(entities, embeddings): CrossDomainLink[]`**

Compare entity canonical names across domains using embedding similarity. Threshold >= 0.75 creates a `cross_domain_link`. No LLM needed — purely embedding math.

### Entity Resolution Strategy

**Layered:** Merge within domain, link across domains.

- Within the same domain, entities that refer to the same concept are merged (one entity node with aliases).
- Across domains, related entities get a lightweight `cross_domain_link` — not a merge, just a signal for the Apply pipeline to optionally traverse.
- False merges are expensive to undo. False separations are cheap to fix later. The system errs conservative.

### relation-detector.ts — Relation Detection (~200 lines)

**1. `findCandidatePairs(newAtoms, existingAtoms, entities): AtomPair[]`**

For each new atom, find existing atoms sharing at least one entity. Filter out same-book pairs (same source cannot reinforce itself).

**2. `scoreAndClassify(pairs, embeddings, llm): Relation[]`**

For each pair, compute full-atom embedding similarity. Classification rules:

| Condition | Classification | Method |
|-----------|---------------|--------|
| Same frame + similarity >= 0.90 | Reinforcement | Algorithmic |
| Same frame + similarity 0.75-0.90 | Ambiguous — LLM decides | LLM tiebreaker |
| Same frame + opposing role values | Contradiction candidate | LLM confirm |
| Different frame + same entity | Extension | Algorithmic |
| Similarity < 0.75 | Unrelated (entity_link only) | Skip |

LLM calls are batched — up to 10 pairs per call.

### graph-builder.ts — Graph Construction (~150 lines)

**1. `finalizeAtoms(candidates, entities, relations): Atom[]`**

Promotes CandidateAtom to Atom:
- Populates `entityRefs` from entity index.
- Populates `reinforcedBy`, `contradictedBy`, `extendedBy` from relations.
- Updates confidence: +0.05 per reinforcing source (capped at 1.0).

**2. `buildAdjacencyList(atoms, entities, relations): GraphIndex`**

Creates typed edges:
- `entity_link` for atoms sharing entities.
- `reinforces`, `contradicts`, `extends` from detected relations.
- `cross_domain` from entity cross-domain links.
- All edges are bidirectional (A→B and B→A both stored).

### prompts.ts — LLM Prompts (~100 lines)

Two prompt templates, both designed for cheap models (Haiku tier):

**Entity Disambiguation:** "Given these entity mentions in [domain], are they the same concept? For each pair, respond: merge / separate / unsure." Batched up to 20 pairs per call.

**Relation Classification:** "Given these two atoms about [entity], classify: reinforce (same claim), contradict (opposing claims), extend (adds nuance), or unrelated." Batched up to 10 pairs per call.

---

## Pipeline Integration

### CLI Changes

New flags for `run-pipeline.ts`:

| Flag | Default | Purpose |
|------|---------|---------|
| `--integrate-provider` | kimi | LLM for entity disambiguation + relation classification |
| `--embedding-provider` | openai | Embedding model provider |
| `--embedding-model` | text-embedding-3-large | Which embedding model to use |
| `--graph-dir` | engine/graph | Where the knowledge graph files live |
| `--skip-integrate` | false | Run only Parse → Comprehend → Extract |
| `--rebuild-graph` | false | Wipe graph and rebuild from all output/*.json |

### Environment Variables

| Variable | Required for |
|----------|-------------|
| `KIMI_API_KEY` | LLM calls (existing) |
| `OPENAI_API_KEY` | **NEW** — embedding calls |

### Batch Runner Flow

```typescript
for (const epub of BOOKS) {
  const tree = await parse(epub)
  const comprehension = await comprehend(tree, llmProvider)
  const extraction = await extract(comprehension, llmProvider)
  saveOutput(`output/${slug}.json`, { metadata, comprehension, extraction })

  // Stage 4: Integrate (NEW)
  const existingGraph = loadGraph('graph/')
  const updatedGraph = await integrate({
    atoms: extraction.atoms,
    metadata: tree.metadata,
    existingGraph,
    llmProvider: integrateProvider,
    embeddingProvider
  })
  saveGraph('graph/', updatedGraph)

  await delay(2000)
}
```

### Output Layout

```
engine/
  ├── output/          # Per-book extraction results (unchanged)
  │   ├── designing-data-intensive-applications.json
  │   └── ...
  └── graph/           # Shared knowledge graph (NEW)
      ├── atoms.json
      ├── entities.json
      ├── graph.json
      └── embeddings.json
```

---

## Error Handling

Design principle: **lenient, never lose data.** LLM failures degrade to conservative algorithmic defaults. The graph is always buildable from entities alone — relations are enrichment, not requirements.

| Failure | Behavior | Rationale |
|---------|----------|-----------|
| Embedding API fails | Retry 2x with backoff. Abort if still fails. | Embeddings are required for all downstream steps. |
| LLM disambiguation fails | Retry 2x. Treat ambiguous as **separate**. Log warning. | False separation is safer than false merge. |
| LLM relation classification fails | Retry 2x. Skip the pair. Log warning. | entity_link edge still connects the atoms. |
| LLM returns unparseable JSON | Retry with same prompt (2x). Skip batch on failure. | Same pattern as Extract stage. |
| Existing graph files corrupt/missing | Treat as empty graph (batch rebuild). Log warning. | Rebuilding is always safe. |
| Atom has no domain tags | Assign to "untagged" domain. | Don't drop atoms. Degrade gracefully. |

---

## Testing Strategy

### Test Files

```
engine/test/integrate/
  ├── embedding-service.test.ts
  ├── entity-resolver.test.ts
  ├── relation-detector.test.ts
  ├── graph-builder.test.ts
  ├── integration.test.ts
  └── fixtures/
      ├── sample-atoms.ts
      └── mock-embeddings.ts
```

All tests use mock providers — no real API calls.

### Test Coverage

**embedding-service.test.ts:**
- `atomToText` produces readable sentences for each frame type
- Batching respects `maxBatchSize`
- Cache: already-embedded atoms skipped
- `cosineSimilarity` returns expected scores for known vectors

**entity-resolver.test.ts:**
- Correct entity-bearing roles extracted per frame type
- Exact match clustering: "replication lag" and "Replication Lag" merge
- Embedding clustering: similar mentions merge within domain (>= 0.85)
- Domain boundary: same text in different domains stays separate
- Incremental: new mention merges into existing entity, no duplicate
- LLM disambiguation: mock returns merge/separate, entities update
- Cross-domain links: similar entities across domains linked, not merged

**relation-detector.test.ts:**
- Only atoms sharing entities are compared; same-book pairs excluded
- Reinforcement: same frame, same roles, different books
- Contradiction: opposing claims about same entity
- Extension: different frame on same entity
- LLM tiebreaker: ambiguous pairs sent to mock LLM
- No false positives: unrelated atoms get entity_link only

**graph-builder.test.ts:**
- CandidateAtom promoted to Atom with all fields populated
- Confidence boosted by reinforcement (+0.05/source, capped at 1.0)
- Bidirectional edges created
- Correct EdgeType for each relation kind
- Incremental merge: no duplicate atoms or edges

**integration.test.ts:**
- First book on empty graph produces valid KnowledgeGraph
- Second book incrementally finds entities and relations
- Batch rebuild (sequential integration) produces consistent results
- IntegrationStats accurately counts everything

---

## Design Decisions & Rationale

### Why layered entity resolution (merge within domain, link across)?
False merges corrupt the graph and are hard to undo. False separations are cheap to fix later. Cross-domain links let the Apply pipeline decide when to traverse domain boundaries based on query intent.

### Why OpenAI embeddings, not local?
Half the corpus is Chinese. Bilingual embedding quality matters. Cost is negligible (~$0.05 for the full corpus with `text-embedding-3-large`). The `EmbeddingProvider` interface allows swapping to Ollama later for offline/free usage.

### Why flat JSON files, not ChromaDB?
At 4K-50K atoms, brute-force cosine similarity on flat JSON is fast enough. ChromaDB adds a dependency and operational complexity. We can migrate when scale demands it — the `VectorIndex` type abstracts the storage.

### Why entity-filtered relation detection, not all-pairs?
4,101 atoms = ~8.4M pairs. Filtering by shared entity reduces this to ~10K-50K pairs. Entity resolution does the expensive work once; relation detection benefits from the narrowed search space.

### Why algorithmic classification with LLM tiebreaker?
Most reinforcement (>= 0.90 similarity) and extension (different frame, same entity) cases are unambiguous. Only the middle band (0.75-0.90) and contradiction candidates need LLM judgment. This keeps LLM costs low while maintaining accuracy where it matters.
