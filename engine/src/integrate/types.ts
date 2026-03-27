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
