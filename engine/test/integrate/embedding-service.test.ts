import { describe, expect, test } from "bun:test";
import {
	atomToText,
	cosineSimilarity,
	embedAtoms,
} from "../../src/integrate/embedding-service";
import { createOpenAIEmbeddingProvider } from "../../src/llm/openai-embedding";
import type { OpenAIEmbeddingClient } from "../../src/llm/openai-embedding";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, makeAtom } from "./fixtures/sample-atoms";

// --- OpenAI Adapter ---

function mockOpenAIClient(
	responses: number[][][],
	error?: Error,
): OpenAIEmbeddingClient {
	let callIdx = 0;
	return {
		async create(_args) {
			if (error) throw error;
			const embeddings = responses[callIdx++] ?? [];
			return {
				data: embeddings.map((embedding, i) => ({ embedding, index: i })),
			};
		},
	};
}

describe("OpenAI Embedding Adapter", () => {
	test("creates provider with correct dimensions for text-embedding-3-large", () => {
		const provider = createOpenAIEmbeddingProvider(
			{ provider: "openai", model: "text-embedding-3-large" },
			mockOpenAIClient([[[0.1, 0.2, 0.3]]]),
		);
		expect(provider.dimensions).toBe(3072);
		expect(provider.maxBatchSize).toBe(100);
	});

	test("creates provider with correct dimensions for text-embedding-3-small", () => {
		const provider = createOpenAIEmbeddingProvider(
			{ provider: "openai", model: "text-embedding-3-small" },
			mockOpenAIClient([[[0.1, 0.2, 0.3]]]),
		);
		expect(provider.dimensions).toBe(1536);
	});

	test("embed returns embeddings in order", async () => {
		const vec1 = [0.1, 0.2, 0.3];
		const vec2 = [0.4, 0.5, 0.6];
		const provider = createOpenAIEmbeddingProvider(
			{ provider: "openai", model: "text-embedding-3-large" },
			mockOpenAIClient([[vec1, vec2]]),
		);
		const result = await provider.embed(["hello", "world"]);
		expect(result).toEqual([vec1, vec2]);
	});

	test("throws on API error", async () => {
		const provider = createOpenAIEmbeddingProvider(
			{ provider: "openai", model: "text-embedding-3-large" },
			mockOpenAIClient([], new Error("API rate limit")),
		);
		await expect(provider.embed(["test"])).rejects.toThrow("API rate limit");
	});
});

// --- atomToText ---

describe("atomToText", () => {
	test("definition frame: '{term} means {meaning}'", () => {
		const atom = makeAtom({
			frame: "definition",
			roles: {
				term: "replication lag",
				meaning: "delay in data propagation",
			},
		});
		const text = atomToText(atom);
		expect(text).toContain("replication lag");
		expect(text).toContain("delay in data propagation");
	});

	test("causal frame: '{cause} causes {effect}'", () => {
		const atom = makeAtom({
			frame: "causal",
			roles: { cause: "network partition", effect: "data inconsistency" },
		});
		const text = atomToText(atom);
		expect(text).toContain("network partition");
		expect(text).toContain("data inconsistency");
	});

	test("heuristic frame includes situation, action, rationale", () => {
		const atom = makeAtom({
			frame: "heuristic",
			roles: {
				situation: "high load",
				action: "add caching",
				rationale: "reduces DB hits",
			},
		});
		const text = atomToText(atom);
		expect(text).toContain("high load");
		expect(text).toContain("add caching");
		expect(text).toContain("reduces DB hits");
	});

	test("unknown frame falls back to concatenated role values", () => {
		const atom = makeAtom({
			frame: "unknown_type",
			roles: { foo: "bar", baz: "qux" },
		});
		const text = atomToText(atom);
		expect(text).toContain("bar");
		expect(text).toContain("qux");
	});
});

// --- cosineSimilarity ---

describe("cosineSimilarity", () => {
	test("identical vectors return 1.0", () => {
		const v = [1, 0, 0, 0];
		expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
	});

	test("orthogonal vectors return 0.0", () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
	});

	test("opposite vectors return -1.0", () => {
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
	});
});

// --- embedAtoms ---

describe("embedAtoms", () => {
	test("embeds all atoms when no existing cache", async () => {
		const provider = createMockEmbeddingProvider();
		const atoms = bookAAtoms.slice(0, 2);
		const result = await embedAtoms(atoms, provider, []);
		expect(result).toHaveLength(2);
		expect(result[0]?.atomId).toBe(atoms[0]?.id);
		expect(result[0]?.embedding).toHaveLength(provider.dimensions);
	});

	test("skips already-cached atoms", async () => {
		const provider = createMockEmbeddingProvider();
		const atoms = bookAAtoms.slice(0, 2);
		const existingCache = [
			{
				atomId: atoms[0]!.id,
				text: "cached text",
				embedding: new Array(provider.dimensions).fill(0),
			},
		];
		const result = await embedAtoms(atoms, provider, existingCache);
		expect(result).toHaveLength(2);
		expect(result.find((e) => e.atomId === atoms[0]!.id)?.text).toBe(
			"cached text",
		);
	});

	test("batches according to maxBatchSize", async () => {
		let callCount = 0;
		const provider = createMockEmbeddingProvider();
		provider.maxBatchSize = 2;
		const origEmbed = provider.embed.bind(provider);
		provider.embed = async (texts) => {
			callCount++;
			return origEmbed(texts);
		};

		const atoms = bookAAtoms.slice(0, 4);
		await embedAtoms(atoms, provider, []);
		expect(callCount).toBe(2);
	});
});
