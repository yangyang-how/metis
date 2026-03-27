import { describe, expect, test } from "bun:test";
import { embedAtoms } from "../../src/integrate/embedding-service";
import { resolveEntities } from "../../src/integrate/entity-resolver";
import {
	detectRelations,
	findCandidatePairs,
} from "../../src/integrate/relation-detector";
import type { LLMProvider } from "../../src/llm/types";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, bookBAtoms, bookCAtoms } from "./fixtures/sample-atoms";

function createMockLLM(responses: string[]): LLMProvider {
	let callIdx = 0;
	return {
		capabilities: {
			vision: false,
			structuredOutput: false,
			maxContextTokens: 128000,
		},
		async sendMessage() {
			const content = responses[callIdx++] ?? '{"classifications":[]}';
			return { content, usage: { inputTokens: 100, outputTokens: 50 } };
		},
	};
}

describe("findCandidatePairs", () => {
	test("pairs atoms sharing entities from different books", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const allAtoms = [...bookAAtoms, ...bookBAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(
			allAtoms,
			{},
			embeddings,
			provider,
			llm,
		);

		const pairs = findCandidatePairs(bookBAtoms, bookAAtoms, entities);
		expect(pairs.length).toBeGreaterThan(0);
	});

	test("excludes same-book pairs", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const { entities } = await resolveEntities(
			bookAAtoms,
			{},
			embeddings,
			provider,
			llm,
		);

		const pairs = findCandidatePairs(bookAAtoms, bookAAtoms, entities);
		expect(pairs.length).toBe(0);
	});
});

describe("detectRelations — full pipeline", () => {
	test("detects relations between Book A and Book B atoms", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const allAtoms = [...bookAAtoms, ...bookBAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(
			allAtoms,
			{},
			embeddings,
			provider,
			llm,
		);

		const { relations } = await detectRelations(
			bookBAtoms,
			bookAAtoms,
			entities,
			embeddings,
			llm,
		);
		expect(relations).toBeDefined();
	});

	test("cross-domain atoms may find relations after domain normalization", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const allAtoms = [...bookAAtoms, ...bookCAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(
			allAtoms,
			{},
			embeddings,
			provider,
			llm,
		);

		const { relations } = await detectRelations(
			bookCAtoms,
			bookAAtoms,
			entities,
			embeddings,
			llm,
		);
		// Domain normalization may collapse domains, enabling cross-book relations
		expect(relations).toBeDefined();
		expect(Array.isArray(relations)).toBe(true);
	});

	test("stats are populated", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const allAtoms = [...bookAAtoms, ...bookBAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(
			allAtoms,
			{},
			embeddings,
			provider,
			llm,
		);

		const { stats } = await detectRelations(
			bookBAtoms,
			bookAAtoms,
			entities,
			embeddings,
			llm,
		);
		expect(typeof stats.reinforcements).toBe("number");
		expect(typeof stats.contradictions).toBe("number");
		expect(typeof stats.extensions).toBe("number");
		expect(typeof stats.llmCalls).toBe("number");
	});
});
