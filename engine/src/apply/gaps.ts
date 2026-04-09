// engine/src/apply/gaps.ts
/**
 * Stage 4: Gap Detection.
 *
 * Compare what was retrieved/traversed against what the QueryPlan
 * said was needed. Surfaces missing domains, frame types, entities,
 * thin coverage, and unresolved contradictions.
 */
import type { Atom } from "../integrate/types";
import type { Gap, QueryPlan, TraversalResult } from "./types";

const THIN_COVERAGE_THRESHOLD = 3;

export function detectGaps(
  plan: QueryPlan,
  atoms: Atom[],
  contradictions: TraversalResult["contradictions"],
): Gap[] {
  const gaps: Gap[] = [];

  const retrievedDomains = new Set(atoms.flatMap((a) => a.domain));
  const retrievedFrameTypes = new Set(atoms.map((a) => a.frame));
  const retrievedEntities = new Set(atoms.flatMap((a) => a.entityRefs));

  // Missing domains
  for (const domain of plan.targetDomains) {
    if (!retrievedDomains.has(domain)) {
      gaps.push({
        type: "missing_domain",
        severity: "critical",
        description: `No atoms found for target domain "${domain}".`,
        suggestion: `Consider ingesting sources about ${domain}.`,
      });
    }
  }

  // Missing frame types
  for (const frameType of plan.targetFrameTypes) {
    if (!retrievedFrameTypes.has(frameType)) {
      gaps.push({
        type: "missing_frame_type",
        severity: "notable",
        description: `No "${frameType}" atoms retrieved. The query may benefit from this knowledge type.`,
      });
    }
  }

  // Missing entities
  for (const entity of plan.targetEntities) {
    if (!retrievedEntities.has(entity)) {
      gaps.push({
        type: "missing_entity",
        severity: "notable",
        description: `Target entity "${entity}" not found in retrieved atoms.`,
        suggestion: `Check if this concept exists in the knowledge graph under a different name.`,
      });
    }
  }

  // Thin coverage
  for (const domain of plan.targetDomains) {
    if (!retrievedDomains.has(domain)) continue; // already flagged as missing
    const domainAtomCount = atoms.filter((a) => a.domain.includes(domain)).length;
    if (domainAtomCount < THIN_COVERAGE_THRESHOLD) {
      gaps.push({
        type: "thin_coverage",
        severity: "minor",
        description: `Domain "${domain}" has only ${domainAtomCount} atom(s) — coverage may be incomplete.`,
        suggestion: `Ingest more sources about ${domain} for deeper coverage.`,
      });
    }
  }

  // Unresolved contradictions
  for (const c of contradictions) {
    const atomA = atoms.find((a) => a.id === c.atomA);
    const atomB = atoms.find((a) => a.id === c.atomB);
    if (!atomA || !atomB) continue;

    // If both have empty conditions, or conditions overlap, it's unresolved
    const conditionsA = new Set(atomA.conditions);
    const conditionsB = new Set(atomB.conditions);
    const bothEmpty = conditionsA.size === 0 && conditionsB.size === 0;
    const overlap = [...conditionsA].some((cond) => conditionsB.has(cond));

    if (bothEmpty || overlap) {
      gaps.push({
        type: "unresolved_contradiction",
        severity: "notable",
        description: `Contradiction between "${c.atomA}" and "${c.atomB}" on topic "${c.topic}" — conditions do not clearly differentiate scope.`,
      });
    }
  }

  return gaps;
}
