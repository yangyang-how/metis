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
