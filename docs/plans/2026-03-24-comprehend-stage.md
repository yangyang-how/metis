# Comprehend Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Comprehend stage that takes a DocumentTree (from Parse) and produces a ComprehensionMap per chapter plus a BookSynthesis, guided by an LLM. Also build the shared LLM provider interface used by all future pipeline stages.

**Architecture:** Three phases — (1) rule-based structure inference normalizes flat/broken parse trees, (2) one LLM call per chapter produces a ComprehensionMap, (3) one synthesis call produces cross-cutting themes. The LLM provider interface abstracts multiple providers (Anthropic first) behind a common interface with retry logic and structured output support.

**Tech Stack:** TypeScript (strict), Bun, @anthropic-ai/sdk, existing parse module types

**Spec:** `design/03-comprehend-stage.md`

---

## File Structure

```
engine/src/
  llm/
    types.ts              — LLMProvider interface, LLMRequest/Response, MessageContent, capabilities
    provider.ts           — createProvider() factory, withRetry() wrapper
    anthropic-adapter.ts  — Anthropic SDK → LLMProvider implementation
  comprehend/
    types.ts              — ComprehensionMap, NormalizedChapter, BookSynthesis, all output types
    errors.ts             — ComprehendError typed error
    structure-inference.ts — rule-based DocumentTree → NormalizedChapter[]
    serialize.ts          — ContentBlock[] → LLM message text (markdown serialization)
    token-estimator.ts    — character-based token estimation with CJK handling
    prompts.ts            — system prompts and user message templates
    chapter-comprehender.ts — one NormalizedChapter → ComprehensionMap via LLM
    book-synthesizer.ts   — ComprehensionMap[] → BookSynthesis via LLM
    index.ts              — public entry: comprehend(input) → ComprehensionResult

engine/test/
  llm/
    types.test.ts         — type smoke tests
    provider.test.ts      — retry logic, createProvider factory
    anthropic-adapter.test.ts — mock SDK, verify request translation
  comprehend/
    structure-inference.test.ts — all normalization cases
    serialize.test.ts     — each ContentBlock type → markdown
    token-estimator.test.ts — English, CJK, mixed estimation
    chapter-comprehender.test.ts — with mock provider
    book-synthesizer.test.ts — with mock provider
    index.test.ts         — integration with mock provider
    fixtures/
      sample-chapter.ts   — sample NormalizedChapter for testing
      mock-provider.ts    — reusable mock LLMProvider
```

---

### Task 1: Install Anthropic SDK dependency

**Files:**
- Modify: `engine/package.json`

- [ ] **Step 1: Add @anthropic-ai/sdk to dependencies**

Run: `cd engine && bun add @anthropic-ai/sdk`

- [ ] **Step 2: Verify install succeeds**

Run: `cd engine && bun test`
Expected: existing 48 parse tests still pass, no install errors.

- [ ] **Step 3: Commit**

```bash
git add engine/package.json engine/bun.lock
git commit -m "chore: add @anthropic-ai/sdk dependency for LLM provider"
```

---

### Task 2: LLM provider types

**Files:**
- Create: `engine/src/llm/types.ts`
- Create: `engine/test/llm/types.test.ts`

- [ ] **Step 1: Write type smoke tests**

