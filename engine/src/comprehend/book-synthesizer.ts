/**
 * Book synthesizer — one LLM call for the whole book.
 *
 * Reads chapter maps (NOT raw content) and produces cross-cutting
 * themes and entity index. This is cheap because maps are compact.
 *
 * If this fails, it's not critical — chapter maps are the primary
 * output. Synthesis is valuable but optional.
 */
import type { LLMProvider } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import { buildSynthesisPrompt, getBookSynthesisSchema } from "./prompts";
import type { BookSynthesis, ComprehensionMap } from "./types";

export interface BookSynthesisResult {
	synthesis: BookSynthesis;
	usage: { inputTokens: number; outputTokens: number };
	failed: boolean;
}

const EMPTY_SYNTHESIS: BookSynthesis = {
	crossCuttingThemes: [],
	entityIndex: [],
	bookType: "unknown",
};

export async function synthesizeBook(
	chapterMaps: ComprehensionMap[],
	bookMetadata: DocumentMetadata,
	provider: LLMProvider,
): Promise<BookSynthesisResult> {
	try {
		const messages = buildSynthesisPrompt(chapterMaps, bookMetadata);
		const response = await provider.sendMessage({
			messages,
			responseSchema: getBookSynthesisSchema(),
			temperature: 0.2,
			maxTokens: 4096,
		});

		const parsed = parseResponse(response.content);

		return {
			synthesis: parsed ?? EMPTY_SYNTHESIS,
			usage: {
				inputTokens: response.usage.inputTokens,
				outputTokens: response.usage.outputTokens,
			},
			failed: !parsed,
		};
	} catch {
		return {
			synthesis: EMPTY_SYNTHESIS,
			usage: { inputTokens: 0, outputTokens: 0 },
			failed: true,
		};
	}
}

function parseResponse(content: string): BookSynthesis | null {
	try {
		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		const raw = JSON.parse(cleaned);

		// Normalize field names — models use snake_case despite instructions
		const themes = raw.crossCuttingThemes ?? raw.cross_cutting_themes;
		const entities = raw.entityIndex ?? raw.entity_index;

		if (!Array.isArray(themes) || !Array.isArray(entities)) {
			return null;
		}

		return {
			crossCuttingThemes: themes.map((t: Record<string, unknown>) => ({
				name: String(t.name ?? ""),
				description: String(t.description ?? ""),
				chapterIds: (t.chapterIds ??
					t.chapter_ids ??
					t.chapters ??
					[]) as string[],
			})),
			entityIndex: entities.map((e: Record<string, unknown>) => ({
				name: String(e.name ?? ""),
				aliases: (e.aliases ?? []) as string[],
				chapterIds: (e.chapterIds ??
					e.chapter_ids ??
					e.chapters ??
					[]) as string[],
			})),
			bookType: String(raw.bookType ?? raw.book_type ?? "unknown"),
		};
	} catch {
		return null;
	}
}
