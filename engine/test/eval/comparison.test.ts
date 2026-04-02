import { describe, expect, test } from "bun:test";
import {
	type ComparisonReport,
	compareReports,
} from "../../src/eval/comparison";
import type { EvalReport } from "../../src/eval/runner";

function makeReport(overrides: Partial<EvalReport>): EvalReport {
	return {
		source: "test",
		atomCount: 100,
		checks: [
			{
				check: "structural:missing-frame",
				layer: "structural",
				severity: "reject",
				pass: 100,
				fail: 0,
				rate: 0,
				samples: [],
			},
			{
				check: "semantic:empty-conditions",
				layer: "semantic",
				severity: "flag",
				pass: 60,
				fail: 40,
				rate: 0.4,
				samples: ["a", "b", "c"],
			},
		],
		aggregate: { atomsWithIssues: 40, issueRate: 0.4 },
		...overrides,
	};
}

describe("compareReports", () => {
	test("computes delta between two reports", () => {
		const before = makeReport({
			aggregate: { atomsWithIssues: 37, issueRate: 0.37 },
		});
		const after = makeReport({
			aggregate: { atomsWithIssues: 2, issueRate: 0.02 },
		});
		const comparison = compareReports(before, after);

		expect(comparison.before.issueRate).toBeCloseTo(0.37, 2);
		expect(comparison.after.issueRate).toBeCloseTo(0.02, 2);
		expect(comparison.reductionPct).toBeGreaterThan(90);
	});

	test("handles different atom counts", () => {
		const before = makeReport({
			atomCount: 150,
			aggregate: { atomsWithIssues: 60, issueRate: 0.4 },
		});
		const after = makeReport({
			atomCount: 100,
			aggregate: { atomsWithIssues: 2, issueRate: 0.02 },
		});
		const comparison = compareReports(before, after);
		expect(comparison.before.atomCount).toBe(150);
		expect(comparison.after.atomCount).toBe(100);
	});

	test("produces per-check deltas for shared checks", () => {
		const before = makeReport({
			checks: [
				{
					check: "semantic:empty-conditions",
					layer: "semantic",
					severity: "flag",
					pass: 60,
					fail: 40,
					rate: 0.4,
					samples: [],
				},
				{
					check: "structural:missing-frame",
					layer: "structural",
					severity: "reject",
					pass: 95,
					fail: 5,
					rate: 0.05,
					samples: [],
				},
			],
		});
		const after = makeReport({
			checks: [
				{
					check: "semantic:empty-conditions",
					layer: "semantic",
					severity: "flag",
					pass: 95,
					fail: 5,
					rate: 0.05,
					samples: [],
				},
				{
					check: "structural:missing-frame",
					layer: "structural",
					severity: "reject",
					pass: 100,
					fail: 0,
					rate: 0,
					samples: [],
				},
			],
		});

		const comparison = compareReports(before, after);
		expect(comparison.perCheck.length).toBe(2);
		const condCheck = comparison.perCheck.find(
			(c) => c.check === "semantic:empty-conditions",
		);
		expect(condCheck).toBeDefined();
		expect(condCheck?.beforeRate).toBeCloseTo(0.4, 2);
		expect(condCheck?.afterRate).toBeCloseTo(0.05, 2);
	});

	test("handles zero before rate without division error", () => {
		const before = makeReport({
			aggregate: { atomsWithIssues: 0, issueRate: 0 },
		});
		const after = makeReport({
			aggregate: { atomsWithIssues: 0, issueRate: 0 },
		});
		const comparison = compareReports(before, after);
		expect(comparison.reductionPct).toBe(0);
	});
});
