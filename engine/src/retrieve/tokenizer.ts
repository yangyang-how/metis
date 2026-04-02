/**
 * Text tokenizer for BM25 retrieval.
 *
 * Handles English (whitespace split + stopwords) and CJK (character bigrams).
 * CJK languages don't use whitespace between words, so we use overlapping
 * bigrams as a simple segmentation strategy that works without external
 * dictionaries. This is standard practice in CJK information retrieval.
 */

const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"shall",
	"can",
	"need",
	"dare",
	"ought",
	"and",
	"or",
	"but",
	"nor",
	"not",
	"so",
	"yet",
	"both",
	"either",
	"neither",
	"each",
	"every",
	"all",
	"any",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"only",
	"own",
	"same",
	"than",
	"too",
	"very",
	"just",
	"because",
	"as",
	"until",
	"while",
	"of",
	"at",
	"by",
	"for",
	"with",
	"about",
	"against",
	"between",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"to",
	"from",
	"up",
	"down",
	"in",
	"out",
	"on",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"here",
	"there",
	"when",
	"where",
	"why",
	"how",
	"that",
	"this",
	"these",
	"those",
	"it",
	"its",
	"i",
	"me",
	"my",
	"we",
	"our",
	"you",
	"your",
	"he",
	"him",
	"his",
	"she",
	"her",
	"they",
	"them",
	"their",
	"what",
	"which",
	"who",
	"whom",
]);

// CJK Unified Ideographs range
const CJK_REGEX = /[\u4e00-\u9fff]/;
const CJK_RUN_REGEX = /[\u4e00-\u9fff]+/g;
const NON_ALNUM_REGEX = /[^a-z0-9\u4e00-\u9fff]+/;

/**
 * Tokenize text into an array of terms (with duplicates).
 * English: lowercase, split, filter stopwords.
 * CJK: overlapping character bigrams.
 */
export function tokenize(text: string): string[] {
	if (!text) return [];

	const lower = text.toLowerCase();
	const tokens: string[] = [];

	// Extract CJK runs and convert to bigrams
	const cjkRuns = lower.match(CJK_RUN_REGEX);
	if (cjkRuns) {
		for (const run of cjkRuns) {
			if (run.length === 1) {
				tokens.push(run);
			} else {
				for (let i = 0; i < run.length - 1; i++) {
					tokens.push(run.slice(i, i + 2));
				}
			}
		}
	}

	// Extract non-CJK tokens (English words, numbers)
	const withoutCjk = lower.replace(CJK_RUN_REGEX, " ");
	const words = withoutCjk.split(NON_ALNUM_REGEX).filter(Boolean);
	for (const word of words) {
		if (!STOPWORDS.has(word) && !CJK_REGEX.test(word)) {
			tokens.push(word);
		}
	}

	return tokens;
}

/**
 * Tokenize and return a frequency map (term → count).
 */
export function tokenizeWithFrequency(text: string): Map<string, number> {
	const tokens = tokenize(text);
	const freq = new Map<string, number>();
	for (const token of tokens) {
		freq.set(token, (freq.get(token) ?? 0) + 1);
	}
	return freq;
}
