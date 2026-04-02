/**
 * Knowledge graph visualizer — generates an HTML report from graph/*.json
 *
 * Usage: bun run src/visualize-graph.ts
 * Output: engine/graph/index.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Atom } from "./integrate/types";
import type { Entity, EntityIndex, GraphIndex } from "./integrate/types";

const GRAPH_DIR = join(new URL(".", import.meta.url).pathname, "../graph");

function main() {
	const atoms: Atom[] = JSON.parse(
		readFileSync(join(GRAPH_DIR, "atoms.json"), "utf8"),
	);
	const entities: EntityIndex = JSON.parse(
		readFileSync(join(GRAPH_DIR, "entities.json"), "utf8"),
	);
	const graph: GraphIndex = JSON.parse(
		readFileSync(join(GRAPH_DIR, "graph.json"), "utf8"),
	);

	const entityList = Object.values(entities);

	// Domain stats
	const domainCounts: Record<string, number> = {};
	for (const e of entityList) {
		domainCounts[e.domain] = (domainCounts[e.domain] ?? 0) + 1;
	}
	const topDomains = Object.entries(domainCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20);

	// Frame type stats
	const frameCounts: Record<string, number> = {};
	for (const a of atoms) {
		frameCounts[a.frame] = (frameCounts[a.frame] ?? 0) + 1;
	}
	const topFrames = Object.entries(frameCounts)
		.sort((a, b) => b[1] - a[1]);

	// Edge stats
	const edgeTypes: Record<string, number> = {};
	for (const edges of Object.values(graph)) {
		for (const e of edges) {
			edgeTypes[e.type] = (edgeTypes[e.type] ?? 0) + 1;
		}
	}

	// Book stats
	const bookAtomCounts: Record<string, number> = {};
	for (const a of atoms) {
		bookAtomCounts[a.source.title] = (bookAtomCounts[a.source.title] ?? 0) + 1;
	}

	// Cross-domain links
	const crossDomainEntities = entityList
		.filter((e) => e.crossDomainLinks.length > 0)
		.sort((a, b) => b.crossDomainLinks.length - a.crossDomainLinks.length)
		.slice(0, 30);

	// Most connected atoms (by graph edges)
	const atomEdgeCounts = Object.entries(graph)
		.map(([id, edges]) => ({ id, count: edges.length }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 20);

	// Entities with most atoms
	const bigEntities = entityList
		.sort((a, b) => b.atomIds.length - a.atomIds.length)
		.slice(0, 20);

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Metis Knowledge Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; line-height: 1.6; }
  h1 { color: #58a6ff; font-size: 1.8rem; margin-bottom: 0.5rem; }
  h2 { color: #d2a8ff; font-size: 1.2rem; margin: 2rem 0 1rem; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }
  .subtitle { color: #8b949e; margin-bottom: 2rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .stat { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.25rem; }
  .stat .value { font-size: 2rem; font-weight: bold; color: #58a6ff; }
  .stat .label { color: #8b949e; font-size: 0.85rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th { text-align: left; padding: 0.5rem 0.75rem; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; border-bottom: 1px solid #21262d; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #161b22; font-size: 0.9rem; }
  .bar { height: 6px; background: #58a6ff; border-radius: 3px; display: inline-block; vertical-align: middle; }
  .tag { display: inline-block; background: rgba(88,166,255,0.1); color: #58a6ff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; margin: 0.1rem; }
  .tag.purple { background: rgba(210,168,255,0.1); color: #d2a8ff; }
  .tag.green { background: rgba(63,185,80,0.1); color: #3fb950; }
  .tag.orange { background: rgba(240,136,62,0.1); color: #f0883e; }
  .section { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.25rem; margin: 1rem 0; }
  .link-list { display: flex; flex-wrap: wrap; gap: 0.25rem; }
</style>
</head>
<body>
<h1>Metis Knowledge Graph</h1>
<p class="subtitle">Generated ${new Date().toISOString().split("T")[0]} from ${Object.keys(bookAtomCounts).length} books</p>

<div class="stats">
  <div class="stat"><div class="value">${atoms.length.toLocaleString()}</div><div class="label">Atoms</div></div>
  <div class="stat"><div class="value">${entityList.length.toLocaleString()}</div><div class="label">Entities</div></div>
  <div class="stat"><div class="value">${Object.keys(domainCounts).length}</div><div class="label">Domains</div></div>
  <div class="stat"><div class="value">${crossDomainEntities.length > 0 ? entityList.filter((e) => e.crossDomainLinks.length > 0).length : 0}</div><div class="label">Cross-domain Links</div></div>
  <div class="stat"><div class="value">${(edgeTypes.entity_link ?? 0).toLocaleString()}</div><div class="label">Entity Edges</div></div>
  <div class="stat"><div class="value">${(edgeTypes.cross_domain ?? 0).toLocaleString()}</div><div class="label">Cross-domain Edges</div></div>
</div>

<h2>Books</h2>
<div class="section">
<table>
<tr><th>Book</th><th>Atoms</th><th></th></tr>
${Object.entries(bookAtomCounts)
	.sort((a, b) => b[1] - a[1])
	.map(([title, count]) => {
		const pct = (count / atoms.length) * 100;
		return `<tr><td>${escHtml(title.slice(0, 60))}</td><td>${count}</td><td><span class="bar" style="width:${pct}%"></span></td></tr>`;
	})
	.join("\n")}
</table>
</div>

<h2>Frame Types</h2>
<div class="section">
<table>
<tr><th>Frame</th><th>Count</th><th></th></tr>
${topFrames
	.map(([frame, count]) => {
		const pct = (count / atoms.length) * 100;
		return `<tr><td><code>${frame}</code></td><td>${count}</td><td><span class="bar" style="width:${pct}%"></span></td></tr>`;
	})
	.join("\n")}
</table>
</div>

<h2>Top Domains</h2>
<div class="section">
<table>
<tr><th>Domain</th><th>Entities</th><th></th></tr>
${topDomains
	.map(([domain, count]) => {
		const pct = (count / entityList.length) * 100;
		return `<tr><td>${escHtml(domain)}</td><td>${count}</td><td><span class="bar" style="width:${Math.max(pct, 1)}%"></span></td></tr>`;
	})
	.join("\n")}
</table>
</div>

<h2>Largest Entities (Most Atoms)</h2>
<div class="section">
<table>
<tr><th>Entity</th><th>Domain</th><th>Atoms</th><th>Aliases</th></tr>
${bigEntities
	.map(
		(e) =>
			`<tr><td><strong>${escHtml(e.canonicalName)}</strong></td><td><span class="tag">${escHtml(e.domain)}</span></td><td>${e.atomIds.length}</td><td>${e.aliases.slice(0, 3).map((a) => `<span class="tag purple">${escHtml(a.slice(0, 30))}</span>`).join(" ")}</td></tr>`,
	)
	.join("\n")}
</table>
</div>

<h2>Cross-Domain Connections</h2>
<div class="section">
<table>
<tr><th>Entity</th><th>Domain</th><th>Links To</th></tr>
${crossDomainEntities
	.slice(0, 20)
	.map((e) => {
		const links = e.crossDomainLinks
			.map((id) => {
				const target = entities[id];
				return target
					? `<span class="tag green">${escHtml(target.canonicalName.slice(0, 25))} (${escHtml(target.domain.slice(0, 15))})</span>`
					: "";
			})
			.join(" ");
		return `<tr><td><strong>${escHtml(e.canonicalName.slice(0, 40))}</strong></td><td><span class="tag">${escHtml(e.domain)}</span></td><td><div class="link-list">${links}</div></td></tr>`;
	})
	.join("\n")}
</table>
</div>

<h2>Most Connected Atoms</h2>
<div class="section">
<table>
<tr><th>Atom ID</th><th>Frame</th><th>Key Role</th><th>Edges</th></tr>
${atomEdgeCounts
	.map(({ id, count }) => {
		const atom = atoms.find((a) => a.id === id);
		if (!atom) return "";
		const keyRole = Object.values(atom.roles)[0] ?? "";
		return `<tr><td><code>${escHtml(id.slice(0, 40))}</code></td><td><span class="tag orange">${atom.frame}</span></td><td>${escHtml(keyRole.slice(0, 50))}</td><td>${count}</td></tr>`;
	})
	.join("\n")}
</table>
</div>

</body>
</html>`;

	const outPath = join(GRAPH_DIR, "index.html");
	writeFileSync(outPath, html);
	console.error(`Graph report written to ${outPath}`);
}

function escHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

main();
