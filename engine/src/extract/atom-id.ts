import { createHash } from "node:crypto";
import type { CandidateAtom } from "./types";

/**
 * Compute a content-addressed atom ID.
 *
 * Identity payload: { frame, roles, conditions, source.sourceId }
 * See design/09-projects.md §6 for rationale.
 */
export function computeAtomId(atom: {
	frame: string;
	roles: Record<string, string>;
	conditions: string[];
	source: { sourceId?: string };
}): string {
	const sourceRef: string = atom.source.sourceId ?? "";
	const payload = {
		conditions: [...atom.conditions].sort(),
		frame: atom.frame,
		roles: sortedObject(atom.roles),
		sourceRef,
	};
	const canonical = JSON.stringify(payload);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

function sortedObject(obj: Record<string, string>): Record<string, string> {
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(obj).sort()) {
		sorted[key] = obj[key] as string;
	}
	return sorted;
}

/**
 * Assign content-addressed IDs to atoms that have sourceId populated.
 * Falls back to the existing positional ID if sourceId is absent.
 */
export function assignContentIds(atoms: CandidateAtom[]): CandidateAtom[] {
	return atoms.map((atom) => {
		if (atom.source.sourceId) {
			return { ...atom, id: computeAtomId(atom) };
		}
		return atom;
	});
}
