export class ComprehendError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "LLM_CALL_FAILED"
			| "RESPONSE_PARSE_FAILED"
			| "CONTEXT_TOO_LONG"
			| "PROVIDER_AUTH_FAILED",
		public readonly chapterId?: string,
	) {
		super(message);
		this.name = "ComprehendError";
	}
}
