/**
 * Token estimation — conservative heuristic for context window checks.
 *
 * CJK characters tokenize differently from Latin text. A naive chars/4
 * estimate would massively undercount for Chinese text (半数测试书籍).
 * We use chars/2 for CJK and chars/4 for everything else.
 */

const CJK_RANGE =
	/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f]/g;

export function estimateTokens(text: string): number {
	const cjkChars = (text.match(CJK_RANGE) || []).length;
	const nonCjkChars = text.length - cjkChars;
	return Math.ceil(cjkChars / 2 + nonCjkChars / 4);
}

export function fitsInContext(
	estimatedTokens: number,
	maxContextTokens: number,
	safetyMargin = 0.8,
): boolean {
	return estimatedTokens <= maxContextTokens * safetyMargin;
}
