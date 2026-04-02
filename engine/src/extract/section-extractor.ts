import { estimateTokens } from "../comprehend/token-estimator";
import type { NormalizedSection, SectionAnalysis } from "../comprehend/types";
/**
 * Section extractor — one LLM call per section (or split if too large).
 *
 * Takes a section + its SectionAnalysis context, calls the cheap model,
 * parses the response into CandidateAtoms. For large sections, splits
 * content into smaller chunks to avoid reasoning model truncation.
 *
 * Inner retry loop for JSON parsing failures (separate from provider-level
 * retry for network errors).
 */
import type { LLMProvider } from "../llm/types";
import type { ContentBlock } from "../parse/types";
import type { DocumentMetadata } from "../parse/types";
import { buildExtractionPrompt, getExtractionResponseSchema } from "./prompts";
import type {
	CandidateAtom,
	FrameTypeRegistry,
	ProposedFrameType,
} from "./types";
import { bookSlug } from "./types";

const MAX_PARSE_RETRIES = 2;
// Max content tokens per extraction call — keep small for reasoning models
const MAX_SECTION_TOKENS = 3000;

export interface SectionExtractionResult {
	atoms: CandidateAtom[];
	proposedFrameTypes: ProposedFrameType[];
	usage: { inputTokens: number; outputTokens: number };
	failed: boolean;
}

export async function extractSection(
	section: NormalizedSection,
	sectionAnalysis: SectionAnalysis,
	registry: FrameTypeRegistry,
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<SectionExtractionResult> {
	// Estimate section content tokens
	const contentText = section.content
		.filter((b): b is ContentBlock & { text: string } => "text" in b)
		.map((b) => b.text)
		.join(" ");
	const contentTokens = estimateTokens(contentText);

	// If section is too large, split into chunks and extract each
	if (contentTokens > MAX_SECTION_TOKENS && section.content.length > 3) {
		return extractLargeSection(
			section,
			sectionAnalysis,
			registry,
			bookMetadata,
			provider,
		);
	}

	return extractSingleSection(
		section,
		sectionAnalysis,
		registry,
		bookMetadata,
		provider,
	);
}

/**
 * Split a large section's content into smaller chunks, extract each
 * separately, then merge all atoms.
 */
async function extractLargeSection(
	section: NormalizedSection,
	sectionAnalysis: SectionAnalysis,
	registry: FrameTypeRegistry,
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<SectionExtractionResult> {
	const chunks = splitContent(section.content);
	console.error(
		`      [split-extract] Section "${section.title.slice(0, 30)}" too large, split into ${chunks.length} chunks`,
	);

	const allAtoms: CandidateAtom[] = [];
	const allProposed: ProposedFrameType[] = [];
	let totalInput = 0;
	let totalOutput = 0;
	let anySucceeded = false;

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		if (!chunk || chunk.length === 0) continue;

		// Create a sub-section with this chunk's content
		const subSection: NormalizedSection = {
			id: `${section.id}-chunk${i}`,
			title: `${section.title} (part ${i + 1})`,
			level: section.level,
			content: chunk,
			sections: [],
		};

		const result = await extractSingleSection(
			subSection,
			sectionAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		totalInput += result.usage.inputTokens;
		totalOutput += result.usage.outputTokens;

		if (!result.failed) {
			// Fix IDs to use original section ID
			for (const atom of result.atoms) {
				atom.source.sectionId = section.id;
				atom.id = atom.id.replace(`-chunk${i}`, "");
			}
			allAtoms.push(...result.atoms);
			allProposed.push(...result.proposedFrameTypes);
			anySucceeded = true;
		}
	}

	return {
		atoms: allAtoms,
		proposedFrameTypes: allProposed,
		usage: { inputTokens: totalInput, outputTokens: totalOutput },
		failed: !anySucceeded,
	};
}

/**
 * Split content blocks into chunks, each under the token budget.
 * Splits at paragraph boundaries.
 */
function splitContent(blocks: ContentBlock[]): ContentBlock[][] {
	const chunks: ContentBlock[][] = [];
	let currentChunk: ContentBlock[] = [];
	let currentTokens = 0;

	for (const block of blocks) {
		const blockText =
			"text" in block ? String((block as { text: string }).text) : "";
		const blockTokens = estimateTokens(blockText);

		if (
			currentTokens + blockTokens > MAX_SECTION_TOKENS &&
			currentChunk.length > 0
		) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentTokens = 0;
		}

		currentChunk.push(block);
		currentTokens += blockTokens;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	return chunks;
}

async function extractSingleSection(
	section: NormalizedSection,
	sectionAnalysis: SectionAnalysis,
	registry: FrameTypeRegistry,
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<SectionExtractionResult> {
	const messages = buildExtractionPrompt(
		section,
		sectionAnalysis,
		registry,
		bookMetadata,
	);

	let totalInput = 0;
	let totalOutput = 0;

	for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
		try {
			const response = await withTimeout(
				provider.sendMessage({
					messages,
					responseSchema: getExtractionResponseSchema(),
					temperature: 0.2,
					maxTokens: 16384,
				}),
				120_000,
			);

			totalInput += response.usage.inputTokens;
			totalOutput += response.usage.outputTokens;

			const parsed = parseResponse(response.content);
			if (parsed) {
				const slug = bookSlug(bookMetadata.title);
				const atoms = parsed.atoms.map((raw, index) =>
					toCandidate(raw, slug, section, bookMetadata, index),
				);

				return {
					atoms,
					proposedFrameTypes: parsed.proposedFrameTypes,
					usage: {
						inputTokens: totalInput,
						outputTokens: totalOutput,
					},
					failed: false,
				};
			}
		} catch {
			break;
		}
	}

	return {
		atoms: [],
		proposedFrameTypes: [],
		usage: { inputTokens: totalInput, outputTokens: totalOutput },
		failed: true,
	};
}

interface RawAtom {
	frame: string;
	roles: Record<string, string>;
	conditions?: string[];
	confidence?: number;
	domain?: string[];
	examples?: string[];
}

interface ParsedResponse {
	atoms: RawAtom[];
	proposedFrameTypes: ProposedFrameType[];
}

function parseResponse(content: string): ParsedResponse | null {
	try {
		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		const raw = JSON.parse(cleaned);

		const atoms = raw.atoms ?? raw.Atoms ?? [];
		const proposedFrameTypes =
			raw.proposedFrameTypes ?? raw.proposed_frame_types ?? [];

		if (!Array.isArray(atoms)) return null;

		return {
			atoms: atoms.filter(
				(a: Record<string, unknown>) => a.frame && a.roles,
			) as RawAtom[],
			proposedFrameTypes: (Array.isArray(proposedFrameTypes)
				? proposedFrameTypes
				: []
			).filter(
				(p: Record<string, unknown>) => p.name && p.roles && p.description,
			) as ProposedFrameType[],
		};
	} catch {
		return null;
	}
}

function toCandidate(
	raw: RawAtom,
	slug: string,
	section: NormalizedSection,
	bookMetadata: DocumentMetadata,
	index: number,
): CandidateAtom {
	return {
		id: `${slug}-${section.id}-${index}`,
		frame: raw.frame,
		roles: raw.roles,
		conditions: raw.conditions ?? [],
		confidence: raw.confidence ?? 0.5,
		source: {
			title: bookMetadata.title,
			authors: bookMetadata.authors,
			chapterId: "",
			sectionId: section.id,
		},
		domain: raw.domain ?? [],
		examples: raw.examples ?? [],
		flags: [],
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
		),
	]);
}
