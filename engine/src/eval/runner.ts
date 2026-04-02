/**
 * Eval runner — batch atoms through all checks, produce a structured report.
 *
 * Computes per-check pass/fail tallies and an aggregate "atoms with issues"
 * count. The aggregate counts each atom once even if it fails multiple checks.
 */
import type { CandidateAtom, FrameTypeRegistry } from "../extract/types";
import { CHECKS, type CheckContext } from "./checks";

export interface CheckResult {
	check: string;
	layer: string;
	severity: string;
	pass: number;
	fail: number;
	rate: number;
	samples: string[];
}

export interface EvalReport {
	source: string;
	atomCount: number;
	checks: CheckResult[];
	aggregate: {
		atomsWithIssues: number;
		issueRate: number;
	};
}

export interface RunEvalOptions {
	registry?: FrameTypeRegistry;
	checks?: string[];
	source?: string;
}

/**
 * Compute per-frame-type confidence stats for the semantic:confidence-outlier check.
 */
function computeFrameStats(
	atoms: CandidateAtom[],
): Map<string, { meanConfidence: number; stdConfidence: number }> {
	const byFrame = new Map<string, number[]>();
	for (const atom of atoms) {
		const list = byFrame.get(atom.frame) ?? [];
		list.push(atom.confidence);
		byFrame.set(atom.frame, list);
	}

	const stats = new Map<
		string,
		{ meanConfidence: number; stdConfidence: number }
	>();
	for (const [frame, confidences] of byFrame) {
		const mean = confidences.reduce((s, c) => s + c, 0) / confidences.length;
		const variance =
			confidences.reduce((s, c) => s + (c - mean) ** 2, 0) / confidences.length;
		stats.set(frame, {
			meanConfidence: mean,
			stdConfidence: Math.sqrt(variance),
		});
	}
	return stats;
}

/**
 * Run evaluation checks against a batch of atoms.
 */
export function runEval(
	atoms: CandidateAtom[],
	options?: RunEvalOptions,
): EvalReport {
	const frameStats = computeFrameStats(atoms);
	const ctx: CheckContext = {
		registry: options?.registry,
		frameStats,
	};

	// Filter checks if specific ones requested
	const activeChecks = options?.checks
		? CHECKS.filter((c) => options.checks?.includes(c.id))
		: CHECKS;

	// Per-check tallies
	const tallies = activeChecks.map((check) => ({
		check: check.id,
		layer: check.layer,
		severity: check.severity,
		pass: 0,
		fail: 0,
		samples: [] as string[],
	}));

	// Track which atoms have any issue (for aggregate)
	const atomsWithIssues = new Set<string>();

	for (const atom of atoms) {
		for (let i = 0; i < activeChecks.length; i++) {
			const check = activeChecks[i];
			const tally = tallies[i];
			if (!check || !tally) continue;

			const result = check.run(atom, ctx);
			if (result.pass) {
				tally.pass++;
			} else {
				tally.fail++;
				atomsWithIssues.add(atom.id);
				if (tally.samples.length < 3) {
					tally.samples.push(atom.id);
				}
			}
		}
	}

	const checkResults: CheckResult[] = tallies.map((t) => ({
		...t,
		rate: atoms.length > 0 ? t.fail / atoms.length : 0,
	}));

	return {
		source: options?.source ?? "inline",
		atomCount: atoms.length,
		checks: checkResults,
		aggregate: {
			atomsWithIssues: atomsWithIssues.size,
			issueRate: atoms.length > 0 ? atomsWithIssues.size / atoms.length : 0,
		},
	};
}
