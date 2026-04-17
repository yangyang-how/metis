# Knowledge Exchange Format (KX) — Contract Specification

A portable, verifiable interchange format for structured knowledge
transfer between tools. KX is a **contract**: a versioned schema with
explicit semantic guarantees, not just a JSON shape. Any tool can
produce or consume it. No tool owns it.

**Revision:** 2026-04-15. Supersedes the original KX format doc with
contract-level guarantees, strictness profiles, content addressing,
and provenance requirements.

---

## 1. Purpose and Principles

Metis extracts knowledge from books. Seisei turns knowledge into Claude
Code skills. parentguidebook uses knowledge to back healthcare articles.
A study tool turns knowledge into flashcards. Each tool has its own
internal representation, but they all need to pass knowledge between
each other with a shared trust model.

KX is the common language. It's simple enough that a human could write
one by hand, rich enough to express conflicts and provenance, and
agnostic about what the consumer does with it.

**Design principles:**

- **Human-readable first.** Every unit has a natural language `content`
  field. Structured data is enrichment, not replacement.
- **Provenance by default.** Every unit traces back to a source file,
  a content hash, and the extraction method that produced it. Optional
  only under the `casual` profile.
- **Source-agnostic.** A KX document can come from Metis's pipeline,
  a human writing JSON, or any other tool.
- **Consumer-agnostic.** No assumption about downstream use. Skills,
  articles, chatbots, flashcards — all valid consumers.
- **Conflicts are declared, not resolved.** KX records contradictions.
  How to handle them is the consumer's job.
- **Immutable once published.** A KX document is a frozen artifact.
  Consumers store it by content hash and can verify it forever.
- **The contract is the product.** Tools depend on the contract, not
  on each other. Metis could be rewritten in Rust tomorrow and no
  consumer would notice, as long as the output validates.

---

## 2. Contract Guarantees

A valid KX document, at any profile, guarantees the following:

1. **Every unit has a `content` field** containing a human-readable
   natural language statement of the knowledge it represents.
2. **Every unit cites a source** via `source.ref`, which dereferences
   to an entry in `meta.sources`.
3. **Every cross-reference** (in `relations`) dereferences to a real
   unit ID within the document.
4. **The `profile` field is accurate.** A document claiming `strict`
   satisfies all strict-profile rules. A document claiming `standard`
   satisfies all standard-profile rules. The validator enforces this —
   the profile is verifiable, not advisory.
5. **The `contentId` field** is the SHA-256 hash of the document's
   semantic payload under JCS canonicalization (see §10). The exact
   fields included are enumerated in §10. Two documents with the same
   `contentId` contain the same knowledge in the same classification
   from the same bibliographic sources.
6. **The `docId` field** is the SHA-256 hash of the complete document
   (excluding `docId` and `contentId` themselves) under JCS
   canonicalization. Two documents with the same `docId` are
   byte-for-byte identical after canonicalization.

Additional guarantees by profile are listed in §3.

---

## 3. Scope of Contract (Consumer Responsibility)

**The KX contract makes no claim whatsoever about:**

- **Faithfulness of downstream content.** Whether any article, lesson,
  chatbot reply, or generated summary that cites a KX unit is faithful
  to what the unit actually says. A consumer can trivially cite unit
  `u-42` while making a claim `u-42` does not support. Citation
  presence is not citation faithfulness.
- **Accuracy of upstream sources.** Whether the books, articles, or
  notes that produced the units are themselves accurate, current,
  authoritative, or safe to act on. KX records what a source said,
  not whether the source was right.
- **Completeness or balance.** Whether the set of units in a document
  is representative of the domain. A document can be fully valid under
  `strict` and still be a cherry-picked selection that misleads.

**Consumers of KX documents are solely responsible for:**

- Enforcing faithfulness between generated output and cited units
  (e.g., constrained decoding, post-generation attribution checks,
  human review).
- Evaluating the quality, currency, and authority of upstream sources.
- Any legal, medical, regulatory, or safety claims made in content
  that uses KX units as evidence.

**Even under the `strict` profile**, Metis only guarantees that the
extraction is source-anchored and verifiable. It does not guarantee
that downstream use of the extracted knowledge is correct, safe, or
appropriate.

