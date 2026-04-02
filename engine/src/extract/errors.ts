export class ExtractError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "LLM_CALL_FAILED"
			| "RESPONSE_PARSE_FAILED"
			| "PROVIDER_AUTH_FAILED",
		public readonly sectionId?: string,
	) {
		super(message);
		this.name = "ExtractError";
	}
}
