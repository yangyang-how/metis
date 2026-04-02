export class IntegrateError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "EMBEDDING_FAILED"
			| "LLM_CALL_FAILED"
			| "RESPONSE_PARSE_FAILED"
			| "GRAPH_LOAD_FAILED",
		public readonly detail?: string,
	) {
		super(message);
		this.name = "IntegrateError";
	}
}
