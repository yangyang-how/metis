import { describe, expect, test } from "bun:test";
import { integrate } from "../../src/integrate/index";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, bookBAtoms } from "./fixtures/sample-atoms";
import type { LLMProvider } from "../../src/llm/types";

function createMockLLM(): LLMProvider {
	return {
		capabilities: {
			vision: false,
			structuredOutput: false,
			maxContextTokens: 128000,
		},
		async sendMessage() {
			return {
				content: '{"decisions":[],"classifications":[]}',
				usage: { inputTokens: 100, outputTokens: 50 },
			};
		},
	};
}

describe("integrate — end to end", () => {
	test("first book on empty graph produces valid KnowledgeGraph", async () => {
		const result = await integrate({
			atoms: bookAAtoms,
			metadata: { title: "Distributed Systems", authors: ["Author A"] },
			existingGraph: null,
			llmProvider: createMockLLM(),
			embeddingProvider: createMockEmbeddingProvider(),
		});

		expect(result.atoms.length).toBe(bookAAtoms.length);
		expect(Object.keys(result.entities).length).toBeGreaterThan(0);
		expect(result.embeddings.length).toBe(bookAAtoms.length);
		expect(result.stats.totalAtoms).toBe(bookAAtoms.length);
	});

	test("second book integrates incrementally", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM();

		const graphA = await integrate({
			atoms: bookAAtoms,
			metadata: { title: "Distributed Systems", authors: ["Author A"] },
			existingGraph: null,
			llmProvider: llm,
			embeddingProvider: provider,
		});

		const graphAB = await integrate({
			atoms: bookBAtoms,
			metadata: {
				title: "System Design Guide",
				authors: ["Author B"],
			},
			existingGraph: graphA,
			llmProvider: llm,
			embeddingProvider: provider,
		});

		expect(graphAB.atoms.length).toBe(
			bookAAtoms.length + bookBAtoms.length,
		);
		expect(graphAB.embeddings.length).toBe(
			bookAAtoms.length + bookBAtoms.length,
		);
		expect(graphAB.stats.totalAtoms).toBe(
			bookAAtoms.length + bookBAtoms.length,
		);
		expect(Object.keys(graphAB.entities).length).toBeGreaterThanOrEqual(
			Object.keys(graphA.entities).length,
		);
	});

	test("all finalized atoms have required Atom fields", async () => {
		const result = await integrate({
			atoms: bookAAtoms,
			metadata: { title: "Distributed Systems", authors: ["Author A"] },
			existingGraph: null,
			llmProvider: createMockLLM(),
			embeddingProvider: createMockEmbeddingProvider(),
		});

		for (const atom of result.atoms) {
			expect(atom).toHaveProperty("entityRefs");
			expect(atom).toHaveProperty("reinforcedBy");
			expect(atom).toHaveProperty("contradictedBy");
			expect(atom).toHaveProperty("extendedBy");
			expect(Array.isArray(atom.entityRefs)).toBe(true);
			expect(Array.isArray(atom.reinforcedBy)).toBe(true);
		}
	});

	test("stats are populated", async () => {
		const result = await integrate({
			atoms: bookAAtoms,
			metadata: { title: "Distributed Systems", authors: ["Author A"] },
			existingGraph: null,
			llmProvider: createMockLLM(),
			embeddingProvider: createMockEmbeddingProvider(),
		});

		expect(result.stats.totalAtoms).toBe(bookAAtoms.length);
		expect(result.stats.totalEntities).toBeGreaterThan(0);
		expect(typeof result.stats.reinforcements).toBe("number");
		expect(typeof result.stats.contradictions).toBe("number");
		expect(typeof result.stats.extensions).toBe("number");
	});
});
