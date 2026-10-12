import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
const root = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const data = JSON.parse(await NodeFSP.readFile(NodePath.join(root, "packets.json"), "utf8"));
const ids = data.packets.map((p) => p.id);
const selected = Array.from({ length: 18 }, (_, i) => i + 1).filter((i) => i !== 14);
if (
  JSON.stringify(ids) !== JSON.stringify(selected) ||
  data.excluded.length !== 1 ||
  data.excluded[0].id !== 14
)
  throw new Error("All selected ideas must be documented, with only #14 excluded.");
const seen = new Set();
for (const id of data.executionOrder) {
  const p = data.packets.find((p) => p.id === id);
  if (!p || seen.has(id) || p.dependsOn.some((dep) => !seen.has(dep)))
    throw new Error("Execution order must cover dependencies without cycles.");
  seen.add(id);
}
if (seen.size !== ids.length) throw new Error("Execution order is incomplete.");
const filename = (p) =>
  String(p.id).padStart(2, "0") + "-" + p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const bullets = (values) => values.map((v) => "- " + v).join("\n");
const links = (ids) =>
  ids.length
    ? ids
        .map((id) => "[#" + id + "](" + filename(data.packets.find((p) => p.id === id)) + ")")
        .join(", ")
    : "None";
const files = new Map();
for (const p of data.packets) {
  files.set(
    filename(p),
    `# ${p.id}. ${p.title}\n\n${p.summary}\n\nStatus: **${p.status}**. Complexity: **${p.complexity}**. Impact: **${p.impact}**.\n\nOwner: ${p.owner}. Dependencies: ${links(p.dependsOn)}.\n\n## Scope\n\n${bullets(p.scope)}\n\n## Acceptance\n\n${bullets(p.acceptance)}\n\n## Delivery\n\n${p.delivery}\n\n## Evidence\n\n${p.evidence.length ? bullets(p.evidence) : "No completion evidence yet. Approved scope remains open."}\n`,
  );
}
files.set(
  "README.md",
  `# LoomOS implementation packets\n\n${data.decision} Original idea numbers are stable. #14, Saved project workspaces, is excluded.\n\nThe canonical packet data is [packets.json](packets.json). Read the [interactive review](index.html), or open individual packets below. Regenerate these views with \`node deploy/omarchy/packets/render.mjs\`; verify consistency with \`--check\`.\n\n## Boundaries\n\n${bullets(data.principles)}\n\n## Execution order\n\nDependencies determine this order; independent packets can proceed when useful. Laptop hardware acceptance and deployment may wait for the machine. Approved does not mean implemented.\n\n| Packet | Status | Dependencies |\n| --- | --- | --- |\n${data.executionOrder
    .map((id) => data.packets.find((p) => p.id === id))
    .map(
      (p) =>
        `| [${p.id}. ${p.title}](${filename(p)}) | ${p.status} | ${p.dependsOn.map((id) => "#" + id).join(", ") || "None"} |`,
    )
    .join("\n")}\n`,
);
const list = (values) => "<ul>" + values.map((v) => "<li>" + esc(v) + "</li>").join("") + "</ul>";
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LoomOS implementation packets</title><style>
:root{--foreground:#eee9f1;--muted-foreground:#b5aabb;--card:#25202d;--border:#3a3142;--accent:#c5a8dd;--background:#1a1720;--radius:12px;--font-sans:system-ui,sans-serif}html[data-standalone]{background:var(--background)}html,body{background:transparent;color:var(--foreground);font-family:var(--font-sans);margin:0}main{max-width:900px;margin:auto}h1{font-size:26px;line-height:1.2;font-weight:650;margin:0 0 12px}h2{font-size:18px;margin:22px 0 8px}p,li{line-height:1.55;font-size:15px;overflow-wrap:anywhere}p{max-width:74ch}p,ul{margin:8px 0 16px}ul{padding-left:22px}small,.muted{color:var(--muted-foreground)}label{display:block;font-size:14px;margin:18px 0 7px}input{box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:8px;color:var(--foreground);background:var(--card);font:inherit}input:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}details{border-bottom:1px solid var(--border);padding:16px 0}summary{cursor:pointer;line-height:1.45;font-weight:600;list-style:none;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}summary::-webkit-details-marker{display:none}.number{color:var(--muted-foreground);font-size:14px;min-width:30px}.title{flex:1;min-width:160px}.status{font-size:12px;font-weight:500;background:var(--card);border-radius:6px;padding:4px 8px;color:var(--muted-foreground)}.active{color:var(--accent)}.body{padding:8px 0 4px 42px;max-width:75ch}.body h3{font-size:15px;margin:18px 0 8px}.body a{color:var(--accent)}.meta{font-size:13px;color:var(--muted-foreground)}[hidden]{display:none!important}@media(max-width:460px){h1{font-size:23px}.body{padding-left:0}.status{margin-left:42px}.title{min-width:200px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style><main><h1>Approved LoomOS packets</h1><p>17 selected improvements, ordered by dependency. Saved project workspaces (#14) are excluded. Open a packet to review its full scope and acceptance checks.</p><p class="muted">Preserve Omarchy's character. Keep Iris consistent. Apps own their data. Every AI route uses Switchboard.</p><label for="query">Find a packet by name, number or capability</label><input id="query" type="search" placeholder="Search capture, offline, connections…"><p id="count" class="meta" aria-live="polite">17 packets</p>
${data.executionOrder
  .map((id) => data.packets.find((p) => p.id === id))
  .map(
    (p) =>
      `<details id="packet-${p.id}" data-search="${esc(p.id + " " + p.title + " " + p.summary + " " + p.scope.join(" "))}" ${p.id === 1 ? "open" : ""}><summary><span class="number">#${p.id}</span><span class="title">${esc(p.title)}</span><span class="status ${["in_progress", "verification_pending"].includes(p.status) ? "active" : ""}">${esc(p.status.replaceAll("_", " "))}</span></summary><div class="body"><p>${esc(p.summary)}</p><p class="meta">${esc(p.complexity)} complexity; ${esc(p.impact)} impact. Dependencies: ${p.dependsOn.map((id) => `<a href="#packet-${id}">#${id}</a>`).join(", ") || "none"}.</p><h3>Scope</h3>${list(p.scope)}<h3>Acceptance</h3>${list(p.acceptance)}<h3>Delivery</h3><p>${esc(p.delivery)}</p><h3>Evidence</h3>${p.evidence.length ? list(p.evidence) : '<p class="muted">No completion evidence yet. Approved scope remains open.</p>'}</div></details>`,
  )
  .join("\n")}
<p class="muted">Update the canonical packet record as each release is verified. Preparation, installation and physical acceptance are separate states.</p></main><script>if(window.self===window.top)document.documentElement.dataset.standalone="";const input=document.querySelector('#query'),rows=[...document.querySelectorAll('details')];input.addEventListener('input',()=>{const terms=input.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);let shown=0;rows.forEach(row=>{row.hidden=!terms.every(t=>row.dataset.search.toLowerCase().includes(t));if(!row.hidden)shown++});document.querySelector('#count').textContent=shown+' of 17 packets'});document.querySelectorAll('a[href^="#packet-"]').forEach(a=>a.addEventListener('click',()=>{const row=document.querySelector(a.getAttribute('href'));if(row){input.value="";input.dispatchEvent(new Event("input"));row.open=true}}));console.assert(rows.length===17&&!document.querySelector('#packet-14'),'Packet inventory');console.log('17 packets; #14 excluded; dependency order checked.');</script></html>`;
files.set("index.html", html + "\n");
const check = process.argv.slice(2);
if (check.some((v) => v !== "--check") || check.length > 1)
  throw new Error("Use render.mjs [--check]");
// Keep generated views identical to the repository formatter used at commit time.
const repo = NodePath.resolve(root, "../../..");
for (const [name, raw] of files) {
  const content = NodeChildProcess.execFileSync(
    NodePath.join(repo, "node_modules/.bin/vp"),
    ["fmt", "--stdin-filepath=" + NodePath.join(root, name)],
    {
      stdio: ["pipe", "pipe", "pipe"],
      input: raw,
      encoding: "utf8",
      cwd: repo,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const target = NodePath.join(root, name);
  if (check.length) {
    if ((await NodeFSP.readFile(target, "utf8")) !== content)
      throw new Error("Packet view is stale: " + name);
  } else await NodeFSP.writeFile(target, content);
}
console.log(
  check.length ? "Packet views verified." : "Rendered 17 packets and their review index.",
);
