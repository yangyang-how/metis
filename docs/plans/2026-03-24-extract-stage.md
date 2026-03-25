# Extract Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Extract stage that takes ComprehensionMaps + section content and produces candidate atoms via a cheap LLM model. Also add a Kimi adapter (OpenAI-compatible) so users can choose providers per pipeline stage.

**Architecture:** One cheap-model call per section, guided by the ComprehensionMap's SectionAnalysis. Frame type registry holds 17 core types; domain types are proposed inline during extraction. Lenient validation with flags. Kimi adapter uses the `openai` npm package with a custom base URL.

**Tech Stack:** TypeScript (strict), Bun, openai npm package (for Kimi adapter), existing llm/parse/comprehend modules

**Spec:** `design/04-extract-stage.md`

**Note:** The Kimi adapter (Task 1) is a user-requested addition not in
the Extract spec. It's bundled here because the user wants to use Kimi
for cheap Extract calls to reduce cost.

---

## File Structure

```
engine/src/
  llm/
    kimi-adapter.ts           — NEW: Kimi (OpenAI-compatible) → LLMProvider
    provider.ts               — MODIFY: add "kimi" to createProvider factory
  comprehend/
    index.ts                  — MODIFY: re-export serializeBlocks, serializeSection
  extract/
    types.ts                  — CandidateAtom, ProposedFrameType, ExtractionResult, FrameType
    errors.ts                 — ExtractError typed error
    frame-registry.ts         — load core-frames.json, register domain types, query
    section-extractor.ts      — one section → CandidateAtom[] via LLM
    atom-validator.ts         — validate atoms, flag issues, adjust confidence
    prompts.ts                — extraction prompt templates
    index.ts                  — public entry: extract(input) → ExtractionResult

engine/data/
  core-frames.json            — 17 core frame types with role schemas and requiredRoles

engine/test/
  llm/
    kimi-adapter.test.ts      — mock OpenAI client, verify translation
  extract/
    types.test.ts             — type smoke tests
    frame-registry.test.ts    — load, register, deduplicate, query
    atom-validator.test.ts    — validation rules, confidence adjustment
    section-extractor.test.ts — with mock provider
    prompts.test.ts           — prompt construction tests
    index.test.ts             — integration with mock provider
    fixtures/
      sample-section.ts       — sample section + SectionAnalysis for testing
```

---

### Task 1: Install openai SDK and add Kimi adapter

**Files:**
- Modify: `engine/package.json`
- Create: `engine/src/llm/kimi-adapter.ts`
- Create: `engine/test/llm/kimi-adapter.test.ts`
- Modify: `engine/src/llm/provider.ts`

Kimi's API is OpenAI-compatible — same message format, same response shape,
different base URL (`https://api.moonshot.cn/v1`). We use the `openai` npm
package with a custom `baseURL` to talk to Kimi.

- [ ] **Step 1: Install openai package**

Run: `cd engine && bun add openai`

- [ ] **Step 2: Write Kimi adapter tests**

Same pattern as anthropic-adapter.test.ts — mock the underlying client,
verify our LLMRequest translates correctly to OpenAI format.

Tests should verify:
- Text messages translate to OpenAI's `{ role, content: string }` format
- System message stays as a message (OpenAI keeps it in the array, unlike Anthropic)
- API key comes from config or falls back to `KIMI_API_KEY` env var
- Response translates back to our `LLMResponse` with usage stats
- Capabilities: vision false (Kimi text-only for now), structuredOutput false,
  maxContextTokens based on model (128k for moonshot-v1-128k)
- Image content is silently skipped (text placeholder instead)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && bun test test/llm/kimi-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement kimi-adapter.ts**

The adapter:
1. Creates an OpenAI client with `baseURL: "https://api.moonshot.cn/v1"` and the Kimi API key
2. Translates `Message[]` → OpenAI format:
   - System/user/assistant messages with `content` as plain string (concatenate text parts)
   - Image parts → `[Image: {alt}]` placeholder (Kimi is text-only)
3. Calls `client.chat.completions.create()`
4. Returns `LLMResponse` with content and usage stats
5. Capabilities: `{ vision: false, structuredOutput: false, maxContextTokens: 128000 }`

Since Kimi doesn't support native structured output, when `responseSchema`
is provided, the adapter injects "Respond with JSON matching this schema:"
into the system message.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/llm/kimi-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Update provider.ts factory**

