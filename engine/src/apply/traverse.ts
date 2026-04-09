// engine/src/apply/traverse.ts
/**
 * Stage 3: Graph Traversal — spreading activation.
 *
 * Starting from seed atoms (retrieve results), follow graph edges
 * to pull connected knowledge. Confidence thresholds tighten per hop
 * to prevent noise at deeper depths.
 */
import type { Atom, EdgeType, GraphIndex } from "../integrate/types";
import type { TraversalOptions, TraversalPath, TraversalResult } from "./types";

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MIN_CONFIDENCE = [0.5, 0.7];
const DEFAULT_MAX_EXPANDED = 50;

/**
 * Traverse the knowledge graph starting from seed atoms.
 *
 * @param seeds - Atoms from the retrieve stage (initial results)
 * @param graphIndex - Adjacency list of atom edges
 * @param atomMap - Map of atomId → Atom for looking up targets
 * @param options - Traversal configuration
 */
export function traverse(
  seeds: Atom[],
  graphIndex: GraphIndex,
  atomMap: Map<string, Atom>,
  options?: TraversalOptions,
): TraversalResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxExpanded = options?.maxExpanded ?? DEFAULT_MAX_EXPANDED;
  const plan = options?.plan;

  // Track all expanded atoms by their path info
  const expanded = new Map<string, TraversalPath>();

  // Add seeds at depth 0
  for (const seed of seeds) {
    expanded.set(seed.id, {
      atomId: seed.id,
      reachedVia: "direct_retrieval",
      depth: 0,
      score: 1.0,
    });
  }

  // BFS with depth-limited expansion
  let frontier = seeds.map((s) => s.id);

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (expanded.size >= maxExpanded) break;

    const minConf = minConfidence[depth - 1] ?? 0.7;
    const nextFrontier: string[] = [];

    for (const atomId of frontier) {
      const edges = graphIndex[atomId];
      if (!edges) continue;

      for (const edge of edges) {
        // Skip already-expanded atoms
        if (expanded.has(edge.target)) continue;

        // Skip below confidence threshold
        if (edge.confidence < minConf) continue;

        // Apply edge-type rules
        if (!shouldFollow(edge.type, depth, edge.target, plan, atomMap)) {
          continue;
        }

        // Cap check
        if (expanded.size >= maxExpanded) break;

        const score = edge.confidence * (1 / depth);
        expanded.set(edge.target, {
          atomId: edge.target,
          reachedVia: "graph_traversal",
          depth,
          edgeType: edge.type,
          score,
        });
        nextFrontier.push(edge.target);
      }

      if (expanded.size >= maxExpanded) break;
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Collect result atoms
  const resultAtoms: Atom[] = [];
  for (const [atomId] of expanded) {
    const atom = atomMap.get(atomId);
    if (atom) resultAtoms.push(atom);
  }

  // Collect contradictions from edges between expanded atoms
  const contradictions = collectContradictions(expanded, graphIndex, atomMap);

  return {
    atoms: resultAtoms,
    paths: [...expanded.values()],
    contradictions,
  };
}

function shouldFollow(
  edgeType: EdgeType,
  depth: number,
  targetId: string,
  plan: TraversalOptions["plan"],
  atomMap: Map<string, Atom>,
): boolean {
  switch (edgeType) {
    case "reinforces":
      return true;
    case "contradicts":
      return true;
    case "extends":
      return depth <= 1;
    case "entity_link": {
      if (!plan) return false;
      const target = atomMap.get(targetId);
      if (!target) return false;
      // Follow if target matches a target entity or domain
      const matchesEntity = target.entityRefs.some((e) =>
        plan.targetEntities.includes(e),
      );
      const matchesDomain = target.domain.some((d) =>
        plan.targetDomains.includes(d),
      );
      return matchesEntity || matchesDomain;
    }
    case "cross_domain": {
      if (!plan) return false;
      return plan.targetDomains.length > 1;
    }
    default:
      return false;
  }
}

function collectContradictions(
  expanded: Map<string, TraversalPath>,
  graphIndex: GraphIndex,
  atomMap: Map<string, Atom>,
): TraversalResult["contradictions"] {
  const seen = new Set<string>();
  const contradictions: TraversalResult["contradictions"] = [];

  for (const [atomId] of expanded) {
    const edges = graphIndex[atomId];
    if (!edges) continue;

    for (const edge of edges) {
      if (edge.type !== "contradicts") continue;
      if (!expanded.has(edge.target)) continue;

      // Deduplicate: use sorted pair key
      const key = [atomId, edge.target].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);

      // Build topic from overlapping domains/entities
      const atomA = atomMap.get(atomId);
      const atomB = atomMap.get(edge.target);
      const topic = inferContradictionTopic(atomA, atomB);

      contradictions.push({ atomA: atomId, atomB: edge.target, topic });
    }
  }

  return contradictions;
}

function inferContradictionTopic(
  atomA: Atom | undefined,
  atomB: Atom | undefined,
): string {
  if (!atomA || !atomB) return "unknown";

  // Find shared entities
  const sharedEntities = atomA.entityRefs.filter((e) =>
    atomB.entityRefs.includes(e),
  );
  if (sharedEntities.length > 0) return sharedEntities[0]!;

  // Find shared domains
  const sharedDomains = atomA.domain.filter((d) => atomB.domain.includes(d));
  if (sharedDomains.length > 0) return sharedDomains[0]!;

  return "unknown";
}
