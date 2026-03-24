import type { ProviderConfig } from "../llm/types";
/**
 * Comprehend stage types — the contract between Comprehend and Extract.
 *
 * ComprehensionMap tells the Extract stage what kind of knowledge exists
 * in each section and how it's organized. NormalizedChapter is the
 * cleaned-up version of Parse's Chapter, with structure inferred from
 * headings when the EPUB nav is flat or broken.
 */
import type {
	ContentBlock,
	DocumentMetadata,
	DocumentTree,
} from "../parse/types";

// --- Input/Output ---

export interface ComprehendInput {
	documentTree: DocumentTree;
	providerConfig: ProviderConfig;
}

export interface ComprehensionResult {
	bookSynthesis: BookSynthesis;
	chapterMaps: ComprehensionMap[];
	usage: {
		totalInputTokens: number;
		totalOutputTokens: number;
		callCount: number;
		failedChapters: string[];
	};
}

// --- Chapter Comprehension Map ---

export type ChapterType =
	| "framework"
	| "survey"
	| "argumentative"
	| "narrative"
	| "practical"
	| "unknown";

export interface ComprehensionMap {
	chapterId: string;
	chapterType: ChapterType;
	summary: string;
	structures: KnowledgeStructure[];
	sectionAnalyses: SectionAnalysis[];
}

export type KnowledgeStructureType =
	| "model"
	| "comparison"
	| "taxonomy"
	| "progression"
	| "process"
	| "debate";

export interface KnowledgeStructure {
	name: string;
	type: KnowledgeStructureType;
	components: string[];
	sectionIds: string[];
}

export interface SectionAnalysis {
	sectionId: string;
	title: string;
	purpose: string;
	knowledgeTypes: string[];
	conceptsIntroduced: string[];
	conceptsReferenced: string[];
	buildsOn: string[];
	significance: string;
}

// --- Book Synthesis ---

export interface BookSynthesis {
	crossCuttingThemes: Theme[];
	entityIndex: EntityEntry[];
	bookType: string;
}

export interface Theme {
	name: string;
	description: string;
	chapterIds: string[];
}

export interface EntityEntry {
	name: string;
	aliases: string[];
	chapterIds: string[];
}

// --- Normalized Chapter (from structure inference) ---

export interface NormalizedChapter {
	id: string;
	title: string;
	order: number;
	sections: NormalizedSection[];
	metadata: ChapterMetadata;
}

export interface NormalizedSection {
	id: string;
	title: string;
	level: number;
	content: ContentBlock[];
	sections: NormalizedSection[];
}

export interface ChapterMetadata {
	totalBlockCount: number;
	hasImages: boolean;
	estimatedTokens: number;
}
