import { createHash } from "node:crypto";
import type { KXDocument } from "./types";

/**
 * Compute contentId — hash of the semantic payload only.
 * See design/07-knowledge-exchange.md §10 for exact field specification.
 */
export function computeContentId(doc: KXDocument): string {
	const payload = {
		meta: {
			domains: [...doc.meta.domains].sort(),
			sources: doc.meta.sources
				.map((s) => ({
					authors: s.authors,
					id: s.id,
					title: s.title,
					type: s.type,
				}))
				.sort((a, b) => a.id.localeCompare(b.id)),
		},
		relations: doc.relations
			.map((r) => ({ from: r.from, to: r.to, type: r.type }))
			.sort((a, b) =>
				`${a.from}:${a.to}:${a.type}`.localeCompare(
					`${b.from}:${b.to}:${b.type}`,
				),
			),
		units: doc.units
			.map((u) => ({
				conditions: u.conditions,
				domains: u.domains,
				kind: u.kind,
				roles: u.roles,
				sourceRef: u.source.ref,
			}))
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	};

	return `sha256:${sha256(canonicalize(payload))}`;
}

/**
 * Compute docId — hash of the full document excluding docId and contentId.
 */
export function computeDocId(doc: KXDocument): string {
	const { contentId: _c, docId: _d, ...rest } = doc;
	return `sha256:${sha256(canonicalize(rest))}`;
}

/**
 * Minimal JCS-like canonical JSON serialization.
 * Sorts keys lexicographically at every level.
 */
export function canonicalize(obj: unknown): string {
	if (obj === null || obj === undefined) return "null";
	if (typeof obj === "boolean") return obj.toString();
	if (typeof obj === "number") return JSON.stringify(obj);
	if (typeof obj === "string") return JSON.stringify(obj);

	if (Array.isArray(obj)) {
		return `[${obj.map((item) => canonicalize(item)).join(",")}]`;
	}

	if (typeof obj === "object") {
		const keys = Object.keys(obj as Record<string, unknown>).sort();
		const entries = keys
			.filter(
				(k) => (obj as Record<string, unknown>)[k] !== undefined,
			)
			.map(
				(k) =>
					`${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`,
			);
		return `{${entries.join(",")}}`;
	}

	return JSON.stringify(obj);
}

function sha256(data: string): string {
	return createHash("sha256").update(data, "utf-8").digest("hex");
}
