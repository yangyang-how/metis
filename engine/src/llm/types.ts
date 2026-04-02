/**
 * LLM provider interface — the contract all providers implement.
 *
 * Pipeline stages call this interface, never an SDK directly.
 * This is the interface segregation principle: the thinnest possible
 * contract that Anthropic, OpenAI, Gemini, and Kimi all satisfy.
 */

export interface LLMProvider {
	sendMessage(request: LLMRequest): Promise<LLMResponse>;
	capabilities: ProviderCapabilities;
}

export interface LLMRequest {
	messages: Message[];
	responseSchema?: Record<string, unknown>;
	maxTokens?: number;
	temperature?: number;
}

export interface Message {
	role: "system" | "user" | "assistant";
	content: MessageContent[];
}

export type MessageContent =
	| { type: "text"; text: string }
	| { type: "image"; data: Uint8Array; mediaType: string };

export interface LLMResponse {
	content: string;
	usage: { inputTokens: number; outputTokens: number };
}

export interface ProviderCapabilities {
	vision: boolean;
	structuredOutput: boolean;
	maxContextTokens: number;
}

export interface ProviderConfig {
	provider: "anthropic" | "openai" | "gemini" | "kimi";
	model: string;
	apiKey?: string;
}
