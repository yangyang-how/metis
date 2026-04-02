import { serializeBlocks } from "../comprehend/serialize";
import type { NormalizedSection, SectionAnalysis } from "../comprehend/types";
/**
 * Extraction prompt templates.
 *
 * Separated from pipeline logic for independent iteration.
 * The system prompt includes ALL frame type schemas so the cheap
 * model knows exactly what shapes to produce.
 */
import type { Message } from "../llm/types";
import type { DocumentMetadata } from "../parse/types";
import type { FrameType, FrameTypeRegistry } from "./types";

export function buildExtractionPrompt(
	section: NormalizedSection,
	sectionAnalysis: SectionAnalysis,
	registry: FrameTypeRegistry,
	bookMetadata: DocumentMetadata,
): Message[] {
	const frameTypeRef = buildFrameTypeReference(registry);
	const sectionContent = serializeBlocks(section.content)
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");

	const systemMessage: Message = {
		role: "system",
		content: [
			{
				type: "text",
				text: `You are a knowledge extractor. Given a section of a book, produce atomic knowledge units (atoms) as JSON.

Each atom represents one piece of knowledge using a frame type with named roles.

## Available Frame Types

${frameTypeRef}

## Output Format

Respond with a JSON object using EXACTLY these field names (camelCase):

{
  "atoms": [
    {
      "frame": "<frame type name from the list above>",
      "roles": { "<role_name>": "<value>", ... },
      "conditions": ["<when this knowledge applies>"],
      "confidence": 0.0-1.0,
      "domain": ["<topic tags>"],
      "examples": ["<optional illustrative examples>"]
    }
  ],
  "proposedFrameTypes": [
    {
      "name": "<new_type_name>",
      "roles": { "<role1>": "<description>", "<role2>": "<description>" },
      "description": "<what this type represents>"
    }
  ]
}

## Rules

1. Each atom captures ONE piece of knowledge (not compound claims).
2. Use the most specific frame type that fits. Don't force everything into "definition".
3. Fill all roles for the frame type. If a role doesn't apply, omit it.
4. Set confidence based on how clearly the source states this knowledge (1.0 = explicit, 0.5 = implied).
5. If knowledge doesn't fit any existing frame type, propose a new one in proposedFrameTypes.
6. proposedFrameTypes is optional — only include it if you actually propose new types.

IMPORTANT: Use camelCase field names exactly as shown. Do NOT use snake_case.
Respond with valid JSON only. No markdown code fences. No explanation outside the JSON.`,
			},
		],
	};

	const userMessage: Message = {
		role: "user",
		content: [
			{
				type: "text",
				text: `Book: "${bookMetadata.title}" by ${bookMetadata.authors.join(", ")}
Section: "${sectionAnalysis.title}" (id: ${sectionAnalysis.sectionId})

## Comprehension Context (what to look for)
- Purpose: ${sectionAnalysis.purpose}
- Knowledge types expected: ${sectionAnalysis.knowledgeTypes.join(", ")}
- Concepts introduced: ${sectionAnalysis.conceptsIntroduced.join(", ") || "none"}
- Concepts referenced: ${sectionAnalysis.conceptsReferenced.join(", ") || "none"}
- Significance: ${sectionAnalysis.significance}

## Section Content

${sectionContent}`,
			},
		],
	};

	return [systemMessage, userMessage];
}

function buildFrameTypeReference(registry: FrameTypeRegistry): string {
	return registry
		.getAll()
		.map((ft) => formatFrameType(ft))
		.join("\n\n");
}

function formatFrameType(ft: FrameType): string {
	const roles = Object.entries(ft.roles)
		.map(([name, desc]) => {
			const required = ft.requiredRoles.includes(name)
				? " (required)"
				: " (optional)";
			return `  - ${name}${required}: ${desc}`;
		})
		.join("\n");

	return `### ${ft.name}
${ft.description}
Roles:
${roles}`;
}

export function getExtractionResponseSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			atoms: {
				type: "array",
				items: {
					type: "object",
					properties: {
						frame: { type: "string" },
						roles: { type: "object" },
						conditions: { type: "array", items: { type: "string" } },
						confidence: { type: "number" },
						domain: { type: "array", items: { type: "string" } },
						examples: { type: "array", items: { type: "string" } },
					},
					required: ["frame", "roles"],
				},
			},
			proposedFrameTypes: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						roles: { type: "object" },
						description: { type: "string" },
					},
					required: ["name", "roles", "description"],
				},
			},
		},
		required: ["atoms"],
	};
}
