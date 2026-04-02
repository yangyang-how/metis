import type { ComprehensionMap, NormalizedChapter } from "../comprehend/types";
/**
 * Extract stage types — candidate atoms, frame types, and the registry.
 *
 * CandidateAtom is "candidate" because these aren't final — the Integrate
 * stage validates and merges them into the knowledge graph.
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";

// --- Input/Output ---

export interface ExtractInput {
	chapter: NormalizedChapter;
	comprehensionMap: ComprehensionMap;
	bookMetadata: DocumentMetadata;
	registry: FrameTypeRegistry;
	provider: LLMProvider;
}

export interface ExtractionResult {
	atoms: CandidateAtom[];
	proposedFrameTypes: ProposedFrameType[];
	usage: {
		inputTokens: number;
		outputTokens: number;
		callCount: number;
	};
	skippedSections: string[];
	flaggedAtoms: string[];
}

// --- Candidate Atom ---

export interface CandidateAtom {
	id: string;
	frame: string;
	roles: Record<string, string>;
	conditions: string[];
	confidence: number;
	source: {
		title: string;
		authors: string[];
		chapterId: string;
		sectionId: string;
	};
	domain: string[];
	examples: string[];
	flags: string[];
}

// --- Frame Type Registry ---

export interface FrameTypeRegistry {
	get(name: string): FrameType | undefined;
	getAll(): FrameType[];
	getCoreTypes(): FrameType[];
	register(proposed: ProposedFrameType): FrameType;
	has(name: string): boolean;
}

export interface FrameType {
	name: string;
	roles: Record<string, string>;
	requiredRoles: string[];
	description: string;
	category: "core" | "domain-specific";
	domain?: string;
	version: number;
}

export interface ProposedFrameType {
	name: string;
	roles: Record<string, string>;
	description: string;
	proposedBy: string;
}

// --- Helpers ---

/**
 * Generate a book slug for deterministic atom IDs.
 * kebab-case of the title, truncated to 40 chars.
 */
export function bookSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}