```typescript
// engine/test/llm/types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  Message,
  MessageContent,
  ProviderCapabilities,
  ProviderConfig,
} from "../../src/llm/types";

describe("llm types", () => {
  test("LLMRequest accepts text-only messages", () => {
    const request: LLMRequest = {
      messages: [
        { role: "system", content: [{ type: "text", text: "You are helpful." }] },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
    };
    expect(request.messages).toHaveLength(2);
  });

  test("LLMRequest accepts image content", () => {
    const request: LLMRequest = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            { type: "image", data: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
          ],
        },
      ],
    };
    expect(request.messages[0]?.content).toHaveLength(2);
  });

  test("ProviderConfig supports all four providers", () => {
    const configs: ProviderConfig[] = [
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      { provider: "openai", model: "gpt-4o" },
      { provider: "gemini", model: "gemini-pro" },
      { provider: "kimi", model: "moonshot-v1" },
    ];
    expect(configs).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/llm/types.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement types**

```typescript
// engine/src/llm/types.ts

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/llm/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add engine/src/llm/types.ts engine/test/llm/types.test.ts
git commit -m "feat(llm): define LLMProvider interface, request/response types, and ProviderConfig"
```

---

### Task 3: Anthropic adapter

**Files:**
- Create: `engine/src/llm/anthropic-adapter.ts`
- Create: `engine/test/llm/anthropic-adapter.test.ts`

The adapter translates our `LLMRequest` into Anthropic SDK calls and
translates the response back. Tests use a mock of the Anthropic client.

- [ ] **Step 1: Write adapter tests**

Tests should verify:
- Text messages are translated to Anthropic format (system as top-level param, user/assistant as messages)
- Image content is translated to Anthropic's base64 image_url format
- `responseSchema` is passed via Anthropic's tool_use or JSON mode
- API key comes from config or falls back to `ANTHROPIC_API_KEY` env var
- Response is translated back to our `LLMResponse` format with usage stats
- Capabilities are set correctly (vision: true, structuredOutput: true, maxContextTokens based on model)

Use a mock Anthropic client — don't make real API calls.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/llm/anthropic-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement adapter**

The adapter:
1. Creates an Anthropic client with the provided API key (or env var fallback)
2. Translates `Message[]` → Anthropic's message format:
   - System message extracted to top-level `system` parameter
   - `MessageContent` text → `{ type: "text", text }`
   - `MessageContent` image → `{ type: "image", source: { type: "base64", data, media_type } }`
3. If `responseSchema` is provided, use Anthropic's JSON mode or tool_use to request structured output
4. Returns `LLMResponse` with content string and usage stats
5. Sets `capabilities`: vision true, structuredOutput true, maxContextTokens based on model name heuristic (200k for claude-sonnet/opus, 100k default)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/llm/anthropic-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add engine/src/llm/anthropic-adapter.ts engine/test/llm/anthropic-adapter.test.ts
git commit -m "feat(llm): implement Anthropic adapter — SDK translation, vision, structured output"
```

---

### Task 4: Provider factory and retry wrapper

**Files:**
- Create: `engine/src/llm/provider.ts`
- Create: `engine/test/llm/provider.test.ts`

- [ ] **Step 1: Write provider tests**

Tests should verify:
- `createProvider({ provider: "anthropic", ... })` returns an Anthropic adapter
- `createProvider({ provider: "openai", ... })` throws "not implemented"
- Retry wrapper retries on errors up to 2 times
- Retry wrapper does NOT retry on auth errors (4xx)
- Retry wrapper uses exponential backoff (verify timing roughly)
- After retries exhausted, the original error is thrown

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/llm/provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement provider.ts**

```typescript
// engine/src/llm/provider.ts
import { createAnthropicProvider } from "./anthropic-adapter";
import type { LLMProvider, LLMRequest, LLMResponse, ProviderConfig } from "./types";

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider(config);
    default:
      throw new Error(`Provider "${config.provider}" is not yet implemented`);
  }
}

export function withRetry(
  provider: LLMProvider,
  maxRetries = 2,
): LLMProvider {
  return {
    capabilities: provider.capabilities,
    async sendMessage(request: LLMRequest): Promise<LLMResponse> {
      let lastError: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await provider.sendMessage(request);
        } catch (error: unknown) {
          lastError = error;
          // Don't retry auth errors
          if (isAuthError(error)) throw error;
          // Exponential backoff
          if (attempt < maxRetries) {
            await sleep(Math.pow(2, attempt) * 500);
          }
        }
      }
      throw lastError;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/llm/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add engine/src/llm/provider.ts engine/test/llm/provider.test.ts
git commit -m "feat(llm): implement createProvider factory and withRetry wrapper"
```

---

### Task 5: Comprehend types and errors

