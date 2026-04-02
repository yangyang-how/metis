import { describe, expect, test } from "bun:test";
import { embedAtoms } from "../../src/integrate/embedding-service";
import {
	clusterMentions,
	extractMentions,
	resolveEntities,
} from "../../src/integrate/entity-resolver";
import type { LLMProvider } from "../../src/llm/types";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import {
	bookAAtoms,
	bookBAtoms,
	bookCAtoms,
	makeAtom,
} from "./fixtures/sample-atoms";

function createMockLLM(responses: string[]): LLMProvider {
	let callIdx = 0;
	return {
		capabilities: {
			vision: false,
			structuredOutput: false,
			maxContextTokens: 128000,
		},
		async sendMessage() {
			const content = responses[callIdx++] ?? '{"decisions":[]}';
			return { content, usage: { inputTokens: 100, outputTokens: 50 } };
		},
	};
}

describe("extractMentions", () => {
	test("extracts term from definition atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const defMention = mentions.find(
			(m) => m.role === "term" && m.text === "replication lag",
		);
		expect(defMention).toBeDefined();
		expect(defMention?.frame).toBe("definition");
	});

	test("extracts cause and effect from causal atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const causes = mentions.filter((m) => m.role === "cause");
		expect(causes.length).toBeGreaterThan(0);
	});

	test("extracts entity from has_property atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const entityMention = mentions.find(
			(m) => m.role === "entity" && m.text === "replication lag",
		);
		expect(entityMention).toBeDefined();
	});

	test("uses first domain element as primary domain", () => {
		const mentions = extractMentions(bookAAtoms);
		expect(mentions[0]?.domain).toBe("distributed systems");
	});

	test("atoms with no domain get 'untagged'", () => {
		const atom = makeAtom({ domain: [] });
		const mentions = extractMentions([atom]);
		expect(mentions[0]?.domain).toBe("untagged");
	});

	test("truncates long mention text to 60 chars", () => {
		const atom = makeAtom({
			frame: "principle",
			roles: {
				statement:
					"this is a very long statement that exceeds sixty characters and should be truncated properly",
			},
		});
		const mentions = extractMentions([atom]);
		expect(mentions[0]?.text.length).toBeLessThanOrEqual(60);
	});
});

describe("clusterMentions", () => {
	test("exact normalized matches cluster together", async () => {
		const provider = createMockEmbeddingProvider();
		const mentions = extractMentions(bookAAtoms);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const clusters = await clusterMentions(mentions, embeddings, provider, {});
		// "replication lag" appears in multiple atoms in Book A
		const repLagCluster = clusters.find((c) =>
			c.mentions.some((m) => m.normalized === "replication lag"),
		);
		expect(repLagCluster).toBeDefined();
		expect(
			repLagCluster?.mentions.filter((m) => m.normalized === "replication lag")
				.length,
		).toBeGreaterThan(1);
	});

	test("same text in different domains stays separate", async () => {
		const atom1 = makeAtom({
			id: "a1",
			frame: "definition",
			roles: { term: "model", meaning: "a" },
			domain: ["machine learning"],
		});
		const atom2 = makeAtom({
			id: "a2",
			frame: "definition",
			roles: { term: "model", meaning: "b" },
			domain: ["fashion"],
		});
		const provider = createMockEmbeddingProvider();
		const mentions = extractMentions([atom1, atom2]);
		const embeddings = await embedAtoms([atom1, atom2], provider, []);
		const clusters = await clusterMentions(mentions, embeddings, provider, {});
		const modelClusters = clusters.filter((c) =>
			c.mentions.some((m) => m.normalized === "model"),
		);
		expect(modelClusters.length).toBe(2);
	});
});

describe("resolveEntities — full pipeline", () => {
	test("resolves entities from Book A atoms", async () => {
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
		expect(Object.keys(entities).length).toBeGreaterThan(0);
		const repLagEntity = Object.values(entities).find((e) =>
			e.canonicalName.toLowerCase().includes("replication lag"),
		);
		expect(repLagEntity).toBeDefined();
		expect(repLagEntity?.atomIds.length).toBeGreaterThan(1);
	});

	test("incremental: new mentions merge into existing entities", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const embeddingsA = await embedAtoms(bookAAtoms, provider, []);
		const { entities: entitiesA } = await resolveEntities(
			bookAAtoms,
			{},
			embeddingsA,
			provider,
			llm,
		);
		const allAtoms = [...bookAAtoms, ...bookBAtoms];
		const embeddingsAll = await embedAtoms(allAtoms, provider, []);
		const { entities: entitiesAB } = await resolveEntities(
			bookBAtoms,
			entitiesA,
			embeddingsAll,
			provider,
			llm,
		);
		// Entity count should not double
		expect(Object.keys(entitiesAB).length).toBeLessThanOrEqual(
			Object.keys(entitiesA).length + bookBAtoms.length,
		);
	});

	test("stats track new and merged entities", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const { stats } = await resolveEntities(
			bookAAtoms,
			{},
			embeddings,
			provider,
			llm,
		);
		expect(stats.newEntities).toBeGreaterThan(0);
		expect(typeof stats.mergedEntities).toBe("number");
		expect(typeof stats.llmCalls).toBe("number");
	});
});