Metis produces evidence. The consumer is the publisher.

---

## 4. Strictness Profiles

Every KX document declares a `profile` that determines the level of
provenance it carries. The profile is set by the producing project's
configuration and travels with the document. Consumers can enforce a
minimum profile — e.g., parentguidebook refuses anything below `strict`.

### `casual`

Minimum viable provenance. Suitable for personal notes, hobby research,
home maintenance guides.

- `provenance` on units is **optional**.
- `quotedSpans` optional.
- Role values may be LLM paraphrases without flagging.
- `content` field required (always).
- Source `ref` required (always).
- Confidence floor: none enforced.

### `standard` (default)

The honest middle. Suitable for industry research, education content,
sales analysis — most knowledge work.

- `provenance` on units is **required**.
- `provenance.quotedSpans` required — at least one verified verbatim
  quote per unit.
- `provenance.roleTypes` required for every role — each role explicitly
  flagged as `"verbatim"` or `"paraphrase"`.
- Paraphrased roles are allowed but must be flagged.
- `provenance.extraction` required — model, provider, prompt version,
  timestamp.
- Source `contentHash` required on `KXSource`.
- Confidence floor: 0.6. Units below are excluded.

### `strict`

Full extractive provenance. Suitable for healthcare content, legal
research, medical claims — anything liability-bearing.

- All `standard` requirements, plus:
- `provenance.roleSpans` required for **every** role — each role value
  must have a corresponding verbatim source span.
- All `provenance.roleTypes` must be `"verbatim"`. Paraphrased roles
  are rejected.
- `provenance.quotedSpans` verified: every span must be a substring
  of the source section text (after Unicode NFC normalization and
  whitespace collapse).
- Cross-language extraction blocked. Units must be in the source
  language. Translation/canonicalization for display is a separate,
  explicitly labeled step. Enforced via `language` field on `KXSource`
  and `KXUnit` (see §9) — validator checks unit language matches source
  language.
- Confidence floor: 0.7.
- Source `sourceId`, `contentHash`, and `language` required on `KXSource`.
- `language` required on every `KXUnit`.

### Profile enforcement

The validator (`validateKX`) takes an optional `minProfile` argument.
A consumer calling `validateKX(doc, { minProfile: "strict" })` will
reject any document below `strict`, regardless of what the document
claims. The profile claim is verified against the rules — a `casual`
document cannot pass `strict` validation by lying about its profile.

---

## 5. Document Structure

```typescript
interface KXDocument {
  version: "kx/1.0";

  // Content addressing (see §9)
  contentId: string;            // sha256(jcs(semantic payload))
  docId: string;                // sha256(jcs(full document))

  // Strictness profile
  profile: "casual" | "standard" | "strict";

  meta: {
    domains: string[];          // topic areas covered
    sources: KXSource[];        // provenance
    generatedBy?: string;       // "metis/0.1" | "seisei/0.1" | "human"
    generatedAt?: string;       // ISO 8601 timestamp
  };

  units: KXUnit[];              // the knowledge itself
  relations: KXRelation[];      // how units relate to each other
}
```

---

## 6. Knowledge Units

The core building block. One unit = one piece of knowledge.

```typescript
interface KXUnit {
  id: string;                   // content-addressed (see §9)

  kind: KXKind;

  // Human-readable statement — always present, all profiles
  content: string;

  // Structured roles — display/canonical form
  // Simple consumers use these as plain strings
  roles?: Record<string, string>;

  // Provenance — required under standard and strict profiles
  provenance?: {
    // Verbatim source quotes backing this unit
    quotedSpans: KXSpan[];

    // Per-role verbatim source spans (required under strict)
    roleSpans?: Record<string, KXSpan>;

    // Per-role provenance flag (required under standard and strict)
    roleTypes?: Record<string, "verbatim" | "paraphrase">;

    // How this unit was produced — discriminated union
    extraction:
      | { method: "llm"; provider: string; model: string;
          promptVersion: string; extractedAt: string }
      | { method: "human"; author: string; extractedAt: string }
      | { method: "algorithmic"; tool: string; version: string;
          extractedAt: string };
  };

  conditions: string[];
  confidence: number;

  source: {
    ref: string;                // matches KXSource.id
    locations?: string[];       // "Ch.3, §2", "Ch.7, §1" — discovery metadata, not identity
  };

  // Language of this unit (required under strict for cross-language check)
  language?: string;            // BCP 47 tag, e.g. "en", "zh-Hans"

  domains: string[];
}

interface KXSpan {
  text: string;                 // verbatim text from the source
  start?: number;               // character offset into section text
  end?: number;                 // (optional — for verification tooling)
}
```

