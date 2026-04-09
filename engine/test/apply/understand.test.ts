// engine/test/apply/understand.test.ts
import { describe, expect, test } from "bun:test";
import { buildInventory } from "../../src/apply/inventory";
import { normalizeQueryPlan, understand } from "../../src/apply/understand";
import {
	createMockProvider,
	mockUnderstandProvider,
} from "./fixtures/mock-provider";
import { sampleGraph } from "./fixtures/sample-graph";

describe("normalizeQueryPlan", () => {
	test("passes through camelCase fields", () => {
		const raw = {
			intent: "test",
			analysisType: "exploration",
			targetDomains: ["a"],
			targetFrameTypes: ["b"],
			targetEntities: ["c"],
			weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
			groupingStrategy: "entity",
		};
		const plan = normalizeQueryPlan(raw);
		expect(plan.analysisType).toBe("exploration");
		expect(plan.targetDomains).toEqual(["a"]);
	});

	test("normalizes snake_case to camelCase", () => {
		const raw = {
			intent: "test",
			analysis_type: "exploration",
			target_domains: ["a"],
			target_frame_types: ["b"],
			target_entities: ["c"],
			weights: { domain_match: 0.5, frame_type_match: 0.5, entity_match: 0.5 },
			grouping_strategy: "domain",
		};
		const plan = normalizeQueryPlan(raw as Record<string, unknown>);
		expect(plan.analysisType).toBe("exploration");
		expect(plan.targetDomains).toEqual(["a"]);
		expect(plan.groupingStrategy).toBe("domain");
		expect(plan.weights.domainMatch).toBe(0.5);
	});

	test("defaults groupingStrategy to entity if missing", () => {
		const raw = {
			intent: "test",
			analysisType: "exploration",
			targetDomains: [],
			targetFrameTypes: [],
			targetEntities: [],
			weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
		};
		const plan = normalizeQueryPlan(raw as Record<string, unknown>);
		expect(plan.groupingStrategy).toBe("entity");
	});
});

describe("understand", () => {
	test("produces a valid QueryPlan from mock provider", async () => {
		const inventory = buildInventory(sampleGraph);
		const plan = await understand(
			{ query: "How does replication work?" },
			inventory,
			mockUnderstandProvider,
		);
		expect(plan.intent).toBeDefined();
		expect(plan.targetDomains.length).toBeGreaterThan(0);
		expect(plan.weights.domainMatch).toBeGreaterThanOrEqual(0);
		expect(plan.weights.domainMatch).toBeLessThanOrEqual(1);
	});

	test("handles snake_case LLM response", async () => {
		const snakeProvider = createMockProvider(
			JSON.stringify({
				intent: "test",
				analysis_type: "exploration",
				target_domains: ["distributed-systems"],
				target_frame_types: ["definition"],
				target_entities: ["entity-replication"],
				weights: {
					domain_match: 0.7,
					frame_type_match: 0.5,
					entity_match: 0.6,
				},
				grouping_strategy: "entity",
			}),
		);
		const inventory = buildInventory(sampleGraph);
		const plan = await understand({ query: "test" }, inventory, snakeProvider);
		expect(plan.analysisType).toBe("exploration");
		expect(plan.targetDomains).toEqual(["distributed-systems"]);
	});
});
