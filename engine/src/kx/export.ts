/**
 * Export a ContextPackage to KX format.
 *
 * Maps Metis atoms -> KXUnits, graph edges -> KXRelations,
 * and assembles a KXDocument with content addressing.
 */
import type { ContextPackage } from "../apply/types";
import type { Atom, GraphIndex } from "../integrate/types";
import { buildContent, frameToKXKind } from "./content";
import { computeContentId, computeDocId } from "./hash";
import type {
	KXDocument,
	KXProvenance,
	KXRelation,
	KXRelationType,
	KXSource,
	KXUnit,
	StrictnessProfile,
} from "./types";

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function formatLocation(source: Atom["source"]): string {
	const parts: string[] = [];
	if (source.chapterId) parts.push(`Ch.${source.chapterId}`);
	if (source.sectionId) parts.push(`§${source.sectionId}`);
	return parts.join(", ");
}

function atomToKXUnit(atom: Atom, sourceRef: string): KXUnit {
	const location = formatLocation(atom.source);
	const unit: KXUnit = {
		id: atom.id,
		kind: frameToKXKind(atom.frame),
		content: buildContent(atom.frame, atom.roles),
		roles: atom.roles,
		conditions: atom.conditions,
		confidence: atom.confidence,
		source: {
			ref: sourceRef,
			locations: location ? [location] : undefined,
		},
		domains: atom.domain,
	};

	if (atom.provenance) {
		const prov: KXProvenance = {
			quotedSpans: atom.provenance.quotedSpans,
			extraction: atom.provenance.extraction,
		};
		if (atom.provenance.roleSpans) prov.roleSpans = atom.provenance.roleSpans;
		if (atom.provenance.roleTypes) prov.roleTypes = atom.provenance.roleTypes;
		unit.provenance = prov;
	}

	return unit;
}

function atomSourcesToKXSources(atoms: Atom[]): KXSource[] {
	const seen = new Map<string, KXSource>();

	for (const atom of atoms) {
		const key = atom.source.title;
		if (!seen.has(key)) {
			const source: KXSource = {
				id: slugify(key),
				type: "book",
				title: atom.source.title,
				authors: atom.source.authors,
			};
			if (atom.source.sourceId) source.sourceId = atom.source.sourceId;
			if (atom.source.contentHash) source.contentHash = atom.source.contentHash;
			seen.set(key, source);
		}
	}

	return [...seen.values()];
}

const EDGE_TYPE_MAP: Record<string, KXRelationType | null> = {
	reinforces: "reinforces",
	contradicts: "contradicts",
	extends: "extends",
	entity_link: null,
	cross_domain: null,
};

function buildKXRelations(
	atoms: Atom[],
	graphIndex: GraphIndex,
): KXRelation[] {
	const atomIdSet = new Set(atoms.map((a) => a.id));
	const relations: KXRelation[] = [];

	for (const atom of atoms) {
		const edges = graphIndex[atom.id];
		if (!edges) continue;

		for (const edge of edges) {
			if (!atomIdSet.has(edge.target)) continue;
			const kxType = EDGE_TYPE_MAP[edge.type];
			if (!kxType) continue;

			relations.push({
				from: atom.id,
				to: edge.target,
				type: kxType,
				confidence: edge.confidence,
			});
		}
	}

	return relations;
}

export interface ExportOptions {
	profile?: StrictnessProfile;
}

export function exportToKX(
	pkg: ContextPackage,
	graphIndex: GraphIndex,
	options?: ExportOptions,
): KXDocument {
	const profile = options?.profile ?? "casual";
	const allAtoms = pkg.sections.flatMap((s) => s.atoms);
	const sources = atomSourcesToKXSources(allAtoms);
	const sourceRefMap = new Map(sources.map((s) => [s.title, s.id]));

	const units = allAtoms.map((atom) =>
		atomToKXUnit(atom, sourceRefMap.get(atom.source.title) ?? "unknown"),
	);

	const relations = buildKXRelations(allAtoms, graphIndex);

	const doc: KXDocument = {
		version: "kx/1.0",
		contentId: "",
		docId: "",
		profile,
		meta: {
			domains: [...new Set(units.flatMap((u) => u.domains))],
			sources,
			generatedBy: "metis/0.2",
			generatedAt: new Date().toISOString(),
		},
		units,
		relations,
	};

	doc.contentId = computeContentId(doc);
	doc.docId = computeDocId(doc);

	return doc;
}
