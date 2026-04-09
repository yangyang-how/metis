// engine/src/apply/understand.ts
/**
 * Stage 1: Query Understanding.
 *
 * Maps a natural language query to a structured QueryPlan using an LLM.
 * The LLM is constrained by the graph's inventory — it can only target
 * domains, entities, and frame types that exist.
 */
import type { LLMProvider } from "../llm/types";
import { ApplyError } from "./errors";
import { buildUnderstandPrompt, getQueryPlanSchema } from "./prompts";
import type {
	GraphInventory,
	GroupingStrategy,
	QueryInput,
	QueryPlan,
} from "./types";

export async function understand(
	input: QueryInput,
	inventory: GraphInventory,
	provider: LLMProvider,
): Promise<QueryPlan> {
	const messages = buildUnderstandPrompt(input, inventory);

	try {
		const response = await provider.sendMessage({
			messages,
			responseSchema: getQueryPlanSchema(),
			maxTokens: 1024,
			temperature: 0.1,
		});

		const raw = JSON.parse(response.content) as Record<string, unknown>;
		return normalizeQueryPlan(raw);
	} catch (error) {
		throw new ApplyError(
			"understand",
			`Failed to generate query plan: ${error instanceof Error ? error.message : String(error)}`,
			error instanceof Error ? error : undefined,
		);
	}
}

export function normalizeQueryPlan(raw: Record<string, unknown>): QueryPlan {
	const weights = raw.weights as Record<string, unknown> | undefined;

	return {
		intent: getString(raw, "intent"),
		analysisType: getString(raw, "analysisType", "analysis_type"),
		targetDomains: getStringArray(raw, "targetDomains", "target_domains"),
		targetFrameTypes: getStringArray(
			raw,
			"targetFrameTypes",
			"target_frame_types",
		),
		targetEntities: getStringArray(raw, "targetEntities", "target_entities"),
		weights: {
			domainMatch: getNumber(weights ?? {}, "domainMatch", "domain_match"),
			frameTypeMatch: getNumber(
				weights ?? {},
				"frameTypeMatch",
				"frame_type_match",
			),
			entityMatch: getNumber(weights ?? {}, "entityMatch", "entity_match"),
		},
		groupingStrategy: getGroupingStrategy(raw),
	};
}

function getString(obj: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		if (typeof obj[key] === "string") return obj[key] as string;
	}
	return "";
}

function getStringArray(
	obj: Record<string, unknown>,
	...keys: string[]
): string[] {
	for (const key of keys) {
		if (Array.isArray(obj[key])) return obj[key] as string[];
	}
	return [];
}

function getNumber(obj: Record<string, unknown>, ...keys: string[]): number {
	for (const key of keys) {
		if (typeof obj[key] === "number") return obj[key] as number;
	}
	return 0.5;
}

function getGroupingStrategy(raw: Record<string, unknown>): GroupingStrategy {
	const value = getString(raw, "groupingStrategy", "grouping_strategy");
	if (value === "entity" || value === "domain" || value === "frame-type") {
		return value;
	}
	return "entity"; // default
}
