/**
 * Comparison mode — compute the delta between two eval reports.
 *
 * Used to show "before validation" vs "after validation" reduction
 * in issue rates. This is the core of the "40% → <2%" resume claim.
 */
import type { EvalReport } from "./runner";

export interface ComparisonReport {
	before: { source: string; atomCount: number; issueRate: number };
	after: { source: string; atomCount: number; issueRate: number };
	/** Percentage reduction in issue rate (e.g., 94.7 means 94.7% reduction) */
	reductionPct: number;
	perCheck: Array<{
		check: string;
		beforeRate: number;
		afterRate: number;
	}>;
}

export function compareReports(
	before: EvalReport,
	after: EvalReport,
): ComparisonReport {
	// Per-check deltas for checks present in both reports
	const afterMap = new Map(after.checks.map((c) => [c.check, c]));
	const perCheck: ComparisonReport["perCheck"] = [];

	for (const bc of before.checks) {
		const ac = afterMap.get(bc.check);
		if (ac) {
			perCheck.push({
				check: bc.check,
				beforeRate: bc.rate,
				afterRate: ac.rate,
			});
		}
	}

	const reductionPct =
		before.aggregate.issueRate > 0
			? ((before.aggregate.issueRate - after.aggregate.issueRate) /
					before.aggregate.issueRate) *
				100
			: 0;

	return {
		before: {
			source: before.source,
			atomCount: before.atomCount,
			issueRate: before.aggregate.issueRate,
		},
		after: {
			source: after.source,
			atomCount: after.atomCount,
			issueRate: after.aggregate.issueRate,
		},
		reductionPct,
		perCheck,
	};
}
