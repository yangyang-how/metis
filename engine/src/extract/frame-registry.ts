/**
 * Frame type registry — the vocabulary of knowledge representation.
 *
 * 17 core types ship with Metis (loaded from core-frames.json).
 * Domain types are proposed during extraction and registered at runtime.
 * Core types are fixed; domain types are extensible.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameType, FrameTypeRegistry, ProposedFrameType } from "./types";

const CORE_FRAMES_PATH = join(
	new URL(".", import.meta.url).pathname,
	"../../data/core-frames.json",
);

export function createRegistry(): FrameTypeRegistry {
	const types = new Map<string, FrameType>();

	// Load core types from JSON
	const raw = readFileSync(CORE_FRAMES_PATH, "utf-8");
	const coreTypes: FrameType[] = JSON.parse(raw);
	for (const ft of coreTypes) {
		types.set(ft.name, ft);
	}

	return {
		get(name: string): FrameType | undefined {
			return types.get(name);
		},

		getAll(): FrameType[] {
			return Array.from(types.values());
		},

		getCoreTypes(): FrameType[] {
			return Array.from(types.values()).filter((ft) => ft.category === "core");
		},

		has(name: string): boolean {
			return types.has(name);
		},

		register(proposed: ProposedFrameType): FrameType {
			// Deduplication: if type already exists, return existing
			const existing = types.get(proposed.name);
			if (existing) return existing;

			// Validation
			const roleCount = Object.keys(proposed.roles).length;
			if (roleCount < 2) {
				throw new Error(
					`Proposed frame type "${proposed.name}" must have at least 2 roles (has ${roleCount})`,
				);
			}
			if (!proposed.description.trim()) {
				throw new Error(
					`Proposed frame type "${proposed.name}" must have a description`,
				);
			}

			const frameType: FrameType = {
				name: proposed.name,
				roles: proposed.roles,
				requiredRoles: Object.keys(proposed.roles), // all roles required by default for domain types
				description: proposed.description,
				category: "domain-specific",
				version: 1,
			};

			types.set(proposed.name, frameType);
			return frameType;
		},
	};
}
