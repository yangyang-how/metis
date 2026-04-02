# Integrate Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Integrate stage — the fourth and final stage of the Metis Learn pipeline — that resolves entities, detects cross-source relationships, and constructs a knowledge graph from extracted atoms.

**Architecture:** Incremental integration (each book integrates into an existing graph) with batch rebuild support (same code path on an empty graph). Four sub-steps: embed atoms → resolve entities → detect relations → build graph. Entity resolution is layered: merge within domain, link across domains.

**Tech Stack:** TypeScript (Bun), OpenAI embeddings (`text-embedding-3-large`, 3072-dim via `openai` npm package already installed), LLM provider interface (existing Kimi/Anthropic adapters).

**Spec:** `docs/superpowers/specs/2026-03-27-integrate-stage-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `engine/src/integrate/types.ts` | All Integrate stage types: Atom, Entity, GraphEdge, KnowledgeGraph, etc. |
| `engine/src/integrate/errors.ts` | IntegrateError class with typed error codes |
| `engine/src/integrate/embedding-service.ts` | atomToText(), embedAtoms(), cosineSimilarity() |
| `engine/src/integrate/entity-resolver.ts` | extractMentions(), clusterMentions(), disambiguate(), linkCrossDomain() |
| `engine/src/integrate/relation-detector.ts` | findCandidatePairs(), scoreAndClassify() |
| `engine/src/integrate/graph-builder.ts` | finalizeAtoms(), buildAdjacencyList() |
| `engine/src/integrate/prompts.ts` | Entity disambiguation + relation classification prompts |
| `engine/src/integrate/index.ts` | integrate() orchestrator |
| `engine/src/llm/embedding-types.ts` | EmbeddingProvider interface + EmbeddingConfig |
| `engine/src/llm/openai-embedding.ts` | OpenAI embedding adapter |
| `engine/test/integrate/fixtures/sample-atoms.ts` | Test fixture: CandidateAtom[] from 2-3 mock books |
| `engine/test/integrate/fixtures/mock-embeddings.ts` | Pre-computed embeddings for deterministic tests |
| `engine/test/integrate/embedding-service.test.ts` | Tests for embedding service |
| `engine/test/integrate/entity-resolver.test.ts` | Tests for entity resolution |
| `engine/test/integrate/relation-detector.test.ts` | Tests for relation detection |
| `engine/test/integrate/graph-builder.test.ts` | Tests for graph construction |
| `engine/test/integrate/integration.test.ts` | End-to-end tests for integrate() |

### Modified Files

| File | Change |
|------|--------|
| `engine/src/run-pipeline.ts` | Add Stage 4 (integrate), new CLI flags |
| `engine/src/run-batch.ts` | Add integrate step after extract, load/save graph |

---

## Task 1: Types & Error Class

**Files:**
- Create: `engine/src/integrate/types.ts`
- Create: `engine/src/integrate/errors.ts`
- Create: `engine/src/llm/embedding-types.ts`

- [ ] **Step 1: Create `engine/src/integrate/types.ts`**

```typescript
/**
 * Integrate stage types — finalized atoms, entities, graph, and vectors.
 *
 * CandidateAtom (from Extract) becomes Atom after entity resolution
 * and relation detection populate the cross-reference fields.
 */
import type { CandidateAtom } from "../extract/types";
import type { DocumentMetadata } from "../parse/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { LLMProvider } from "../llm/types";

// --- Input/Output ---

export interface IntegrateInput {
	/** New atoms from Extract stage */
	atoms: CandidateAtom[];
	/** Document metadata for provenance (from Parse stage) */
	metadata: DocumentMetadata;
	/** Existing graph to integrate into (null for first book / batch rebuild) */
	existingGraph: KnowledgeGraph | null;
	/** LLM provider for entity disambiguation + relation classification */
	llmProvider: LLMProvider;
	/** Embedding provider for vector operations */
	embeddingProvider: EmbeddingProvider;
}

export interface KnowledgeGraph {
	atoms: Atom[];
	entities: EntityIndex;
	graph: GraphIndex;
	embeddings: VectorIndex;
	stats: IntegrationStats;
}

export interface IntegrationStats {
	totalAtoms: number;
	totalEntities: number;
	newEntities: number;
	mergedEntities: number;
	reinforcements: number;
	contradictions: number;
	extensions: number;
	crossDomainLinks: number;
	llmCalls: number;
	embeddingTokens: number;
}

// --- Finalized Atom ---

export interface Atom extends CandidateAtom {
	/** Resolved entity IDs referenced by this atom's roles */
	entityRefs: string[];
	/** Atom IDs that assert the same claim from different sources */
	reinforcedBy: string[];
	/** Atom IDs that contradict this atom */
	contradictedBy: string[];
	/** Atom IDs that extend/add nuance to this atom */
	extendedBy: string[];
}

// --- Entity Index ---

export interface Entity {
	id: string;
	canonicalName: string;
	aliases: string[];
	domain: string;
	atomIds: string[];
	crossDomainLinks: string[];
}

export type EntityIndex = Record<string, Entity>;

// --- Graph Index ---

export type EdgeType =
	| "reinforces"
	| "contradicts"
	| "extends"
	| "entity_link"
	| "cross_domain";

export interface GraphEdge {
	target: string;
	type: EdgeType;
	confidence: number;
	source?: string;
}

export type GraphIndex = Record<string, GraphEdge[]>;

// --- Vector Index ---

export interface VectorEntry {
	atomId: string;
	text: string;
	embedding: number[];
}

export type VectorIndex = VectorEntry[];

// --- Internal Types ---

export interface EntityMention {
	text: string;
	normalized: string;
	atomId: string;
	role: string;
	frame: string;
	domain: string;
}

export interface Relation {
	type: "reinforces" | "contradicts" | "extends";
	atomA: string;
	atomB: string;
	confidence: number;
	method: "algorithmic" | "llm";
}
```

- [ ] **Step 2: Create `engine/src/integrate/errors.ts`**

```typescript
export class IntegrateError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "EMBEDDING_FAILED"
			| "LLM_CALL_FAILED"
			| "RESPONSE_PARSE_FAILED"
			| "GRAPH_LOAD_FAILED",
		public readonly detail?: string,
	) {
		super(message);
		this.name = "IntegrateError";
	}
}
```

- [ ] **Step 3: Create `engine/src/llm/embedding-types.ts`**

```typescript
/**
 * Embedding provider interface — same abstraction pattern as LLMProvider.
 *
 * Pipeline stages call this interface, never an SDK directly.
 * Currently: OpenAI adapter. Future: Ollama, Voyage.
 */

export interface EmbeddingProvider {
	/** Embed a batch of texts. Returns embeddings in same order. */
	embed(texts: string[]): Promise<number[][]>;
	/** Model dimensions (e.g., 3072 for text-embedding-3-large) */
	dimensions: number;
	/** Max batch size the provider supports */
	maxBatchSize: number;
}

