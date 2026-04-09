// engine/src/apply/prompts.ts
/**
 * LLM prompts for the Apply pipeline.
 * - Query Understanding: query + inventory → QueryPlan
 * - Section Summary: atoms → 2-3 sentence summary
 */
import type { Message } from "../llm/types";
import type { GraphInventory, QueryInput } from "./types";

export function buildUnderstandPrompt(
	input: QueryInput,
	inventory: GraphInventory,
): Message[] {
	const systemPrompt = `You are a query planner for a knowledge retrieval system. Given a user's question and an inventory of available knowledge, produce a structured query plan.

You will receive:
- The user's question
- An inventory of available domains, entities, and frame types with their counts

Respond with a JSON object using EXACTLY these field names (camelCase):

{
  "intent": "<what the user is trying to do>",
  "analysisType": "<type of analysis needed>",
  "targetDomains": ["<domain1>", "<domain2>"],
  "targetFrameTypes": ["<frameType1>", "<frameType2>"],
  "targetEntities": ["<entity1>", "<entity2>"],
  "weights": {
    "domainMatch": 0.0-1.0,
    "frameTypeMatch": 0.0-1.0,
    "entityMatch": 0.0-1.0
  },
  "groupingStrategy": "entity" | "domain" | "frame-type"
}

Rules:
1. Only use domains, entities, and frame types from the inventory. Do NOT invent domains or entities that don't exist.
2. Select 1-5 target domains (most relevant to the question).
3. Select 2-6 target frame types based on what the question needs:
   - "How do I..." → procedure, heuristic
   - "What is..." → definition, has_property
   - "Compare..." → method_comparison, evaluation_matrix
   - "Why does..." → causal, causal_chain
   - "Evaluate..." → evaluation_matrix, heuristic, principle
   - "What are the risks..." → deviation, threshold
4. Select 2-8 target entities (concepts the question is about).
5. Set weights based on query specificity:
   - Broad questions → higher domainMatch (cast a wide net)
   - Specific questions → higher entityMatch (precise retrieval)
   - "How to" questions → higher frameTypeMatch (method-focused)
6. Set groupingStrategy:
   - "What is X?" / entity-focused → "entity"
   - "What about topic Y?" / domain-focused → "domain"
   - "How do I X?" / method-focused → "frame-type"
   - Ambiguous → "entity"

IMPORTANT: Use camelCase field names exactly as shown. Do NOT use snake_case. Respond with valid JSON only.`;

	const domainsSection = inventory.domains
		.map((d) => `  ${d.name} (${d.atomCount} atoms)`)
		.join("\n");

	const entitiesSection = inventory.entities
		.map(
			(e) =>
				`  ${e.name}${e.aliases.length > 0 ? ` [aliases: ${e.aliases.join(", ")}]` : ""} — domain: ${e.domain}`,
		)
		.join("\n");

	const frameTypesSection = inventory.frameTypes
		.map((f) => `  ${f.name} (${f.count} atoms)`)
		.join("\n");

	let scopeConstraints = "";
	if (input.scope) {
		const parts: string[] = [];
		if (input.scope.domains?.length)
			parts.push(`Limit to domains: ${input.scope.domains.join(", ")}`);
		if (input.scope.sources?.length)
			parts.push(`Limit to sources: ${input.scope.sources.join(", ")}`);
		if (input.scope.frameTypes?.length)
			parts.push(`Limit to frame types: ${input.scope.frameTypes.join(", ")}`);
		if (parts.length > 0) scopeConstraints = `\n${parts.join("\n")}\n`;
	}

	const userPrompt = `Question: "${input.query}"
${scopeConstraints}
--- Available Knowledge Inventory ---

Domains (${inventory.domains.length} total):
${domainsSection}

Entities (${inventory.entities.length} total):
${entitiesSection}

Frame Types (${inventory.frameTypes.length} total):
${frameTypesSection}`;

	return [
		{ role: "system", content: [{ type: "text", text: systemPrompt }] },
		{ role: "user", content: [{ type: "text", text: userPrompt }] },
	];
}

export function buildSummaryPrompt(
	topic: string,
	query: string,
	atomContents: string[],
): Message[] {
	const systemPrompt =
		"You are summarizing a group of knowledge atoms for a human reader. Write 2-3 sentences that capture the key insights. Be specific — reference concrete claims, not vague generalities.";

	const atomList = atomContents.map((c) => `- ${c}`).join("\n");

	const userPrompt = `Topic: "${topic}"
Query context: "${query}"

Atoms:
${atomList}

Summarize these atoms in 2-3 sentences.`;

	return [
		{ role: "system", content: [{ type: "text", text: systemPrompt }] },
		{ role: "user", content: [{ type: "text", text: userPrompt }] },
	];
}

export function getQueryPlanSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			intent: { type: "string" },
			analysisType: { type: "string" },
			targetDomains: { type: "array", items: { type: "string" } },
			targetFrameTypes: { type: "array", items: { type: "string" } },
			targetEntities: { type: "array", items: { type: "string" } },
			weights: {
				type: "object",
				properties: {
					domainMatch: { type: "number" },
					frameTypeMatch: { type: "number" },
					entityMatch: { type: "number" },
				},
				required: ["domainMatch", "frameTypeMatch", "entityMatch"],
			},
			groupingStrategy: {
				type: "string",
				enum: ["entity", "domain", "frame-type"],
			},
		},
		required: [
			"intent",
			"analysisType",
			"targetDomains",
			"targetFrameTypes",
			"targetEntities",
			"weights",
			"groupingStrategy",
		],
	};
}
