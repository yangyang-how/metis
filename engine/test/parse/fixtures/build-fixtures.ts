import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
/**
 * Build test fixture EPUBs from raw directory structures.
 *
 * EPUB zip requirements (non-obvious):
 * - The "mimetype" file MUST be the first entry in the zip
 * - The "mimetype" file MUST be stored uncompressed (compression level 0)
 * - All other files use normal compression
 *
 * This runs once via beforeAll() in tests, or manually with `bun run test/parse/fixtures/build-fixtures.ts`.
 */
import type { Zippable } from "fflate";
import { zipSync } from "fflate";

const fixturesDir = new URL(".", import.meta.url).pathname;

function collectFiles(dir: string): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	const entries = readdirSync(dir, { recursive: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry as string);
		if (statSync(fullPath).isFile()) {
			const relPath = relative(dir, fullPath);
			files.set(relPath, readFileSync(fullPath));
		}
	}
	return files;
}

function buildEpub(fixtureDir: string, outputPath: string): void {
	const files = collectFiles(fixtureDir);

	const zipInput: Zippable = {};

	// mimetype MUST be first and uncompressed
	const mimetype = files.get("mimetype");
	if (mimetype) {
		zipInput.mimetype = [mimetype, { level: 0 as const }];
		files.delete("mimetype");
	}

	for (const [path, data] of files) {
		zipInput[path] = [data, { level: 6 as const }];
	}

	const zipped = zipSync(zipInput);
	writeFileSync(outputPath, zipped);
}

export function buildFixtures(): void {
	const fixtures = ["minimal", "epub2", "no-nav", "drm"];
	for (const name of fixtures) {
		const dir = join(fixturesDir, name);
		const out = join(fixturesDir, `${name}.epub`);
		if (existsSync(dir)) {
			buildEpub(dir, out);
		}
	}
}

// Allow running directly: bun run test/parse/fixtures/build-fixtures.ts
if (import.meta.main) {
	buildFixtures();
	console.log("Fixtures built.");
}
