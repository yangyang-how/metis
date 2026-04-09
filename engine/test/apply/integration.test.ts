// engine/test/apply/integration.test.ts
import { describe, expect, test } from "bun:test";
import { applyPipeline } from "../../src/apply/index";
import type { Atom } from "../../src/integrate/types";
import {
	mockSummaryProvider,
	mockUnderstandProvider,
} from "./fixtures/mock-provider";
import {
	allAtoms,
	embeddings,
	entities,
	graphIndex,
	sampleGraph,
} from "./fixtures/sample-graph";

describe("applyPipeline integration", () => {
	test("runs full pipeline with manual QueryPlan (no LLM for understand)", async () => {
		const result = await applyPipeline({
			query: "How does replication work in distributed systems?",
			graphDir: undefined,
			graph: sampleGraph,
			manualPlan: {
				intent: "understand replication",
				analysisType: "exploration",
				targetDomains: ["distributed-systems"],
				targetFrameTypes: ["definition", "procedure", "deviation"],
				targetEntities: ["entity-replication"],
				weights: { domainMatch: 0.7, frameTypeMatch: 0.5, entityMatch: 0.8 },
				groupingStrategy: "entity",
			},
			options: {
				topK: 5,
				maxDepth: 2,
				noTraverse: false,
				noGaps: false,
				noSummarize: true,
			},
		});

		expect(result.query).toContain("replication");
		expect(result.sections.length).toBeGreaterThan(0);
		expect(result.stats.totalAtomsRetrieved).toBeGreaterThan(0);
		expect(result.stats.totalAtomsAfterTraversal).toBeGreaterThanOrEqual(
			result.stats.totalAtomsRetrieved,
		);
	});

	test("skips traverse when noTraverse is true", async () => {
		const result = await applyPipeline({
			query: "replication",
			graph: sampleGraph,
			manualPlan: {
				intent: "test",
				analysisType: "exploration",
				targetDomains: ["distributed-systems"],
				targetFrameTypes: ["definition"],
				targetEntities: ["entity-replication"],
				weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
				groupingStrategy: "entity",
			},
			options: {
				topK: 3,
				noTraverse: true,
				noGaps: false,
				noSummarize: true,
			},
		});

		expect(result.stats.totalAtomsAfterTraversal).toBe(
			result.stats.totalAtomsRetrieved,
		);
	});

	test("skips gaps when noGaps is true", async () => {
		const result = await applyPipeline({
			query: "replication",
			graph: sampleGraph,
			manualPlan: {
				intent: "test",
				analysisType: "exploration",
				targetDomains: ["distributed-systems", "networking"],
				targetFrameTypes: ["definition"],
				targetEntities: ["entity-replication"],
				weights: { domainMatch: 0.5, frameTypeMatch: 0.5, entityMatch: 0.5 },
				groupingStrategy: "entity",
			},
			options: {
				topK: 3,
				noTraverse: true,
				noGaps: true,
				noSummarize: true,
			},
		});

		expect(result.gaps).toHaveLength(0);
	});
});
