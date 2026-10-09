import type {
  CodeGraphEdge,
  CodeGraphImpactHit,
  CodeGraphImpactResult,
  CodeGraphNeighborhood,
  CodeGraphNode,
  CodeGraphSearchResult,
  CodeGraphSummary,
} from "@t3tools/contracts/fork";

/** Graphify's DEFAULT_AFFECTED_RELATIONS (graphify/affected.py, 0.9.83). */
export const IMPACT_RELATIONS: ReadonlySet<string> = new Set([
  "calls",
  "indirect_call",
  "references",
  "imports",
  "imports_from",
  "dynamic_import",
  "re_exports",
  "inherits",
  "extends",
  "implements",
  "uses",
  "mixes_in",
  "embeds",
  "requires",
]);

/** Member relations: a changed class also seeds its methods, as Graphify's walk does. */
const MEMBER_RELATIONS: ReadonlySet<string> = new Set(["method", "contains"]);

export const MAX_SEARCH_RESULTS = 50;
export const MAX_NEIGHBORHOOD_NODES = 80;
export const MAX_IMPACT_HITS = 300;
export const MAX_PATH_HOPS = 8;
const SUMMARY_COMMUNITIES = 30;
const SUMMARY_HUBS = 20;
const COMMUNITY_TOP_FILES = 3;

export interface IndexedNode extends CodeGraphNode {
  /** Imported packages and modules outside the scanned tree; they have no file. */
  readonly external: boolean;
}

export interface IndexedEdge {
  /** The other end: the target in `out`, the source in `in`. */
  readonly node: number;
  readonly relation: string;
  /** The edge's site in its source file. */
  readonly line: number | null;
}

export interface CodeGraphIndex {
  readonly graphifyVersion: string | null;
  readonly builtAtCommit: string | null;
  readonly nodes: ReadonlyArray<IndexedNode>;
  readonly byId: ReadonlyMap<string, number>;
  readonly out: ReadonlyArray<ReadonlyArray<IndexedEdge>>;
  readonly in: ReadonlyArray<ReadonlyArray<IndexedEdge>>;
  readonly byFile: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly edgeCount: number;
}