**Files:**
- Create: `engine/src/comprehend/types.ts`
- Create: `engine/src/comprehend/errors.ts`
- Create: `engine/test/comprehend/types.test.ts`

- [ ] **Step 1: Write type smoke tests**

Similar pattern to parse types.test.ts — verify all type shapes compile
and discriminated unions work. Test `ComprehensionMap`, `NormalizedChapter`,
`BookSynthesis`, `ComprehendInput`, `ComprehensionResult`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement types.ts and errors.ts**

`types.ts` contains: `ComprehendInput`, `ComprehensionResult`,
`ComprehensionMap`, `KnowledgeStructure`, `SectionAnalysis`,
`BookSynthesis`, `Theme`, `EntityEntry`, `NormalizedChapter`,
`NormalizedSection`, `ChapterMetadata`.

`errors.ts` contains `ComprehendError` with codes:
`LLM_CALL_FAILED`, `RESPONSE_PARSE_FAILED`, `CONTEXT_TOO_LONG`,
`PROVIDER_AUTH_FAILED`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && bun test test/comprehend/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add engine/src/comprehend/types.ts engine/src/comprehend/errors.ts engine/test/comprehend/types.test.ts
git commit -m "feat(comprehend): define ComprehensionMap types, NormalizedChapter, and ComprehendError"
```

---

### Task 6: Token estimator

**Files:**
- Create: `engine/src/comprehend/token-estimator.ts`
- Create: `engine/test/comprehend/token-estimator.test.ts`

- [ ] **Step 1: Write estimator tests**

```typescript
describe("estimateTokens", () => {
  test("estimates English text at ~chars/4", () => {
    const text = "Hello world, this is a test sentence."; // 37 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  test("estimates CJK text at ~chars/2", () => {
    const text = "这是一个中文测试句子"; // 9 chars, each ~1-2 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(12);
  });

  test("handles mixed CJK and English", () => {
    const text = "Hello 你好 World 世界";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
  });

  test("fitsInContext checks against 80% of max", () => {
    expect(fitsInContext(1000, 2000)).toBe(true);  // 1000 < 1600
    expect(fitsInContext(1700, 2000)).toBe(false); // 1700 > 1600
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/token-estimator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement token-estimator.ts**

```typescript
// engine/src/comprehend/token-estimator.ts

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f]/g;

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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/token-estimator.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/token-estimator.ts engine/test/comprehend/token-estimator.test.ts
git commit -m "feat(comprehend): implement token estimator with CJK-aware heuristic"
```

---

### Task 7: Content serializer

**Files:**
- Create: `engine/src/comprehend/serialize.ts`
- Create: `engine/test/comprehend/serialize.test.ts`

This module converts `ContentBlock[]` into markdown text for the LLM
message, following the spec's serialization rules.

- [ ] **Step 1: Write serializer tests**

Test each `ContentBlock` type:
- paragraph → text as-is
- heading level 2 → `## Title`
- table → markdown table with pipes and separator
- ordered list → `1. item` with indentation for nesting
- unordered list → `- item`
- code → fenced code block with language
- blockquote → `> text`
- footnote → `[Footnote fn1]: text`
- image with vision → returns separate image MessageContent
- image without vision → `[Image: alt text]`

Also test `serializeSection()` which wraps content in section delimiters:
```
=== Section: Title (id: section-id) ===
{content}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/serialize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement serialize.ts**

Export two functions:
- `serializeBlocks(blocks: ContentBlock[], options?: { vision?: boolean }): MessageContent[]`
  Returns an array of MessageContent — mostly text parts, but images become
  separate image parts when vision is enabled.
- `serializeSection(section: NormalizedSection, options?): MessageContent[]`
  Wraps with section delimiter, then calls serializeBlocks on content,
  recurses into sub-sections.

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/serialize.ts engine/test/comprehend/serialize.test.ts
git commit -m "feat(comprehend): implement content serializer — ContentBlock to markdown for LLM"
```

---

### Task 8: Structure inference

**Files:**
- Create: `engine/src/comprehend/structure-inference.ts`
- Create: `engine/test/comprehend/structure-inference.test.ts`

The rule-based normalizer that fixes broken/flat parse trees.

- [ ] **Step 1: Write structure inference tests**

Test cases from real EPUBs:
1. **Chapter with sections** → passes through unchanged (sections preserved)
2. **Flat chapter with H2/H3 headings** → splits at heading boundaries, creates synthetic sections
3. **Large flat chapter (>100 blocks, no headings)** → splits into ~50-block chunks
4. **Small flat chapter** → becomes single section with chapter title
5. **Chapter.content (pre-section blocks)** → prepended to first section
6. **Deterministic IDs** → `inferred-{kebab-title}-{index}`
7. **ChapterMetadata** is computed correctly (block count, hasImages, estimatedTokens)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/structure-inference.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement structure-inference.ts**

Export: `normalizeChapters(tree: DocumentTree): NormalizedChapter[]`

Algorithm:
1. Walk each `Chapter` in the document tree
2. If chapter has sections, convert them to `NormalizedSection[]` and
   prepend `Chapter.content` to the first section (or create a synthetic
   intro section if there's intro content)
3. If chapter is flat (0 sections), scan content for heading blocks:
   - Split at each heading boundary
   - Each segment becomes a NormalizedSection with the heading as title
   - Generate deterministic IDs: `inferred-{kebab-title}-{index}`
4. If flat and no headings and >100 blocks: chunk into ~50-block segments
5. If flat and small: wrap entire content as one section
6. Compute `ChapterMetadata` for each chapter

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/structure-inference.test.ts`
Expected: PASS.

- [ ] **Step 5: Test with real EPUBs**

Write one additional test that parses a real EPUB (using the existing
parse module) and runs structure inference on it:

```typescript
test("normalizes flat chapter from real EPUB", async () => {
  // Parse a fixture that has flat structure
  const tree = await parse({ filePath: fixture("no-nav") });
  const normalized = normalizeChapters(tree);
  // Every chapter should have at least one section
  for (const ch of normalized) {
    expect(ch.sections.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 6: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/structure-inference.ts engine/test/comprehend/structure-inference.test.ts
git commit -m "feat(comprehend): implement structure inference — normalize flat/broken parse trees"
```

---

### Task 9: Prompts, fixtures, and prompt tests

**Files:**
- Create: `engine/src/comprehend/prompts.ts`
- Create: `engine/test/comprehend/prompts.test.ts`
- Create: `engine/test/comprehend/fixtures/mock-provider.ts`
- Create: `engine/test/comprehend/fixtures/sample-chapter.ts`

- [ ] **Step 1: Create mock provider**

A reusable mock `LLMProvider` that returns canned responses. It records
all calls for assertion and lets tests configure what to return.

```typescript
// engine/test/comprehend/fixtures/mock-provider.ts
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../src/llm/types";

export function createMockProvider(responses: string[]): {
  provider: LLMProvider;
  calls: LLMRequest[];
} {
  const calls: LLMRequest[] = [];
  let callIndex = 0;

  const provider: LLMProvider = {
    capabilities: {
      vision: false,
      structuredOutput: true,
      maxContextTokens: 200_000,
    },
    async sendMessage(request: LLMRequest): Promise<LLMResponse> {
      calls.push(request);
      const content = responses[callIndex] ?? "{}";
      callIndex++;
      return {
        content,
        usage: { inputTokens: 1000, outputTokens: 500 },
      };
    },
  };

  return { provider, calls };
}
```

- [ ] **Step 2: Create sample chapter fixture**

A `NormalizedChapter` with 2-3 sections, some paragraphs and a heading,
for use in chapter-comprehender and integration tests.

- [ ] **Step 3: Create prompts.ts**

Export functions:
- `buildChapterPrompt(chapter: NormalizedChapter, bookMetadata: DocumentMetadata): Message[]`
  Builds the system + user messages for chapter comprehension.
- `buildSynthesisPrompt(chapterMaps: ComprehensionMap[], bookMetadata: DocumentMetadata): Message[]`
  Builds the system + user messages for book synthesis.
- `getComprehensionMapSchema(): Record<string, unknown>`
  Returns the JSON schema for ComprehensionMap (used as responseSchema).
- `getBookSynthesisSchema(): Record<string, unknown>`
  Returns the JSON schema for BookSynthesis.

The system prompts are exactly as specified in the design doc.

- [ ] **Step 4: Write prompt smoke tests**

```typescript
// engine/test/comprehend/prompts.test.ts
import { describe, expect, test } from "bun:test";
import { buildChapterPrompt, buildSynthesisPrompt, getComprehensionMapSchema, getBookSynthesisSchema } from "../../src/comprehend/prompts";
// import sample chapter and metadata fixtures

describe("prompts", () => {
  test("buildChapterPrompt returns system and user messages", () => {
    const messages = buildChapterPrompt(sampleChapter, sampleMetadata);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
  });

  test("buildSynthesisPrompt includes all chapter maps", () => {
    const messages = buildSynthesisPrompt([sampleMap], sampleMetadata);
    const userMsg = messages.find(m => m.role === "user");
    const textContent = userMsg?.content.find(c => c.type === "text");
    expect(textContent?.text).toContain(sampleMap.chapterId);
  });

  test("getComprehensionMapSchema returns valid JSON schema", () => {
    const schema = getComprehensionMapSchema();
    expect(schema).toHaveProperty("type");
    expect(schema).toHaveProperty("properties");
  });

  test("getBookSynthesisSchema returns valid JSON schema", () => {
    const schema = getBookSynthesisSchema();
    expect(schema).toHaveProperty("type");
  });
});
```

- [ ] **Step 5: Run prompt tests and verify they pass**

Run: `cd engine && bun test test/comprehend/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/prompts.ts engine/test/comprehend/prompts.test.ts engine/test/comprehend/fixtures/
git commit -m "feat(comprehend): add prompt templates, mock provider, sample fixtures, and prompt tests"
```

---

### Task 10: Chapter comprehender

**Files:**
- Create: `engine/src/comprehend/chapter-comprehender.ts`
- Create: `engine/test/comprehend/chapter-comprehender.test.ts`

- [ ] **Step 1: Write chapter comprehender tests**

Using the mock provider:
1. Sends correct prompt to provider (system + user messages)
2. Parses valid JSON response into ComprehensionMap
3. Handles invalid JSON → retries (via withRetry wrapper)
4. After exhausted retries → returns minimal map (chapterType "unknown")
5. Chapter too large for context → splits at section boundaries
6. Includes images when provider has vision capability

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/chapter-comprehender.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement chapter-comprehender.ts**

Export: `comprehendChapter(chapter: NormalizedChapter, bookMetadata: DocumentMetadata, provider: LLMProvider): Promise<ComprehensionMap>`

Flow:
1. Serialize chapter content using serialize.ts
2. Estimate tokens using token-estimator.ts
3. If too large for context window, split at section boundaries into
   sub-chapters. If an individual section still exceeds the limit,
   truncate its content with a `[Content truncated]` marker and log a warning.
4. Build prompt using prompts.ts
5. **Inner retry loop for JSON parsing** (up to 2 attempts):
   a. Call `provider.sendMessage()` with responseSchema
   b. Parse response JSON into `ComprehensionMap`
   c. Run structural validation (JSON shape). If invalid, retry from (a).
   d. Run quality checks (section count, non-empty fields). Log warnings but accept.
6. If split into multiple calls, merge results:
   - `chapterType`: use the type from the first (largest) sub-call
   - `structures`: concatenate from all sub-calls, deduplicate by name
   - `sectionAnalyses`: concatenate (each sub-call produces analyses for its sections only)
   - `summary`: use from the first sub-call (it has the chapter intro)
7. On all retries exhausted, return minimal map (chapterType "unknown",
   sectionAnalyses with just IDs/titles, empty structures).

Note: The `withRetry` wrapper (Task 4) handles provider-level errors
(network, rate limits). The inner retry loop here handles response-level
errors (malformed JSON). These are separate concerns at separate layers.

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/chapter-comprehender.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/chapter-comprehender.ts engine/test/comprehend/chapter-comprehender.test.ts
git commit -m "feat(comprehend): implement chapter comprehender — LLM call, parsing, validation, fallback"
```

---

### Task 11: Book synthesizer

**Files:**
- Create: `engine/src/comprehend/book-synthesizer.ts`
- Create: `engine/test/comprehend/book-synthesizer.test.ts`

- [ ] **Step 1: Write synthesizer tests**

Using the mock provider:
1. Sends all chapter maps (not raw content) to the provider
2. Parses valid JSON response into BookSynthesis
3. On failure → returns empty synthesis (empty themes, empty entities)
4. Never crashes the pipeline

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/book-synthesizer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement book-synthesizer.ts**

Export: `synthesizeBook(chapterMaps: ComprehensionMap[], bookMetadata: DocumentMetadata, provider: LLMProvider): Promise<BookSynthesis>`

Flow:
1. Build synthesis prompt using prompts.ts
2. Call `provider.sendMessage()` with responseSchema
3. Parse response. On failure, return empty BookSynthesis (not an error).

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/book-synthesizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint, commit**

```bash
git add engine/src/comprehend/book-synthesizer.ts engine/test/comprehend/book-synthesizer.test.ts
git commit -m "feat(comprehend): implement book synthesizer — cross-cutting themes and entity index"
```

---

### Task 12: Comprehend orchestrator

**Files:**
- Create: `engine/src/comprehend/index.ts`
- Create: `engine/test/comprehend/index.test.ts`

- [ ] **Step 1: Write integration tests**

Using the mock provider:
1. Full pipeline: DocumentTree → ComprehensionResult with chapter maps and synthesis
2. Failed chapter produces minimal map, doesn't halt pipeline
3. Failed synthesis produces empty synthesis, doesn't halt pipeline
4. Usage stats are accumulated across all calls
5. failedChapters lists the IDs of chapters that fell back to minimal maps

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && bun test test/comprehend/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement index.ts**

Export: `comprehend(input: ComprehendInput): Promise<ComprehensionResult>`

Re-export types: `ComprehensionResult`, `ComprehensionMap`, `BookSynthesis`,
`ComprehendError`, etc.

Flow:
1. Create provider via `createProvider(input.providerConfig)`
2. Wrap with `withRetry(provider)`
3. Run structure inference: `normalizeChapters(input.documentTree)`
4. For each normalized chapter (sequential):
   a. Call `comprehendChapter(chapter, metadata, provider)`
   b. Accumulate usage stats
   c. On error, produce minimal map, add to failedChapters
5. Call `synthesizeBook(chapterMaps, metadata, provider)`
6. Return `ComprehensionResult`

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd engine && bun test test/comprehend/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `cd engine && bun test`
Expected: ALL tests pass (parse + llm + comprehend).

- [ ] **Step 6: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 7: Commit**

```bash
git add engine/src/comprehend/index.ts engine/test/comprehend/index.test.ts
git commit -m "feat(comprehend): implement comprehend() orchestrator — three-phase pipeline"
```

---

### Task 13: Update CLAUDE.md and final checks

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to the directory structure:
- `engine/src/llm/` — Shared LLM provider interface. Multi-provider, Anthropic adapter in v1.
- `engine/src/comprehend/` — Comprehend stage: structure inference, chapter comprehension, book synthesis.

Add to Gotchas:
- Anthropic SDK requires `ANTHROPIC_API_KEY` env var (or explicit config). Tests use mock providers.
- Structure inference normalizes flat EPUBs — never assume the parse tree has sections.

- [ ] **Step 2: Run full test suite**

Run: `cd engine && bun test`
Expected: ALL tests pass.

- [ ] **Step 3: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — add llm and comprehend modules, new gotchas"
```
