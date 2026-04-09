/**
 * Export gap analysis as a sidecar document.
 * Gaps are meta-information about coverage, not knowledge itself.
 */
import type { ApplyStats, Gap } from "../apply/types";
import type { GapsDocument } from "./types";

export function exportGaps(
  query: string,
  gaps: Gap[],
  stats: ApplyStats,
): GapsDocument {
  return {
    version: "gaps/1.0",
    query,
    gaps: gaps.map((g) => ({
      type: g.type,
      description: g.description,
      severity: g.severity,
      suggestion: g.suggestion,
    })),
    stats: {
      totalAtomsRetrieved: stats.totalAtomsRetrieved,
      contradictionsFound: stats.contradictionsFound,
      gapsFound: gaps.length,
    },
  };
}
