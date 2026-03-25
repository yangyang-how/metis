import type { NormalizedSection, SectionAnalysis } from "../comprehend/types";
/**
 * Section extractor — one LLM call per section.
 *
 * Takes a section + its SectionAnalysis context, calls the cheap model,
 * parses the response into CandidateAtoms. Inner retry loop for JSON
 * parsing failures (separate from provider-level retry for network errors).
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import { buildExtractionPrompt, getExtractionResponseSchema } from "./prompts";
import type {
	CandidateAtom,
	FrameTypeRegistry,
	ProposedFrameType,
} from "./types";
import { bookSlug } from "./types";

const MAX_PARSE_RETRIES = 2;

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
			const response = await provider.sendMessage({
				messages,
				responseSchema: getExtractionResponseSchema(),
				temperature: 0.2,
				maxTokens: 4096,
			});

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
					usage: { inputTokens: totalInput, outputTokens: totalOutput },
					failed: false,
				};
			}
			// Invalid JSON — retry
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

		// Normalize field names
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
			chapterId: "", // filled by orchestrator
			sectionId: section.id,
		},
		domain: raw.domain ?? [],
		examples: raw.examples ?? [],
		flags: [],
	};
}
