import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { computeContentHash, detectFormat } from "./manifest";
import type { ScannedFile } from "./manifest";

/**
 * Recursively scan a sources/ directory for supported files.
 * Returns ScannedFile[] with relPath relative to project root.
 */
export function scanSources(projectDir: string): {
	files: ScannedFile[];
	unsupported: string[];
} {
	const sourcesDir = join(projectDir, "sources");
	const files: ScannedFile[] = [];
	const unsupported: string[] = [];

	try {
		walkDir(sourcesDir, (absPath) => {
			const relPath = relative(projectDir, absPath);
			const format = detectFormat(relPath);
			if (format) {
				files.push({
					relPath,
					contentHash: computeContentHash(absPath),
					format,
				});
			} else {
				unsupported.push(relPath);
			}
		});
	} catch {
		// sources/ doesn't exist yet — fine, return empty
	}

	return { files, unsupported };
}

function walkDir(dir: string, cb: (absPath: string) => void): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const absPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			walkDir(absPath, cb);
		} else if (entry.isFile()) {
			cb(absPath);
		}
	}
}