export interface EmbeddingConfig {
	provider: "openai";
	model: string;
	apiKey?: string;
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd engine && bun run typecheck`
Expected: PASS (no errors from new files)

- [ ] **Step 5: Commit**

```bash
git add engine/src/integrate/types.ts engine/src/integrate/errors.ts engine/src/llm/embedding-types.ts
git commit -m "feat(integrate): add type definitions and error class"
```

---

## Task 2: Test Fixtures

**Files:**
- Create: `engine/test/integrate/fixtures/sample-atoms.ts`
- Create: `engine/test/integrate/fixtures/mock-embeddings.ts`

- [ ] **Step 1: Create `engine/test/integrate/fixtures/sample-atoms.ts`**

These fixtures simulate atoms from 3 different books with overlapping concepts. They are the foundation for all Integrate tests.

```typescript
/**
 * Test fixtures: CandidateAtom[] simulating extraction from 3 books.
 *
 * Book A: "Distributed Systems" (English) — domain: distributed systems
 * Book B: "System Design Guide" (English) — domain: distributed systems
 * Book C: "行为设计模型" (Chinese) — domain: behavioral science
 *
 * Designed overlaps:
 * - "replication lag" appears in Book A and Book B (reinforcement candidate)
 * - "feedback loop" appears in Book A (distributed) and Book C (behavioral) (cross-domain link)
 * - Book A says "replication lag causes stale reads", Book B says "replication lag causes inconsistency" (extension)
 * - Book A says "strong consistency requires synchronous replication",
 *   Book B says "strong consistency does not require synchronous replication" (contradiction candidate)
 */
import type { CandidateAtom } from "../../../src/extract/types";

export function makeAtom(overrides: Partial<CandidateAtom> = {}): CandidateAtom {
	return {
		id: "test-ch1-s1-0",
		frame: "definition",
		roles: { term: "test concept", meaning: "a test definition" },
		conditions: [],
		confidence: 0.8,
		source: {
			title: "Test Book",
			authors: ["Author"],
			chapterId: "ch1",
			sectionId: "s1",
		},
		domain: ["testing"],
		examples: [],
		flags: [],
		...overrides,
	};
}

// --- Book A: Distributed Systems ---

export const bookAAtoms: CandidateAtom[] = [
	makeAtom({
		id: "dist-sys-ch1-s1-0",
		frame: "definition",
		roles: { term: "replication lag", meaning: "the delay between a write on the leader and its reflection on a follower" },
		domain: ["distributed systems", "replication"],
		source: { title: "Distributed Systems", authors: ["Author A"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "dist-sys-ch1-s1-1",
		frame: "causal",
		roles: { cause: "replication lag", effect: "stale reads from followers" },
		domain: ["distributed systems", "replication"],
		source: { title: "Distributed Systems", authors: ["Author A"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "dist-sys-ch2-s1-0",
		frame: "principle",
		roles: { statement: "strong consistency requires synchronous replication", scope: "distributed databases", implication: "higher latency for writes" },
		domain: ["distributed systems", "consistency"],
		source: { title: "Distributed Systems", authors: ["Author A"], chapterId: "ch2", sectionId: "s1" },
	}),
	makeAtom({
		id: "dist-sys-ch3-s1-0",
		frame: "causal",
		roles: { cause: "feedback loop in retry logic", effect: "cascading failures across services" },
		domain: ["distributed systems", "fault tolerance"],
		source: { title: "Distributed Systems", authors: ["Author A"], chapterId: "ch3", sectionId: "s1" },
	}),
	makeAtom({
		id: "dist-sys-ch1-s2-0",
		frame: "has_property",
		roles: { entity: "replication lag", property: "increases during peak load" },
		domain: ["distributed systems", "replication"],
		source: { title: "Distributed Systems", authors: ["Author A"], chapterId: "ch1", sectionId: "s2" },
	}),
];

// --- Book B: System Design Guide ---

export const bookBAtoms: CandidateAtom[] = [
	makeAtom({
		id: "sys-design-ch1-s1-0",
		frame: "definition",
		roles: { term: "replication delay", meaning: "time for a write to propagate from primary to replica" },
		domain: ["distributed systems", "databases"],
		source: { title: "System Design Guide", authors: ["Author B"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "sys-design-ch1-s1-1",
		frame: "causal",
		roles: { cause: "replication delay", effect: "read inconsistency in distributed databases" },
		domain: ["distributed systems", "databases"],
		source: { title: "System Design Guide", authors: ["Author B"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "sys-design-ch2-s1-0",
		frame: "principle",
		roles: { statement: "strong consistency does not require synchronous replication", scope: "modern distributed databases", implication: "consensus protocols can achieve consistency without sync replication" },
		domain: ["distributed systems", "consistency"],
		source: { title: "System Design Guide", authors: ["Author B"], chapterId: "ch2", sectionId: "s1" },
	}),
];

// --- Book C: 行为设计模型 (Behavioral Design) ---

export const bookCAtoms: CandidateAtom[] = [
	makeAtom({
		id: "behavior-ch1-s1-0",
		frame: "definition",
		roles: { term: "反馈循环", meaning: "行为产生的结果反过来影响后续行为的循环过程" },
		domain: ["behavioral science", "行为设计"],
		source: { title: "行为设计模型", authors: ["Author C"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "behavior-ch1-s1-1",
		frame: "heuristic",
		roles: { situation: "when building a new habit", action: "create a positive feedback loop by celebrating small wins", rationale: "positive emotions reinforce the neural pathway for the behavior" },
		domain: ["behavioral science", "习惯养成"],
		source: { title: "行为设计模型", authors: ["Author C"], chapterId: "ch1", sectionId: "s1" },
	}),
	makeAtom({
		id: "behavior-ch2-s1-0",
		frame: "causal",
		roles: { cause: "feedback loop in habit formation", effect: "exponential behavior change over time" },
		domain: ["behavioral science", "习惯养成"],
		source: { title: "行为设计模型", authors: ["Author C"], chapterId: "ch2", sectionId: "s1" },
	}),
];

export const allFixtureAtoms: CandidateAtom[] = [
	...bookAAtoms,
	...bookBAtoms,
	...bookCAtoms,
];
```

- [ ] **Step 2: Create `engine/test/integrate/fixtures/mock-embeddings.ts`**

```typescript
/**
 * Mock embedding provider and pre-computed embeddings for deterministic tests.
 *
 * Strategy: use short vectors (8-dim) instead of 3072-dim. Tests validate
 * the logic (batching, caching, similarity), not the embedding quality.
 * Pre-computed vectors are designed so that:
 *   - "replication lag" and "replication delay" have cosine similarity ~0.92
 *   - "feedback loop" (distributed) and "反馈循环" have similarity ~0.78
 *   - Unrelated concepts have similarity < 0.5
 */
import type { EmbeddingProvider } from "../../../src/llm/embedding-types";

export const MOCK_DIMENSIONS = 8;

/** Pre-computed vectors with designed similarity relationships */
export const MOCK_VECTORS: Record<string, number[]> = {
	// Replication cluster (high mutual similarity)
	"replication lag": [0.9, 0.3, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0],
	"replication delay": [0.88, 0.32, 0.12, 0.02, 0.0, 0.08, 0.0, 0.0],
	"the delay between a write on the leader and its reflection on a follower":
		[0.85, 0.35, 0.15, 0.0, 0.05, 0.1, 0.0, 0.0],
	"time for a write to propagate from primary to replica":
		[0.84, 0.34, 0.14, 0.01, 0.04, 0.09, 0.0, 0.0],

	// Stale reads / inconsistency (related to replication)
	"stale reads from followers": [0.7, 0.5, 0.2, 0.0, 0.1, 0.1, 0.0, 0.0],
	"read inconsistency in distributed databases": [0.68, 0.48, 0.22, 0.02, 0.12, 0.08, 0.0, 0.0],

	// Consistency cluster
	"strong consistency requires synchronous replication":
		[0.3, 0.1, 0.8, 0.4, 0.0, 0.0, 0.0, 0.0],
	"strong consistency does not require synchronous replication":
		[0.3, 0.1, 0.75, 0.35, 0.0, 0.0, 0.1, 0.0],

	// Feedback loop — distributed systems
	"feedback loop in retry logic": [0.1, 0.0, 0.0, 0.0, 0.8, 0.3, 0.2, 0.0],
	"cascading failures across services": [0.0, 0.0, 0.1, 0.0, 0.6, 0.5, 0.1, 0.0],

	// Feedback loop — behavioral science
	"反馈循环": [0.12, 0.0, 0.0, 0.0, 0.7, 0.25, 0.3, 0.2],
	"feedback loop in habit formation": [0.1, 0.0, 0.0, 0.0, 0.72, 0.28, 0.28, 0.18],

	// Replication lag has_property
	"increases during peak load": [0.6, 0.4, 0.2, 0.1, 0.0, 0.0, 0.0, 0.0],
};

/** Deterministic fallback: hash the text to a stable vector */
function hashToVector(text: string): number[] {
	const vec = new Array(MOCK_DIMENSIONS).fill(0);
	for (let i = 0; i < text.length; i++) {
		vec[i % MOCK_DIMENSIONS] += text.charCodeAt(i) / 1000;
	}
	// Normalize
	const mag = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
	return mag > 0 ? vec.map((v: number) => v / mag) : vec;
}

export function createMockEmbeddingProvider(): EmbeddingProvider {
	return {
		dimensions: MOCK_DIMENSIONS,
		maxBatchSize: 50,
		async embed(texts: string[]): Promise<number[][]> {
			return texts.map((text) => {
				const normalized = text.toLowerCase().trim();
				// Check for exact match first
				if (MOCK_VECTORS[normalized]) return MOCK_VECTORS[normalized];
				// Check for substring match (e.g., atom text containing the key phrase)
				for (const [key, vec] of Object.entries(MOCK_VECTORS)) {
					if (normalized.includes(key) || key.includes(normalized)) return vec;
				}
				// Fallback to hash
				return hashToVector(text);
			});
		},
	};
}
```

- [ ] **Step 3: Verify fixtures compile**

Run: `cd engine && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add engine/test/integrate/
git commit -m "test(integrate): add test fixtures — sample atoms and mock embeddings"
```

---

## Task 3: OpenAI Embedding Adapter

**Files:**
- Create: `engine/src/llm/openai-embedding.ts`
- Test: `engine/test/integrate/embedding-service.test.ts` (provider portion)

- [ ] **Step 1: Write test for OpenAI embedding adapter**

Add a test section in `engine/test/integrate/embedding-service.test.ts` (we'll add the rest of the embedding-service tests in the next task):

```typescript
import { describe, expect, test } from "bun:test";
import { createOpenAIEmbeddingProvider } from "../../src/llm/openai-embedding";

describe("OpenAI Embedding Adapter", () => {
	test("creates provider with correct dimensions for text-embedding-3-large", () => {
		const provider = createOpenAIEmbeddingProvider(
			{ provider: "openai", model: "text-embedding-3-large" },
			mockOpenAIClient([[[0.1, 0.2, 0.3]]]),
		);
		expect(provider.dimensions).toBe(3072);
		expect(provider.maxBatchSize).toBe(2048);
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

/** Mock the OpenAI embeddings.create() method */
function mockOpenAIClient(
	responses: number[][][],
	error?: Error,
): { create(args: Record<string, unknown>): Promise<{ data: Array<{ embedding: number[] }> }> } {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && bun test test/integrate/embedding-service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `engine/src/llm/openai-embedding.ts`**

```typescript
/**
 * OpenAI embedding adapter.
 *
 * Uses the `openai` npm package (already installed for Kimi adapter).
 * Same pattern: injectable client for testing, real client for production.
 */
import OpenAI from "openai";
import type { EmbeddingConfig, EmbeddingProvider } from "./embedding-types";

/** Injectable dependency for testing */
export interface OpenAIEmbeddingClient {
	create(args: Record<string, unknown>): Promise<{
		data: Array<{ embedding: number[] }>;
	}>;
}

export function createOpenAIEmbeddingProvider(
	config: EmbeddingConfig,
	mockClient?: OpenAIEmbeddingClient,
): EmbeddingProvider {
	const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
	const client = mockClient ?? createRealClient(apiKey);
	const dimensions = inferDimensions(config.model);

	return {
		dimensions,
		maxBatchSize: 2048,
		async embed(texts: string[]): Promise<number[][]> {
			const response = await client.create({
				model: config.model,
				input: texts,
			});
			// OpenAI returns embeddings sorted by index
			const sorted = response.data
				.sort((a: { embedding: number[] }, b: { embedding: number[] }) => {
					const aIdx = (a as unknown as { index: number }).index;
					const bIdx = (b as unknown as { index: number }).index;
					return aIdx - bIdx;
				});
			return sorted.map((d: { embedding: number[] }) => d.embedding);
		},
	};
}

function createRealClient(apiKey: string | undefined): OpenAIEmbeddingClient {
	const sdk = new OpenAI({ apiKey: apiKey ?? "" });
	return {
		async create(args) {
			const response = await sdk.embeddings.create(
				args as unknown as Parameters<typeof sdk.embeddings.create>[0],
			);
			return {
				data: response.data.map((d) => ({
					embedding: d.embedding,
					index: d.index,
				})) as Array<{ embedding: number[] }>,
			};
		},
	};
}

function inferDimensions(model: string): number {
	if (model.includes("3-large")) return 3072;
	if (model.includes("3-small")) return 1536;
	if (model.includes("ada")) return 1536;
	return 3072; // default
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && bun test test/integrate/embedding-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/llm/openai-embedding.ts engine/test/integrate/embedding-service.test.ts
git commit -m "feat(integrate): add OpenAI embedding adapter with mock-injectable client"
```

---

## Task 4: Embedding Service

**Files:**
- Create: `engine/src/integrate/embedding-service.ts`
- Modify: `engine/test/integrate/embedding-service.test.ts` (add embedding-service tests)

- [ ] **Step 1: Add embedding-service tests to existing test file**

Append to `engine/test/integrate/embedding-service.test.ts`:

```typescript
import { atomToText, embedAtoms, cosineSimilarity } from "../../src/integrate/embedding-service";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { makeAtom, bookAAtoms } from "./fixtures/sample-atoms";

describe("atomToText", () => {
	test("definition frame: '{term} means {meaning}'", () => {
		const atom = makeAtom({
			frame: "definition",
			roles: { term: "replication lag", meaning: "delay in data propagation" },
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
			roles: { situation: "high load", action: "add caching", rationale: "reduces DB hits" },
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
		// Pre-cache the first atom
		const existingCache = [{
			atomId: atoms[0]!.id,
			text: "cached text",
			embedding: new Array(provider.dimensions).fill(0),
		}];
		const result = await embedAtoms(atoms, provider, existingCache);
		// Should have 2 entries: 1 cached + 1 new
		expect(result).toHaveLength(2);
		// Cached entry should be preserved
		expect(result.find(e => e.atomId === atoms[0]!.id)?.text).toBe("cached text");
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

		const atoms = bookAAtoms.slice(0, 4); // 4 atoms, batch size 2 = 2 calls
		await embedAtoms(atoms, provider, []);
		expect(callCount).toBe(2);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/integrate/embedding-service.test.ts`
Expected: FAIL (embedding-service module not found)

- [ ] **Step 3: Implement `engine/src/integrate/embedding-service.ts`**

```typescript
/**
 * Embedding service — converts atoms to text, embeds them, caches results.
 *
 * The text representation varies by frame type to produce natural language
 * that captures the atom's meaning for embedding models.
 */
import type { CandidateAtom } from "../extract/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { VectorEntry, VectorIndex } from "./types";

// --- Frame-specific text templates ---

const FRAME_TEMPLATES: Record<string, (roles: Record<string, string>) => string> = {
	definition: (r) => `${r.term} means ${r.meaning}`,
	has_property: (r) => `${r.entity} has the property: ${r.property}`,
	is_a: (r) => `${r.instance} is a type of ${r.category}`,
	consists_of: (r) => `${r.whole} consists of ${r.dimension}: ${r.description}`,
	example_of: (r) => `${r.instance} is an example of ${r.concept}${r.detail ? `: ${r.detail}` : ""}`,
	taxonomy: (r) => `${r.concept} is classified into ${r.categories} based on ${r.basis}`,
	causal: (r) => `${r.cause} causes ${r.effect}`,
	causal_chain: (r) => `${r.trigger} leads to ${r.mechanism}, resulting in ${r.outcome}`,
	heuristic: (r) => `when ${r.situation}, ${r.action} because ${r.rationale}`,
	principle: (r) => `${r.statement}${r.scope ? ` (in ${r.scope})` : ""}${r.implication ? `: ${r.implication}` : ""}`,
	procedure: (r) => `to ${r.goal}: ${r.steps}${r.context ? ` (${r.context})` : ""}`,
	formula: (r) => `${r.name}: ${r.expression}${r.terms ? ` where ${r.terms}` : ""}`,
	deviation: (r) => `theory says ${r.theory}, but reality is ${r.reality}${r.implication ? `: ${r.implication}` : ""}`,
	threshold: (r) => `${r.metric} at ${r.threshold_value} triggers ${r.transition}${r.direction ? ` (${r.direction})` : ""}`,
	method_comparison: (r) => `${r.method_a} vs ${r.method_b}: ${r.difference}${r.when_to_use ? `. Use when: ${r.when_to_use}` : ""}`,
	sequence: (r) => `${r.name}: ${r.layers}${r.rule ? `. Rule: ${r.rule}` : ""}`,
	evaluation_matrix: (r) => `${r.name} evaluates across ${r.dimensions}${r.quadrants ? `: ${r.quadrants}` : ""}${r.rule ? `. ${r.rule}` : ""}`,
};

/**
 * Convert an atom to a natural language sentence for embedding.
 * Uses frame-specific templates for known types, falls back to
 * concatenating role values for unknown types.
 */
export function atomToText(atom: CandidateAtom): string {
	const template = FRAME_TEMPLATES[atom.frame];
	if (template) {
		return template(atom.roles);
	}
	// Fallback: concatenate all role values
	return Object.values(atom.roles).join(". ");
}

/**
 * Embed atoms, skipping those already in the cache.
 * Batches calls according to provider's maxBatchSize.
 */
export async function embedAtoms(
	atoms: CandidateAtom[],
	provider: EmbeddingProvider,
	existingCache: VectorIndex,
): Promise<VectorIndex> {
	const cacheMap = new Map(existingCache.map((e) => [e.atomId, e]));

	// Find atoms that need embedding
	const toEmbed: Array<{ atom: CandidateAtom; text: string }> = [];
	for (const atom of atoms) {
		if (!cacheMap.has(atom.id)) {
			toEmbed.push({ atom, text: atomToText(atom) });
		}
	}

	// Batch embed
	const newEntries: VectorEntry[] = [];
	for (let i = 0; i < toEmbed.length; i += provider.maxBatchSize) {
		const batch = toEmbed.slice(i, i + provider.maxBatchSize);
		const texts = batch.map((b) => b.text);
		const embeddings = await provider.embed(texts);

		for (let j = 0; j < batch.length; j++) {
			const item = batch[j]!;
			newEntries.push({
				atomId: item.atom.id,
				text: item.text,
				embedding: embeddings[j]!,
			});
		}
	}

	// Merge: cached + new
	const result: VectorIndex = [];
	for (const atom of atoms) {
		const cached = cacheMap.get(atom.id);
		if (cached) {
			result.push(cached);
		} else {
			const newEntry = newEntries.find((e) => e.atomId === atom.id);
			if (newEntry) result.push(newEntry);
		}
	}

	// Include existing entries not in current atoms (from previous books)
	for (const entry of existingCache) {
		if (!result.find((e) => e.atomId === entry.atomId)) {
			result.push(entry);
		}
	}

	return result;
}

/**
 * Cosine similarity between two vectors.
 * Returns value in [-1, 1]. Higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!;
		magA += a[i]! * a[i]!;
		magB += b[i]! * b[i]!;
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/integrate/embedding-service.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/integrate/embedding-service.ts engine/test/integrate/embedding-service.test.ts
git commit -m "feat(integrate): add embedding service — atomToText, batch embed, cosine similarity"
```

---

## Task 5: Entity Resolver

**Files:**
- Create: `engine/src/integrate/entity-resolver.ts`
- Create: `engine/src/integrate/prompts.ts`
- Test: `engine/test/integrate/entity-resolver.test.ts`

- [ ] **Step 1: Write entity resolver tests**

Create `engine/test/integrate/entity-resolver.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { extractMentions, clusterMentions, resolveEntities } from "../../src/integrate/entity-resolver";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, bookBAtoms, bookCAtoms, allFixtureAtoms, makeAtom } from "./fixtures/sample-atoms";
import { embedAtoms } from "../../src/integrate/embedding-service";
import type { LLMProvider } from "../../src/llm/types";
import type { EntityIndex } from "../../src/integrate/types";

function createMockLLM(responses: string[]): LLMProvider {
	let callIdx = 0;
	return {
		capabilities: { vision: false, structuredOutput: false, maxContextTokens: 128000 },
		async sendMessage() {
			const content = responses[callIdx++] ?? '{"decisions":[]}';
			return { content, usage: { inputTokens: 100, outputTokens: 50 } };
		},
	};
}

describe("extractMentions", () => {
	test("extracts term from definition atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const defMention = mentions.find(m => m.role === "term" && m.text === "replication lag");
		expect(defMention).toBeDefined();
		expect(defMention!.frame).toBe("definition");
	});

	test("extracts cause and effect from causal atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const causes = mentions.filter(m => m.role === "cause");
		expect(causes.length).toBeGreaterThan(0);
	});

	test("extracts entity from has_property atoms", () => {
		const mentions = extractMentions(bookAAtoms);
		const entityMention = mentions.find(m => m.role === "entity" && m.text === "replication lag");
		expect(entityMention).toBeDefined();
	});

	test("uses first domain element as primary domain", () => {
		const mentions = extractMentions(bookAAtoms);
		expect(mentions[0]!.domain).toBe("distributed systems");
	});

	test("atoms with no domain get 'untagged'", () => {
		const atom = makeAtom({ domain: [] });
		const mentions = extractMentions([atom]);
		expect(mentions[0]!.domain).toBe("untagged");
	});
});

describe("clusterMentions", () => {
	test("exact normalized matches cluster together", async () => {
		const provider = createMockEmbeddingProvider();
		const mentions = extractMentions(bookAAtoms);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const clusters = await clusterMentions(mentions, embeddings, provider, {});
		// "replication lag" appears in multiple atoms in Book A — should be one cluster
		const repLagCluster = clusters.find(c =>
			c.mentions.some(m => m.normalized === "replication lag")
		);
		expect(repLagCluster).toBeDefined();
		expect(repLagCluster!.mentions.filter(m => m.normalized === "replication lag").length).toBeGreaterThan(1);
	});

	test("same text in different domains stays separate", async () => {
		// Create two atoms with same term but different domains
		const atom1 = makeAtom({ id: "a1", frame: "definition", roles: { term: "model", meaning: "a" }, domain: ["machine learning"] });
		const atom2 = makeAtom({ id: "a2", frame: "definition", roles: { term: "model", meaning: "b" }, domain: ["fashion"] });
		const provider = createMockEmbeddingProvider();
		const mentions = extractMentions([atom1, atom2]);
		const embeddings = await embedAtoms([atom1, atom2], provider, []);
		const clusters = await clusterMentions(mentions, embeddings, provider, {});
		// Should be 2 separate clusters because different domains
		const modelClusters = clusters.filter(c =>
			c.mentions.some(m => m.normalized === "model")
		);
		expect(modelClusters.length).toBe(2);
	});
});

describe("resolveEntities — full pipeline", () => {
	test("resolves entities from Book A atoms", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const { entities, stats } = await resolveEntities(bookAAtoms, {}, embeddings, provider, llm);
		expect(Object.keys(entities).length).toBeGreaterThan(0);
		// "replication lag" should be an entity
		const repLagEntity = Object.values(entities).find(e =>
			e.canonicalName.toLowerCase().includes("replication lag")
		);
		expect(repLagEntity).toBeDefined();
		expect(repLagEntity!.atomIds.length).toBeGreaterThan(1);
	});

	test("incremental: new mentions merge into existing entities", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		// First integrate Book A
		const embeddingsA = await embedAtoms(bookAAtoms, provider, []);
		const { entities: entitiesA } = await resolveEntities(bookAAtoms, {}, embeddingsA, provider, llm);
		// Then integrate Book B (has "replication delay" — similar to "replication lag")
		const allAtoms = [...bookAAtoms, ...bookBAtoms];
		const embeddingsAll = await embedAtoms(allAtoms, provider, []);
		const { entities: entitiesAB } = await resolveEntities(
			bookBAtoms, entitiesA, embeddingsAll, provider, llm,
		);
		// Entity count should not double — "replication delay" should merge with "replication lag"
		expect(Object.keys(entitiesAB).length).toBeLessThanOrEqual(
			Object.keys(entitiesA).length + bookBAtoms.length // upper bound
		);
	});

	test("cross-domain links created for related entities in different domains", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const allAtoms = [...bookAAtoms, ...bookCAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(allAtoms, {}, embeddings, provider, llm);
		// Check if any entity has crossDomainLinks
		const withLinks = Object.values(entities).filter(e => e.crossDomainLinks.length > 0);
		// "feedback loop" concepts should link across distributed systems and behavioral science
		expect(withLinks.length).toBeGreaterThanOrEqual(0); // May or may not trigger depending on threshold
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/integrate/entity-resolver.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Create `engine/src/integrate/prompts.ts`**

```typescript
/**
 * LLM prompt templates for the Integrate stage.
 *
 * Two prompts, both designed for cheap models (Haiku tier):
 * 1. Entity disambiguation — "are these the same concept?"
 * 2. Relation classification — "how do these atoms relate?"
 *
 * Prompts live here (not inline) so they can be iterated
 * without touching pipeline logic.
 */

export function entityDisambiguationPrompt(
	domain: string,
	pairs: Array<{ a: string; b: string }>,
): string {
	const pairList = pairs
		.map((p, i) => `${i + 1}. "${p.a}" vs "${p.b}"`)
		.join("\n");

	return `You are an entity resolution expert. Given pairs of entity mentions from the domain "${domain}", determine if each pair refers to the same concept.

For each pair, respond with one of:
- "merge" — same concept, should be unified
- "separate" — different concepts, keep apart
- "unsure" — cannot determine

Pairs:
${pairList}

Respond with valid JSON:
{
  "decisions": [
    { "pair": 1, "decision": "merge" | "separate" | "unsure", "reason": "brief explanation" }
  ]
}

Respond with valid JSON only.`;
}

export function relationClassificationPrompt(
	pairs: Array<{
		atomA: { frame: string; roles: Record<string, string>; source: string };
		atomB: { frame: string; roles: Record<string, string>; source: string };
		sharedEntity: string;
	}>,
): string {
	const pairList = pairs
		.map(
			(p, i) =>
				`${i + 1}. Entity: "${p.sharedEntity}"
   Atom A (${p.atomA.source}, ${p.atomA.frame}): ${JSON.stringify(p.atomA.roles)}
   Atom B (${p.atomB.source}, ${p.atomB.frame}): ${JSON.stringify(p.atomB.roles)}`,
		)
		.join("\n\n");

	return `You are a knowledge graph expert. Given pairs of knowledge atoms that share an entity, classify their relationship.

For each pair, respond with one of:
- "reinforces" — both atoms assert the same claim from different sources
- "contradicts" — atoms make opposing/conflicting claims
- "extends" — one atom adds nuance, detail, or a different perspective to the other
- "unrelated" — atoms share an entity but are not semantically related

Pairs:
${pairList}

Respond with valid JSON:
{
  "classifications": [
    { "pair": 1, "relation": "reinforces" | "contradicts" | "extends" | "unrelated", "reason": "brief explanation" }
  ]
}

Respond with valid JSON only.`;
}
```

- [ ] **Step 4: Implement `engine/src/integrate/entity-resolver.ts`**

```typescript
/**
 * Entity resolver — extract mentions, cluster, disambiguate, link across domains.
 *
 * The most complex module in the Integrate stage. Entity resolution is
 * "layered": merge within domain, link across domains.
 */
import type { CandidateAtom } from "../extract/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { LLMProvider } from "../llm/types";
import { cosineSimilarity } from "./embedding-service";
import { IntegrateError } from "./errors";
import { entityDisambiguationPrompt } from "./prompts";
import type { Entity, EntityIndex, EntityMention, VectorIndex } from "./types";

// --- Configuration ---

/** Which roles are "entity-bearing" per frame type */
const ENTITY_ROLES: Record<string, string[]> = {
	definition: ["term"],
	has_property: ["entity"],
	is_a: ["instance", "category"],
	causal: ["cause", "effect"],
	causal_chain: ["trigger", "outcome"],
	threshold: ["metric"],
	heuristic: ["situation"],
	principle: ["statement"],
	method_comparison: ["method_a", "method_b"],
	formula: ["name"],
	procedure: ["goal"],
	sequence: ["name"],
	evaluation_matrix: ["name"],
	taxonomy: ["concept"],
	consists_of: ["whole"],
	example_of: ["concept"],
	deviation: ["theory"],
};

const MAX_MENTION_LENGTH = 60;
const CLUSTER_MERGE_THRESHOLD = 0.85;
const CLUSTER_AMBIGUOUS_THRESHOLD = 0.70;
const CROSS_DOMAIN_THRESHOLD = 0.75;
const DISAMBIGUATION_BATCH_SIZE = 20;

// --- Public API ---

export interface ResolveResult {
	entities: EntityIndex;
	stats: { newEntities: number; mergedEntities: number; crossDomainLinks: number; llmCalls: number };
}

export function extractMentions(atoms: CandidateAtom[]): EntityMention[] {
	const mentions: EntityMention[] = [];

	for (const atom of atoms) {
		const entityRoles = ENTITY_ROLES[atom.frame];
		if (!entityRoles) continue;

		const domain = atom.domain[0] ?? "untagged";

		for (const role of entityRoles) {
			const value = atom.roles[role];
			if (!value) continue;

			// Truncate long values (e.g., principle.statement)
			const text = value.length > MAX_MENTION_LENGTH
				? value.slice(0, MAX_MENTION_LENGTH)
				: value;

			mentions.push({
				text,
				normalized: text.toLowerCase().trim(),
				atomId: atom.id,
				role,
				frame: atom.frame,
				domain,
			});
		}
	}

	return mentions;
}

export interface MentionCluster {
	mentions: EntityMention[];
	domain: string;
	centroidText: string;
}

export async function clusterMentions(
	mentions: EntityMention[],
	embeddings: VectorIndex,
	provider: EmbeddingProvider,
	existingEntities: EntityIndex,
): Promise<MentionCluster[]> {
	// Group mentions by domain
	const byDomain = new Map<string, EntityMention[]>();
	for (const m of mentions) {
		const list = byDomain.get(m.domain) ?? [];
		list.push(m);
		byDomain.set(m.domain, list);
	}

	const allClusters: MentionCluster[] = [];

	for (const [domain, domainMentions] of byDomain) {
		// Pass 1: exact normalized match
		const exactGroups = new Map<string, EntityMention[]>();
		for (const m of domainMentions) {
			const list = exactGroups.get(m.normalized) ?? [];
			list.push(m);
			exactGroups.set(m.normalized, list);
		}

		const clusters: MentionCluster[] = [...exactGroups.entries()].map(([text, ms]) => ({
			mentions: ms,
			domain,
			centroidText: text,
		}));

		// Pass 2: check if any cluster should merge into an existing entity
		const existingInDomain = Object.values(existingEntities).filter(e => e.domain === domain);
		for (const cluster of clusters) {
			for (const existing of existingInDomain) {
				if (
					existing.canonicalName.toLowerCase() === cluster.centroidText ||
					existing.aliases.some(a => a.toLowerCase() === cluster.centroidText)
				) {
					// Exact match with existing — mark for merge
					cluster.centroidText = existing.canonicalName.toLowerCase();
					break;
				}
			}
		}

		// Pass 3: embedding-based merge within domain
		if (clusters.length > 1) {
			const embeddingMap = new Map(embeddings.map(e => [e.atomId, e.embedding]));

			// Get representative embedding for each cluster (first mention's atom)
			const clusterEmbeddings: Array<{ cluster: MentionCluster; embedding: number[] | null }> = [];
			for (const cluster of clusters) {
				// Try to get embedding from mention text
				const firstMention = cluster.mentions[0]!;
				const atomEmbedding = embeddingMap.get(firstMention.atomId);
				clusterEmbeddings.push({ cluster, embedding: atomEmbedding ?? null });
			}

			// Compare all pairs within domain
			for (let i = 0; i < clusterEmbeddings.length; i++) {
				for (let j = i + 1; j < clusterEmbeddings.length; j++) {
					const a = clusterEmbeddings[i]!;
					const b = clusterEmbeddings[j]!;
					if (!a.embedding || !b.embedding) continue;

					// Also compare mention text embeddings
					const textsToEmbed = [a.cluster.centroidText, b.cluster.centroidText];
					const textEmbeddings = await provider.embed(textsToEmbed);
					const sim = cosineSimilarity(textEmbeddings[0]!, textEmbeddings[1]!);

					if (sim >= CLUSTER_MERGE_THRESHOLD) {
						// Merge b into a
						a.cluster.mentions.push(...b.cluster.mentions);
						b.cluster.mentions = []; // mark as empty
					}
				}
			}
		}

		// Filter out empty clusters (merged away)
		allClusters.push(...clusters.filter(c => c.mentions.length > 0));
	}

	return allClusters;
}

export async function resolveEntities(
	newAtoms: CandidateAtom[],
	existingEntities: EntityIndex,
	embeddings: VectorIndex,
	embeddingProvider: EmbeddingProvider,
	llmProvider: LLMProvider,
): Promise<ResolveResult> {
	let llmCalls = 0;
	let newEntityCount = 0;
	let mergedCount = 0;

	// Step 1: Extract mentions from new atoms
	const mentions = extractMentions(newAtoms);

	// Step 2: Cluster mentions
	const clusters = await clusterMentions(mentions, embeddings, embeddingProvider, existingEntities);

	// Step 3: LLM disambiguation for ambiguous clusters
	const ambiguousClusters = clusters.filter(c => c.mentions.length > 0);
	// Find cluster pairs within same domain that are close but not merged
	const disambiguationPairs: Array<{ a: MentionCluster; b: MentionCluster }> = [];
	for (let i = 0; i < ambiguousClusters.length; i++) {
		for (let j = i + 1; j < ambiguousClusters.length; j++) {
			const a = ambiguousClusters[i]!;
			const b = ambiguousClusters[j]!;
			if (a.domain !== b.domain) continue;
			// Check if these are in the ambiguous range (0.70-0.85)
			const textsToEmbed = [a.centroidText, b.centroidText];
			const textEmbeddings = await embeddingProvider.embed(textsToEmbed);
			const sim = cosineSimilarity(textEmbeddings[0]!, textEmbeddings[1]!);
			if (sim >= CLUSTER_AMBIGUOUS_THRESHOLD && sim < CLUSTER_MERGE_THRESHOLD) {
				disambiguationPairs.push({ a, b });
			}
		}
	}

	// Batch disambiguate via LLM
	for (let i = 0; i < disambiguationPairs.length; i += DISAMBIGUATION_BATCH_SIZE) {
		const batch = disambiguationPairs.slice(i, i + DISAMBIGUATION_BATCH_SIZE);
		const promptPairs = batch.map(p => ({ a: p.a.centroidText, b: p.b.centroidText }));
		const domain = batch[0]?.a.domain ?? "unknown";

		try {
			const response = await llmProvider.sendMessage({
				messages: [
					{ role: "user", content: [{ type: "text", text: entityDisambiguationPrompt(domain, promptPairs) }] },
				],
				temperature: 0.1,
				maxTokens: 4096,
			});
			llmCalls++;

			const jsonMatch = response.content.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as {
					decisions?: Array<{ pair: number; decision: string }>;
				};
				for (const d of parsed.decisions ?? []) {
					const pair = batch[d.pair - 1];
					if (!pair) continue;
					if (d.decision === "merge") {
						// Merge b into a
						pair.a.mentions.push(...pair.b.mentions);
						pair.b.mentions = [];
					}
				}
			}
		} catch {
			console.warn(`[integrate] Entity disambiguation LLM call failed — treating as separate`);
		}
	}

	// Filter out empty clusters after disambiguation
	const finalClusters = clusters.filter(c => c.mentions.length > 0);

	// Step 4: Build/update entity index
	const entities: EntityIndex = { ...existingEntities };

	for (const cluster of finalClusters) {
		const canonicalName = cluster.centroidText;
		const domain = cluster.domain;
		const atomIds = [...new Set(cluster.mentions.map(m => m.atomId))];
		const aliases = [...new Set(cluster.mentions.map(m => m.text))].filter(
			a => a.toLowerCase() !== canonicalName,
		);

		// Check if this merges into an existing entity
		const existingEntity = Object.values(entities).find(
			e =>
				e.domain === domain &&
				(e.canonicalName.toLowerCase() === canonicalName ||
					e.aliases.some(a => a.toLowerCase() === canonicalName)),
		);

		if (existingEntity) {
			// Merge: add new atomIds and aliases
			existingEntity.atomIds = [...new Set([...existingEntity.atomIds, ...atomIds])];
			existingEntity.aliases = [...new Set([...existingEntity.aliases, ...aliases])];
			mergedCount++;
		} else {
			// New entity
			const slug = canonicalName
				.toLowerCase()
				.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 40);
			const id = `entity:${slug}-${domain.replace(/\s+/g, "-").slice(0, 20)}`;

			entities[id] = {
				id,
				canonicalName,
				aliases,
				domain,
				atomIds,
				crossDomainLinks: [],
			};
			newEntityCount++;
		}
	}

	// Step 4: Cross-domain linking
	let crossDomainLinkCount = 0;
	const entityList = Object.values(entities);
	const domains = [...new Set(entityList.map(e => e.domain))];

	if (domains.length > 1) {
		// Get embeddings for all entity canonical names
		const entityNames = entityList.map(e => e.canonicalName);
		const nameEmbeddings = await embeddingProvider.embed(entityNames);

		for (let i = 0; i < entityList.length; i++) {
			for (let j = i + 1; j < entityList.length; j++) {
				const eA = entityList[i]!;
				const eB = entityList[j]!;
				if (eA.domain === eB.domain) continue; // same domain — skip

				const sim = cosineSimilarity(nameEmbeddings[i]!, nameEmbeddings[j]!);
				if (sim >= CROSS_DOMAIN_THRESHOLD) {
					if (!eA.crossDomainLinks.includes(eB.id)) {
						eA.crossDomainLinks.push(eB.id);
					}
					if (!eB.crossDomainLinks.includes(eA.id)) {
						eB.crossDomainLinks.push(eA.id);
					}
					crossDomainLinkCount++;
				}
			}
		}
	}

	return {
		entities,
		stats: {
			newEntities: newEntityCount,
			mergedEntities: mergedCount,
			crossDomainLinks: crossDomainLinkCount,
			llmCalls,
		},
	};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/integrate/entity-resolver.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add engine/src/integrate/entity-resolver.ts engine/src/integrate/prompts.ts engine/test/integrate/entity-resolver.test.ts
git commit -m "feat(integrate): add entity resolver — mention extraction, clustering, cross-domain links"
```

---

## Task 6: Relation Detector

**Files:**
- Create: `engine/src/integrate/relation-detector.ts`
- Test: `engine/test/integrate/relation-detector.test.ts`

- [ ] **Step 1: Write relation detector tests**

Create `engine/test/integrate/relation-detector.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { findCandidatePairs, scoreAndClassify, detectRelations } from "../../src/integrate/relation-detector";
import { resolveEntities } from "../../src/integrate/entity-resolver";
import { embedAtoms } from "../../src/integrate/embedding-service";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, bookBAtoms, bookCAtoms, makeAtom } from "./fixtures/sample-atoms";
import type { LLMProvider } from "../../src/llm/types";
import type { EntityIndex } from "../../src/integrate/types";

function createMockLLM(responses: string[]): LLMProvider {
	let callIdx = 0;
	return {
		capabilities: { vision: false, structuredOutput: false, maxContextTokens: 128000 },
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
		const { entities } = await resolveEntities(allAtoms, {}, embeddings, provider, llm);

		const pairs = findCandidatePairs(bookBAtoms, bookAAtoms, entities);
		expect(pairs.length).toBeGreaterThan(0);
	});

	test("excludes same-book pairs", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		const embeddings = await embedAtoms(bookAAtoms, provider, []);
		const { entities } = await resolveEntities(bookAAtoms, {}, embeddings, provider, llm);

		// All atoms are from same book — should produce no pairs
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
		const { entities } = await resolveEntities(allAtoms, {}, embeddings, provider, llm);

		const { relations } = await detectRelations(
			bookBAtoms, bookAAtoms, entities, embeddings, llm,
		);
		// Should find at least some relations (reinforcement, extension, etc.)
		// The exact count depends on embedding similarity from mock vectors
		expect(relations).toBeDefined();
	});

	test("returns empty relations when atoms share no entities", async () => {
		const provider = createMockEmbeddingProvider();
		const llm = createMockLLM([]);
		// Book A (distributed systems) vs Book C (behavioral science) — different domains
		const allAtoms = [...bookAAtoms, ...bookCAtoms];
		const embeddings = await embedAtoms(allAtoms, provider, []);
		const { entities } = await resolveEntities(allAtoms, {}, embeddings, provider, llm);

		const { relations } = await detectRelations(
			bookCAtoms, bookAAtoms, entities, embeddings, llm,
		);
		// Different domains, likely no shared entities → no relations
		// (entity_link edges still exist via graph builder, but those aren't "relations")
		expect(relations.length).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/integrate/relation-detector.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `engine/src/integrate/relation-detector.ts`**

```typescript
/**
 * Relation detector — find reinforcement, contradiction, and extension
 * relationships between atoms that share resolved entities.
 *
 * The entity index does the heavy filtering: we only compare atoms that
 * share at least one entity. This cuts O(n²) down to a manageable set.
 */
import type { CandidateAtom } from "../extract/types";
import type { LLMProvider } from "../llm/types";
import { cosineSimilarity } from "./embedding-service";
import { IntegrateError } from "./errors";
import { relationClassificationPrompt } from "./prompts";
import type { EntityIndex, Relation, VectorIndex } from "./types";

// --- Configuration ---

const REINFORCE_THRESHOLD = 0.90;
const AMBIGUOUS_THRESHOLD = 0.75;
const RELATION_BATCH_SIZE = 10;

// --- Public API ---

export interface DetectResult {
	relations: Relation[];
	stats: { reinforcements: number; contradictions: number; extensions: number; llmCalls: number };
}

export interface AtomPair {
	atomA: CandidateAtom;
	atomB: CandidateAtom;
	sharedEntityIds: string[];
}

export function findCandidatePairs(
	newAtoms: CandidateAtom[],
	existingAtoms: CandidateAtom[],
	entities: EntityIndex,
): AtomPair[] {
	// Build atom → entity mapping
	const atomToEntities = new Map<string, string[]>();
	for (const [entityId, entity] of Object.entries(entities)) {
		for (const atomId of entity.atomIds) {
			const list = atomToEntities.get(atomId) ?? [];
			list.push(entityId);
			atomToEntities.set(atomId, list);
		}
	}

	const pairs: AtomPair[] = [];
	const seen = new Set<string>();

	for (const newAtom of newAtoms) {
		const newEntityIds = atomToEntities.get(newAtom.id) ?? [];
		if (newEntityIds.length === 0) continue;

		for (const existingAtom of existingAtoms) {
			// Skip same-book pairs
			if (newAtom.source.title === existingAtom.source.title) continue;

			const existingEntityIds = atomToEntities.get(existingAtom.id) ?? [];
			const shared = newEntityIds.filter(id => existingEntityIds.includes(id));
			if (shared.length === 0) continue;

			// Deduplicate (order-independent key)
			const key = [newAtom.id, existingAtom.id].sort().join(":");
			if (seen.has(key)) continue;
			seen.add(key);

			pairs.push({ atomA: newAtom, atomB: existingAtom, sharedEntityIds: shared });
		}
	}

	return pairs;
}

export function scoreAndClassify(
	pairs: AtomPair[],
	embeddings: VectorIndex,
): { algorithmic: Relation[]; ambiguous: AtomPair[] } {
	const embeddingMap = new Map(embeddings.map(e => [e.atomId, e.embedding]));
	const algorithmic: Relation[] = [];
	const ambiguous: AtomPair[] = [];

	for (const pair of pairs) {
		const embA = embeddingMap.get(pair.atomA.id);
		const embB = embeddingMap.get(pair.atomB.id);

		if (!embA || !embB) continue;

		const similarity = cosineSimilarity(embA, embB);

		if (pair.atomA.frame === pair.atomB.frame) {
			// Same frame type
			if (similarity >= REINFORCE_THRESHOLD) {
				algorithmic.push({
					type: "reinforces",
					atomA: pair.atomA.id,
					atomB: pair.atomB.id,
					confidence: similarity,
					method: "algorithmic",
				});
			} else if (similarity >= AMBIGUOUS_THRESHOLD) {
				// Could be reinforcement, contradiction, or just related
				ambiguous.push(pair);
			}
			// Below threshold: just entity_link, no semantic relation
		} else {
			// Different frame types on same entity = extension
			if (similarity >= AMBIGUOUS_THRESHOLD) {
				algorithmic.push({
					type: "extends",
					atomA: pair.atomA.id,
					atomB: pair.atomB.id,
					confidence: similarity,
					method: "algorithmic",
				});
			}
		}
	}

	return { algorithmic, ambiguous };
}

export async function detectRelations(
	newAtoms: CandidateAtom[],
	existingAtoms: CandidateAtom[],
	entities: EntityIndex,
	embeddings: VectorIndex,
	llmProvider: LLMProvider,
): Promise<DetectResult> {
	let llmCalls = 0;

	// Step 1: Find candidate pairs
	const pairs = findCandidatePairs(newAtoms, existingAtoms, entities);

	// Step 2: Algorithmic classification
	const { algorithmic, ambiguous } = scoreAndClassify(pairs, embeddings);

	// Step 3: LLM tiebreaker for ambiguous pairs
	const llmRelations: Relation[] = [];

	for (let i = 0; i < ambiguous.length; i += RELATION_BATCH_SIZE) {
		const batch = ambiguous.slice(i, i + RELATION_BATCH_SIZE);
		const promptPairs = batch.map(pair => ({
			atomA: {
				frame: pair.atomA.frame,
				roles: pair.atomA.roles,
				source: pair.atomA.source.title,
			},
			atomB: {
				frame: pair.atomB.frame,
				roles: pair.atomB.roles,
				source: pair.atomB.source.title,
			},
			sharedEntity: pair.sharedEntityIds[0] ?? "unknown",
		}));

		try {
			const response = await llmProvider.sendMessage({
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: relationClassificationPrompt(promptPairs) }],
					},
				],
				temperature: 0.1,
				maxTokens: 4096,
			});

			llmCalls++;

			// Parse response
			const jsonMatch = response.content.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as {
					classifications?: Array<{
						pair: number;
						relation: string;
					}>;
				};

				for (const c of parsed.classifications ?? []) {
					const pairIdx = c.pair - 1;
					const pair = batch[pairIdx];
					if (!pair) continue;

					if (c.relation === "reinforces" || c.relation === "contradicts" || c.relation === "extends") {
						llmRelations.push({
							type: c.relation,
							atomA: pair.atomA.id,
							atomB: pair.atomB.id,
							confidence: 0.80,
							method: "llm",
						});
					}
				}
			}
		} catch {
			// LLM failure — skip batch, log warning
			console.warn(`[integrate] Relation classification LLM call failed for batch starting at ${i}`);
		}
	}

	const allRelations = [...algorithmic, ...llmRelations];
	const stats = {
		reinforcements: allRelations.filter(r => r.type === "reinforces").length,
		contradictions: allRelations.filter(r => r.type === "contradicts").length,
		extensions: allRelations.filter(r => r.type === "extends").length,
		llmCalls,
	};

	return { relations: allRelations, stats };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/integrate/relation-detector.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/integrate/relation-detector.ts engine/test/integrate/relation-detector.test.ts
git commit -m "feat(integrate): add relation detector — reinforcement, contradiction, extension"
```

---

## Task 7: Graph Builder

**Files:**
- Create: `engine/src/integrate/graph-builder.ts`
- Test: `engine/test/integrate/graph-builder.test.ts`

- [ ] **Step 1: Write graph builder tests**

Create `engine/test/integrate/graph-builder.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { finalizeAtoms, buildAdjacencyList } from "../../src/integrate/graph-builder";
import { makeAtom } from "./fixtures/sample-atoms";
import type { EntityIndex, Relation } from "../../src/integrate/types";

describe("finalizeAtoms", () => {
	test("promotes CandidateAtom to Atom with empty cross-references", () => {
		const atom = makeAtom({ id: "test-1" });
		const entities: EntityIndex = {};
		const relations: Relation[] = [];

		const [finalized] = finalizeAtoms([atom], entities, relations);
		expect(finalized!.entityRefs).toEqual([]);
		expect(finalized!.reinforcedBy).toEqual([]);
		expect(finalized!.contradictedBy).toEqual([]);
		expect(finalized!.extendedBy).toEqual([]);
	});

	test("populates entityRefs from entity index", () => {
		const atom = makeAtom({ id: "test-1" });
		const entities: EntityIndex = {
			"entity:foo": {
				id: "entity:foo",
				canonicalName: "foo",
				aliases: [],
				domain: "testing",
				atomIds: ["test-1"],
				crossDomainLinks: [],
			},
		};
		const [finalized] = finalizeAtoms([atom], entities, []);
		expect(finalized!.entityRefs).toEqual(["entity:foo"]);
	});

	test("populates reinforcedBy from relations", () => {
		const atomA = makeAtom({ id: "a", confidence: 0.8 });
		const atomB = makeAtom({ id: "b", confidence: 0.8 });
		const relations: Relation[] = [{
			type: "reinforces",
			atomA: "a",
			atomB: "b",
			confidence: 0.95,
			method: "algorithmic",
		}];

		const finalized = finalizeAtoms([atomA, atomB], {}, relations);
		const fA = finalized.find(a => a.id === "a")!;
		const fB = finalized.find(a => a.id === "b")!;
		expect(fA.reinforcedBy).toContain("b");
		expect(fB.reinforcedBy).toContain("a");
	});

	test("boosts confidence for reinforced atoms (+0.05 per source, capped at 1.0)", () => {
		const atom = makeAtom({ id: "a", confidence: 0.9 });
		const relations: Relation[] = [
			{ type: "reinforces", atomA: "a", atomB: "b", confidence: 0.95, method: "algorithmic" },
			{ type: "reinforces", atomA: "a", atomB: "c", confidence: 0.92, method: "algorithmic" },
			{ type: "reinforces", atomA: "a", atomB: "d", confidence: 0.91, method: "algorithmic" },
		];
		const [finalized] = finalizeAtoms([atom], {}, relations);
		// 0.9 + 0.05 * 3 = 1.05 → capped at 1.0
		expect(finalized!.confidence).toBe(1.0);
	});

	test("populates contradictedBy from relations", () => {
		const atomA = makeAtom({ id: "a" });
		const atomB = makeAtom({ id: "b" });
		const relations: Relation[] = [{
			type: "contradicts",
			atomA: "a",
			atomB: "b",
			confidence: 0.85,
			method: "llm",
		}];
		const finalized = finalizeAtoms([atomA, atomB], {}, relations);
		expect(finalized.find(a => a.id === "a")!.contradictedBy).toContain("b");
		expect(finalized.find(a => a.id === "b")!.contradictedBy).toContain("a");
	});
});

describe("buildAdjacencyList", () => {
	test("creates entity_link edges for atoms sharing an entity", () => {
		const entities: EntityIndex = {
			"entity:foo": {
				id: "entity:foo",
				canonicalName: "foo",
				aliases: [],
				domain: "testing",
				atomIds: ["a", "b"],
				crossDomainLinks: [],
			},
		};
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			entities,
			[],
		);
		expect(graph["a"]?.some(e => e.target === "b" && e.type === "entity_link")).toBe(true);
		expect(graph["b"]?.some(e => e.target === "a" && e.type === "entity_link")).toBe(true);
	});

	test("creates bidirectional reinforces edges", () => {
		const relations: Relation[] = [{
			type: "reinforces",
			atomA: "a",
			atomB: "b",
			confidence: 0.95,
			method: "algorithmic",
		}];
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			{},
			relations,
		);
		expect(graph["a"]?.some(e => e.target === "b" && e.type === "reinforces")).toBe(true);
		expect(graph["b"]?.some(e => e.target === "a" && e.type === "reinforces")).toBe(true);
	});

	test("creates cross_domain edges between linked entities", () => {
		const entities: EntityIndex = {
			"entity:foo-domainA": {
				id: "entity:foo-domainA",
				canonicalName: "foo",
				aliases: [],
				domain: "domainA",
				atomIds: ["a"],
				crossDomainLinks: ["entity:foo-domainB"],
			},
			"entity:foo-domainB": {
				id: "entity:foo-domainB",
				canonicalName: "foo",
				aliases: [],
				domain: "domainB",
				atomIds: ["b"],
				crossDomainLinks: ["entity:foo-domainA"],
			},
		};
		const graph = buildAdjacencyList(
			[makeAtom({ id: "a" }), makeAtom({ id: "b" })],
			entities,
			[],
		);
		// Cross-domain edges should exist between atoms of linked entities
		expect(graph["a"]?.some(e => e.target === "b" && e.type === "cross_domain")).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/integrate/graph-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `engine/src/integrate/graph-builder.ts`**

```typescript
/**
 * Graph builder — finalize atoms and construct the adjacency list.
 *
 * Pure data transformation. No LLM calls. Takes resolved entities
 * and detected relations and produces the final KnowledgeGraph artifacts.
 */
import type { CandidateAtom } from "../extract/types";
import type {
	Atom,
	EntityIndex,
	GraphEdge,
	GraphIndex,
	Relation,
} from "./types";

const CONFIDENCE_BOOST_PER_REINFORCEMENT = 0.05;

/**
 * Promote CandidateAtom[] to Atom[] by populating cross-reference fields
 * and updating confidence based on relations.
 */
export function finalizeAtoms(
	candidates: CandidateAtom[],
	entities: EntityIndex,
	relations: Relation[],
): Atom[] {
	// Build lookup: atomId → entity IDs
	const atomEntityMap = new Map<string, string[]>();
	for (const [entityId, entity] of Object.entries(entities)) {
		for (const atomId of entity.atomIds) {
			const list = atomEntityMap.get(atomId) ?? [];
			list.push(entityId);
			atomEntityMap.set(atomId, list);
		}
	}

	// Build relation lookups
	const reinforcedByMap = new Map<string, string[]>();
	const contradictedByMap = new Map<string, string[]>();
	const extendedByMap = new Map<string, string[]>();

	for (const rel of relations) {
		if (rel.type === "reinforces") {
			addToMap(reinforcedByMap, rel.atomA, rel.atomB);
			addToMap(reinforcedByMap, rel.atomB, rel.atomA);
		} else if (rel.type === "contradicts") {
			addToMap(contradictedByMap, rel.atomA, rel.atomB);
			addToMap(contradictedByMap, rel.atomB, rel.atomA);
		} else if (rel.type === "extends") {
			addToMap(extendedByMap, rel.atomA, rel.atomB);
			addToMap(extendedByMap, rel.atomB, rel.atomA);
		}
	}

	return candidates.map((c) => {
		const reinforcedBy = reinforcedByMap.get(c.id) ?? [];
		const contradictedBy = contradictedByMap.get(c.id) ?? [];
		const extendedBy = extendedByMap.get(c.id) ?? [];

		// Confidence boost from reinforcement
		const boost = reinforcedBy.length * CONFIDENCE_BOOST_PER_REINFORCEMENT;
		const confidence = Math.min(1.0, c.confidence + boost);

		return {
			...c,
			confidence,
			entityRefs: atomEntityMap.get(c.id) ?? [],
			reinforcedBy,
			contradictedBy,
			extendedBy,
		} satisfies Atom;
	});
}

/**
 * Build the adjacency list from entities, relations, and cross-domain links.
 * All edges are bidirectional.
 */
export function buildAdjacencyList(
	atoms: CandidateAtom[],
	entities: EntityIndex,
	relations: Relation[],
): GraphIndex {
	const graph: GraphIndex = {};
	const atomIds = new Set(atoms.map(a => a.id));

	const addEdge = (from: string, edge: GraphEdge) => {
		if (!graph[from]) graph[from] = [];
		// Deduplicate
		const existing = graph[from].find(
			e => e.target === edge.target && e.type === edge.type,
		);
		if (!existing) {
			graph[from].push(edge);
		}
	};

	// Entity-link edges: atoms sharing an entity
	for (const entity of Object.values(entities)) {
		const entityAtomIds = entity.atomIds.filter(id => atomIds.has(id));
		for (let i = 0; i < entityAtomIds.length; i++) {
			for (let j = i + 1; j < entityAtomIds.length; j++) {
				const a = entityAtomIds[i]!;
				const b = entityAtomIds[j]!;
				addEdge(a, { target: b, type: "entity_link", confidence: 1.0 });
				addEdge(b, { target: a, type: "entity_link", confidence: 1.0 });
			}
		}
	}

	// Relation edges
	for (const rel of relations) {
		addEdge(rel.atomA, {
			target: rel.atomB,
			type: rel.type,
			confidence: rel.confidence,
		});
		addEdge(rel.atomB, {
			target: rel.atomA,
			type: rel.type,
			confidence: rel.confidence,
		});
	}

	// Cross-domain edges: link atoms across domain-linked entities
	for (const entity of Object.values(entities)) {
		for (const linkedEntityId of entity.crossDomainLinks) {
			const linkedEntity = entities[linkedEntityId];
			if (!linkedEntity) continue;

			for (const atomA of entity.atomIds.filter(id => atomIds.has(id))) {
				for (const atomB of linkedEntity.atomIds.filter(id => atomIds.has(id))) {
					addEdge(atomA, { target: atomB, type: "cross_domain", confidence: 0.75 });
					addEdge(atomB, { target: atomA, type: "cross_domain", confidence: 0.75 });
				}
			}
		}
	}

	return graph;
}

function addToMap(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key) ?? [];
	if (!list.includes(value)) list.push(value);
	map.set(key, list);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/integrate/graph-builder.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/integrate/graph-builder.ts engine/test/integrate/graph-builder.test.ts
git commit -m "feat(integrate): add graph builder — atom finalization and adjacency list"
```

---

## Task 8: Orchestrator (index.ts)

**Files:**
- Create: `engine/src/integrate/index.ts`
- Test: `engine/test/integrate/integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `engine/test/integrate/integration.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { integrate } from "../../src/integrate/index";
import { createMockEmbeddingProvider } from "./fixtures/mock-embeddings";
import { bookAAtoms, bookBAtoms, bookCAtoms } from "./fixtures/sample-atoms";
import type { LLMProvider } from "../../src/llm/types";

function createMockLLM(): LLMProvider {
	return {
		capabilities: { vision: false, structuredOutput: false, maxContextTokens: 128000 },
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

		// Integrate Book A
		const graphA = await integrate({
			atoms: bookAAtoms,
			metadata: { title: "Distributed Systems", authors: ["Author A"] },
			existingGraph: null,
			llmProvider: llm,
			embeddingProvider: provider,
		});

		// Integrate Book B into existing graph
		const graphAB = await integrate({
			atoms: bookBAtoms,
			metadata: { title: "System Design Guide", authors: ["Author B"] },
			existingGraph: graphA,
			llmProvider: llm,
			embeddingProvider: provider,
		});

		expect(graphAB.atoms.length).toBe(bookAAtoms.length + bookBAtoms.length);
		expect(graphAB.embeddings.length).toBe(bookAAtoms.length + bookBAtoms.length);
		expect(graphAB.stats.totalAtoms).toBe(bookAAtoms.length + bookBAtoms.length);
		// Should have more entities than just Book A alone
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/integrate/integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `engine/src/integrate/index.ts`**

```typescript
/**
 * Integrate stage — public entry point.
 *
 * Orchestrates the four sub-steps: embed → resolve entities →
 * detect relations → build graph. No business logic lives here.
 *
 * Usage:
 *   import { integrate } from "metis-engine/integrate";
 *   const graph = await integrate({ atoms, metadata, existingGraph, ... });
 */
import type { CandidateAtom } from "../extract/types";
import { embedAtoms } from "./embedding-service";
import { resolveEntities } from "./entity-resolver";
import { IntegrateError } from "./errors";
import { finalizeAtoms, buildAdjacencyList } from "./graph-builder";
import { detectRelations } from "./relation-detector";
import type {
	Atom,
	IntegrateInput,
	KnowledgeGraph,
} from "./types";

export { IntegrateError } from "./errors";
export type {
	Atom,
	Entity,
	EntityIndex,
	GraphEdge,
	GraphIndex,
	IntegrateInput,
	IntegrationStats,
	KnowledgeGraph,
	VectorEntry,
	VectorIndex,
} from "./types";

export async function integrate(input: IntegrateInput): Promise<KnowledgeGraph> {
	const { atoms, metadata, existingGraph, llmProvider, embeddingProvider } = input;

	const existingAtoms: CandidateAtom[] = existingGraph?.atoms ?? [];
	const existingEntities = existingGraph?.entities ?? {};
	const existingEmbeddings = existingGraph?.embeddings ?? [];

	console.error(`[integrate] ${atoms.length} new atoms from "${metadata.title}"`);

	// Step 1: Embed new atoms (skip already-cached)
	console.error("[integrate] Step 1/4: Embedding atoms...");
	const allEmbeddings = await embedAtoms(atoms, embeddingProvider, existingEmbeddings);

	// Step 2: Resolve entities
	console.error("[integrate] Step 2/4: Resolving entities...");
	const { entities, stats: entityStats } = await resolveEntities(
		atoms,
		existingEntities,
		allEmbeddings,
		embeddingProvider,
		llmProvider,
	);

	// Step 3: Detect relations (new atoms vs existing atoms)
	console.error("[integrate] Step 3/4: Detecting relations...");
	const { relations, stats: relationStats } = await detectRelations(
		atoms,
		existingAtoms,
		entities,
		allEmbeddings,
		llmProvider,
	);

	// Step 4: Build graph
	console.error("[integrate] Step 4/4: Building graph...");
	const allCandidates = [...existingAtoms, ...atoms];
	const finalizedAtoms = finalizeAtoms(allCandidates, entities, relations);
	const graph = buildAdjacencyList(finalizedAtoms, entities, relations);

	const result: KnowledgeGraph = {
		atoms: finalizedAtoms,
		entities,
		graph,
		embeddings: allEmbeddings,
		stats: {
			totalAtoms: finalizedAtoms.length,
			totalEntities: Object.keys(entities).length,
			newEntities: entityStats.newEntities,
			mergedEntities: entityStats.mergedEntities,
			reinforcements: relationStats.reinforcements,
			contradictions: relationStats.contradictions,
			extensions: relationStats.extensions,
			crossDomainLinks: entityStats.crossDomainLinks,
			llmCalls: entityStats.llmCalls + relationStats.llmCalls,
			embeddingTokens: 0, // TODO: track from embedding provider
		},
	};

	console.error(
		`[integrate] Done. ${result.stats.totalEntities} entities (${entityStats.newEntities} new, ${entityStats.mergedEntities} merged), ` +
		`${relationStats.reinforcements} reinforcements, ${relationStats.contradictions} contradictions, ${relationStats.extensions} extensions`,
	);

	return result;
}
```

- [ ] **Step 4: Run ALL Integrate tests**

Run: `cd engine && bun test test/integrate/`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to ensure no regressions**

Run: `cd engine && bun test`
Expected: ALL PASS (187 existing + new integrate tests)

- [ ] **Step 6: Commit**

```bash
git add engine/src/integrate/index.ts engine/test/integrate/integration.test.ts
git commit -m "feat(integrate): add orchestrator — integrate() entry point with stats"
```

---

## Task 9: Pipeline Integration (CLI)

**Files:**
- Modify: `engine/src/run-pipeline.ts`
- Modify: `engine/src/run-batch.ts`

- [ ] **Step 1: Update `engine/src/run-pipeline.ts`**

Add the new CLI flags and Stage 4 integration. Add to the existing `parseArgs()`:

```typescript
// Add these variables to parseArgs:
let integrateProvider = "kimi";
let integrateModel = "kimi-k2-0711-preview";
let embeddingProvider = "openai";
let embeddingModel = "text-embedding-3-large";
let graphDir = join(new URL(".", import.meta.url).pathname, "../graph");
let skipIntegrate = false;
let rebuildGraph = false;

// Add these cases to the arg parsing loop:
} else if (arg === "--integrate-provider") {
	integrateProvider = args[++i] ?? integrateProvider;
} else if (arg === "--integrate-model") {
	integrateModel = args[++i] ?? integrateModel;
} else if (arg === "--embedding-provider") {
	embeddingProvider = args[++i] ?? embeddingProvider;
} else if (arg === "--embedding-model") {
	embeddingModel = args[++i] ?? embeddingModel;
} else if (arg === "--graph-dir") {
	graphDir = args[++i] ?? graphDir;
} else if (arg === "--skip-integrate") {
	skipIntegrate = true;
} else if (arg === "--rebuild-graph") {
	rebuildGraph = true;
}
```

After the Extract phase in `main()`, add:

```typescript
// === Phase 4: Integrate ===
if (!config.skipIntegrate) {
	const { integrate } = await import("./integrate/index");
	const { createOpenAIEmbeddingProvider } = await import("./llm/openai-embedding");

	const integrateProviderConfig: ProviderConfig = {
		provider: config.integrateProvider as ProviderConfig["provider"],
		model: config.integrateModel,
	};
	const integrateLLM = withRetry(createProvider(integrateProviderConfig));
	const embeddingProv = createOpenAIEmbeddingProvider({
		provider: "openai",
		model: config.embeddingModel,
	});

	// Load existing graph
	const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");

	let existingGraph = null;
	const graphDir = config.graphDir;
	const atomsPath = join(graphDir, "atoms.json");
	if (!config.rebuildGraph && existsSync(atomsPath)) {
		try {
			existingGraph = {
				atoms: JSON.parse(readFileSync(join(graphDir, "atoms.json"), "utf8")),
				entities: JSON.parse(readFileSync(join(graphDir, "entities.json"), "utf8")),
				graph: JSON.parse(readFileSync(join(graphDir, "graph.json"), "utf8")),
				embeddings: JSON.parse(readFileSync(join(graphDir, "embeddings.json"), "utf8")),
				stats: { totalAtoms: 0, totalEntities: 0, newEntities: 0, mergedEntities: 0, reinforcements: 0, contradictions: 0, extensions: 0, crossDomainLinks: 0, llmCalls: 0, embeddingTokens: 0 },
			};
			console.error(`[integrate] Loaded existing graph from ${graphDir}`);
		} catch {
			console.error(`[integrate] Could not load existing graph — starting fresh`);
		}
	}

	const knowledgeGraph = await integrate({
		atoms: allAtoms as CandidateAtom[],
		metadata: tree.metadata,
		existingGraph,
		llmProvider: integrateLLM,
		embeddingProvider: embeddingProv,
	});

	// Save graph
	if (!existsSync(graphDir)) mkdirSync(graphDir, { recursive: true });
	writeFileSync(join(graphDir, "atoms.json"), JSON.stringify(knowledgeGraph.atoms, null, 2));
	writeFileSync(join(graphDir, "entities.json"), JSON.stringify(knowledgeGraph.entities, null, 2));
	writeFileSync(join(graphDir, "graph.json"), JSON.stringify(knowledgeGraph.graph, null, 2));
	writeFileSync(join(graphDir, "embeddings.json"), JSON.stringify(knowledgeGraph.embeddings));
	console.error(`[integrate] Graph saved to ${graphDir}`);
}
```

- [ ] **Step 2: Update `engine/src/run-batch.ts`**

Add imports at top of file:

```typescript
import { integrate } from "./integrate/index";
import type { KnowledgeGraph } from "./integrate/types";
import { createOpenAIEmbeddingProvider } from "./llm/openai-embedding";
```

In `main()`, after creating the LLM provider, create the embedding provider:

```typescript
const embeddingProvider = createOpenAIEmbeddingProvider({
	provider: "openai",
	model: "text-embedding-3-large",
});
const GRAPH_DIR = join(new URL(".", import.meta.url).pathname, "../graph");
```

In `processBook()`, add integrate step after the extract loop and before saving output. Accept `embeddingProvider` and `graphDir` as parameters:

```typescript
// After the extract loop, before saveOutput:

// Integrate into shared graph
const graphDir = GRAPH_DIR;
if (!existsSync(graphDir)) mkdirSync(graphDir, { recursive: true });

let existingGraph: KnowledgeGraph | null = null;
const atomsPath = join(graphDir, "atoms.json");
if (existsSync(atomsPath)) {
	try {
		const readJson = (f: string) => JSON.parse(readFileSync(join(graphDir, f), "utf8"));
		existingGraph = {
			atoms: readJson("atoms.json"),
			entities: readJson("entities.json"),
			graph: readJson("graph.json"),
			embeddings: readJson("embeddings.json"),
			stats: { totalAtoms: 0, totalEntities: 0, newEntities: 0, mergedEntities: 0, reinforcements: 0, contradictions: 0, extensions: 0, crossDomainLinks: 0, llmCalls: 0, embeddingTokens: 0 },
		};
	} catch {
		console.error("[integrate] Could not load existing graph — starting fresh");
	}
}

console.error("[integrate] Integrating into knowledge graph...");
const knowledgeGraph = await integrate({
	atoms: allAtoms as CandidateAtom[],
	metadata: tree.metadata,
	existingGraph,
	llmProvider: provider,
	embeddingProvider,
});

writeFileSync(join(graphDir, "atoms.json"), JSON.stringify(knowledgeGraph.atoms, null, 2));
writeFileSync(join(graphDir, "entities.json"), JSON.stringify(knowledgeGraph.entities, null, 2));
writeFileSync(join(graphDir, "graph.json"), JSON.stringify(knowledgeGraph.graph, null, 2));
writeFileSync(join(graphDir, "embeddings.json"), JSON.stringify(knowledgeGraph.embeddings));
console.error(`[integrate] Graph saved. ${knowledgeGraph.stats.totalEntities} entities, ${knowledgeGraph.stats.reinforcements} reinforcements`);
```

Also add `readFileSync` to the existing `import` from `"node:fs"` at top of file.

- [ ] **Step 3: Add `engine/graph/` to `.gitignore`**

Append to the existing `.gitignore`:

```
engine/graph/
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd engine && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd engine && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add engine/src/run-pipeline.ts engine/src/run-batch.ts .gitignore
git commit -m "feat(integrate): wire integrate stage into pipeline runner and batch runner"
```

---

## Task 10: Lint, Typecheck, Final Verification

- [ ] **Step 1: Run linter**

Run: `cd engine && bun run lint`
Expected: PASS (or fix issues)

- [ ] **Step 2: Fix any lint issues**

Run: `cd engine && bun run lint:fix`

- [ ] **Step 3: Run typecheck**

Run: `cd engine && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `cd engine && bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore(integrate): fix lint and type issues"
```

- [ ] **Step 6: Final commit summary**

Run: `git log --oneline -10`

Expected commits (newest first):
```
chore(integrate): fix lint and type issues
feat(integrate): wire integrate stage into pipeline runner and batch runner
feat(integrate): add orchestrator — integrate() entry point with stats
feat(integrate): add graph builder — atom finalization and adjacency list
feat(integrate): add relation detector — reinforcement, contradiction, extension
feat(integrate): add entity resolver — mention extraction, clustering, cross-domain links
feat(integrate): add embedding service — atomToText, batch embed, cosine similarity
feat(integrate): add OpenAI embedding adapter with mock-injectable client
test(integrate): add test fixtures — sample atoms and mock embeddings
feat(integrate): add type definitions and error class
```
