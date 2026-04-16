import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	emptyManifest,
	loadManifest,
	matchSources,
	saveManifestAtomically,
} from "../../src/learn/manifest";
import type { Manifest, ScannedFile } from "../../src/learn/manifest";

const TMP = join(import.meta.dir, ".tmp-manifest-test");

beforeEach(() => {
	rmSync(TMP, { recursive: true, force: true });
	mkdirSync(join(TMP, ".metis"), { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("loadManifest", () => {
	test("returns null when no manifest", () => {
		expect(loadManifest(TMP)).toBeNull();
	});

	test("loads existing manifest", () => {
		const m = emptyManifest("standard");
		writeFileSync(join(TMP, ".metis", "manifest.json"), JSON.stringify(m));
		const loaded = loadManifest(TMP);
		expect(loaded).not.toBeNull();
		expect(loaded!.schemaVersion).toBe(1);
	});
});

describe("saveManifestAtomically", () => {
	test("writes manifest via tmp + rename", () => {
		const m = emptyManifest("strict");
		m.lastLearnedAt = "2026-04-15T00:00:00Z";
		saveManifestAtomically(TMP, m);
		const raw = readFileSync(join(TMP, ".metis", "manifest.json"), "utf-8");
		const loaded = JSON.parse(raw);
		expect(loaded.profile).toBe("strict");
		expect(loaded.lastLearnedAt).toBe("2026-04-15T00:00:00Z");
	});
});

describe("matchSources", () => {
	const manifest: Manifest = {
		schemaVersion: 1,
		profile: "standard",
		lastLearnedAt: "2026-04-15T00:00:00Z",
		sources: [
			{
				sourceId: "aaa",
				relPath: "sources/book-a.epub",
				contentHash: "sha256:aaaa",
				format: "epub",
				title: "Book A",
				authors: [],
				atomCount: 10,
				learnedAt: "2026-04-15T00:00:00Z",
			},
			{
				sourceId: "bbb",
				relPath: "sources/notes.md",
				contentHash: "sha256:bbbb",
				format: "md",
				title: "Notes",
				authors: [],
				atomCount: 5,
				learnedAt: "2026-04-15T00:00:00Z",
			},
		],
	};

	test("detects unchanged files", () => {
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
			{ relPath: "sources/notes.md", contentHash: "sha256:bbbb", format: "md" },
		];
		const result = matchSources(scanned, manifest);
		expect(result.unchanged).toHaveLength(2);
		expect(result.toLearn).toHaveLength(0);
		expect(result.toArchive).toHaveLength(0);
	});

	test("detects changed files", () => {
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
			{ relPath: "sources/notes.md", contentHash: "sha256:CHANGED", format: "md" },
		];
		const result = matchSources(scanned, manifest);
		expect(result.unchanged).toHaveLength(1);
		expect(result.toLearn).toHaveLength(1);
		expect(result.toLearn[0]!.kind).toBe("changed");
		expect(result.toLearn[0]!.sourceId).toBe("bbb");
		expect(result.toArchive).toContain("bbb");
	});

	test("detects new files", () => {
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
			{ relPath: "sources/notes.md", contentHash: "sha256:bbbb", format: "md" },
			{ relPath: "sources/new-paper.md", contentHash: "sha256:cccc", format: "md" },
		];
		const result = matchSources(scanned, manifest);
		expect(result.toLearn).toHaveLength(1);
		expect(result.toLearn[0]!.kind).toBe("new");
		expect(result.toLearn[0]!.sourceId).toHaveLength(12);
	});

	test("detects removed files", () => {
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
		];
		const result = matchSources(scanned, manifest);
		expect(result.toArchive).toContain("bbb");
	});

	test("detects renames via contentHash", () => {
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
			{ relPath: "sources/renamed-notes.md", contentHash: "sha256:bbbb", format: "md" },
		];
		const result = matchSources(scanned, manifest);
		expect(result.unchanged).toHaveLength(2);
		expect(result.toLearn).toHaveLength(0);
		expect(result.toArchive).toHaveLength(0);
	});

	test("ambiguous hash match assigns new sourceIds", () => {
		const manifestWithDupes: Manifest = {
			...manifest,
			sources: [
				...manifest.sources,
				{
					sourceId: "ccc",
					relPath: "sources/copy.md",
					contentHash: "sha256:bbbb",
					format: "md",
					title: "Copy",
					authors: [],
					atomCount: 5,
					learnedAt: "2026-04-15T00:00:00Z",
				},
			],
		};
		const scanned: ScannedFile[] = [
			{ relPath: "sources/book-a.epub", contentHash: "sha256:aaaa", format: "epub" },
			{ relPath: "sources/something-else.md", contentHash: "sha256:bbbb", format: "md" },
		];
		const result = matchSources(scanned, manifestWithDupes);
		const newFile = result.toLearn.find(
			(l) => l.relPath === "sources/something-else.md",
		);
		expect(newFile).toBeDefined();
		expect(newFile!.kind).toBe("new");
	});
});
