---
paths:
  - "engine/**"
---
# Engine Rules (Knowledge Pipeline)

## Architecture
- Each pipeline stage (parse, comprehend, extract, integrate) is a separate module in `engine/src/`.
- Each module exports a single entry function. Internal helpers are not exported.
- All LLM calls go through `engine/src/llm/provider.ts` — never import Anthropic SDK directly.
- Pipeline stages are composable: each takes typed input and returns typed output. No shared mutable state.

## Testing
- Every module has a test file in `engine/test/` mirroring the source structure.
- Tests use sample fixtures in `engine/test/fixtures/` — real text passages with expected extraction results.
- Test the pipeline stages independently. Integration tests compose stages.
- Mock LLM calls in unit tests. Use real calls only in clearly marked integration tests.

## Type Safety
- All atoms must conform to the Atom type (defined in `engine/src/types/atom.ts`).
- Frame types must be registered in the frame type registry before use.
- Use discriminated unions for frame types, not string literals.

## Error Handling
- Pipeline errors are typed (ParseError, ComprehendError, etc.) — never throw generic Error.
- Failed extraction on a section should not halt the entire chapter. Collect errors, continue, report at the end.
- LLM provider errors get retried (with backoff) for transient failures, surfaced for permanent ones.
