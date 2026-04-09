// engine/test/apply/integration.test.ts
import { describe, expect, test } from "bun:test";
import { applyPipeline } from "../../src/apply/index";
import type { Atom } from "../../src/integrate/types";
import { exportToKX } from "../../src/kx/export";
import type { KXDocument } from "../../src/kx/types";
import { hasDDIAGraph, loadDDIAGraph } from "./fixtures/ddia-graph-loader";
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

describe("applyPipeline — real DDIA graph", () => {
	const skip = !hasDDIAGraph();

	test.skipIf(skip)(
		"returns non-empty results for domain-relevant query",
		async () => {
			const graph = loadDDIAGraph();
			const result = await applyPipeline({
				query: "How does replication work in distributed systems?",
				graph,
				manualPlan: {
					intent: "understand replication",
					analysisType: "exploration",
					targetDomains: ["distributed-systems"],
					targetFrameTypes: ["definition", "procedure"],
					targetEntities: [],
					weights: {
						domainMatch: 0.7,
						frameTypeMatch: 0.5,
						entityMatch: 0.5,
					},
					groupingStrategy: "entity",
				},
				options: { topK: 10, noSummarize: true },
			});

			expect(result.sections.length).toBeGreaterThan(0);
			expect(result.stats.totalAtomsRetrieved).toBeGreaterThan(0);
		},
	);

	test.skipIf(skip)("traversal expands the seed set", async () => {
		const graph = loadDDIAGraph();
		const result = await applyPipeline({
			query: "consensus algorithms",
			graph,
			manualPlan: {
				intent: "understand consensus",
				analysisType: "exploration",
				targetDomains: ["distributed-systems"],
				targetFrameTypes: [
					"definition",
					"procedure",
					"method_comparison",
				],
				targetEntities: [],
				weights: {
					domainMatch: 0.5,
					frameTypeMatch: 0.5,
					entityMatch: 0.5,
				},
				groupingStrategy: "entity",
			},
			options: { topK: 5, noSummarize: true },
		});

		expect(result.stats.totalAtomsAfterTraversal).toBeGreaterThanOrEqual(
			result.stats.totalAtomsRetrieved,
		);
	});

	test.skipIf(skip)(
		"detects gaps for out-of-domain query",
		async () => {
			const graph = loadDDIAGraph();
			const result = await applyPipeline({
				query: "machine learning optimization",
				graph,
				manualPlan: {
					intent: "understand ML optimization",
					analysisType: "exploration",
					targetDomains: ["machine-learning"],
					targetFrameTypes: ["procedure"],
					targetEntities: ["gradient-descent"],
					weights: {
						domainMatch: 0.7,
						frameTypeMatch: 0.5,
						entityMatch: 0.5,
					},
					groupingStrategy: "entity",
				},
				options: { topK: 5, noSummarize: true },
			});

			expect(result.gaps.length).toBeGreaterThan(0);
			expect(result.gaps.some((g) => g.type === "missing_domain")).toBe(
				true,
			);
		},
	);

	test.skipIf(skip)(
		"KX export produces valid KXDocument",
		async () => {
			const graph = loadDDIAGraph();
			const result = await applyPipeline({
				query: "storage engines",
				graph,
				manualPlan: {
					intent: "understand storage",
					analysisType: "exploration",
					targetDomains: ["databases"],
					targetFrameTypes: ["definition", "method_comparison"],
					targetEntities: [],
					weights: {
						domainMatch: 0.5,
						frameTypeMatch: 0.5,
						entityMatch: 0.5,
					},
					groupingStrategy: "entity",
				},
				options: { topK: 10, noSummarize: true },
			});

			const kxDoc = exportToKX(result, graph.graph);

			// Validate KXDocument structure
			expect(kxDoc.version).toBe("kx/1.0");
			expect(kxDoc.meta.domains.length).toBeGreaterThan(0);
			expect(kxDoc.meta.sources.length).toBeGreaterThan(0);
			expect(kxDoc.units.length).toBeGreaterThan(0);

			// Every unit has required fields
			for (const unit of kxDoc.units) {
				expect(unit.id).toBeTruthy();
				expect(unit.kind).toBeTruthy();
				expect(unit.content).toBeTruthy();
				expect(unit.confidence).toBeGreaterThan(0);
				expect(unit.source.ref).toBeTruthy();
			}
		},
	);
});
