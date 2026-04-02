/**
 * BM25 (Best Matching 25) index and scoring.
 *
 * BM25 is a bag-of-words ranking function that scores documents by how well
 * their terms match the query. It improves on raw TF-IDF by adding term
 * frequency saturation (k1) and document length normalization (b).
 *
 * Formula:
 *   score(D, Q) = Σ IDF(qi) · (tf(qi,D) · (k1+1)) / (tf(qi,D) + k1 · (1 - b + b · |D|/avgdl))
 *
 * Where:
 *   IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 *   N = total documents, n(qi) = documents containing term qi
 */
import { tokenize, tokenizeWithFrequency } from "./tokenizer";

export interface BM25Index {
	/** Inverted index: term → list of (docIndex, termFrequency) */
	invertedIndex: Map<string, Array<{ doc: number; tf: number }>>;
	/** Document IDs in index order */
	docIds: string[];
	/** Token count per document */
	docLengths: number[];
	/** Average document length */
	avgDocLength: number;
	/** Total number of documents */
	docCount: number;
	/** Pre-computed IDF: term → inverse document frequency */
	idf: Map<string, number>;
}

/** BM25 tuning parameters */
const K1 = 1.5; // term frequency saturation
const B = 0.75; // document length normalization

/**
 * Build a BM25 index from an array of documents.
 */
export function buildBM25Index(
	docs: Array<{ id: string; text: string }>,
): BM25Index {
	const docIds: string[] = [];
	const docLengths: number[] = [];
	const invertedIndex = new Map<string, Array<{ doc: number; tf: number }>>();

	// Index each document
	for (let i = 0; i < docs.length; i++) {
		const doc = docs[i];
		if (!doc) continue;
		docIds.push(doc.id);

		const freq = tokenizeWithFrequency(doc.text);
		let docLength = 0;
		for (const count of freq.values()) {
			docLength += count;
		}
		docLengths.push(docLength);

		// Build inverted index
		for (const [term, tf] of freq) {
			let postings = invertedIndex.get(term);
			if (!postings) {
				postings = [];
				invertedIndex.set(term, postings);
			}
			postings.push({ doc: i, tf });
		}
	}

	const docCount = docs.length;
	const totalLength = docLengths.reduce((sum, l) => sum + l, 0);
	const avgDocLength = docCount > 0 ? totalLength / docCount : 0;

	// Pre-compute IDF for all terms
	const idf = new Map<string, number>();
	for (const [term, postings] of invertedIndex) {
		const n = postings.length; // number of docs containing term
		// BM25 IDF with +1 to avoid negative values for very common terms
		const idfValue = Math.log((docCount - n + 0.5) / (n + 0.5) + 1);
		idf.set(term, idfValue);
	}

	return { invertedIndex, docIds, docLengths, avgDocLength, docCount, idf };
}

/**
 * Score documents against a query using BM25.
 * Returns top-k results sorted by descending score.
 */
export function queryBM25(
	index: BM25Index,
	query: string,
	topK: number,
): Array<{ id: string; score: number }> {
	const queryTerms = tokenize(query);
	if (queryTerms.length === 0) return [];

	// Accumulate scores per document
	const scores = new Float64Array(index.docCount);

	for (const term of queryTerms) {
		const termIdf = index.idf.get(term);
		if (termIdf === undefined) continue; // term not in corpus

		const postings = index.invertedIndex.get(term);
		if (!postings) continue;

		for (const { doc, tf } of postings) {
			const dl = index.docLengths[doc] ?? 0;
			const numerator = tf * (K1 + 1);
			const denominator = tf + K1 * (1 - B + B * (dl / index.avgDocLength));
			scores[doc] += termIdf * (numerator / denominator);
		}
	}

	// Collect non-zero scores and sort
	const results: Array<{ id: string; score: number }> = [];
	for (let i = 0; i < scores.length; i++) {
		const score = scores[i] ?? 0;
		const docId = index.docIds[i];
		if (score > 0 && docId) {
			results.push({ id: docId, score });
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topK);
}
