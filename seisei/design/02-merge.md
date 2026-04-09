# Merge Stage Design

The second stage of the Seisei pipeline. Takes N KXDocuments (from
Ingest) and produces a single MergedKnowledge structure — clustered,
deduplicated, with conflicts detected and classified.

This is where multi-source intelligence happens. A single source
gives you knowledge; multiple sources give you perspective.

## Constraints

- **All input is KX.** The merge stage never sees raw text, PDF, or
  any original format. Ingest has already normalized everything.
- **No knowledge is silently dropped.** Units may be merged
  (deduplicated), but the constituent sources are always preserved
  in attribution.
- **Conflicts are classified, not resolved.** Merge detects and
  labels conflicts. How to present them in the skill is Compose's
  job.
- **Deterministic.** Same inputs → same MergedKnowledge. No random
  seed, no non-deterministic clustering.

---

## Input / Output

### Input

```typescript
interface MergeInput {
  documents: KXDocument[];        // from Ingest
  options?: MergeOptions;
}

interface MergeOptions {
  similarityThreshold?: number;   // for clustering (default: 0.80)
  conflictThreshold?: number;     // for contradiction detection (default: 0.70)
  maxClusters?: number;           // cap cluster count (default: 50)
}
```

### Output

```typescript
interface MergedKnowledge {
  clusters: KnowledgeCluster[];
  conflicts: Conflict[];
  stats: MergeStats;
}

interface KnowledgeCluster {
  id: string;
  topic: string;                  // derived label for the cluster
  domains: string[];              // union of member domains
  units: MergedUnit[];            // deduplicated, confidence-boosted
  kind: KXKind;                   // dominant kind in this cluster
}

interface MergedUnit {
  /** The canonical unit (highest confidence or most detailed) */
  canonical: KXUnit;

  /** Other units that were merged into this one */
  merged: KXUnit[];               // empty if no duplicates

  /** Combined confidence (boosted if multiple sources agree) */
  confidence: number;

  /** All sources that support this unit */
  sources: KXSource[];
}

interface Conflict {
  id: string;
  type: "scope_dependent" | "unresolved";
  topic: string;                  // what they disagree about
  sides: ConflictSide[];
  resolution?: string;            // for scope_dependent: the conditional rule
}

interface ConflictSide {
  units: KXUnit[];
  claim: string;                  // what this side asserts
  sources: KXSource[];
  conditions: string[];           // scoping conditions
}

interface MergeStats {
  inputDocuments: number;
  inputUnits: number;
  clustersFormed: number;
  unitsMerged: number;            // dedup count
  conflictsDetected: number;
  scopeDependentConflicts: number;
  unresolvedConflicts: number;
}
```

---

## Algorithm

### Step 1: Flatten

Collect all units from all KXDocuments into a single list. Attach
source metadata to each unit for attribution.

```typescript
const allUnits: Array<{ unit: KXUnit; source: KXSource; docIndex: number }> =
  documents.flatMap((doc, i) =>
    doc.units.map(unit => ({
      unit,
      source: doc.meta.sources.find(s => s.id === unit.source.ref)!,
      docIndex: i,
    }))
  );
```

### Step 2: Embed

Generate embeddings for each unit's `content` field. Used for
semantic similarity in clustering and deduplication.

```typescript
const embeddings = await embedAll(
  allUnits.map(u => u.unit.content),
  embeddingProvider,
);
```

Batch embedding calls to respect rate limits. Same pattern as Metis
integration stage.

### Step 3: Cluster

Group units by topic using agglomerative clustering on embeddings.

**Algorithm: Agglomerative Hierarchical Clustering**

1. Start with each unit as its own cluster.
2. Compute pairwise cosine similarity between cluster centroids.
3. Merge the two most similar clusters (above `similarityThreshold`).
4. Recompute centroid of merged cluster (average of member embeddings).
5. Repeat until no pair exceeds the threshold or `maxClusters` is
   reached.

Why agglomerative over k-means: we don't know the number of clusters
in advance, and the data is small enough (typically <500 units) that
O(n²) is fine.

**Domain boost:** When computing similarity, units sharing a domain
get a +0.05 boost. Units with the same `kind` get a +0.03 boost.
This biases clustering toward topically coherent groups.

```typescript
function adjustedSimilarity(
  sim: number,
  unitA: KXUnit,
  unitB: KXUnit,
): number {
  let adjusted = sim;
  if (hasOverlap(unitA.domains, unitB.domains)) adjusted += 0.05;
  if (unitA.kind === unitB.kind) adjusted += 0.03;
  return Math.min(adjusted, 1.0);
}
```

