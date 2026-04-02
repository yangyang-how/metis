import { describe, expect, test } from "bun:test";
import { runEval } from "../../src/eval/runner";
import { createRegistry } from "../../src/extract/frame-registry";
import {
	batchAtoms,
	compoundRole,
	emptyConditions,
	missingRequiredRole,
	passingAtom,
	vagueContent,
} from "./fixtures/sample-atoms";

const registry = createRegistry();

describe("runEval", () => {
	test("runs all checks against a batch of atoms", () => {
		const report = runEval(batchAtoms, { registry });
		expect(report.atomCount).toBe(batchAtoms.length);
		expect(report.checks.length).toBeGreaterThan(0);
	});

	test("counts pass/fail per check correctly", () => {
		const report = runEval(batchAtoms, { registry });
		const emptyCondCheck = report.checks.find(
			(c) => c.check === "semantic:empty-conditions",
		);
		expect(emptyCondCheck).toBeDefined();
		if (!emptyCondCheck) return;
		// batchAtoms has some atoms with conditions, some without
		expect(emptyCondCheck.pass + emptyCondCheck.fail).toBe(batchAtoms.length);
	});

	test("computes aggregate 'atoms with at least one issue'", () => {
		const report = runEval(batchAtoms, { registry });
		// At least emptyConditions, compoundRole, vagueContent, missingRequiredRole have issues
		expect(report.aggregate.atomsWithIssues).toBeGreaterThanOrEqual(4);
		expect(report.aggregate.issueRate).toBeGreaterThan(0);
		expect(report.aggregate.issueRate).toBeLessThanOrEqual(1);
	});

	test("includes up to 3 sample atom IDs per failed check", () => {
		const report = runEval(batchAtoms, { registry });
		for (const check of report.checks) {
			expect(check.samples.length).toBeLessThanOrEqual(3);
			if (check.fail > 0) {
				expect(check.samples.length).toBeGreaterThan(0);
			}
		}
	});

	test("handles empty atom array without crashing", () => {
		const report = runEval([], { registry });
		expect(report.atomCount).toBe(0);
		expect(report.aggregate.atomsWithIssues).toBe(0);
		expect(report.aggregate.issueRate).toBe(0);
	});

	test("atoms with multiple failing checks counted once in aggregate", () => {
		// vagueContent has vague role AND empty conditions → multiple failures
		// but should count as 1 atom with issues
		const report = runEval([vagueContent], { registry });
		expect(report.aggregate.atomsWithIssues).toBe(1);
	});

	test("filters to specific checks when provided", () => {
		const report = runEval(batchAtoms, {
			registry,
			checks: ["structural:missing-frame", "structural:empty-roles"],
		});
		expect(report.checks.length).toBe(2);
		expect(report.checks.map((c) => c.check)).toContain(
			"structural:missing-frame",
		);
	});
});