Add `case "kimi"` to the `createProvider` switch statement:

```typescript
case "kimi":
  return createKimiProvider(config);
```

- [ ] **Step 7: Run all LLM tests**

Run: `cd engine && bun test test/llm/`
Expected: ALL pass.

- [ ] **Step 8: Typecheck and lint, commit**

```bash
git add engine/package.json engine/bun.lock engine/src/llm/kimi-adapter.ts engine/src/llm/provider.ts engine/test/llm/kimi-adapter.test.ts
git commit -m "feat(llm): add Kimi adapter — OpenAI-compatible API with custom base URL"
```

---

### Task 2: Re-export serialize from comprehend public API

**Files:**
- Modify: `engine/src/comprehend/index.ts`

The Extract stage needs `serializeBlocks` and `serializeSection` from the
comprehend module. Currently these are internal. Re-export them.

- [ ] **Step 1: Add re-exports to comprehend/index.ts**

Add to the existing exports:

```typescript
export { serializeBlocks, serializeSection } from "./serialize";
export type { SerializeOptions } from "./serialize";
```

Also export `normalizeChapters` function (Extract might need it for
the integration test):

```typescript
export { normalizeChapters } from "./structure-inference";
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd engine && bun run typecheck && bun run lint:fix && bun run lint`

- [ ] **Step 3: Commit**

```bash
git add engine/src/comprehend/index.ts
git commit -m "refactor(comprehend): re-export serialize and normalizeChapters from public API"
```

---

### Task 3: Extract types and errors

**Files:**
- Create: `engine/src/extract/types.ts`
- Create: `engine/src/extract/errors.ts`
- Create: `engine/test/extract/types.test.ts`

- [ ] **Step 1: Write type smoke tests**

Test `CandidateAtom`, `ExtractionResult`, `ProposedFrameType`, `FrameType`,
`FrameTypeRegistry` interface shapes.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement types.ts and errors.ts**

`types.ts`: All types from the spec:
- `CandidateAtom` with all fields: id, frame, roles, conditions, confidence,
  source (title, authors, chapterId, sectionId), domain (string[]),
  examples (string[]), flags (string[])
- `ExtractionResult` with usage including `callCount`
- `ProposedFrameType` with name, roles, description, proposedBy
- `FrameType` with name, roles, requiredRoles, description, category, domain, version
- `FrameTypeRegistry` interface
- `bookSlug(title: string): string` helper — kebab-case, truncated to 40 chars

`errors.ts`: `ExtractError` with codes `LLM_CALL_FAILED`,
`RESPONSE_PARSE_FAILED`, `PROVIDER_AUTH_FAILED`.

- [ ] **Step 4: Run tests, typecheck, lint, commit**

```bash
git add engine/src/extract/ engine/test/extract/
git commit -m "feat(extract): define CandidateAtom, FrameType, and ExtractError types"
```

---

### Task 4: Core frame types JSON and frame registry

**Files:**
- Create: `engine/data/core-frames.json`
- Create: `engine/src/extract/frame-registry.ts`
- Create: `engine/test/extract/frame-registry.test.ts`

- [ ] **Step 1: Create core-frames.json**

All 17 core frame types from the vision doc. Each entry has: name, roles
(Record<string, string>), requiredRoles (string[]), description, category
"core", version 1.

For `requiredRoles`, use a sensible default: for binary frames like `causal`
both roles are required (`["cause", "effect"]`). For frames with optional
detail like `example_of`, the detail role is optional
(`requiredRoles: ["instance", "concept"]`).

- [ ] **Step 2: Write registry tests**

Tests:
- `createRegistry()` loads all 17 core types from JSON
- `registry.get("definition")` returns the definition frame type
- `registry.has("definition")` returns true
- `registry.has("nonexistent")` returns false
- `registry.getAll()` returns 17 types
- `registry.getCoreTypes()` returns only core types
- `registry.register(proposed)` adds a new domain type
- `registry.register(proposed)` with duplicate name returns existing (no overwrite)
- `registry.register(proposed)` with invalid type (<2 roles) throws
- After registration, `registry.get(newName)` returns the registered type

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Implement frame-registry.ts**

Export: `createRegistry(): FrameTypeRegistry`

Loads `core-frames.json` at startup (use `import` or `readFileSync`).
Stores types in a `Map<string, FrameType>`. `register()` validates,
deduplicates, and adds.

