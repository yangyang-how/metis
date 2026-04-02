/**
 * Evaluation checks — three layers of atom quality validation.
 *
 * Structural: hard rejects (missing frame, empty roles, unregistered type)
 * Schema: soft flags (missing required/optional roles for the frame type)
 * Semantic: soft flags (compound values, vague content, confidence outliers)
 *
 * The structural and schema checks wrap logic from extract/atom-validator.ts
 * but expose each check individually for reporting. The semantic checks are
 * new — they catch issues the validator doesn't.
 */
import type { CandidateAtom, FrameTypeRegistry } from "../extract/types";

export interface EvalResult {
	pass: boolean;
	detail?: string;
}

export interface EvalCheck {
	id: string;
	name: string;
	layer: "structural" | "schema" | "semantic";
	severity: "reject" | "flag";
	run: (atom: CandidateAtom, context?: CheckContext) => EvalResult;
}

export interface CheckContext {
	registry?: FrameTypeRegistry;
	frameStats?: Map<string, { meanConfidence: number; stdConfidence: number }>;
}

// --- Vague content patterns ---

const VAGUE_PATTERNS = [
	/^various\s/i,
	/^important\s/i,
	/^significant\s/i,
	/^relevant\s/i,
	/^different\s/i,
	/^several\s/i,
	/^many\s/i,
	/^some\s/i,
];

const VAGUE_EXACT = new Set([
	"important",
	"significant",
	"relevant",
	"concept",
	"thing",
	"stuff",
	"various",
	"etc",
	"others",
]);

function isVague(value: string): boolean {
	if (value.length < 10) return true;
	const lower = value.toLowerCase().trim();
	if (VAGUE_EXACT.has(lower)) return true;
	return VAGUE_PATTERNS.some((p) => p.test(lower));
}

/** Count sentences by splitting on period/exclamation/question followed by space or end. */
function countSentences(text: string): number {
	const sentences = text
		.split(/[.!?。！？]\s+|[.!?。！？]$/)
		.filter((s) => s.trim().length > 0);
	return sentences.length;
}

// --- Check definitions ---

export const CHECKS: EvalCheck[] = [
	// Structural
	{
		id: "structural:missing-frame",
		name: "Missing frame type",
		layer: "structural",
		severity: "reject",
		run: (atom) => ({
			pass: Boolean(atom.frame && atom.frame.trim().length > 0),
			detail: atom.frame ? undefined : "atom has no frame type",
		}),
	},
	{
		id: "structural:empty-roles",
		name: "Empty roles",
		layer: "structural",
		severity: "reject",
		run: (atom) => ({
			pass: Object.keys(atom.roles).length > 0,
			detail:
				Object.keys(atom.roles).length === 0
					? "atom has zero roles"
					: undefined,
		}),
	},
	{
		id: "structural:unregistered-frame",
		name: "Unregistered frame type",
		layer: "structural",
		severity: "reject",
		run: (atom, ctx) => {
			if (!ctx?.registry) return { pass: true }; // skip if no registry
			return {
				pass: ctx.registry.has(atom.frame),
				detail: ctx.registry.has(atom.frame)
					? undefined
					: `frame "${atom.frame}" not in registry`,
			};
		},
	},

	// Schema
	{
		id: "schema:missing-required-role",
		name: "Missing required role",
		layer: "schema",
		severity: "flag",
		run: (atom, ctx) => {
			if (!ctx?.registry) return { pass: true };
			const frameType = ctx.registry.get(atom.frame);
			if (!frameType) return { pass: true }; // unregistered frame handled elsewhere
			const missing = frameType.requiredRoles.filter((r) => !atom.roles[r]);
			return {
				pass: missing.length === 0,
				detail:
					missing.length > 0
						? `missing required: ${missing.join(", ")}`
						: undefined,
			};
		},
	},
	{
		id: "schema:missing-optional-role",
		name: "Missing optional role",
		layer: "schema",
		severity: "flag",
		run: (atom, ctx) => {
			if (!ctx?.registry) return { pass: true };
			const frameType = ctx.registry.get(atom.frame);
			if (!frameType) return { pass: true };
			const allRoles = Object.keys(frameType.roles);
			const optional = allRoles.filter(
				(r) => !frameType.requiredRoles.includes(r) && !atom.roles[r],
			);
			return {
				pass: optional.length === 0,
				detail:
					optional.length > 0
						? `missing optional: ${optional.join(", ")}`
						: undefined,
			};
		},
	},

	// Semantic
	{
		id: "semantic:compound-role",
		name: "Compound role value",
		layer: "semantic",
		severity: "flag",
		run: (atom) => {
			for (const [role, rawValue] of Object.entries(atom.roles)) {
				const value =
					typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
				// Skip short values — can't be compound
				if (value.length < 30) continue;
				if (countSentences(value) >= 3) {
					return {
						pass: false,
						detail: `role "${role}" has ${countSentences(value)} sentences (expected 1-2)`,
					};
				}
			}
			return { pass: true };
		},
	},
	{
		id: "semantic:vague-content",
		name: "Vague or generic content",
		layer: "semantic",
		severity: "flag",
		run: (atom) => {
			for (const [role, rawValue] of Object.entries(atom.roles)) {
				const value =
					typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
				if (isVague(value)) {
					return {
						pass: false,
						detail: `role "${role}" is vague: "${value.slice(0, 40)}"`,
					};
				}
			}
			return { pass: true };
		},
	},
	{
		id: "semantic:confidence-outlier",
		name: "Confidence outlier",
		layer: "semantic",
		severity: "flag",
		run: (atom, ctx) => {
			if (!ctx?.frameStats) return { pass: true };
			const stats = ctx.frameStats.get(atom.frame);
			if (!stats) return { pass: true };
			const deviation = Math.abs(atom.confidence - stats.meanConfidence);
			const sigmas =
				stats.stdConfidence > 0 ? deviation / stats.stdConfidence : 0;
			return {
				pass: sigmas <= 2,
				detail:
					sigmas > 2
						? `confidence ${atom.confidence.toFixed(2)} is ${sigmas.toFixed(1)}σ from frame mean ${stats.meanConfidence.toFixed(2)}`
						: undefined,
			};
		},
	},
	{
		id: "semantic:empty-conditions",
		name: "No conditions specified",
		layer: "semantic",
		severity: "flag",
		run: (atom) => ({
			pass: atom.conditions.length > 0,
			detail:
				atom.conditions.length === 0
					? "atom has no conditions (contextless knowledge)"
					: undefined,
		}),
	},
];
