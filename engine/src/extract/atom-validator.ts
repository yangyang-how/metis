/**
 * Atom validator — lenient validation with flags.
 *
 * We don't throw away atoms that are 80% correct. We tag what's wrong
 * and let the Integrate stage decide. Confidence is a composite signal:
 * model's self-assessment + objective pipeline checks.
 */
import type { SectionAnalysis } from "../comprehend/types";
import type { CandidateAtom, FrameTypeRegistry } from "./types";

export function validateAtoms(
	atoms: CandidateAtom[],
	registry: FrameTypeRegistry,
	sectionAnalysis?: SectionAnalysis,
): { valid: CandidateAtom[]; rejected: CandidateAtom[] } {
	const valid: CandidateAtom[] = [];
	const rejected: CandidateAtom[] = [];

	for (const atom of atoms) {
		// Hard rejection checks
		if (!atom.frame) {
			rejected.push(atom);
			continue;
		}
		if (Object.keys(atom.roles).length === 0) {
			rejected.push(atom);
			continue;
		}
		if (!registry.has(atom.frame)) {
			rejected.push(atom);
			continue;
		}

		// Soft validation — add flags
		const flags: string[] = [];
		const frameType = registry.get(atom.frame);

		if (frameType) {
			// Check required roles
			for (const required of frameType.requiredRoles) {
				if (!atom.roles[required]) {
					flags.push(`missing_required_role:${required}`);
				}
			}

			// Check optional roles (in frame schema but not required)
			for (const roleName of Object.keys(frameType.roles)) {
				if (
					!frameType.requiredRoles.includes(roleName) &&
					!atom.roles[roleName]
				) {
					flags.push(`missing_role:${roleName}`);
				}
			}
		}

		// Check conditions
		if (atom.conditions.length === 0) {
			flags.push("no_conditions");
		}

		// Check if frame type matches SectionAnalysis prediction
		if (sectionAnalysis) {
			const predicted = sectionAnalysis.knowledgeTypes;
			if (predicted.length > 0 && !predicted.includes(atom.frame)) {
				flags.push("unexpected_frame_type");
			}
		}

		// Confidence adjustments
		let confidence = atom.confidence;

		// Positive adjustments
		if (frameType) {
			const allRolesFilled = Object.keys(frameType.roles).every(
				(r) => atom.roles[r],
			);
			if (allRolesFilled) confidence += 0.05;
		}
		if (atom.conditions.length > 0) confidence += 0.05;
		if (sectionAnalysis?.knowledgeTypes.includes(atom.frame)) {
			confidence += 0.05;
		}

		// Negative adjustments
		const hasMissingRequired = flags.some((f) =>
			f.startsWith("missing_required_role:"),
		);
		if (hasMissingRequired) confidence -= 0.1;
		if (flags.length > 0) confidence -= 0.1;

		// Clamp
		confidence = Math.max(0, Math.min(1, confidence));

		valid.push({
			...atom,
			flags,
			confidence,
		});
	}

	return { valid, rejected };
}
