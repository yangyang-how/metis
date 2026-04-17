import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type StrictnessProfile = "casual" | "standard" | "strict";

export interface ProjectConfig {
	profile: StrictnessProfile;
	overrides: {
		minConfidence?: number;
		crossLanguageAllowed?: boolean;
		requireQuotedSpans?: boolean;
	};
}

interface RawConfig {
	profile?: string;
	overrides?: Record<string, unknown>;
}

const PROFILE_DEFAULTS: Record<StrictnessProfile, ProjectConfig["overrides"] & { minConfidence: number; crossLanguageAllowed: boolean }> = {
	casual: { minConfidence: 0, crossLanguageAllowed: true },
	standard: { minConfidence: 0.6, crossLanguageAllowed: true },
	strict: { minConfidence: 0.7, crossLanguageAllowed: false },
};

export function loadProjectConfig(projectDir: string): ProjectConfig {
	const configPath = join(projectDir, ".metis", "config.json");

	if (!existsSync(configPath)) {
		return { profile: "standard", overrides: {} };
	}

	const raw: RawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
	const profile = validateProfile(raw.profile);
	const overrides = validateOverrides(raw.overrides ?? {}, profile);

	return { profile, overrides };
}

export function getEffectiveConfig(config: ProjectConfig): {
	minConfidence: number;
	crossLanguageAllowed: boolean;
	requireQuotedSpans: boolean;
} {
	const defaults = PROFILE_DEFAULTS[config.profile];
	return {
		minConfidence: config.overrides.minConfidence ?? defaults.minConfidence,
		crossLanguageAllowed:
			config.overrides.crossLanguageAllowed ?? defaults.crossLanguageAllowed,
		requireQuotedSpans:
			config.overrides.requireQuotedSpans ??
			config.profile !== "casual",
	};
}

function validateProfile(raw: unknown): StrictnessProfile {
	if (raw === "casual" || raw === "standard" || raw === "strict") return raw;
	if (raw === undefined || raw === null) return "standard";
	throw new Error(`Invalid profile: "${raw}". Must be casual, standard, or strict.`);
}

function validateOverrides(
	raw: Record<string, unknown>,
	profile: StrictnessProfile,
): ProjectConfig["overrides"] {
	const overrides: ProjectConfig["overrides"] = {};

	if ("minConfidence" in raw) {
		const v = raw.minConfidence;
		if (typeof v !== "number" || v < 0 || v > 1) {
			throw new Error("minConfidence must be a number between 0 and 1");
		}
		overrides.minConfidence = v;
	}

	if ("crossLanguageAllowed" in raw) {
		const v = raw.crossLanguageAllowed;
		if (typeof v !== "boolean") {
			throw new Error("crossLanguageAllowed must be a boolean");
		}
		if (v && profile === "strict") {
			throw new Error("crossLanguageAllowed cannot be true under strict profile");
		}
		overrides.crossLanguageAllowed = v;
	}

	if ("requireQuotedSpans" in raw) {
		const v = raw.requireQuotedSpans;
		if (typeof v !== "boolean") {
			throw new Error("requireQuotedSpans must be a boolean");
		}
		overrides.requireQuotedSpans = v;
	}

	return overrides;
}