### Content vs Roles vs Provenance

Three layers, each serving a different consumer:

1. **`content`** — always present. A natural language sentence any tool
   can read. This is the universal fallback.
2. **`roles`** — optional structured data. Display/canonical form of
   the knowledge, useful for richer processing. A consumer that
   understands roles can build checklists, decision trees, etc.
3. **`provenance`** — audit trail. Verbatim source spans, per-role
   provenance flags, extraction metadata. A compliance-aware consumer
   uses this to verify that the unit is source-anchored.

A simple consumer reads only `content`. A structured consumer reads
`roles`. A compliance consumer reads `provenance`. All three layers
describe the same knowledge at different fidelity levels.

### Role values under strict profile

Under `strict`, every role in `roles` must have a corresponding entry
in `provenance.roleSpans` containing the exact source text, and every
entry in `provenance.roleTypes` must be `"verbatim"`. Under strict,
`roles[key]` **must equal** `provenance.roleSpans[key].text` after the
same normalization used for span verification (Unicode NFC, whitespace
collapse, quote/dash normalization). There is no separate "display form"
under strict — the role value IS the verbatim span.

Under `standard`, `roles[key]` may differ from `roleSpans[key].text`.
The role is the canonical/display form; the span is the evidence. Both
are present; consumers choose which to use.

### source.location is not identity

A unit's `source.locations` array records where in the source the claim
was found. If the same claim appears in Ch.3 §2 and Ch.7 §1 of the
same source, that is **one unit** with two locations, not two units.
Locations are discovery metadata — they do not contribute to unit
identity (see §10).

Example under `strict`:

```json
{
  "id": "sha256:a1b2c3...",
  "kind": "heuristic",
  "content": "Never feed honey to a baby under one year old due to risk of infant botulism.",
  "roles": {
    "subject": "infants under one year",
    "risk": "honey",
    "consequence": "infant botulism"
  },
  "provenance": {
    "quotedSpans": [
      {
        "text": "Never feed honey to a baby under one year old. It contains spores that can cause infant botulism.",
        "start": 1847,
        "end": 1945
      }
    ],
    "roleSpans": {
      "subject": { "text": "a baby under one year old", "start": 1868, "end": 1893 },
      "risk": { "text": "honey", "start": 1858, "end": 1863 },
      "consequence": { "text": "infant botulism", "start": 1930, "end": 1945 }
    },
    "roleTypes": {
      "subject": "verbatim",
      "risk": "verbatim",
      "consequence": "verbatim"
    },
    "extraction": {
      "method": "llm",
      "extractedAt": "2026-04-15T12:00:00Z",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "promptVersion": "sha256:e4f5..."
    }
  },
  "conditions": ["feeding infants"],
  "confidence": 0.98,
  "source": { "ref": "aap-feeding-guide", "locations": ["Ch.4, §2"] },
  "language": "en",
  "domains": ["pediatric-nutrition", "food-safety"]
}
```

---

## 7. Knowledge Kinds

12 types covering the range of knowledge structures. Deliberately
broader than Metis's 17 frame types — KX trades specificity for
portability.