- [ ] **Step 5: Run tests, typecheck, lint, commit**

```bash
git add engine/data/core-frames.json engine/src/extract/frame-registry.ts engine/test/extract/frame-registry.test.ts
git commit -m "feat(extract): implement frame type registry with 17 core types"
```

---

### Task 5: Atom validator

**Files:**
- Create: `engine/src/extract/atom-validator.ts`
- Create: `engine/test/extract/atom-validator.test.ts`

- [ ] **Step 1: Write validator tests**

Tests:
- Clean atom (valid frame type, all required roles, has conditions) → no flags
- Atom missing optional role → flag `"missing_role:detail"`, accepted
- Atom missing required role → flag `"missing_required_role:cause"`, confidence −0.1
- Atom with empty conditions → flag `"no_conditions"`, accepted
- Atom with unexpected frame type (doesn't match SectionAnalysis) → flag `"unexpected_frame_type"`, accepted
- Atom with no frame type → rejected (filtered out)
- Atom with zero roles → rejected
- Atom with unknown frame type (not in registry) → rejected
- Confidence +0.05 for all roles filled
- Confidence +0.05 for has conditions
- Confidence +0.05 for frame type matches SectionAnalysis knowledgeTypes
- Confidence −0.1 for missing required roles
- Confidence −0.1 for having any validation flags (general penalty)
- Confidence clamped to [0.0, 1.0]

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement atom-validator.ts**

Export: `validateAtoms(atoms: CandidateAtom[], registry: FrameTypeRegistry, sectionAnalysis?: SectionAnalysis): { valid: CandidateAtom[]; rejected: CandidateAtom[] }`

The function modifies atoms in place (adds flags, adjusts confidence)
and returns two arrays: valid (kept) and rejected (dropped).

- [ ] **Step 4: Run tests, typecheck, lint, commit**

```bash
git add engine/src/extract/atom-validator.ts engine/test/extract/atom-validator.test.ts
git commit -m "feat(extract): implement atom validator with lenient rules and confidence adjustment"
```

---

### Task 6: Extraction prompts and fixtures

**Files:**
- Create: `engine/src/extract/prompts.ts`
- Create: `engine/test/extract/prompts.test.ts`
- Create: `engine/test/extract/fixtures/sample-section.ts`

- [ ] **Step 1: Create fixtures**

Create `engine/test/extract/fixtures/sample-section.ts`:
A `NormalizedSection` with a few paragraphs about a concrete topic
(e.g., "types of systems") plus its corresponding `SectionAnalysis`
from a ComprehensionMap. Also a sample valid extraction response (JSON).

Reuse `engine/test/comprehend/fixtures/mock-provider.ts` — import from
there, or symlink. No need to duplicate.

- [ ] **Step 2: Write prompt tests (TDD: tests first)**

Verify:
- `buildExtractionPrompt` returns system + user messages
- System message contains all 17 frame type names
- User message contains section content
- User message contains SectionAnalysis context (purpose, knowledgeTypes)
- Schema is valid JSON

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && bun test test/extract/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create prompts.ts**

Export:
- `buildExtractionPrompt(section, sectionAnalysis, registry, bookMetadata): Message[]`
  System message with full frame type schemas + output format instructions.
  User message with section content and SectionAnalysis context.
- `getExtractionResponseSchema(): Record<string, unknown>`
  JSON schema for the expected response shape: `{ atoms: [...], proposedFrameTypes?: [...] }`.

The system prompt includes:
- All frame types with role schemas and descriptions
- Instruction to produce atoms as JSON
- Instruction to propose new types if knowledge doesn't fit
- Exact output format with camelCase field names (learned from Comprehend)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && bun test test/extract/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
git add engine/src/extract/prompts.ts engine/test/extract/prompts.test.ts engine/test/extract/fixtures/
git commit -m "feat(extract): add extraction prompt templates and test fixtures"
```

---

### Task 7: Section extractor

**Files:**
- Create: `engine/src/extract/section-extractor.ts`
- Create: `engine/test/extract/section-extractor.test.ts`

- [ ] **Step 1: Write section extractor tests**

Using mock provider:
1. Returns parsed CandidateAtom[] from valid LLM response
2. Assigns deterministic IDs: `{bookSlug}-{chapterId}-{sectionId}-{index}`
3. Fills in source metadata (title, authors, chapterId, sectionId)
4. Handles proposed frame types in response → returns them alongside atoms
5. Retries on invalid JSON (up to 2 attempts)
6. Returns empty array on persistent failure (doesn't throw)
7. Normalizes snake_case field names from LLM (same pattern as comprehend)

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement section-extractor.ts**

Export: `extractSection(section, sectionAnalysis, registry, bookMetadata, provider): Promise<SectionExtractionResult>`

```typescript
SectionExtractionResult {
  atoms: CandidateAtom[]
  proposedFrameTypes: ProposedFrameType[]
  usage: { inputTokens: number; outputTokens: number }
  failed: boolean
}
```

Flow:
1. Serialize section content to markdown
2. Estimate token count (reuse `estimateTokens` from comprehend).
   If content + schema overhead exceeds 80% of `provider.capabilities.maxContextTokens`,
   truncate content with `[Content truncated]` marker and log warning.
3. Build prompt using prompts.ts
4. Inner retry loop (up to 2 attempts) for JSON parsing:
   a. Call provider.sendMessage()
   b. Parse response → atoms[] + proposedFrameTypes[]
   c. Normalize field names (snake_case → camelCase)
   d. Assign deterministic IDs using `bookSlug(title)-chapterId-sectionId-index`
   e. Fill source metadata (title, authors, chapterId, sectionId)
   f. Fill domain[] and examples[] from response (default to empty arrays)
5. On failure → return empty atoms, failed: true

- [ ] **Step 4: Run tests, typecheck, lint, commit**

```bash
git add engine/src/extract/section-extractor.ts engine/test/extract/section-extractor.test.ts
git commit -m "feat(extract): implement section extractor — LLM call, parsing, ID generation"
```

---

### Task 8: Extract orchestrator

**Files:**
- Create: `engine/src/extract/index.ts`
- Create: `engine/test/extract/index.test.ts`

- [ ] **Step 1: Write integration tests**

Using mock provider:
1. Full pipeline: NormalizedChapter + ComprehensionMap → ExtractionResult with atoms
2. Trivial sections (<3 blocks) are skipped, listed in skippedSections
3. Failed sections don't halt — pipeline continues, other sections extracted
4. Domain types proposed in section 3 are available for section 4
5. Usage stats accumulated across all section calls
6. flaggedAtoms lists atoms with validation issues
7. Atom confidence adjusted by pipeline after model proposes

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement index.ts**

Export: `extract(input: ExtractInput): Promise<ExtractionResult>`

Re-export types.

Flow:
1. Load/receive frame registry
2. Filter sections: skip those with <3 content blocks
3. For each section (sequential):
   a. Find matching SectionAnalysis from ComprehensionMap
   b. Call `extractSection(section, analysis, registry, metadata, provider)`
   c. Register any proposed frame types in the registry
   d. Accumulate atoms and usage
   e. Add 100ms delay between calls for rate limiting
4. Validate all atoms via `validateAtoms()`
5. Return ExtractionResult

- [ ] **Step 4: Run tests, typecheck, lint**

- [ ] **Step 5: Run FULL test suite**

Run: `cd engine && bun test`
Expected: ALL tests pass (parse + llm + comprehend + extract).

- [ ] **Step 6: Commit**

```bash
git add engine/src/extract/index.ts engine/test/extract/index.test.ts
git commit -m "feat(extract): implement extract() orchestrator — per-section extraction with validation"
```

---

### Task 9: Update run-pipeline.ts and CLAUDE.md

**Files:**
- Modify: `engine/src/run-pipeline.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update run-pipeline.ts**

Add Extract stage after Comprehend. Accept CLI args for provider per stage:

```
Usage: bun run src/run-pipeline.ts <epub> [options]
  --comprehend-provider anthropic    (default: anthropic)
  --comprehend-model claude-sonnet-4-20250514
  --extract-provider kimi            (default: kimi)
  --extract-model moonshot-v1-128k
```

Flow: parse → comprehend → extract (for each chapter) → output results.

- [ ] **Step 2: Update CLAUDE.md**

Add extract module and Kimi adapter to directory structure and gotchas.

- [ ] **Step 3: Run full test suite**

Run: `cd engine && bun test`
Expected: ALL pass.

- [ ] **Step 4: Typecheck and lint, commit**

```bash
git add engine/src/run-pipeline.ts CLAUDE.md
git commit -m "feat: add extract stage to pipeline runner, update CLAUDE.md"
```
