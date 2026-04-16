import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getEffectiveConfig, loadProjectConfig } from "../../src/learn/config";

const TMP = join(import.meta.dir, ".tmp-config-test");

beforeEach(() => {
	rmSync(TMP, { recursive: true, force: true });
	mkdirSync(join(TMP, ".metis"), { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("loadProjectConfig", () => {
	test("defaults to standard when no config file", () => {
		rmSync(join(TMP, ".metis"), { recursive: true, force: true });
		const config = loadProjectConfig(TMP);
		expect(config.profile).toBe("standard");
		expect(config.overrides).toEqual({});
	});

	test("reads profile from config.json", () => {
		writeFileSync(
			join(TMP, ".metis", "config.json"),
			JSON.stringify({ profile: "strict" }),
		);
		const config = loadProjectConfig(TMP);
		expect(config.profile).toBe("strict");
	});

	test("reads overrides", () => {
		writeFileSync(
			join(TMP, ".metis", "config.json"),
			JSON.stringify({
				profile: "standard",
				overrides: { minConfidence: 0.8 },
			}),
		);
		const config = loadProjectConfig(TMP);
		expect(config.overrides.minConfidence).toBe(0.8);
	});

	test("rejects crossLanguageAllowed=true under strict", () => {
		writeFileSync(
			join(TMP, ".metis", "config.json"),
			JSON.stringify({
				profile: "strict",
				overrides: { crossLanguageAllowed: true },
			}),
		);
		expect(() => loadProjectConfig(TMP)).toThrow("cannot be true under strict");
	});

	test("rejects invalid profile", () => {
		writeFileSync(
			join(TMP, ".metis", "config.json"),
			JSON.stringify({ profile: "maximum" }),
		);
		expect(() => loadProjectConfig(TMP)).toThrow("Invalid profile");
	});
});

describe("getEffectiveConfig", () => {
	test("casual defaults", () => {
		const eff = getEffectiveConfig({ profile: "casual", overrides: {} });
		expect(eff.minConfidence).toBe(0);
		expect(eff.crossLanguageAllowed).toBe(true);
		expect(eff.requireQuotedSpans).toBe(false);
	});

	test("standard defaults", () => {
		const eff = getEffectiveConfig({ profile: "standard", overrides: {} });
		expect(eff.minConfidence).toBe(0.6);
		expect(eff.requireQuotedSpans).toBe(true);
	});

	test("strict defaults", () => {
		const eff = getEffectiveConfig({ profile: "strict", overrides: {} });
		expect(eff.minConfidence).toBe(0.7);
		expect(eff.crossLanguageAllowed).toBe(false);
		expect(eff.requireQuotedSpans).toBe(true);
	});

	test("overrides apply", () => {
		const eff = getEffectiveConfig({
			profile: "standard",
			overrides: { minConfidence: 0.9 },
		});
		expect(eff.minConfidence).toBe(0.9);
	});
});
