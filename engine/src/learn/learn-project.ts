import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateAtom } from "../extract/types";
import { integrate } from "../integrate/index";
import type { KnowledgeGraph } from "../integrate/types";
import type { EmbeddingProvider } from "../llm/embedding-types";
import type { LLMProvider } from "../llm/types";
import { parseFile } from "../parse/index";
import { getEffectiveConfig, loadProjectConfig } from "./config";
import type { ProjectConfig, StrictnessProfile } from "./config";
import { learnSource } from "./learn-source";
import {
	emptyManifest,
	loadManifest,
	matchSources,
	saveManifestAtomically,
} from "./manifest";
import type { Manifest, ManifestEntry } from "./manifest";
import { scanSources } from "./scan-sources";

export interface LearnProjectInput {
	projectDir: string;
	rebuild?: boolean;
	comprehendProvider: LLMProvider;
	extractProvider: LLMProvider;
	integrateProvider: LLMProvider;
	embeddingProvider: EmbeddingProvider;
	onProgress?: (msg: string) => void;
}

export interface LearnProjectResult {
	learned: number;
	archived: number;
	unchanged: number;
	totalAtoms: number;
	unsupportedFiles: string[];
}

export async function learnProject(
	input: LearnProjectInput,
): Promise<LearnProjectResult> {
	const {
		projectDir,
		rebuild,
		comprehendProvider,
		extractProvider,
		integrateProvider,
		embeddingProvider,
		onProgress = (msg) => console.error(msg),
	} = input;

	const metisDir = join(projectDir, ".metis");
	mkdirSync(metisDir, { recursive: true });

	const config = loadProjectConfig(projectDir);
	const profile = config.profile;

	let manifest: Manifest;
	if (rebuild) {
		onProgress("[learn] Rebuild mode — archiving existing state...");
		archiveFullState(metisDir);
		manifest = emptyManifest(profile);
	} else {
		manifest = loadManifest(projectDir) ?? emptyManifest(profile);
	}
	const { files: scanned, unsupported } = scanSources(projectDir);

	if (unsupported.length > 0) {
		onProgress(
			`[learn] ${unsupported.length} unsupported file(s) skipped: ${unsupported.slice(0, 3).join(", ")}`,
		);
	}

	const { toLearn, toArchive, unchanged } = matchSources(scanned, manifest);

	if (toLearn.length === 0 && toArchive.length === 0) {
		onProgress("[learn] Up to date.");
		return {
			learned: 0,
			archived: 0,
			unchanged: unchanged.length,
			totalAtoms: manifest.sources.reduce((sum, s) => sum + s.atomCount, 0),
			unsupportedFiles: unsupported,
		};
	}

	onProgress(
		`[learn] ${toLearn.length} to learn, ${toArchive.length} to archive, ${unchanged.length} unchanged`,
	);

	// Load existing atoms (or start fresh)
	let liveAtoms = loadAtoms(metisDir);

	// Archive before removal
	for (const sid of toArchive) {
		const entry = manifest.sources.find((s) => s.sourceId === sid);
		if (entry) {
			const oldAtoms = liveAtoms.filter(
				(a) => a.source.sourceId === sid,
			);
			archiveAtoms(metisDir, sid, entry.contentHash, oldAtoms);
			liveAtoms = liveAtoms.filter((a) => a.source.sourceId !== sid);
			manifest.sources = manifest.sources.filter(
				(s) => s.sourceId !== sid,
			);
			onProgress(`[learn] Archived ${oldAtoms.length} atoms from ${entry.relPath}`);
		}
	}

	// Learn new/changed sources
	let atomsChanged = toArchive.length > 0;

	for (const item of toLearn) {
		onProgress(`[learn] Processing ${item.relPath}...`);
		const absPath = join(projectDir, item.relPath);
		const tree = await parseFile(absPath);

		const result = await learnSource({
			tree,
			sourceId: item.sourceId,
			contentHash: item.contentHash,
			profile,
			comprehendProvider,
			extractProvider,
		});

		liveAtoms.push(...result.atoms);
		atomsChanged = true;

		const entry: ManifestEntry = {
			sourceId: item.sourceId,
			relPath: item.relPath,
			contentHash: item.contentHash,
			format: item.format,
			title: tree.metadata.title,
			authors: tree.metadata.authors,
			atomCount: result.atoms.length,
			learnedAt: new Date().toISOString(),
		};

		const existingIdx = manifest.sources.findIndex(
			(s) => s.sourceId === item.sourceId,
		);
		if (existingIdx >= 0) {
			manifest.sources[existingIdx] = entry;
		} else {
			manifest.sources.push(entry);
		}

		onProgress(
			`[learn]   → ${result.atoms.length} atoms (${result.rejectedAtoms} rejected, ${result.skippedSections.length} sections skipped)`,
		);
	}

	// Full-rebuild integration if anything changed
	if (atomsChanged) {
		onProgress("[learn] Rebuilding graph from full atom set...");

		const graph = await integrate({
			atoms: liveAtoms,
			metadata: {
				title: "Project Graph",
				authors: [],
			},
			existingGraph: null,
			llmProvider: integrateProvider,
			embeddingProvider,
		});

		saveGraph(metisDir, graph);
		onProgress(
			`[learn] Graph: ${graph.stats.totalAtoms} atoms, ${graph.stats.totalEntities} entities`,
		);
	}

	manifest.lastLearnedAt = new Date().toISOString();
	saveManifestAtomically(projectDir, manifest);

	return {
		learned: toLearn.length,
		archived: toArchive.length,
		unchanged: unchanged.length,
		totalAtoms: liveAtoms.length,
		unsupportedFiles: unsupported,
	};
}

function loadAtoms(metisDir: string): CandidateAtom[] {
	const path = join(metisDir, "atoms.json");
	if (!existsSync(path)) return [];
	return JSON.parse(readFileSync(path, "utf-8")) as CandidateAtom[];
}

function saveGraph(metisDir: string, graph: KnowledgeGraph): void {
	writeFileSync(
		join(metisDir, "atoms.json"),
		JSON.stringify(graph.atoms, null, 2),
	);
	writeFileSync(
		join(metisDir, "entities.json"),
		JSON.stringify(graph.entities, null, 2),
	);
	writeFileSync(
		join(metisDir, "graph.json"),
		JSON.stringify(graph.graph, null, 2),
	);
	writeFileSync(
		join(metisDir, "embeddings.json"),
		JSON.stringify(graph.embeddings, null, 2),
	);
}

function archiveAtoms(
	metisDir: string,
	sourceId: string,
	contentHash: string,
	atoms: CandidateAtom[],
): void {
	if (atoms.length === 0) return;
	const hash = contentHash.replace("sha256:", "").slice(0, 16);
	const dir = join(metisDir, "history", sourceId, hash);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "atoms.json"),
		JSON.stringify(
			{
				sourceId,
				contentHash,
				archivedAt: new Date().toISOString(),
				reason: "source-changed",
				atoms,
			},
			null,
			2,
		),
	);
}

function archiveFullState(metisDir: string): void {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const archiveDir = join(metisDir, "history", `rebuild-${timestamp}`);
	mkdirSync(archiveDir, { recursive: true });

	for (const file of ["atoms.json", "entities.json", "graph.json", "embeddings.json"]) {
		const src = join(metisDir, file);
		if (existsSync(src)) {
			writeFileSync(join(archiveDir, file), readFileSync(src));
		}
	}
}
