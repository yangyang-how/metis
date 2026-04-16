import type { AtomProvenance, SourceSpan } from "./types";

export interface SpanVerifyResult {
	valid: boolean;
	failures: SpanFailure[];
}

export interface SpanFailure {
	field: string;
	spanText: string;
	reason: "not_found" | "offset_mismatch";
}

/**
 * Normalize text for span matching.
 *
 * Unicode NFC, whitespace collapse, smart quote → straight, em-dash → hyphen.
 * See design/09-projects.md §6 "Span verification procedure".
 */
export function normalizeForSpanMatch(text: string): string {
	return text
		.normalize("NFC")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2012\u2013\u2014\u2015]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Verify that a span's text exists in the section text.
 */
export function verifySpan(
	span: SourceSpan,
	sectionText: string,
): { found: boolean; computedStart?: number } {
	const normalizedSection = normalizeForSpanMatch(sectionText);
	const normalizedSpan = normalizeForSpanMatch(span.text);

	if (!normalizedSpan) {
		return { found: false };
	}

	const idx = normalizedSection.indexOf(normalizedSpan);
	if (idx === -1) {
		return { found: false };
	}

	return { found: true, computedStart: idx };
}

/**
 * Verify all spans in an atom's provenance against section text.
 *
 * Returns a result listing every failed span. An atom with any failure
 * should be rejected under standard/strict profiles.
 */
export function verifyAtomSpans(
	provenance: AtomProvenance,
	sectionText: string,
): SpanVerifyResult {
	const failures: SpanFailure[] = [];

	for (let i = 0; i < provenance.quotedSpans.length; i++) {
		const span = provenance.quotedSpans[i] as SourceSpan;
		const result = verifySpan(span, sectionText);
		if (!result.found) {
			failures.push({
				field: `quotedSpans[${i}]`,
				spanText: span.text.slice(0, 80),
				reason: "not_found",
			});
		}
	}

	if (provenance.roleSpans) {
		for (const [role, span] of Object.entries(provenance.roleSpans) as [
			string,
			SourceSpan,
		][]) {
			if (!span) continue;
			const result = verifySpan(span, sectionText);
			if (!result.found) {
				failures.push({
					field: `roleSpans.${role}`,
					spanText: span.text.slice(0, 80),
					reason: "not_found",
				});
			}
		}
	}

	return { valid: failures.length === 0, failures };
}
