/**
 * Integration tests — run eval against real processed data.
 *
 * Depends on engine/graph/ and engine/output/ existing with processed books.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareReports } from "../../src/eval/comparison";
import { runEval } from "../../src/eval/runner";
import { createRegistry } from "../../src/extract/frame-registry";
import type { CandidateAtom } from "../../src/extract/types";

const graphDir = join(import.meta.dir, "../../graph");
const outputDir = join(import.meta.dir, "../../output");
const hasGraph = existsSync(join(graphDir, "atoms.json"));
const hasDDIA = existsSync(
	join(outputDir, "designing-data-intensive-applications.json"),
);

const registry = createRegistry();

describe.skipIf(!hasGraph)("eval integration — graph atoms", () => {
	test("structural checks all pass on final graph atoms", () => {
		const atoms = JSON.parse(
			readFileSync(join(graphDir, "atoms.json"), "utf8"),
		) as CandidateAtom[];
		const report = runEval(atoms, {
			registry,
			checks: [
				"structural:missing-frame",
				"structural:empty-roles",
				"structural:unregistered-frame",
			],
		});
		// All structural checks should pass — atoms were already validated
		for (const c of report.checks) {
			expect(c.fail).toBe(0);
		}
	});
});

describe.skipIf(!hasDDIA)("eval integration — raw extraction", () => {
	test("DDIA raw extraction has meaningful flag rate", () => {
		const raw = JSON.parse(
			readFileSync(
				join(outputDir, "designing-data-intensive-applications.json"),
				"utf8",
			),
		);
		const atoms = raw.extraction.atoms as CandidateAtom[];
		const report = runEval(atoms, { registry });

		// Known: ~37-41% of DDIA atoms have issues
		expect(report.aggregate.issueRate).toBeGreaterThan(0.3);
		expect(report.aggregate.issueRate).toBeLessThan(0.6);
	});

	test("comparison between raw and graph shows detection", () => {
		const raw = JSON.parse(
			readFileSync(
				join(outputDir, "designing-data-intensive-applications.json"),
				"utf8",
			),
		);
		const rawAtoms = raw.extraction.atoms as CandidateAtom[];
		const graphAtoms = JSON.parse(
			readFileSync(join(graphDir, "atoms.json"), "utf8"),
		) as CandidateAtom[];

		const beforeReport = runEval(rawAtoms, { registry, source: "raw" });
		const afterReport = runEval(graphAtoms, { registry, source: "graph" });

		const comparison = compareReports(beforeReport, afterReport);

		// Both should show meaningful issue rates
		expect(comparison.before.issueRate).toBeGreaterThan(0.3);
		// After should also show issues (they're detected, not removed)
		expect(comparison.after.issueRate).toBeGreaterThan(0);
	});
});
