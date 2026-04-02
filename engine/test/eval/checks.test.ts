import { describe, expect, test } from "bun:test";
import { CHECKS, type CheckContext } from "../../src/eval/checks";
import { createRegistry } from "../../src/extract/frame-registry";
import {
	allRolesFilled,
	compoundRole,
	confidenceOutlier,
	emptyConditions,
	emptyRoles,
	missingFrame,
	missingOptionalRole,
	missingRequiredRole,
	passingAtom,
	specificContent,
	unregisteredFrame,
	vagueContent,
	vagueContentPattern,
} from "./fixtures/sample-atoms";

const registry = createRegistry();

/** Frame stats: definition atoms average 0.9 confidence, σ = 0.05 */
const frameStats = new Map([
	["definition", { meanConfidence: 0.9, stdConfidence: 0.05 }],
	["example_of", { meanConfidence: 0.85, stdConfidence: 0.06 }],
]);

const ctx: CheckContext = { registry, frameStats };

function runCheck(
	checkId: string,
	atom: Parameters<(typeof CHECKS)[number]["run"]>[0],
) {
	const check = CHECKS.find((c) => c.id === checkId);
	if (!check) throw new Error(`Unknown check: ${checkId}`);
	return check.run(atom, ctx);
}

describe("structural checks", () => {
	test("structural:missing-frame — fails on empty frame", () => {
		expect(runCheck("structural:missing-frame", missingFrame).pass).toBe(false);
	});

	test("structural:missing-frame — passes on valid frame", () => {
		expect(runCheck("structural:missing-frame", passingAtom).pass).toBe(true);
	});

	test("structural:empty-roles — fails on {} roles", () => {
		expect(runCheck("structural:empty-roles", emptyRoles).pass).toBe(false);
	});

	test("structural:empty-roles — passes with at least one role", () => {
		expect(runCheck("structural:empty-roles", passingAtom).pass).toBe(true);
	});

	test("structural:unregistered-frame — fails on unknown frame", () => {
		expect(
			runCheck("structural:unregistered-frame", unregisteredFrame).pass,
		).toBe(false);
	});

	test("structural:unregistered-frame — passes on core frame", () => {
		expect(runCheck("structural:unregistered-frame", passingAtom).pass).toBe(
			true,
		);
	});
});

describe("schema checks", () => {
	test("schema:missing-required-role — fails when required role absent", () => {
		const result = runCheck(
			"schema:missing-required-role",
			missingRequiredRole,
		);
		expect(result.pass).toBe(false);
		expect(result.detail).toContain("meaning");
	});

	test("schema:missing-required-role — passes when all required roles present", () => {
		expect(runCheck("schema:missing-required-role", passingAtom).pass).toBe(
			true,
		);
	});

	test("schema:missing-optional-role — flags when optional role absent", () => {
		const result = runCheck(
			"schema:missing-optional-role",
			missingOptionalRole,
		);
		expect(result.pass).toBe(false);
		expect(result.detail).toContain("detail");
	});

	test("schema:missing-optional-role — passes when all roles filled", () => {
		expect(runCheck("schema:missing-optional-role", allRolesFilled).pass).toBe(
			true,
		);
	});
});

describe("semantic checks", () => {
	test("semantic:compound-role — fails on 3+ sentence role value", () => {
		const result = runCheck("semantic:compound-role", compoundRole);
		expect(result.pass).toBe(false);
	});

	test("semantic:compound-role — passes on single statement", () => {
		expect(runCheck("semantic:compound-role", specificContent).pass).toBe(true);
	});

	test("semantic:vague-content — fails on 'important'", () => {
		expect(runCheck("semantic:vague-content", vagueContent).pass).toBe(false);
	});

	test("semantic:vague-content — fails on 'various factors' pattern", () => {
		expect(runCheck("semantic:vague-content", vagueContentPattern).pass).toBe(
			false,
		);
	});

	test("semantic:vague-content — passes on specific content", () => {
		expect(runCheck("semantic:vague-content", specificContent).pass).toBe(true);
	});

	test("semantic:confidence-outlier — fails when > 2σ from frame mean", () => {
		// confidence 0.3, mean 0.9, σ 0.05 → 12σ away
		const result = runCheck("semantic:confidence-outlier", confidenceOutlier);
		expect(result.pass).toBe(false);
	});

	test("semantic:confidence-outlier — passes for normal confidence", () => {
		expect(runCheck("semantic:confidence-outlier", passingAtom).pass).toBe(
			true,
		);
	});

	test("semantic:empty-conditions — fails on empty conditions array", () => {
		expect(runCheck("semantic:empty-conditions", emptyConditions).pass).toBe(
			false,
		);
	});

	test("semantic:empty-conditions — passes with conditions", () => {
		expect(runCheck("semantic:empty-conditions", passingAtom).pass).toBe(true);
	});
});

describe("check registry", () => {
	test("all checks have unique IDs", () => {
		const ids = CHECKS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("all checks have layer and severity", () => {
		for (const check of CHECKS) {
			expect(["structural", "schema", "semantic"]).toContain(check.layer);
			expect(["reject", "flag"]).toContain(check.severity);
		}
	});
});
