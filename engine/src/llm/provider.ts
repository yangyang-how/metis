/**
 * Provider factory and retry wrapper.
 *
 * createProvider() — maps a ProviderConfig to the right adapter.
 * withRetry() — decorator that adds retry logic to any provider.
 *
 * These are separate concerns composed together:
 *   const provider = withRetry(createProvider(config));
 */
import { createAnthropicProvider } from "./anthropic-adapter";
import { createKimiProvider } from "./kimi-adapter";
import type {
	LLMProvider,
	LLMRequest,
	LLMResponse,
	ProviderConfig,
} from "./types";

export function createProvider(config: ProviderConfig): LLMProvider {
	switch (config.provider) {
		case "anthropic":
			return createAnthropicProvider(config);
		case "kimi":
			return createKimiProvider(config);
		default:
			throw new Error(
				`Provider "${config.provider}" is not yet implemented. Available: anthropic, kimi`,
			);
	}
}

export function withRetry(provider: LLMProvider, maxRetries = 2): LLMProvider {
	return {
		capabilities: provider.capabilities,
		async sendMessage(request: LLMRequest): Promise<LLMResponse> {
			let lastError: unknown;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				try {
					return await provider.sendMessage(request);
				} catch (error: unknown) {
					lastError = error;
					if (isAuthError(error)) throw error;
					if (attempt < maxRetries) {
						await sleep(2 ** attempt * 100); // 100ms, 200ms, 400ms...
					}
				}
			}
			throw lastError;
		},
	};
}

function isAuthError(error: unknown): boolean {
	if (error && typeof error === "object") {
		const status = (error as Record<string, unknown>).status;
		if (typeof status === "number" && status >= 400 && status < 500) {
			return true;
		}
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
