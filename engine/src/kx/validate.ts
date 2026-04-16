import { computeContentId, computeDocId } from "./hash";
import type { KXDocument, StrictnessProfile } from "./types";

export interface ValidateOptions {
	minProfile?: StrictnessProfile;
}

export interface ValidateResult {
	valid: boolean;
	profile: StrictnessProfile;
	violations: Violation[];
}

export interface Violation {
	unitId?: string;
	field: string;
	rule: string;
	message: string;
}

const PROFILE_RANK: Record<StrictnessProfile, number> = {
	casual: 0,
	standard: 1,
	strict: 2,
};

/**
 * Structural validation of a KX document.
 * Does NOT verify spans against source files — that's verifySpans().
 */
export function validateKX(
	doc: KXDocument,
	options?: ValidateOptions,
): ValidateResult {
	const violations: Violation[] = [];

	// Schema basics
	if (doc.version !== "kx/1.0") {
		violations.push({
			field: "version",
			rule: "version",
			message: `Expected "kx/1.0", got "${doc.version}"`,
		});
	}

	if (!["casual", "standard", "strict"].includes(doc.profile)) {
		violations.push({
			field: "profile",
			rule: "profile",
			message: `Invalid profile: "${doc.profile}"`,
		});
	}

	// Min profile check
	if (
		options?.minProfile &&
		PROFILE_RANK[doc.profile] < PROFILE_RANK[options.minProfile]
	) {
		violations.push({
			field: "profile",
			rule: "minProfile",
			message: `Document profile "${doc.profile}" is below required "${options.minProfile}"`,
		});
	}

	// Content addressing
	const expectedContentId = computeContentId(doc);
	if (doc.contentId && doc.contentId !== expectedContentId) {
		violations.push({
			field: "contentId",
			rule: "contentAddress",
			message: "contentId does not match recomputed hash",
		});
	}

	const expectedDocId = computeDocId(doc);
	if (doc.docId && doc.docId !== expectedDocId) {
		violations.push({
			field: "docId",
			rule: "contentAddress",
			message: "docId does not match recomputed hash",
		});
	}

	// Source refs
	const sourceIds = new Set(doc.meta.sources.map((s) => s.id));
	const unitIds = new Set(doc.units.map((u) => u.id));

	for (const unit of doc.units) {
		// Every unit must have content
		if (!unit.content) {
			violations.push({
				unitId: unit.id,
				field: "content",
				rule: "required",
				message: "Unit missing content field",
			});
		}

		// Source ref must dereference
		if (!sourceIds.has(unit.source.ref)) {
			violations.push({
				unitId: unit.id,
				field: "source.ref",
				rule: "referentialIntegrity",
				message: `Source ref "${unit.source.ref}" not found in meta.sources`,
			});
		}

		// Profile-specific checks
		if (doc.profile === "standard" || doc.profile === "strict") {
			if (!unit.provenance) {
				violations.push({
					unitId: unit.id,
					field: "provenance",
					rule: "profileRequired",
					message: `Provenance required under ${doc.profile} profile`,
				});
			} else {
				if (
					!unit.provenance.quotedSpans ||
					unit.provenance.quotedSpans.length === 0
				) {
					violations.push({
						unitId: unit.id,
						field: "provenance.quotedSpans",
						rule: "profileRequired",
						message: "At least one quotedSpan required under standard/strict",
					});
				}

				if (!unit.provenance.extraction) {
					violations.push({
						unitId: unit.id,
						field: "provenance.extraction",
						rule: "profileRequired",
						message: "Extraction metadata required under standard/strict",
					});
				}

				if (unit.roles && !unit.provenance.roleTypes) {
					violations.push({
						unitId: unit.id,
						field: "provenance.roleTypes",
						rule: "profileRequired",
						message: "roleTypes required for all roles under standard/strict",
					});
				}
			}

			// Confidence floor
			const minConf = doc.profile === "strict" ? 0.7 : 0.6;
			if (unit.confidence < minConf) {
				violations.push({
					unitId: unit.id,
					field: "confidence",
					rule: "confidenceFloor",
					message: `Confidence ${unit.confidence} below ${doc.profile} floor ${minConf}`,
				});
			}
		}

		// Strict-specific
		if (doc.profile === "strict") {
			if (unit.provenance?.roleTypes) {
				for (const [role, type] of Object.entries(
					unit.provenance.roleTypes,
				)) {
					if (type !== "verbatim") {
						violations.push({
							unitId: unit.id,
							field: `provenance.roleTypes.${role}`,
							rule: "strictVerbatim",
							message: `Role "${role}" must be verbatim under strict profile`,
						});
					}
				}
			}

			if (unit.provenance?.roleSpans && unit.roles) {
				for (const role of Object.keys(unit.roles)) {
					if (
						!unit.provenance.roleSpans[role]
					) {
						violations.push({
							unitId: unit.id,
							field: `provenance.roleSpans.${role}`,
							rule: "strictRoleSpans",
							message: `Role "${role}" missing verbatim span under strict profile`,
						});
					}
				}
			}

			if (!unit.language) {
				violations.push({
					unitId: unit.id,
					field: "language",
					rule: "strictLanguage",
					message: "Language required on every unit under strict profile",
				});
			}
		}
	}

	// Relation refs
	for (const rel of doc.relations) {
		if (!unitIds.has(rel.from)) {
			violations.push({
				field: `relation.from`,
				rule: "referentialIntegrity",
				message: `Relation from "${rel.from}" not found in units`,
			});
		}
		if (!unitIds.has(rel.to)) {
			violations.push({
				field: `relation.to`,
				rule: "referentialIntegrity",
				message: `Relation to "${rel.to}" not found in units`,
			});
		}
	}

	// Strict: source language required
	if (doc.profile === "strict") {
		for (const source of doc.meta.sources) {
			if (!source.language) {
				violations.push({
					field: `meta.sources.${source.id}.language`,
					rule: "strictLanguage",
					message: `Source "${source.id}" missing language under strict profile`,
				});
			}
			if (!source.sourceId) {
				violations.push({
					field: `meta.sources.${source.id}.sourceId`,
					rule: "strictProvenance",
					message: `Source "${source.id}" missing sourceId under strict profile`,
				});
			}
			if (!source.contentHash) {
				violations.push({
					field: `meta.sources.${source.id}.contentHash`,
					rule: "strictProvenance",
					message: `Source "${source.id}" missing contentHash under strict profile`,
				});
			}
		}
	}

	return {
		valid: violations.length === 0,
		profile: doc.profile,
		violations,
	};
}
