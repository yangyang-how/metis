// engine/src/apply/rerank.ts
/**
 * Post-fusion re-ranking using QueryPlan boosts.
 *
 * Applied after hybrid retrieval (BM25 + vector + RRF fusion).
 * Boosts atoms that match the plan's target domains, frame types,
 * and entities. The weights in the plan control how much each
 * axis contributes to the boost.
 */
import type { RetrievalResult } from "../retrieve/index";
import type { RerankOptions } from "./types";

export function rerank(options: RerankOptions): RetrievalResult[] {
  const { results, plan } = options;
  const targetDomains = new Set(plan.targetDomains);
  const targetFrameTypes = new Set(plan.targetFrameTypes);
  const targetEntities = new Set(plan.targetEntities);

  const boosted = results.map((result) => {
    const atom = result.atom;
    let boost = 1.0;

    // Domain match
    if (atom.domain.some((d) => targetDomains.has(d))) {
      boost += plan.weights.domainMatch * 0.5;
    }

    // Frame type match
    if (targetFrameTypes.has(atom.frame)) {
      boost += plan.weights.frameTypeMatch * 0.5;
    }

    // Entity match (only available on Atom, not CandidateAtom)
    if ("entityRefs" in atom) {
      const entityRefs = (atom as { entityRefs: string[] }).entityRefs;
      if (entityRefs.some((e) => targetEntities.has(e))) {
        boost += plan.weights.entityMatch * 0.5;
      }
    }

    return { ...result, score: result.score * boost };
  });

  // Re-sort by boosted score descending
  boosted.sort((a, b) => b.score - a.score);

  return boosted;
}