| Kind | What it represents | Example |
|---|---|---|
| `definition` | What something means | "Affordance means the perceived action possibilities of an object" |
| `property` | An attribute of something | "Mature industries have penetration rates above 50%" |
| `classification` | Taxonomy, is-a, consists-of | "Design patterns are classified into creational, structural, and behavioral" |
| `causal` | A causes/leads to B | "Poor error messages increase user abandonment" |
| `heuristic` | In situation X, do Y | "When designing forms, put labels above inputs, not beside them" |
| `principle` | A general truth that guides reasoning | "Every piece of interface must earn its place on the screen" |
| `procedure` | Steps to achieve a goal | "To conduct a usability test: recruit 5 users, prepare tasks, observe, debrief" |
| `comparison` | A vs B, when to use which | "Modeless design reduces errors; modal design reduces complexity" |
| `threshold` | Boundary that changes behavior | "Response time above 1 second breaks the user's flow of thought" |
| `deviation` | Theory vs reality gap | "The funnel model assumes linear progression, but real users jump between stages" |
| `example` | Concrete instance of an abstract concept | "Amazon's 1-Click ordering is an example of reducing friction to zero" |
| `evaluation` | Criteria or matrix for judgment | "Evaluate onboarding by: time-to-first-value, completion rate, and support ticket volume" |

### Mapping from Metis Frame Types

Metis's 17 core frame types map to KX kinds:

| Metis frame | KX kind |
|---|---|
| `definition` | `definition` |
| `has_property` | `property` |
| `is_a` | `classification` |
| `consists_of` | `classification` |
| `taxonomy` | `classification` |
| `example_of` | `example` |
| `causal` | `causal` |
| `causal_chain` | `causal` |
| `heuristic` | `heuristic` |
| `principle` | `principle` |
| `procedure` | `procedure` |
| `method_comparison` | `comparison` |
| `threshold` | `threshold` |
| `deviation` | `deviation` |
| `formula` | `evaluation` |
| `sequence` | `evaluation` |
| `evaluation_matrix` | `evaluation` |

Domain-specific frame types proposed at runtime also map to the
closest KX kind. The mapping is lossy — intentionally. If a consumer
needs Metis's full frame specificity, it should use Metis's native
format, not KX.

---

## 8. Relations

How units connect to each other.

```typescript
interface KXRelation {
  from: string;                 // unit ID
  to: string;                   // unit ID
  type: KXRelationType;
  confidence: number;           // 0-1
  note?: string;                // human-readable explanation
}

type KXRelationType =
  | "reinforces"      // both assert the same claim from different sources
  | "contradicts"     // units assert opposing claims
  | "extends"         // one adds nuance or detail to another
  | "requires"        // understanding one requires the other
  | "exemplifies";    // one is a concrete example of the other
```

### Conflict Representation

KX declares conflicts; it does not resolve them. A `contradicts`
relation means the consumer must decide how to handle the tension.

The `conditions` field on each unit provides scope that often resolves
the contradiction. Two units may contradict in general but not within
their respective scopes.

```json
{
  "units": [
    {
      "id": "unit-a",
      "kind": "heuristic",
      "content": "Remove everything that isn't essential.",
      "conditions": ["consumer web", "casual users"],
      "confidence": 0.91,
      "source": { "ref": "krug-dmmt", "locations": ["Ch.3"] },
      "domains": ["usability"]
    },
    {
      "id": "unit-b",
      "kind": "heuristic",
      "content": "Expert users need rich affordances, even at the cost of surface complexity.",
      "conditions": ["professional tools", "expert users"],
      "confidence": 0.89,
      "source": { "ref": "cooper-af", "locations": ["Ch.12"] },
      "domains": ["interaction-design"]
    }
  ],
  "relations": [
    {
      "from": "unit-a",
      "to": "unit-b",
      "type": "contradicts",
      "confidence": 0.85,
      "note": "Scope-dependent: casual users vs expert users"
    }
  ]
}
```

---

## 9. Sources

```typescript
interface KXSource {
  id: string;                   // referenced by unit.source.ref

  // Provenance fields (required under standard and strict profiles)
  sourceId?: string;            // manifest-assigned stable UUID
  contentHash?: string;         // sha256 of source file bytes at learn time

  // Language (required under strict for cross-language enforcement)
  language?: string;            // BCP 47 tag, e.g. "en", "zh-Hans"

  type: "book" | "article" | "case-study" | "notes"
      | "guide" | "transcript" | "other";
  title: string;
  authors?: string[];
  url?: string;
}
```

Under `standard` and `strict` profiles, `contentHash` is required.
Under `strict`, both `sourceId` and `contentHash` are required.