export type ParsedGraph =
  | { readonly ok: true; readonly index: CodeGraphIndex }
  | { readonly ok: false; readonly graphifyVersion: string | null; readonly problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseLine = (location: unknown) => {
  if (typeof location !== "string") return null;
  const match = /^L(\d+)/.exec(location);
  return match ? Number(match[1]) : null;
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Checks `graph.json` has the shape Loom reads and indexes it. Graphify writes NetworkX
 * node-link JSON; unknown keys are ignored. Every link is treated as directed, source to target,
 * whatever `directed` says, because relations have a direction.
 */
export const parseGraph = (json: unknown): ParsedGraph => {
  const meta = isRecord(json) && isRecord(json.graph) ? json.graph : {};
  const graphifyVersion = typeof meta.graphify_version === "string" ? meta.graphify_version : null;
  const invalid = (problem: string): ParsedGraph => ({ ok: false, graphifyVersion, problem });
  if (!isRecord(json)) return invalid("the file is not a JSON object");
  const rawNodes = json.nodes;
  const rawLinks = json.links ?? json.edges;
  if (!Array.isArray(rawNodes)) return invalid("it has no nodes array");
  if (!Array.isArray(rawLinks)) return invalid("it has no links array");

  const byId = new Map<string, number>();
  const drafts: Array<Omit<IndexedNode, "kind">> = [];
  for (const [i, raw] of rawNodes.entries()) {
    if (!isRecord(raw)) return invalid(`nodes[${i}] is not an object`);
    const { id, label, source_file: file } = raw;
    if (typeof id !== "string") return invalid(`nodes[${i}] has no id`);
    if (typeof label !== "string") return invalid(`nodes[${i}] has no label`);
    if (typeof file !== "string") return invalid(`nodes[${i}] has no source_file`);
    if (byId.has(id)) continue;
    byId.set(id, drafts.length);
    drafts.push({
      id,
      label,
      file,
      line: parseLine(raw.source_location),
      community: typeof raw.community === "number" ? raw.community : null,
      external: raw.external === true || file === "",
    });
  }

  const out: IndexedEdge[][] = drafts.map(() => []);
  const into: IndexedEdge[][] = drafts.map(() => []);
  const methods = new Set<number>();
  let edgeCount = 0;
  for (const [i, raw] of rawLinks.entries()) {
    if (!isRecord(raw)) return invalid(`links[${i}] is not an object`);
    const { source, target, relation } = raw;
    if (typeof source !== "string") return invalid(`links[${i}] has no source`);
    if (typeof target !== "string") return invalid(`links[${i}] has no target`);
    if (typeof relation !== "string") return invalid(`links[${i}] has no relation`);
    const from = byId.get(source);
    const to = byId.get(target);
    // NetworkX never writes a dangling link; skip one rather than refuse the graph.
    if (from === undefined || to === undefined) continue;
    const line = parseLine(raw.source_location);
    out[from]!.push({ node: to, relation, line });
    into[to]!.push({ node: from, relation, line });
    if (relation === "method") methods.add(to);
    edgeCount += 1;
  }

  const nodes = drafts.map((draft, i): IndexedNode => ({
    ...draft,
    kind:
      !draft.external && draft.label === basename(draft.file)
        ? "file"
        : methods.has(i)
          ? "method"
          : "symbol",
  }));
  const byFile = new Map<string, number[]>();
  for (const [i, node] of nodes.entries()) {
    if (node.external) continue;
    const list = byFile.get(node.file);
    if (list) list.push(i);
    else byFile.set(node.file, [i]);
  }

  return {
    ok: true,
    index: {
      graphifyVersion,
      builtAtCommit: typeof json.built_at_commit === "string" ? json.built_at_commit : null,
      nodes,
      byId,
      out,
      in: into,
      byFile,
      edgeCount,
    },
  };
};

export const toNode = (node: IndexedNode): CodeGraphNode => ({
  id: node.id,
  label: node.label,
  kind: node.kind,
  file: node.file,
  line: node.line,
  community: node.community,
});

/** Labels of functions end in `()`; queries match with or without it. */
const bare = (label: string) => label.replace(/\(\)$/, "").toLowerCase();

const isSubsequence = (needle: string, haystack: string) => {
  let at = 0;
  for (const char of haystack) if (char === needle[at]) at += 1;
  return at === needle.length;
};

const searchScore = (node: IndexedNode, query: string) => {
  const label = bare(node.label);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  if (node.file.toLowerCase().includes(query)) return 3;
  if (isSubsequence(query, label)) return 4;
  return null;
};

/** Symbols and files by name: exact, prefix, substring, file path, then subsequence. */
export const search = (
  index: CodeGraphIndex,
  rawQuery: string,
  limit = MAX_SEARCH_RESULTS,
): CodeGraphSearchResult => {
  const query = bare(rawQuery.trim());
  if (query === "") return { nodes: [], truncated: false };
  const scored = index.nodes.flatMap((node) => {
    if (node.external) return [];
    const score = searchScore(node, query);
    return score === null ? [] : [{ node, score }];
  });
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.node.label.length - b.node.label.length ||
      a.node.file.localeCompare(b.node.file) ||
      (a.node.line ?? 0) - (b.node.line ?? 0),
  );
  return {
    nodes: scored.slice(0, limit).map((entry) => toNode(entry.node)),
    truncated: scored.length > limit,
  };
};

/**
 * Finds the node an agent or a link names: a node id, an exact label (with or without `()`),
 * a file path, or else the best search hit.
 */
export const resolveNode = (index: CodeGraphIndex, query: string): number | null => {
  const trimmed = query.trim();
  const byId = index.byId.get(trimmed);
  if (byId !== undefined) return byId;
  const fileNodes = index.byFile.get(trimmed.replace(/^\.\//, ""));
  const fileNode = fileNodes?.find((i) => index.nodes[i]!.kind === "file");
  if (fileNode !== undefined) return fileNode;
  const best = search(index, trimmed, 1).nodes[0];
  return best ? (index.byId.get(best.id) ?? null) : null;
};

const neighbors = (index: CodeGraphIndex, node: number) => [
  ...index.out[node]!.map((edge) => edge.node),
  ...index.in[node]!.map((edge) => edge.node),
];

/** Nodes within `depth` hops in either direction, nearest first, plus the edges among them. */
export const neighborhood = (
  index: CodeGraphIndex,
  focus: number,
  depth: 1 | 2 = 2,
  limit = MAX_NEIGHBORHOOD_NODES,
): CodeGraphNeighborhood => {
  const depthOf = new Map<number, number>([[focus, 0]]);
  let frontier = [focus];
  let truncated = false;
  for (let level = 1; level <= depth && !truncated; level += 1) {
    const next: number[] = [];
    for (const node of frontier) {
      for (const other of neighbors(index, node)) {
        if (depthOf.has(other)) continue;
        if (depthOf.size > limit) {
          truncated = true;
          break;
        }
        depthOf.set(other, level);
        next.push(other);
      }
      if (truncated) break;
    }
    frontier = next;
  }

  const edges: CodeGraphEdge[] = [];
  const seen = new Set<string>();
  for (const from of depthOf.keys()) {
    for (const edge of index.out[from]!) {
      if (!depthOf.has(edge.node)) continue;
      const key = `${from}\u0000${edge.node}\u0000${edge.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: index.nodes[from]!.id,
        to: index.nodes[edge.node]!.id,
        relation: edge.relation,
      });
    }
  }
  return {
    focus: toNode(index.nodes[focus]!),
    nodes: [...depthOf]
      .filter(([node]) => node !== focus)
      .map(([node, level]) => ({ node: toNode(index.nodes[node]!), depth: level }))
      .sort((a, b) => a.depth - b.depth),
    edges,
    truncated,
  };
};

export interface PathStep {
  readonly node: IndexedNode;
  /** How this step connects to the previous one; null for the start. */
  readonly via: { readonly relation: string; readonly forward: boolean } | null;
}

/** Shortest path in either direction over any relation, at most `maxHops` hops. */
export const shortestPath = (
  index: CodeGraphIndex,
  start: number,
  end: number,
  maxHops = MAX_PATH_HOPS,
): ReadonlyArray<PathStep> | null => {
  const previous = new Map<number, { from: number; relation: string; forward: boolean } | null>([
    [start, null],
  ]);
  let frontier = [start];
  for (let hop = 0; hop < maxHops && !previous.has(end) && frontier.length > 0; hop += 1) {
    const next: number[] = [];
    for (const node of frontier) {
      const steps = [
        ...index.out[node]!.map((edge) => ({ edge, forward: true })),
        ...index.in[node]!.map((edge) => ({ edge, forward: false })),
      ];
      for (const { edge, forward } of steps) {
        if (previous.has(edge.node)) continue;
        previous.set(edge.node, { from: node, relation: edge.relation, forward });
        next.push(edge.node);
      }
    }
    frontier = next;
  }
  if (!previous.has(end)) return null;
  const path: PathStep[] = [];
  for (let at: number | undefined = end; at !== undefined;) {
    const step = previous.get(at);
    path.unshift({
      node: index.nodes[at]!,
      via: step ? { relation: step.relation, forward: step.forward } : null,
    });
    at = step?.from;
  }
  return path;
};

/**
 * What the changed files can affect: a reverse walk over Graphify's affected relations from
 * every node in those files, as `graphify affected` does. Hits in the changed files themselves
 * are skipped.
 */
export const impact = (
  index: CodeGraphIndex,
  files: ReadonlyArray<string>,
  depth: 1 | 2 | 3 = 2,
): Omit<CodeGraphImpactResult, "stale"> => {
  const changed = [...new Set(files.map((file) => file.replace(/^\.\//, "")))];
  const seedFiles = changed.filter((file) => index.byFile.has(file));
  const unknownFiles = changed.filter((file) => !index.byFile.has(file));

  const seen = new Set<number>();
  const queue: Array<{ node: number; depth: number }> = [];
  const seed = (node: number) => {
    if (seen.has(node)) return;
    seen.add(node);
    queue.push({ node, depth: 0 });
  };
  for (const file of seedFiles) for (const node of index.byFile.get(file)!) seed(node);
  // A copy: seeding members appends to the queue.
  for (const { node } of queue.slice()) {
    for (const edge of index.out[node]!) if (MEMBER_RELATIONS.has(edge.relation)) seed(edge.node);
  }

  const hits: Array<CodeGraphImpactHit & { fanIn: number }> = [];
  const communities = new Set<number>();
  for (const { node } of queue) {
    const community = index.nodes[node]!.community;
    if (community !== null) communities.add(community);
  }
  for (let at = 0; at < queue.length; at += 1) {
    const current = queue[at]!;
    if (current.depth >= depth) continue;
    for (const edge of index.in[current.node]!) {
      if (!IMPACT_RELATIONS.has(edge.relation) || seen.has(edge.node)) continue;
      seen.add(edge.node);
      const node = index.nodes[edge.node]!;
      queue.push({ node: edge.node, depth: current.depth + 1 });
      if (node.external) continue;
      if (node.community !== null) communities.add(node.community);
      hits.push({
        node: toNode(node),
        depth: current.depth + 1,
        viaRelation: edge.relation,
        viaNodeId: index.nodes[current.node]!.id,
        viaLine: edge.line,
        fanIn: index.in[edge.node]!.length,
      });
    }
  }

  hits.sort(
    (a, b) => a.depth - b.depth || b.fanIn - a.fanIn || a.node.file.localeCompare(b.node.file),
  );
  const byFile = new Map<string, { file: string; minDepth: number; hitCount: number }>();
  for (const hit of hits) {
    const entry = byFile.get(hit.node.file);
    if (entry) {
      entry.minDepth = Math.min(entry.minDepth, hit.depth);
      entry.hitCount += 1;
    } else {
      byFile.set(hit.node.file, { file: hit.node.file, minDepth: hit.depth, hitCount: 1 });
    }
  }
  return {
    seedFiles,
    unknownFiles,
    hits: hits.slice(0, MAX_IMPACT_HITS).map(({ fanIn: _fanIn, ...hit }) => hit),
    files: [...byFile.values()].sort(
      (a, b) => a.minDepth - b.minDepth || b.hitCount - a.hitCount || a.file.localeCompare(b.file),
    ),
    communities: communities.size,
    truncated: hits.length > MAX_IMPACT_HITS,
  };
};

const STRUCTURAL_RELATIONS: ReadonlySet<string> = new Set(["contains", "method"]);

/** Counts, the largest communities with their main files, and the most connected symbols. */
export const summary = (index: CodeGraphIndex): CodeGraphSummary => {
  const relations = new Map<string, number>();
  for (const edges of index.out) {
    for (const edge of edges) relations.set(edge.relation, (relations.get(edge.relation) ?? 0) + 1);
  }

  const communities = new Map<number, Map<string, number>>();
  let nodeCount = 0;
  for (const node of index.nodes) {
    if (node.external) continue;
    nodeCount += 1;
    if (node.community === null) continue;
    const files = communities.get(node.community) ?? new Map<string, number>();
    files.set(node.file, (files.get(node.file) ?? 0) + 1);
    communities.set(node.community, files);
  }

  const hubs = index.nodes.flatMap((node, i) => {
    if (node.external || node.kind === "file") return [];
    const degree = [...index.out[i]!, ...index.in[i]!].filter(
      (edge) => !STRUCTURAL_RELATIONS.has(edge.relation),
    ).length;
    return degree > 0 ? [{ node: toNode(node), degree }] : [];
  });

  return {
    nodeCount,
    edgeCount: index.edgeCount,
    fileCount: index.byFile.size,
    relations: [...relations]
      .map(([relation, count]) => ({ relation, count }))
      .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation)),
    communities: [...communities]
      .map(([community, files]) => ({
        community,
        size: [...files.values()].reduce((sum, count) => sum + count, 0),
        topFiles: [...files]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, COMMUNITY_TOP_FILES)
          .map(([file]) => file),
      }))
      .sort((a, b) => b.size - a.size || a.community - b.community)
      .slice(0, SUMMARY_COMMUNITIES),
    hubs: hubs
      .sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label))
      .slice(0, SUMMARY_HUBS),
  };
};