### Step 4: Label Clusters

Each cluster gets a `topic` label. Derived from:

1. The most common entity/concept across member units (extracted
   from `content` or `roles`).
2. If ambiguous, use a cheap LLM call to generate a 2-4 word topic
   label from the cluster's top 3 units.

### Step 5: Deduplicate Within Clusters

Within each cluster, find units that say the same thing:

1. Compute pairwise similarity of units within the cluster.
2. Pairs above 0.92 similarity → candidate duplicates.
3. For each candidate pair, check:
   - Same `kind`? (required)
   - Overlapping `conditions`? (required)
   - From different sources? (expected — same-source dupes were
     handled in Ingest)
4. Merge: keep the more detailed unit as `canonical`, add the other
   to `merged`. Boost confidence:

```typescript
function mergeConfidence(a: number, b: number): number {
  // Two independent sources agreeing = stronger belief
  // Formula: 1 - (1 - a)(1 - b), capped at 0.99
  return Math.min(1 - (1 - a) * (1 - b), 0.99);
}
```

### Step 6: Detect Conflicts

Within each cluster, find units that contradict:

1. **Embedding antipairs:** Units with content similarity between
   0.5 and 0.75 — similar topic but different claims. (Very high
   similarity = agreement, very low = different topic.)
2. **LLM confirmation:** For each candidate pair, one cheap LLM call
   asking: "Do these two statements contradict each other? If yes,
   can the contradiction be resolved by scoping (different conditions
   apply)?"

The LLM returns:

```typescript
interface ConflictCheck {
  contradicts: boolean;
  scopeDependent: boolean;       // true if conditions differentiate
  explanation: string;
  conditionalRule?: string;      // "if X then A; if Y then B"
}
```

### Step 7: Classify Conflicts

- **Scope-dependent:** Both sides have non-overlapping `conditions`,
  or the LLM identifies a scoping dimension. → Generate a conditional
  rule. Compose will render this as a decision criterion.
- **Unresolved:** Overlapping or empty conditions, no clear scoping.
  → Flag for the skill's "Known Debates" section.

---

## Cross-Source Relations

Merge also discovers new relations between units from different
sources that weren't in the original KXDocuments:

| Pattern | Relation type |
|---|---|
| Units in same cluster, same claim, different source | `reinforces` |
| Units contradict (detected above) | `contradicts` |
| One unit's `content` is a specific case of another's | `exemplifies` |
| One unit adds a condition or nuance to another | `extends` |

The `reinforces` and `contradicts` relations are algorithmic.
`exemplifies` and `extends` require a cheap LLM call on candidate
pairs (units in the same cluster with different `kind` values).

---

## Edge Cases

### Single Source

If there's only one KXDocument, merge is mostly a passthrough:
- Cluster the units (still useful for organization).
- No cross-source deduplication possible.
- No cross-source conflicts possible.
- Within-source contradictions are still detected (a book can
  contradict itself).

### Empty or Near-Empty Sources

A source with 0 units after Ingest is logged as a warning and
excluded. A source with <3 units is flagged as "thin source" in
the stats.

### Overwhelming Source

If one source contributes 90% of units, clusters will be dominated
by that source. This is fine — it reflects reality. The stats
surface the imbalance:

```typescript
interface SourceBalance {
  sourceId: string;
  unitCount: number;
  percentageOfTotal: number;
}
```

---

## Cost Profile

```
Embedding:           1 batch call per ~100 units
Clustering:          0 LLM calls (algorithmic)
Cluster labeling:    0-1 cheap call per cluster (only if ambiguous)
Deduplication:       0 LLM calls (embedding similarity)
Conflict detection:  1 cheap call per candidate contradiction pair
Conflict class.:     included in detection call

Typical (100 units, 3 sources):
  1 embedding batch + 5-10 cheap LLM calls ≈ $0.01-0.03
```

---

## Open Questions

1. **Clustering granularity.** Should `similarityThreshold` be
   user-configurable, or should Seisei auto-tune based on unit
   count? Too high → many small clusters; too low → few large ones.
2. **Transitive conflicts.** If A contradicts B, and B reinforces C,
   does A contradict C? How deep to chase?
3. **Temporal ordering.** When two sources disagree and one is newer,
   should recency factor into conflict presentation? (Not resolution
   — but flagging "Source B is newer and disagrees with Source A".)
4. **Cluster stability.** Adding one new source shouldn't completely
   reorganize existing clusters. But agglomerative clustering doesn't
   guarantee this. Problem in practice?