The `contentHash` allows any consumer to independently verify that
the source file they hold matches the one the producer extracted from.
If the hashes don't match, the provenance chain is broken and the
consumer should treat the units as unverified.

---

## 10. Content Addressing and Immutability

### Two hashes, two questions

Every KX document carries two content-addressed identifiers. Both
exclude themselves from the hash input (the document is serialized
with `contentId` and `docId` fields removed before hashing).

- **`contentId`** = `sha256(jcs(semanticPayload))` — answers "is this
  the same knowledge?" Stable across re-exports that produce the same
  knowledge from the same graph.

- **`docId`** = `sha256(jcs(fullDocument minus docId and contentId))` —
  answers "is this the exact same artifact?" Every re-export produces a
  new `docId` even if the knowledge is identical (because timestamps
  differ).

Consumers cite `docId` for compliance-grade provenance ("this exact
artifact backs this article"). Consumers cite `contentId` for
aggregation ("show me everything citing this body of knowledge").

### contentId exact field specification

`contentId` is computed over the following fields, serialized via JCS:

**Units** (sorted by `id` before serialization):

| Field | Included | Rationale |
|---|---|---|
| `kind` | Yes | Type of knowledge |
| `roles` | Yes | The structured claim |
| `conditions` | Yes | Scoping — different conditions = different knowledge |
| `source.ref` | Yes | Which source it came from |
| `domains` | Yes | Topic classification |
| `content` | No | Display text, not semantic identity |
| `confidence` | No | Subjective assessment, not the claim itself |
| `source.locations` | No | Where found, not what it says |
| `provenance` | No | How extracted, not what it says |
| `language` | No | Property of the source, not the knowledge |

**Relations** (sorted by `from` + `to` + `type`):

| Field | Included | Rationale |
|---|---|---|
| `from` | Yes | Which units are linked |
| `to` | Yes | |
| `type` | Yes | Semantic relationship |
| `confidence` | No | Subjective |
| `note` | No | Human explanation |

**Meta:**

| Field | Included | Rationale |
|---|---|---|
| `sources[].id, .type, .title, .authors` | Yes | Identity of what was read |
| `sources[].sourceId, .contentHash, .url, .language` | No | Implementation/discovery metadata |
| `meta.domains` (sorted) | Yes | Topic scope |
| `meta.generatedBy, .generatedAt` | No | Production metadata |

**Conscious tradeoff:** including `domains` and source bibliographic
metadata (`title`, `authors`) in `contentId` means that retagging
domains or correcting a source's author name changes `contentId`,
even if the extracted units are unchanged. This is by design —
`contentId` represents "same knowledge in the same classification
from the same bibliographic sources." Consumers who need a narrower
identity that ignores metadata corrections should aggregate by
unit-level `id` fields, which are stable across domain retagging and
source metadata edits.

### Canonicalization

Both hashes use **RFC 8785 JSON Canonicalization Scheme (JCS)**. This
ensures that any implementation in any language, serializing the same
logical document, produces the same hash. JCS specifies:

- Lexicographic key ordering
- No trailing commas, no comments
- Numbers in shortest-representation form
- Strings in UTF-8 with minimal escaping
- No whitespace outside strings

Non-TS implementations **must** use a JCS-compliant serializer to
interop. Using `JSON.stringify` with a key-sort is not sufficient
(number representation and escape handling differ).

### Unit IDs are content-addressed

```
unit.id = sha256(jcs({ kind, roles, conditions, source.ref }))
```

The identity payload matches the knowledge model:
- `kind` + `roles` + `conditions` = the scoped claim.
- `source.ref` = which source it came from.
- Two claims with the same roles but different conditions are different
  units (e.g., "don't feed honey to infants" scoped to "under 1 year"
  vs scoped to "immunocompromised children").
- `source.locations` is **excluded** — the same claim found in Ch.3
  and Ch.7 of the same source is one unit with two locations, not two
  units.
- `content`, `confidence`, `provenance`, `domains`, and `language` are
  **excluded** — they do not define what the claim *is*.
- Re-learning the same source and producing the same extraction yields
  the same unit IDs. Durable cross-document references work.
- A different model producing slightly different roles yields different
  IDs (correct — it's a different unit).

### Immutability guarantee

**A KX document is immutable once published.** Its `docId` is its
permanent identity. The producing tool does not mutate, update, or
retract published documents.

If the underlying graph evolves (new sources, re-learned sources,
changed prompts), the producer generates a **new** KX document with
a new `docId`. The old document remains valid and unchanged. Consumers
who stored it by `docId` are guaranteed to see the same bytes forever.

This is the load-bearing guarantee for compliance use cases. An article
published today citing `docId: sha256:abc123` can be audited in five
years by retrieving the same document and verifying its hash.

---

## 11. Versioning

The `version` field uses the format `kx/MAJOR.MINOR`. Consumers should
check the major version and reject documents with an unknown major.

- **Major bump:** Breaking structural changes (new required fields,
  removed fields, changed semantics of existing fields).
- **Minor bump:** Additive changes (new optional fields, new `kind`
  values, new relation types).

Consumers should tolerate unknown `kind` values and unknown relation
types gracefully — treat as opaque and pass through the `content` field.

The current version is `kx/1.0`. This document defines the full v1
contract including profiles and provenance.

---

## 12. Conformance and Validation

### Reference validator

Metis ships a reference validator: `validateKX(doc, options?)`.

```typescript
interface ValidateOptions {
  minProfile?: "casual" | "standard" | "strict";
}

interface ValidateResult {
  valid: boolean;
  profile: "casual" | "standard" | "strict";
  violations: Violation[];
}

interface Violation {
  unitId?: string;
  field: string;
  rule: string;
  message: string;
}
```

**`validateKX(doc, options?)`** — structural validation (no source
files needed):

- Schema shape (required fields, correct types)
- Profile compliance (all rules for the claimed profile are met,
  including field presence, roleType flags, confidence floors)
- Referential integrity (all `source.ref` → `KXSource`, all relation
  IDs → `KXUnit`)
- Content-address verification (`contentId` and `docId` recomputed
  from the exact field specifications in §10 and compared)
- Extraction method shape (discriminated union validated per `method`)
- Language consistency under strict (unit `language` matches source
  `language` via `source.ref`)

The validator **does not** verify that quoted spans exist in source
files. It checks that span fields are present, non-empty, and
structurally correct — not that they are truthful. Structural
validation is what the contract enforces.

**`verifySpans(doc, sourceDir)`** — source verification (requires
original project directory):

- For each unit, loads the source file referenced by `source.ref`
- Verifies `contentHash` matches the file on disk
- Verifies every `quotedSpan.text` is a substring of the section text
  (after normalization)
- Under strict: verifies every `roleSpan.text` is a substring
- Reports per-unit pass/fail with near-miss diagnostics

This is an **audit operation**, not a contract operation. A consumer
may not have the source files. `validateKX` is always sufficient to
decide whether to accept a document. `verifySpans` is for producers
who want to verify their own output, or auditors with source access.

### Conformance suite (future direction)

The reference validator is a shortcut — Metis writes both the producer
and the checker. For independent verification, the proper shape is a
**conformance test suite**: a set of KX documents labeled valid/invalid
with reasons, against which any implementation can test.

The suite is not shipped in v1, but the spec describes what it would
check. A future consumer who needs independent trust can reimplement
the validator against the suite and catch any drift between the spec
and Metis's reference implementation.

---

## 13. Implementation Notes

### Producing KX

Any tool that produces KX should:

1. Generate content-addressed `id` values for units (see §10).
2. Always populate `content` with readable natural language.
3. Include `conditions` even if empty (empty array = "always applies").
4. Set `confidence` to 1.0 if confidence scoring isn't available.
5. Map internal knowledge types to the closest KX `kind`.
6. Compute and set `contentId` and `docId` using JCS canonicalization.
7. Set `profile` to the producing project's configured profile.
8. Under `standard`/`strict`: populate `provenance` on every unit.
9. Under `strict`: populate `roleSpans` for every role and verify all
   spans against source text before export.

### Consuming KX

Any tool that consumes KX should:

1. Call `validateKX(doc, { minProfile })` before trusting any content.
2. Work with `content` alone if `roles` are absent.
3. Handle unknown `kind` values (don't crash — treat as generic).
4. Handle unknown relation types (log and skip).
5. Use `conditions` to scope knowledge before applying it.
6. Check `relations` for `contradicts` before presenting knowledge as
   settled fact.
7. Store consumed documents by `docId` for compliance auditability.
8. **Never assume faithfulness.** The presence of a citation does not
   mean generated content is faithful to the cited unit. Enforce
   faithfulness in your own pipeline.

### File Convention

KX documents are JSON files with the `.kx.json` extension. This
distinguishes them from other JSON files and enables tooling.

---

## 14. Full Example

A small KX document under `standard` profile:

```json
{
  "version": "kx/1.0",
  "contentId": "sha256:7f3a...",
  "docId": "sha256:9e2b...",
  "profile": "standard",
  "meta": {
    "domains": ["usability", "interaction-design"],
    "sources": [
      {
        "id": "krug-dmmt",
        "sourceId": "a1b2c3d4e5f6",
        "contentHash": "sha256:4d5e...",
        "type": "book",
        "title": "Don't Make Me Think",
        "authors": ["Steve Krug"]
      },
      {
        "id": "norman-doet",
        "sourceId": "c3d4e5f6a1b2",
        "contentHash": "sha256:8f9a...",
        "type": "book",
        "title": "The Design of Everyday Things",
        "authors": ["Don Norman"]
      }
    ],
    "generatedBy": "metis/0.2",
    "generatedAt": "2026-04-15T12:00:00Z"
  },
  "units": [
    {
      "id": "sha256:b1c2d3...",
      "kind": "definition",
      "content": "An affordance is a relationship between the properties of an object and the capabilities of the agent that determines how the object could be used.",
      "roles": {
        "term": "affordance",
        "meaning": "relationship between object properties and agent capabilities determining possible use"
      },
      "provenance": {
        "quotedSpans": [
          {
            "text": "An affordance is a relationship between the properties of an object and the capabilities of the agent that determine just how the object could possibly be used.",
            "start": 342,
            "end": 504
          }
        ],
        "roleTypes": {
          "term": "verbatim",
          "meaning": "paraphrase"
        },
        "extraction": {
          "method": "llm",
          "extractedAt": "2026-04-15T11:30:00Z",
          "provider": "anthropic",
          "model": "claude-sonnet-4-6",
          "promptVersion": "sha256:e4f5..."
        }
      },
      "conditions": [],
      "confidence": 0.95,
      "source": { "ref": "norman-doet", "locations": ["Ch.1"] },
      "domains": ["interaction-design"]
    },
    {
      "id": "sha256:d4e5f6...",
      "kind": "heuristic",
      "content": "Users scan web pages rather than reading them. Design for scanning: clear visual hierarchy, short text blocks, obvious clickable elements.",
      "roles": {
        "situation": "designing any web page",
        "action": "design for scanning with clear hierarchy, short blocks, obvious links",
        "rationale": "users scan rather than read"
      },
      "provenance": {
        "quotedSpans": [
          {
            "text": "What users actually do most of the time (if we're lucky) is glance at each new page, scan some of the text, and click on the first link that catches their interest",
            "start": 891,
            "end": 1058
          }
        ],
        "roleTypes": {
          "situation": "paraphrase",
          "action": "paraphrase",
          "rationale": "verbatim"
        },
        "extraction": {
          "method": "llm",
          "extractedAt": "2026-04-15T11:32:00Z",
          "provider": "anthropic",
          "model": "claude-sonnet-4-6",
          "promptVersion": "sha256:e4f5..."
        }
      },
      "conditions": ["web pages", "screen-based reading"],
      "confidence": 0.92,
      "source": { "ref": "krug-dmmt", "locations": ["Ch.2"] },
      "domains": ["usability", "web-design"]
    }
  ],
  "relations": [
    {
      "from": "sha256:b1c2d3...",
      "to": "sha256:d4e5f6...",
      "type": "reinforces",
      "confidence": 0.70,
      "note": "Both emphasize making interface state immediately perceivable"
    }
  ]
}
```

Note: under `strict` profile, the second unit would be rejected — its
`situation` and `action` roles are typed as `"paraphrase"`. A strict
producer would need to extract verbatim spans for those roles or drop
the unit.
