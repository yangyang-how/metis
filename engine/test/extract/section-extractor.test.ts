import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/extract/frame-registry";
import { extractSection } from "../../src/extract/section-extractor";
import { createMockProvider } from "../comprehend/fixtures/mock-provider";
import {
	sampleAnalysis,
	sampleExtractionResponse,
	sampleSection,
} from "./fixtures/sample-section";

const bookMetadata = { title: "Test Book", authors: ["Test Author"] };

describe("extractSection — happy path", () => {
	test("returns parsed CandidateAtoms from LLM response", async () => {
		const { provider } = createMockProvider([sampleExtractionResponse]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms).toHaveLength(2);
		expect(result.atoms[0]?.frame).toBe("taxonomy");
		expect(result.atoms[1]?.frame).toBe("definition");
		expect(result.failed).toBe(false);
	});

	test("assigns deterministic IDs", async () => {
		const { provider } = createMockProvider([sampleExtractionResponse]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms[0]?.id).toContain("test-book");
		expect(result.atoms[0]?.id).toContain("s2");
		expect(result.atoms[0]?.id).toEndWith("-0");
		expect(result.atoms[1]?.id).toEndWith("-1");
	});

	test("fills source metadata on each atom", async () => {
		const { provider } = createMockProvider([sampleExtractionResponse]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms[0]?.source.title).toBe("Test Book");
		expect(result.atoms[0]?.source.authors).toEqual(["Test Author"]);
		expect(result.atoms[0]?.source.sectionId).toBe("s2");
	});

	test("returns usage stats", async () => {
		const { provider } = createMockProvider([sampleExtractionResponse]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.usage.inputTokens).toBeGreaterThan(0);
		expect(result.usage.outputTokens).toBeGreaterThan(0);
	});
});

describe("extractSection — proposed frame types", () => {
	test("returns proposed frame types from response", async () => {
		const responseWithProposal = JSON.stringify({
			atoms: [
				{
					frame: "stage_chars",
					roles: { stage: "growth", competition: "intense" },
					conditions: [],
					confidence: 0.8,
					domain: [],
					examples: [],
				},
			],
			proposedFrameTypes: [
				{
					name: "stage_chars",
					roles: {
						stage: "lifecycle stage",
						competition: "competitive dynamics",
					},
					description: "Characteristics of an industry stage",
				},
			],
		});

		const { provider } = createMockProvider([responseWithProposal]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.proposedFrameTypes).toHaveLength(1);
		expect(result.proposedFrameTypes[0]?.name).toBe("stage_chars");
	});
});

describe("extractSection — error handling", () => {
	test("returns empty on invalid JSON after retries", async () => {
		const { provider } = createMockProvider([
			"not json",
			"still not json",
			"nope",
		]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms).toHaveLength(0);
		expect(result.failed).toBe(true);
	});

	test("retries on invalid JSON and succeeds on second try", async () => {
		const { provider, calls } = createMockProvider([
			"bad json",
			sampleExtractionResponse,
		]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms).toHaveLength(2);
		expect(result.failed).toBe(false);
		expect(calls).toHaveLength(2);
	});
});

describe("extractSection — field normalization", () => {
	test("normalizes snake_case response fields", async () => {
		const snakeCaseResponse = JSON.stringify({
			atoms: [
				{
					frame: "definition",
					roles: { term: "test", meaning: "a test" },
					conditions: [],
					confidence: 0.8,
					domain: ["testing"],
					examples: [],
				},
			],
			proposed_frame_types: [],
		});

		const { provider } = createMockProvider([snakeCaseResponse]);
		const registry = createRegistry();

		const result = await extractSection(
			sampleSection,
			sampleAnalysis,
			registry,
			bookMetadata,
			provider,
		);

		expect(result.atoms).toHaveLength(1);
		expect(result.atoms[0]?.frame).toBe("definition");
	});
});
