/**
 * Typed error for parse failures. The `code` field lets callers handle
 * specific failure modes without parsing error messages.
 *
 * This is the "typed errors, not generic Error" principle from the engine rules:
 * callers can switch on error.code to decide whether to retry, skip, or abort.
 */
export class ParseError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "INVALID_EPUB"
			| "MISSING_OPF"
			| "DRM_PROTECTED"
			| "CORRUPT_CONTENT"
			| "NO_CHAPTERS",
		public readonly filePath?: string,
	) {
		super(message);
		this.name = "ParseError";
	}
}
