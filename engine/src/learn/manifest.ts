import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StrictnessProfile } from "./config";

export interface ManifestEntry {
	sourceId: string;
	relPath: string;
	contentHash: string;
	format: "epub" | "md" | "pdf";
	title: string;
	authors: string[];
	atomCount: number;
	learnedAt: string;
}

export interface Manifest {
	schemaVersion: number;
	profile: StrictnessProfile;
	lastLearnedAt: string;
	sources: ManifestEntry[];
}

export interface ScannedFile {
	relPath: string;
	contentHash: string;
	format: "epub" | "md" | "pdf";
}

export interface MatchResult {
	toLearn: Array<{
		kind: "new" | "changed";
		relPath: string;
		sourceId: string;
		contentHash: string;
		format: "epub" | "md" | "pdf";
	}>;
	toArchive: string[];
	unchanged: string[];
}

export function loadManifest(projectDir: string): Manifest | null {
	const path = join(projectDir, ".metis", "manifest.json");
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
}

export function emptyManifest(profile: StrictnessProfile): Manifest {
	return {
		schemaVersion: 1,
		profile,
		lastLearnedAt: "",
		sources: [],
	};
}

export function saveManifestAtomically(
	projectDir: string,
	manifest: Manifest,
): void {
	const dir = join(projectDir, ".metis");
	const finalPath = join(dir, "manifest.json");
	const tmpPath = join(dir, "manifest.json.tmp");
	writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
	renameSync(tmpPath, finalPath);
}

export function computeContentHash(filePath: string): string {
	const bytes = readFileSync(filePath);
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function detectFormat(relPath: string): "epub" | "md" | "pdf" | "pdf" | null {
	if (relPath.endsWith(".epub")) return "epub";
	if (relPath.endsWith(".pdf")) return "pdf";
	if (relPath.endsWith(".md") || relPath.endsWith(".markdown")) return "md";
	return null;
}

/**
 * Match scanned files to manifest entries.
 *
 * Pass 1: match by relPath.
 * Pass 2: match unmatched files by contentHash (rename detection).
 *         If multiple candidates share the same hash, treat as ambiguous.
 */
export function matchSources(
	scanned: ScannedFile[],
	manifest: Manifest,
): MatchResult {
	const toLearn: MatchResult["toLearn"] = [];
	const toArchive: string[] = [];
	const unchanged: string[] = [];

	const unmatchedManifest = new Map<string, ManifestEntry>();
	for (const entry of manifest.sources) {
		unmatchedManifest.set(entry.sourceId, entry);
	}
	const unmatchedFiles: ScannedFile[] = [];

	// Pass 1: match by relPath
	for (const file of scanned) {
		const entry = manifest.sources.find((e) => e.relPath === file.relPath);
		if (entry) {
			unmatchedManifest.delete(entry.sourceId);
			if (entry.contentHash === file.contentHash) {
				unchanged.push(entry.sourceId);
			} else {
				toArchive.push(entry.sourceId);
				toLearn.push({
					kind: "changed",
					relPath: file.relPath,
					sourceId: entry.sourceId,
					contentHash: file.contentHash,
					format: file.format,
				});
			}
		} else {
			unmatchedFiles.push(file);
		}
	}

	// Pass 2: rename detection by contentHash
	const stillUnmatched: ScannedFile[] = [];
	for (const file of unmatchedFiles) {
		const candidates = [...unmatchedManifest.values()].filter(
			(e) => e.contentHash === file.contentHash,
		);

		if (candidates.length === 1) {
			const entry = candidates[0] as ManifestEntry;
			unmatchedManifest.delete(entry.sourceId);
			unchanged.push(entry.sourceId);
			entry.relPath = file.relPath;
		} else {
			stillUnmatched.push(file);
		}
	}

	// Truly new files
	for (const file of stillUnmatched) {
		toLearn.push({
			kind: "new",
			relPath: file.relPath,
			sourceId: randomUUID().slice(0, 12),
			contentHash: file.contentHash,
			format: file.format,
		});
	}

	// Truly removed
	for (const [sourceId] of unmatchedManifest) {
		toArchive.push(sourceId);
	}

	return { toLearn, toArchive, unchanged };
}
