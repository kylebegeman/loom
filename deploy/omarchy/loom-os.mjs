#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeReadline from "node:readline";
import * as NodeVM from "node:vm";

import { aiFiles, aiBindings, aiMenu, aiEnvironment, aiAction } from "./ai.mjs";
import {
  collectConnections,
  collectPrivateConnections,
  connectionSummary,
  formatConnections,
  formatPrivateConnections,
} from "./health.mjs";

const sourceDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const begin = "BEGIN LOOM OS";
const end = "END LOOM OS";
const appNames = { loom: "Loom", office: "Office", atlas: "Atlas", switchboard: "Switchboard" };
const sha = (s) => NodeCrypto.createHash("sha256").update(s).digest("hex");
export const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const hasControl = (s) =>
  [...s].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const singleLine = (s) => typeof s === "string" && s.length > 0 && !hasControl(s);

export function paths(env = process.env) {
  const home = env.HOME || NodeOS.homedir();
  const config = env.XDG_CONFIG_HOME || NodePath.join(home, ".config");
  const data = env.XDG_DATA_HOME || NodePath.join(home, ".local/share");
  const state = env.XDG_STATE_HOME || NodePath.join(home, ".local/state");
  for (const s of [home, config, data, state]) {
    if (!singleLine(s) || !NodePath.isAbsolute(s))
      throw new Error("XDG directories must be absolute paths.");
  }
  return {
    home,
    config,
    data,
    state,
    root: NodePath.join(data, "loom-os"),
    configFile: NodePath.join(config, "loom-os/config.json"),
    manifest: NodePath.join(state, "loom-os/installation.json"),
    bin: NodePath.join(home, ".local/bin/loom-os"),
    profiles: NodePath.join(data, "loom-os/browser-profiles"),
  };
}

export function validateOrigin(value, label, { allowPath = false } = {}) {
  if (!singleLine(value)) throw new Error(`${label} must be an HTTP(S) URL.`);
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (!allowPath && u.pathname !== "" && u.pathname !== "/")
  ) {
    throw new Error(
      `${label} must be an HTTP(S) ${allowPath ? "URL" : "origin"} without credentials, query or fragment.`,
    );
  }
  return u.href.replace(/\/$/, "");
}

export function validateConfig(input) {
  if (
    !input ||
    input.version !== 1 ||
    (input.profile !== "laptop" && input.profile !== "workstation")
  ) {
    throw new Error("Configuration requires version 1 and a laptop or workstation profile.");
  }
  const allowed = new Set([
    "version",
    "profile",
    "officeUrl",
    "atlasUrl",
    "loomExecutable",
    "officeCli",
    "atlasCli",
    "browserExecutable",
    "switchboardUrl",
    "switchboardStatusUrl",
    "switchboardDashboardUrl",
    "switchboardKeyHelper",
    "switchboardCli",
    "serverExecutable",
    "serverBaseDir",
    "serverReleaseBaseUrl",
    "serverHost",
    "serverPort",
  ]);
  for (const key of Object.keys(input))
    if (!allowed.has(key)) throw new Error(`Unknown configuration field: ${key}`);
  const config = { ...input, officeUrl: validateOrigin(input.officeUrl, "officeUrl") };
  for (const key of ["atlasUrl", "switchboardUrl"])
    if (input[key] !== undefined) config[key] = validateOrigin(input[key], key);
  for (const key of ["switchboardStatusUrl", "switchboardDashboardUrl", "serverReleaseBaseUrl"]) {
    if (input[key] !== undefined)
      config[key] = validateOrigin(input[key], key, { allowPath: true });
  }
  for (const key of [
    "loomExecutable",
    "officeCli",
    "atlasCli",
    "browserExecutable",
    "switchboardKeyHelper",
    "switchboardCli",
    "serverExecutable",
  ]) {
    if (input[key] !== undefined && (!singleLine(input[key]) || !NodePath.isAbsolute(input[key]))) {
      throw new Error(`${key} must be an absolute executable path.`);
    }
  }
  if (
    input.serverBaseDir !== undefined &&
    (!singleLine(input.serverBaseDir) || !NodePath.isAbsolute(input.serverBaseDir))
  )
    throw new Error("serverBaseDir must be an absolute data directory.");
  if (
    input.serverPort !== undefined &&
    (!Number.isInteger(input.serverPort) || input.serverPort < 1 || input.serverPort > 65535)
  )
    throw new Error("serverPort must be an integer from 1 to 65535.");
  if (
    input.serverHost !== undefined &&
    (!singleLine(input.serverHost) ||
      !(
        NodeNet.isIP(input.serverHost) ||
        /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*\.?$/i.test(
          input.serverHost,
        )
      ))
  )
    throw new Error("serverHost must be an IP address or hostname.");
  if (!config.loomExecutable)
    throw new Error("Choose the custom Loom executable with --loom-executable.");
  return config;
}

export function desktopArg(value) {
  const quoted = value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  return `"${quoted}"`.replaceAll("\\", "\\\\");
}

async function read(file) {
  try {
    return await NodeFSP.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function readJson(file) {
  const content = await read(file);
  return content === null ? null : JSON.parse(content);
}
async function rejectSymlinks(file) {
  for (let current = file; ; current = NodePath.dirname(current)) {
    try {
      if ((await NodeFSP.lstat(current)).isSymbolicLink())
        throw new Error(`Refusing symlink: ${current}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (current === NodePath.dirname(current)) break;
  }
}
async function write(file, content, mode = 0o600) {
  await rejectSymlinks(file);
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.loom-os-${process.pid}`;
  await NodeFSP.writeFile(temp, content, { mode, flag: "wx" });
  try {
    await NodeFSP.rename(temp, file);
  } finally {
    await NodeFSP.rm(temp, { force: true });
  }
}

export function ownedBlock(content, comment) {
  const start = content.indexOf(`${comment} ${begin}`);
  if (start === -1) return null;
  const finish = content.indexOf(`${comment} ${end}`, start);
  if (finish === -1) throw new Error("Malformed LoomOS markers.");
  return content.slice(start, finish + `${comment} ${end}`.length);
}

export function markedBlock(content, body, comment) {
  const start = `${comment} ${begin}`,
    finish = `${comment} ${end}`;
  const a = content.indexOf(start),
    b = content.indexOf(finish);
  if (
    (a === -1) !== (b === -1) ||
    (a !== -1 &&
      (b < a ||
        content.indexOf(start, a + start.length) !== -1 ||
        content.indexOf(finish, b + finish.length) !== -1))
  )
    throw new Error("Malformed LoomOS markers; preserve and repair the file manually.");
  const block = body === null ? "" : `${start}\n${body}\n${finish}\n`;
  if (a === -1)
    return body === null
      ? content
      : `${content}${content.endsWith("\n") || !content ? "" : "\n"}${block}`;
  const after = b + finish.length + (content[b + finish.length] === "\n" ? 1 : 0);
  return content.slice(0, a) + block + content.slice(after);
}

function menuBlock(content, body) {
  if (content.includes(`// ${begin}`)) return markedBlock(content, body, "//");
  if (body === null) return content;
  if (/"loomos(?:\.[^"]*)?"\s*:/.test(content))
    throw new Error("Existing loomos menu IDs are not owned by this installer.");
  const opening = /^\s*\{/.exec(content);
  if (!opening) throw new Error("Expected an Omarchy JSONC root object.");
  const openingEnd = opening[0].length;
  const hasNewline = content[openingEnd] === "\n";
  const at = openingEnd + (hasNewline ? 1 : 0);
  return (
    content.slice(0, at) +
    `${hasNewline ? "" : "\n"}// ${begin}\n${body}\n// ${end}\n` +
    content.slice(at)
  );
}

const shortcutActions = [
  ["open-loom", "L", "Loom", "open loom"],
  ["open-office", "O", "Office", "open office"],
  ["open-atlas", "A", "Atlas", "open atlas"],
  ["capture-office", "N", "Capture in Office", "capture office --clipboard"],
  ["find", "F", "Find in apps", "find"],
  ["actions", "SPACE", "Loom actions", "actions"],
];
export function normalizeShortcut(value) {
  if (value === "none") return null;
  if (typeof value !== "string" || value.length > 80 || hasControl(value))
    throw new Error("Invalid shortcut. Use Super+Alt+O, Super+F12, or none.");
  const parts = value
    .toUpperCase()
    .split("+")
    .map((v) => v.trim());
  const key = parts.pop(),
    mods = ["SUPER", "CTRL", "ALT", "SHIFT"];
  if (
    !parts.length ||
    parts.some((v) => !mods.includes(v)) ||
    new Set(parts).size !== parts.length ||
    !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|SPACE|RETURN|ESCAPE|TAB|HOME|END|INSERT|DELETE|PAGE_UP|PAGE_DOWN)$/.test(
      key,
    )
  )
    throw new Error("Invalid shortcut. Use supported modifiers and one named key.");
  return [...mods.filter((v) => parts.includes(v)), key].join(" + ");
}
function validateShortcuts(value) {
  if (
    !value ||
    value.version !== 1 ||
    !["standard", "compact", "none"].includes(value.preset) ||
    !value.bindings ||
    typeof value.bindings !== "object" ||
    Array.isArray(value.bindings) ||
    Object.keys(value).some((k) => !["version", "preset", "bindings"].includes(k))
  )
    throw new Error("Invalid shortcut preferences.");
  const bindings = {};
  for (const [id, chord] of Object.entries(value.bindings)) {
    if (!shortcutActions.some((action) => action[0] === id))
      throw new Error("Unknown shortcut action.");
    bindings[id] = normalizeShortcut(chord) ?? "none";
  }
  return { version: 1, preset: value.preset, bindings };
}
const defaultShortcuts = () => ({ version: 1, preset: "standard", bindings: { actions: "none" } });
async function readShortcuts(env) {
  if ((await read(NodePath.join(paths(env).state, "loom-os/shortcut-pending.json"))) !== null)
    throw Error("Shortcut update interrupted. Use shortcuts recover.");
  return validateShortcuts(
    (await readJson(NodePath.join(paths(env).config, "loom-os/shortcuts.json"))) ??
      defaultShortcuts(),
  );
}
export function shortcutBindings(config, preferences = defaultShortcuts()) {
  const prefs = validateShortcuts(preferences);
  const prefix = prefs.preset === "compact" ? "SUPER + ALT" : "SUPER + CTRL + ALT";
  return shortcutActions
    .filter(
      ([id]) =>
        (id !== "open-atlas" || config.atlasUrl) &&
        (id !== "find" || config.officeCli || (config.atlasCli && config.atlasUrl)),
    )
    .flatMap(([id, key, title, suffix]) => {
      const chord = normalizeShortcut(
        prefs.bindings[id] ?? (prefs.preset === "none" ? "none" : `${prefix} + ${key}`),
      );
      return chord ? [{ id, chord, title, suffix }] : [];
    });
}
function bindingToken(chord) {
  const parts = normalizeShortcut(chord).split(" + ");
  const key = parts.pop();
  const mask = parts.reduce((n, v) => n + { SUPER: 64, CTRL: 4, ALT: 8, SHIFT: 1 }[v], 0);
  return `${mask}:${key}`;
}
function liveBindingToken(binding) {
  const key = String(binding.key ?? "").toUpperCase();
  return `${Number(binding.modmask)}:${key === " " ? "SPACE" : key}`;
}
export async function shortcutPreview(
  config,
  env,
  proposed,
  { query = (args) => queryHyprland(args, env) } = {},
) {
  const prefs = validateShortcuts(proposed),
    p = paths(env);
  const storedPreferences = await read(NodePath.join(p.config, "loom-os/shortcuts.json"));
  if ((await read(NodePath.join(p.state, "loom-os/shortcut-pending.json"))) !== null)
    throw Error(
      "A shortcut update was interrupted. Use shortcuts recover before applying another change.",
    );
  const plan = await installationPlan(config, env, sourceDir, prefs);
  const patch = plan.patches.find((v) => v.kind.startsWith("bindings-"));
  if (!patch) throw new Error("No supported user bindings file is available.");
  const comment = patch.kind === "bindings-lua" ? "--" : "#";
  const manifest = await readJson(p.manifest);
  const old = manifest?.patches?.find((v) => v.file === patch.file);
  const block = ownedBlock(patch.before ?? "", comment);
  if (!old || block === null || sha(block) !== old.blockHash)
    throw new Error("Preserving an edited or unowned LoomOS bindings block.");
  let live;
  try {
    live = JSON.parse((await query(["binds", "-j"])).stdout);
    if (
      !Array.isArray(live) ||
      live.some(
        (v) =>
          !Number.isInteger(v.modmask) ||
          typeof v.key !== "string" ||
          typeof v.dispatcher !== "string" ||
          typeof v.arg !== "string",
      )
    )
      throw new Error("Invalid live bindings");
  } catch {
    throw new Error("Cannot check live bindings. Preview again in an available Hyprland session.");
  }
  const conflicts = [],
    bindings = shortcutBindings(config, prefs),
    seen = new Set();
  const managedCommands = new Set(shortcutActions.map((v) => `${shellQuote(p.bin)} ${v[3]}`));
  const managedTokens = new Set();
  if (patch.kind === "bindings-lua") {
    for (const match of block.matchAll(/o\.bind\(\s*("(?:\\.|[^"\\])*")/g)) {
      try {
        managedTokens.add(bindingToken(JSON.parse(match[1])));
      } catch {
        /* Non-app native bindings are excluded. */
      }
    }
  } else {
    for (const line of block.split("\n")) {
      const fields = line.split(",");
      if (/^bindd\s*=/.test(fields[0]) && fields[1])
        managedTokens.add(
          bindingToken(
            fields[0]
              .replace(/^bindd\s*=\s*/, "")
              .trim()
              .split(/\s+/)
              .join(" + ") +
              " + " +
              fields[1].trim(),
          ),
        );
    }
  }
  for (const action of bindings) {
    const token = bindingToken(action.chord);
    if (seen.has(token))
      conflicts.push({
        action: action.id,
        chord: action.chord,
        reason: "Another proposed Loom action uses this shortcut.",
      });
    seen.add(token);
    if (
      live.some(
        (v) =>
          liveBindingToken(v) === token &&
          !(
            v.dispatcher === "exec" &&
            managedCommands.has(v.arg) &&
            managedTokens.has(token) &&
            block.includes(v.arg.replaceAll('"', '\\"'))
          ),
      )
    )
      conflicts.push({
        action: action.id,
        chord: action.chord,
        reason: "A live system or personal binding already uses this shortcut.",
      });
  }
  return {
    preferences: prefs,
    bindings,
    conflicts,
    liveChecked: true,
    reloadRequired: true,
    _patch: patch,
    _manifest: manifest,
    _comment: comment,
    _storedPreferences: storedPreferences,
  };
}
function publicShortcutPlan(report) {
  const { _patch, _manifest, _comment, _storedPreferences, ...result } = report;
  return result;
}
export async function applyShortcuts(config, env, proposed, dependencies = {}) {
  const report = await shortcutPreview(config, env, proposed, dependencies);
  if (report.conflicts.length)
    throw new Error("Shortcut conflicts must be resolved before applying.");
  const p = paths(env),
    file = NodePath.join(p.config, "loom-os/shortcuts.json"),
    history = NodePath.join(p.state, "loom-os/shortcut-restore.json");
  const before = await readShortcuts(env),
    patch = report._patch;
  // A live preview is advisory until its exact source snapshot is checked again.
  if (
    (await read(file)) !== report._storedPreferences ||
    (dependencies.reviewed &&
      (patch.before !== dependencies.reviewed._patch?.before ||
        report._storedPreferences !== dependencies.reviewed._storedPreferences)) ||
    (await read(patch.file)) !== patch.before ||
    JSON.stringify(await readJson(p.manifest)) !== JSON.stringify(report._manifest)
  )
    throw new Error("Bindings changed during review. Preview again.");
  for (const target of [file, history, patch.file, p.manifest]) await rejectSymlinks(target);
  const block = ownedBlock(patch.after, report._comment);
  const manifest = {
    ...report._manifest,
    patches: report._manifest.patches.map((v) =>
      v.file === patch.file ? { ...v, blockHash: sha(block) } : v,
    ),
  };
  const intentFile = NodePath.join(p.state, "loom-os/shortcut-pending.json");
  const changes = [
    [
      history,
      JSON.stringify({
        version: 1,
        previous: before,
        current: sha(JSON.stringify(report.preferences)),
      }) + "\n",
    ],
    [file, JSON.stringify(report.preferences, null, 2) + "\n"],
    [patch.file, patch.after],
    [p.manifest, JSON.stringify(manifest, null, 2) + "\n"],
  ];
  const entries = await Promise.all(
    changes.map(async ([file, after]) => ({ file, before: await read(file), after })),
  );
  await write(intentFile, JSON.stringify({ version: 1, entries }) + "\n");
  for (const entry of entries) await (dependencies.write ?? write)(entry.file, entry.after);
  await NodeFSP.rm(intentFile);
  return publicShortcutPlan(report);
}
export async function recoverShortcuts(env) {
  const p = paths(env),
    intentFile = NodePath.join(p.state, "loom-os/shortcut-pending.json"),
    intent = await readJson(intentFile);
  const allowed = new Set([
    NodePath.join(p.state, "loom-os/shortcut-restore.json"),
    NodePath.join(p.config, "loom-os/shortcuts.json"),
    NodePath.join(p.config, "hypr/bindings.lua"),
    NodePath.join(p.config, "hypr/bindings.conf"),
    p.manifest,
  ]);
  if (
    !intent ||
    intent.version !== 1 ||
    !Array.isArray(intent.entries) ||
    intent.entries.length !== 4 ||
    new Set(intent.entries.map((v) => v.file)).size !== 4
  )
    throw Error("No valid interrupted shortcut update is available.");
  for (const entry of intent.entries) {
    if (
      !allowed.has(entry.file) ||
      (entry.before !== null && typeof entry.before !== "string") ||
      typeof entry.after !== "string"
    )
      throw Error("Invalid shortcut recovery record.");
    await rejectSymlinks(entry.file);
    const current = await read(entry.file);
    if (current !== entry.before && current !== entry.after)
      throw Error("Preserving edits made after the interrupted shortcut update.");
  }
  for (const entry of intent.entries) {
    if (entry.before === null) await NodeFSP.rm(entry.file, { force: true });
    else await write(entry.file, entry.before);
  }
  await NodeFSP.rm(intentFile);
  return { recovered: true };
}
export async function restoreShortcuts(config, env, dependencies = {}) {
  const p = paths(env),
    saved = await readJson(NodePath.join(p.state, "loom-os/shortcut-restore.json"));
  if (!saved || saved.version !== 1)
    throw new Error("No previous shortcut preferences are available.");
  const current = await readShortcuts(env);
  if (saved.current !== sha(JSON.stringify(current)))
    throw new Error("Preserving edited shortcut preferences. Preview a new preset instead.");
  return applyShortcuts(config, env, validateShortcuts(saved.previous), dependencies);
}
async function shortcutStatus(config, env) {
  const prefs = await readShortcuts(env),
    actions = await collectLoomActions(config, env);
  return {
    preset: prefs.preset,
    bindings: shortcutActions
      .filter(([id]) => actions.some((a) => a.id === id))
      .map(([id, , title]) => ({
        id,
        title,
        chord: actions.find((a) => a.id === id)?.shortcut || "No configured shortcut",
      })),
  };
}
function formatShortcutPlan(report) {
  return [
    "Loom shortcut preview",
    ...report.bindings.map((v) => `${v.title}: ${v.chord}`),
    ...report.conflicts.map((v) => `CONFLICT: ${v.chord}. ${v.reason}`),
    "Only Loom app shortcuts change. AI routing and personal bindings are preserved.",
    "Reload Hyprland normally or sign out and back in to activate changes.",
  ].join("\n");
}
export async function nativeShortcuts(config, env, dependencies = {}) {
  const choose =
    dependencies.choose ??
    ((choices) => finderChoice(["choose", "--header", "Loom shortcuts", "--", ...choices], env));
  const show = dependencies.show ?? console.log;
  const edit = async (prefs) => {
    const selected = await choose(shortcutActions.map((a) => a[2]));
    if (selected === null) return null;
    const id = shortcutActions.find((a) => a[2] === selected)?.[0];
    if (!id) throw Error("Unknown shortcut action.");
    const chord = await (
      dependencies.input ??
      ((title) =>
        finderChoice(
          [
            "input",
            "--header",
            title + " shortcut",
            "--placeholder",
            "Super+Alt+O or none",
            "--char-limit",
            "80",
          ],
          env,
        ))
    )(selected);
    if (chord === null) return null;
    return { ...prefs, bindings: { ...prefs.bindings, [id]: normalizeShortcut(chord) ?? "none" } };
  };
  while (true) {
    let status;
    try {
      status = await (dependencies.status ?? (() => shortcutStatus(config, env)))();
    } catch (error) {
      show(terminalText(error.message));
      status = { bindings: [] };
    }
    show(status.bindings.map((v) => `${v.title}: ${v.chord}`).join("\n"));
    const choice = await choose([
      "Standard shortcuts",
      "Compact shortcuts",
      "No Loom app shortcuts",
      "Customize one shortcut",
      "Restore previous shortcuts",
      "Recover interrupted update",
      "Readability controls",
      "Close",
    ]);
    if (choice === null || choice === "Close") return;
    if (choice === "Recover interrupted update") {
      try {
        await recoverShortcuts(env);
        show("Previous shortcut state recovered.");
      } catch (error) {
        show(terminalText(error.message));
      }
      continue;
    }
    if (choice === "Readability controls") {
      await (dependencies.readability ?? (() => main(["readability", "--inline"], env)))();
      continue;
    }
    try {
      let prefs,
        restoreOriginal = choice === "Restore previous shortcuts";
      if (choice === "Restore previous shortcuts") {
        const saved = await readJson(
          NodePath.join(paths(env).state, "loom-os/shortcut-restore.json"),
        );
        if (!saved) throw Error("No previous shortcuts are available.");
        prefs = saved.previous;
      } else if (choice === "Customize one shortcut") {
        prefs = await edit(await readShortcuts(env));
        if (prefs === null) continue;
      } else {
        const preset = {
          "Standard shortcuts": "standard",
          "Compact shortcuts": "compact",
          "No Loom app shortcuts": "none",
        }[choice];
        if (!preset) throw Error("Unknown shortcut choice.");
        prefs = { ...(await readShortcuts(env)), preset };
        if (preset === "none") prefs.bindings = {};
      }
      let preview = await (dependencies.preview ?? ((v) => shortcutPreview(config, env, v)))(prefs);
      show(formatShortcutPlan(preview));
      while (preview.conflicts.length) {
        if ((await choose(["Keep current shortcuts", "Adjust a shortcut"])) !== "Adjust a shortcut")
          break;
        const changed = await edit(prefs);
        if (changed === null) break;
        prefs = changed;
        restoreOriginal = false;
        preview = await (dependencies.preview ?? ((v) => shortcutPreview(config, env, v)))(prefs);
        show(formatShortcutPlan(preview));
      }
      if (preview.conflicts.length) continue;
      if (
        (await choose(["Keep current shortcuts", "Apply reviewed shortcuts"])) !==
        "Apply reviewed shortcuts"
      )
        continue;
      await (restoreOriginal
        ? (dependencies.restore ?? (() => restoreShortcuts(config, env, { reviewed: preview })))()
        : (dependencies.apply ?? ((v) => applyShortcuts(config, env, v, { reviewed: preview })))(
            prefs,
          ));
      show("Saved. Reload Hyprland normally or sign out and back in to activate.");
      if ((await choose(["Activate later", "Reload shortcuts now"])) === "Reload shortcuts now") {
        const locked = NodeChildProcess.spawnSync("omarchy-hyprland-session-locked", [], {
          env,
          stdio: "ignore",
          timeout: 3000,
        });
        if (locked.status !== 1) show("Unlock the desktop normally before reloading shortcuts.");
        else {
          const result = await queryHyprland(["reload"], env);
          if (result.stdout.trim() !== "ok")
            throw Error("Shortcut reload did not finish. Reload Hyprland normally.");
          show("Shortcuts activated.");
        }
      }
    } catch (error) {
      show(terminalText(error.message));
      await choose(["Back"]);
    }
  }
}
async function readReadability(env) {
  const prefs = (await readJson(NodePath.join(paths(env).config, "loom-os/readability.json"))) ?? {
    version: 1,
    size: "system",
  };
  if (
    prefs.version !== 1 ||
    !["system", "larger"].includes(prefs.size) ||
    Object.keys(prefs).some((key) => !["version", "size"].includes(key))
  )
    throw Error("Invalid readability preferences.");
  return prefs;
}
export async function loomTuiCommand(args, env, resolve = executable) {
  const prefs = await readReadability(env);
  if (prefs.size === "system") return { command: "omarchy-launch-tui", args };
  const terminal = resolve("alacritty");
  // Keep the preference's recovery screen reachable if its chosen terminal is removed.
  if (!terminal && args[0] === "--app-id=org.omarchy.loom-readability")
    return { command: "omarchy-launch-tui", args };
  if (!terminal)
    throw Error(
      "Larger Loom dialogs require the included Alacritty terminal. Restore system sizing in Readability controls.",
    );
  const [appId, ...command] = args;
  if (!appId.startsWith("--app-id=")) throw Error("Loom dialog needs an app identity.");
  return {
    command: "uwsm-app",
    args: [
      "--",
      terminal,
      "--class",
      appId.slice(9),
      "--option",
      "font.size=14",
      "--option",
      "window.padding.x=12",
      "--option",
      "window.padding.y=12",
      "-e",
      ...command,
    ],
  };
}
async function nativeReadability(env) {
  while (true) {
    console.log(
      "Loom utility dialogs: " +
        (await readReadability(env)).size +
        ". Existing terminal, display and theme settings stay yours.",
    );
    const choice = await finderChoice(
      [
        "choose",
        "--header",
        "Readability controls",
        "--",
        "System terminal sizing",
        "Larger Loom dialogs",
        "Native font chooser",
        "Native theme chooser",
        "Close",
      ],
      env,
    );
    if (choice === null || choice === "Close") return;
    if (["System terminal sizing", "Larger Loom dialogs"].includes(choice)) {
      const size = choice === "Larger Loom dialogs" ? "larger" : "system";
      if (size === "larger" && !executable("alacritty")) {
        console.log("Alacritty is unavailable. System sizing remains active.");
        continue;
      }
      await write(
        NodePath.join(paths(env).config, "loom-os/readability.json"),
        JSON.stringify({ version: 1, size }) + "\n",
      );
      console.log("Saved for the next Loom utility dialog.");
    } else if (choice === "Native font chooser" || choice === "Native theme chooser") {
      await run(
        "omarchy-menu",
        ["summon", choice === "Native font chooser" ? "style.font" : "style.theme"],
        { env },
      );
      return;
    }
  }
}

export async function installationPlan(
  config,
  env = process.env,
  packDir = sourceDir,
  preferences,
) {
  config = validateConfig(config);
  const p = paths(env);
  const writes = new Map();
  writes.set(NodePath.join(p.root, "loom-os.mjs"), {
    content: await NodeFSP.readFile(NodePath.join(packDir, "loom-os.mjs"), "utf8"),
    mode: 0o755,
  });
  writes.set(NodePath.join(p.root, "release.mjs"), {
    content: await NodeFSP.readFile(NodePath.join(packDir, "release.mjs"), "utf8"),
    mode: 0o644,
  });
  writes.set(p.bin, {
    content: `#!/bin/sh\nexec node ${shellQuote(NodePath.join(p.root, "loom-os.mjs"))} "$@"\n`,
    mode: 0o755,
  });
  writes.set(p.configFile, { content: `${JSON.stringify(config, null, 2)}\n`, mode: 0o600 });
  for (const [app, name] of Object.entries(appNames)) {
    if (
      (app === "atlas" && !config.atlasUrl) ||
      (app === "switchboard" && !config.switchboardDashboardUrl)
    )
      continue;
    writes.set(NodePath.join(p.data, "applications", `loom-os-${app}.desktop`), {
      content: `[Desktop Entry]\nType=Application\nName=${name}\nComment=${name} on LoomOS\nExec=${desktopArg(p.bin)} open ${app}\nIcon=${app === "loom" ? "utilities-terminal" : app === "office" ? "applications-office" : app === "atlas" ? "folder" : "preferences-system"}\nTerminal=false\nStartupNotify=true\nStartupWMClass=${app === "loom" ? "t3code" : `loom-os-${app}`}\nCategories=${app === "office" ? "Office" : "Development"};\n`,
      mode: 0o644,
    });
  }
  if (config.switchboardCli && config.switchboardUrl) {
    writes.set(NodePath.join(p.root, "ai.mjs"), {
      content: await NodeFSP.readFile(NodePath.join(packDir, "ai.mjs"), "utf8"),
      mode: 0o644,
    });
    for (const [file, value] of aiFiles(p)) writes.set(file, value);
  } else {
    // The launcher imports the AI module even when routing is not commissioned.
    writes.set(NodePath.join(p.root, "ai.mjs"), {
      content: await NodeFSP.readFile(NodePath.join(packDir, "ai.mjs"), "utf8"),
      mode: 0o644,
    });
  }
  writes.set(NodePath.join(p.root, "health.mjs"), {
    content: await NodeFSP.readFile(NodePath.join(packDir, "health.mjs"), "utf8"),
    mode: 0o644,
  });
  for (const action of ["shortcuts", "readability", "compatibility", "app-integration"]) {
    writes.set(NodePath.join(p.root, action + "-terminal"), {
      content: `#!/bin/bash\nprintf '\\033]0;Loom ${action}\\007'\n${shellQuote(p.bin)} ${action} ${["compatibility", "app-integration"].includes(action) ? "--human" : "--inline"}\nstatus=$?\n${["compatibility", "app-integration"].includes(action) ? "printf '\\nPress Enter to close. '; read -r _\n" : ""}exit "$status"\n`,
      mode: 0o755,
    });
  }
  writes.set(NodePath.join(p.root, "actions-terminal"), {
    content: `#!/bin/bash\nprintf '\\033]0;Loom actions\\007'\n${shellQuote(p.bin)} actions --inline "$@"\nstatus=$?\nif (( status != 0 )); then printf '\\nPress Enter to close. '; read -r _; fi\nexit "$status"\n`,
    mode: 0o755,
  });
  writes.set(NodePath.join(p.data, "applications/loom-os-actions.desktop"), {
    content: `[Desktop Entry]\nType=Application\nName=Loom actions\nComment=Find apps, save notes, AI and connection tools\nExec=${desktopArg(p.bin)} actions\nIcon=system-search\nTerminal=false\nCategories=Utility;\n`,
    mode: 0o644,
  });
  writes.set(NodePath.join(p.root, "doctor-terminal"), {
    content: `#!/bin/bash\nprintf '\\033]0;Check connections\\007'\n${shellQuote(p.bin)} doctor --human\nstatus=$?\nprintf '\\nPress Enter to close. '\nread -r _\nexit "$status"\n`,
    mode: 0o755,
  });
  writes.set(NodePath.join(p.root, "connections-terminal"), {
    content: `#!/bin/bash
printf '\\033]0;Loom connections\\007'
while true; do
  ${shellQuote(p.bin)} connections --human
  if ! command -v gum >/dev/null 2>&1; then
    printf '\nPress Enter to close. '; read -r _; exit 0
  fi
  choice=$(gum choose --header 'Loom connections' 'Check again' 'Open Tailscale' 'Open Switchboard' 'Loom service status' 'Close') || exit 0
  case "$choice" in
    'Check again') ;;
    'Open Tailscale') omarchy-shell omarchy.tailscale open || printf '%s\n' 'Open Tailscale from the system bar.' ;;
    'Open Switchboard') ${shellQuote(p.bin)} open switchboard ;;
    'Loom service status') ${shellQuote(p.bin)} service status ;;
    *) exit 0 ;;
  esac
done
`,
    mode: 0o755,
  });
  writes.set(NodePath.join(p.root, "pack-status-terminal"), {
    content: `#!/bin/bash\nprintf '\\033]0;LoomOS integration\\007'\n${shellQuote(p.bin)} pack status --human\nstatus=$?\nprintf '\\nPress Enter to close. '\nread -r _\nexit "$status"\n`,
    mode: 0o755,
  });
  writes.set(NodePath.join(p.root, "pack-rollback-terminal"), {
    content: `#!/bin/bash\nprintf '\\033]0;Restore LoomOS integration\\007'\nstatus=0\nif ${shellQuote(p.bin)} pack status --human && plan=$(${shellQuote(p.bin)} pack rollback --dry-run); then\n  printf '%s\\n' "$plan"\n  reviewed_sha=$(printf '%s' "$plan" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).sha256') || exit 1\n  printf '\\nThis restores the previous integration. App data, your theme and background agents are preserved.\\n'\n  if command -v gum >/dev/null 2>&1; then\n    if gum confirm --default=false 'Restore the previous LoomOS integration?'; then\n      ${shellQuote(p.bin)} pack rollback --expected-sha256 "$reviewed_sha"\n      status=$?\n    else\n      printf '%s\\n' 'Cancelled. No changes applied.'\n    fi\n  else\n    printf '%s\\n' 'The native confirmation utility is unavailable. Run loom-os pack rollback manually after reviewing the plan.'\n    status=1\n  fi\nelse\n  status=$?\nfi\nprintf '\\nPress Enter to close. '\nread -r _\nexit "$status"\n`,
    mode: 0o755,
  });
  const pairingEnabled =
    config.profile === "workstation" && config.serverExecutable && config.serverBaseDir;
  if (pairingEnabled)
    writes.set(NodePath.join(p.root, "pair-terminal"), {
      content: `#!/bin/bash\nprintf '\\033]0;Connect another device\\007'\nprintf '%s\\n' 'Connect your other device to Tailscale, then add this environment in Loom Settings > Connections.'\n${shellQuote(p.bin)} pair "$@"\nstatus=$?\nprintf '\\nPress Enter to close. '\nread -r _\nexit "$status"\n`,
      mode: 0o755,
    });
  const aiEnabled = Boolean(config.switchboardCli && config.switchboardUrl);
  const command = (suffix) => `${shellQuote(p.bin)} ${suffix}`;
  const bindingsLua = NodePath.join(p.config, "hypr/bindings.lua");
  const bindingsConf = NodePath.join(p.config, "hypr/bindings.conf");
  const lua = await read(bindingsLua),
    conf = await read(bindingsConf);
  const finderEnabled = ["office", "atlas"].some(
    (app) => config[`${app}Cli`] && config[`${app}Url`],
  );
  if (finderEnabled) {
    writes.set(NodePath.join(p.root, "find-terminal"), {
      content: `#!/bin/bash\nprintf '\\033]0;Find in apps\\007'\n${shellQuote(p.bin)} find --inline "$@"\nstatus=$?\nif (( status != 0 )); then printf '\\nPress Enter to close. '; read -r _; fi\nexit "$status"\n`,
      mode: 0o755,
    });
    writes.set(NodePath.join(p.root, "connect-search-terminal"), {
      content: `#!/bin/bash\nprintf '\\033]0;Connect app search\\007'\n${shellQuote(p.bin)} connect "$@" --inline\nstatus=$?\nif (( status != 0 )); then printf '\\nPress Enter to close. '; read -r _; fi\nexit "$status"\n`,
      mode: 0o755,
    });
    writes.set(NodePath.join(p.data, "applications/loom-os-find.desktop"), {
      content: `[Desktop Entry]\nType=Application\nName=Find in apps\nComment=Search Office and Atlas\nExec=${desktopArg(p.bin)} find\nIcon=system-search\nTerminal=false\nCategories=Utility;\n`,
      mode: 0o644,
    });
  }
  const bindings = shortcutBindings(config, preferences ?? (await readShortcuts(env)));
  const patches = [];
  if (lua !== null) {
    const body =
      (aiEnabled ? aiBindings(p) + "\n" : "") +
      bindings
        .map(
          ({ chord, title, suffix }) =>
            `o.bind(${JSON.stringify(chord)}, ${JSON.stringify(title)}, ${JSON.stringify(command(suffix))})`,
        )
        .join("\n");
    patches.push({
      file: bindingsLua,
      before: lua,
      after: markedBlock(lua, body, "--"),
      kind: "bindings-lua",
    });
  } else if (conf !== null) {
    // Commas delimit Hyprland bind fields, including inside quoted commands.
    if (p.bin.includes(","))
      throw new Error("Hyprland legacy bindings cannot use a path containing a comma.");
    const body = bindings
      .map(({ chord, title, suffix }) => {
        const parts = chord.split(" + ");
        const key = parts.pop();
        return `bindd = ${parts.join(" ")}, ${key}, ${title}, exec, ${command(suffix)}`;
      })
      .join("\n");
    patches.push({
      file: bindingsConf,
      before: conf,
      after: markedBlock(conf, body, "#"),
      kind: "bindings-conf",
    });
  }
  const menuFile = NodePath.join(p.config, "omarchy/extensions/omarchy-menu.jsonc");
  const menu = await read(menuFile);
  if (lua !== null) {
    for (const name of ["manifest.json", "LoomStatus.qml", "StatusModel.js"]) {
      writes.set(NodePath.join(p.config, "omarchy/plugins/loom.status", name), {
        content: await NodeFSP.readFile(NodePath.join(packDir, "status", name), "utf8"),
        mode: 0o644,
      });
    }
    const entries = { loomos: { label: "LoomOS", description: "Your apps and native utilities" } };
    for (const [app, name] of Object.entries(appNames)) {
      if (
        (app === "atlas" && !config.atlasUrl) ||
        (app === "switchboard" && !config.switchboardDashboardUrl)
      )
        continue;
      entries[`loomos.${app}`] = { label: name, action: command(`open ${app}`) };
    }
    entries["loomos.actions"] = {
      label: "Loom actions",
      description: "Find apps, save notes, AI and connection tools",
      action: command("actions"),
    };
    entries["about"] = { icon: "", label: "About LoomOS", action: "omarchy-launch-about" };
    entries["loomos.connections"] = { label: "AI and connections" };
    entries["loomos.connections.status"] = {
      label: "Connection status",
      action: command("connections --terminal"),
    };
    entries["loomos.connections.tailscale"] = {
      label: "Open Tailscale",
      action: "omarchy-shell omarchy.tailscale open",
    };
    if (config.switchboardDashboardUrl)
      entries["loomos.connections.switchboard"] = {
        label: "Open Switchboard",
        action: command("open switchboard"),
      };
    if (aiEnabled)
      entries["loomos.connections.ask-ai"] = { label: "Ask AI", action: command("agent") };
    entries["loomos.appearance"] = {
      label: "Appearance",
      description: "Iris colors with Omarchy's native shell",
    };
    for (const mode of ["dark", "light"]) {
      const theme = `loom-iris-${mode}`;
      const directory = NodePath.join(p.home, ".config/omarchy/themes", theme);
      const current = NodePath.join(p.home, ".local/state/omarchy/current/theme.name");
      entries[`loomos.appearance.${mode}`] = {
        label: `Iris ${mode === "dark" ? "Dark" : "Light"}`,
        when: `[[ -d ${shellQuote(directory)} ]]`,
        checked: `[[ "$(cat ${shellQuote(current)} 2>/dev/null)" == ${shellQuote(theme)} ]]`,
        action: `omarchy-theme-set ${shellQuote(theme)}`,
      };
    }
    entries["loomos.appearance.shortcuts"] = { label: "Shortcuts", action: command("shortcuts") };
    entries["loomos.appearance.readability"] = {
      label: "Readability controls",
      action: command("readability"),
    };
    entries["loomos.connections.integration"] = {
      label: "App integration",
      action: command("app-integration --terminal"),
    };
    entries["loomos.maintenance.compatibility"] = {
      label: "Compatibility checks",
      action: command("compatibility --terminal"),
    };
    entries["loomos.maintenance"] = { label: "Maintenance" };
    entries["loomos.maintenance.status"] = {
      label: "Installed integration",
      description: "Version, machine profile, theme and retained rollback",
      action: command("pack status --terminal"),
    };
    entries["loomos.maintenance.rollback"] = {
      label: "Restore previous integration",
      description: "Review and confirm a rollback without interrupting agents",
      action: command("pack rollback --terminal"),
    };
    entries["update.loomos"] = { label: "LoomOS integration", target: "loomos.maintenance" };
    if (finderEnabled) {
      entries["loomos.find"] = { label: "Find in apps", action: command("find") };
      for (const app of ["office", "atlas"])
        if (config[`${app}Cli`] && config[`${app}Url`]) {
          entries[`loomos.connections.${app}-search`] = {
            label: `Connect ${appNames[app]} search`,
            action: command(`connect ${app}`),
          };
          entries[`loomos.find-${app}`] = {
            label: `Search ${appNames[app]}`,
            action: command(`find ${app}`),
          };
        }
    }
    entries["loomos.capture"] = {
      label: "Capture in Office",
      action: command("capture office --clipboard"),
    };
    entries["loomos.health"] = {
      label: "Check connections",
      description: "Inspect apps, private AI and background Loom",
      action: command("doctor --terminal"),
    };
    if (pairingEnabled)
      entries["loomos.pair"] = {
        label: "Connect another device",
        description: "Pair with this workstation through Tailscale",
        action: command("pair --terminal"),
      };
    if (aiEnabled) Object.assign(entries, aiMenu(p));
    const body = Object.entries(entries)
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)},`)
      .join("\n");
    patches.push({
      file: menuFile,
      before: menu,
      after: menuBlock(menu ?? "{}\n", body),
      kind: "menu",
    });
  }
  if (aiEnabled) {
    const file = NodePath.join(p.home, ".bashrc");
    const before = await read(file);
    const remainder = markedBlock(before ?? "", null, "#");
    patches.push({
      file,
      before,
      after: markedBlock("", aiEnvironment(p).trimEnd(), "#") + remainder,
      kind: "shell",
    });
  }
  return {
    p,
    config,
    writes,
    patches,
    integration:
      lua !== null
        ? "Omarchy Lua + menu"
        : conf !== null
          ? "Hyprland legacy bindings"
          : "Desktop entries only (no recognized user bindings file)",
  };
}

export async function install(
  config,
  { env = process.env, dryRun = false, packDir = sourceDir } = {},
) {
  const plan = await installationPlan(config, env, packDir);
  await rejectSymlinks(plan.p.manifest);
  const old = await readJson(plan.p.manifest);
  for (const [file, value] of plan.writes) {
    await rejectSymlinks(file);
    const current = await read(file),
      previous = old?.files?.find((entry) => entry.file === file);
    if (
      file !== plan.p.configFile &&
      current !== null &&
      sha(current) !== previous?.hash &&
      current !== value.content
    ) {
      throw new Error(`Preserving existing file with local edits: ${file}`);
    }
  }
  for (const patch of plan.patches) {
    await rejectSymlinks(patch.file);
    const comment = patch.kind === "menu" ? "//" : patch.kind === "bindings-lua" ? "--" : "#";
    const block = ownedBlock(patch.before ?? "", comment);
    const previous = old?.patches?.find((entry) => entry.file === patch.file);
    if (
      block !== null &&
      sha(block) !== previous?.blockHash &&
      block !== ownedBlock(patch.after, comment)
    ) {
      throw new Error(`Preserving edited LoomOS integration block: ${patch.file}`);
    }
  }
  await rejectSymlinks(plan.p.manifest);
  if (dryRun)
    return {
      profile: config.profile,
      integration: plan.integration,
      files: [...plan.writes.keys(), ...plan.patches.map((s) => s.file)],
      dryRun: true,
    };
  const records = [];
  for (const entry of old?.files ?? []) {
    if (plan.writes.has(entry.file)) continue;
    await rejectSymlinks(entry.file);
    const content = await read(entry.file);
    if (content !== null && sha(content) === entry.hash) await NodeFSP.rm(entry.file);
  }
  for (const [file, value] of plan.writes) {
    await write(file, value.content, value.mode);
    records.push({ file, hash: sha(value.content) });
  }
  for (const patch of plan.patches) {
    if (patch.before !== patch.after) {
      if (patch.before !== null) {
        const backup = NodePath.join(
          plan.p.state,
          "loom-os/backups",
          `${NodePath.basename(patch.file)}-${sha(patch.before).slice(0, 12)}`,
        );
        if ((await read(backup)) === null) await write(backup, patch.before);
      }
      await write(patch.file, patch.after);
    }
  }
  // Keep previously owned entries so uninstall also finds launchers removed by reconfiguration.
  const files = [
    ...records,
    ...(old?.files ?? []).filter((e) => !records.some((r) => r.file === e.file)),
  ];
  const patches = [
    ...plan.patches.map(({ file, kind, after }) => ({
      file,
      kind,
      blockHash: sha(
        ownedBlock(after, kind === "menu" ? "//" : kind === "bindings-lua" ? "--" : "#"),
      ),
    })),
    ...(old?.patches ?? []).filter((e) => !plan.patches.some((r) => r.file === e.file)),
  ];
  await write(plan.p.manifest, `${JSON.stringify({ version: 1, files, patches }, null, 2)}\n`);
  return { profile: config.profile, integration: plan.integration, installed: true };
}

export async function uninstall({ env = process.env, dryRun = false } = {}) {
  const p = paths(env),
    manifest = await readJson(p.manifest);
  if (!manifest) return { removed: [], preserved: [], dryRun };
  const removed = [],
    preserved = [],
    mutations = [];
  for (const entry of manifest.files) {
    await rejectSymlinks(entry.file);
    const content = await read(entry.file);
    if (content !== null && sha(content) !== entry.hash) {
      preserved.push(entry.file);
      continue;
    }
    removed.push(entry.file);
    mutations.push(() => NodeFSP.rm(entry.file, { force: true }));
  }
  for (const entry of manifest.patches) {
    await rejectSymlinks(entry.file);
    const content = await read(entry.file);
    if (content === null) continue;
    const comment = entry.kind === "menu" ? "//" : entry.kind === "bindings-lua" ? "--" : "#";
    const block = ownedBlock(content, comment);
    if (block !== null && sha(block) !== entry.blockHash) {
      preserved.push(`${entry.file} (edited LoomOS block)`);
      continue;
    }
    const after =
      entry.kind === "menu" ? menuBlock(content, null) : markedBlock(content, null, comment);
    if (content !== after) {
      removed.push(`${entry.file} (LoomOS block)`);
      mutations.push(() => write(entry.file, after));
    }
  }
  // Validate every destination before removing any file.
  if (!dryRun) {
    for (const mutate of mutations) await mutate();
    if (preserved.length === 0) await NodeFSP.rm(p.manifest, { force: true });
  }
  return {
    removed,
    preserved,
    retained: [
      "browser profiles",
      "credentials",
      "app and T3 data",
      "backups",
      "background services",
    ],
    dryRun,
  };
}

export function loomEnvironment(config, env = process.env) {
  return {
    ...env,
    ...(config.switchboardUrl ? { LOOM_SWITCHBOARD_URL: config.switchboardUrl } : {}),
    ...(config.switchboardStatusUrl
      ? { LOOM_SWITCHBOARD_STATUS_URL: config.switchboardStatusUrl }
      : {}),
    ...(config.switchboardKeyHelper
      ? { LOOM_SWITCHBOARD_KEY_HELPER: config.switchboardKeyHelper }
      : {}),
  };
}
function serverEnvironment(config, env = process.env) {
  const result = loomEnvironment(config, env);
  // Service settings have one owner: the persisted pack config, not an ambient shell.
  for (const key of ["T3CODE_HOME", "T3CODE_RELEASE_BASE_URL", "T3CODE_HOST", "T3CODE_PORT"])
    delete result[key];
  if (config.serverBaseDir) result.T3CODE_HOME = config.serverBaseDir;
  if (config.serverReleaseBaseUrl) result.T3CODE_RELEASE_BASE_URL = config.serverReleaseBaseUrl;
  if (config.serverHost) result.T3CODE_HOST = config.serverHost;
  if (config.serverPort) result.T3CODE_PORT = String(config.serverPort);
  return result;
}
function executable(command) {
  return (
    NodeChildProcess.spawnSync("which", [command], { encoding: "utf8" }).stdout?.trim() || null
  );
}
export function appCommand(app, config, env = process.env, urlOverride) {
  if (app === "loom")
    return { command: config.loomExecutable, args: [], env: loomEnvironment(config, env) };
  const base =
    app === "office"
      ? config.officeUrl
      : app === "atlas"
        ? config.atlasUrl
        : app === "switchboard"
          ? config.switchboardDashboardUrl
          : null;
  if (!base) throw new Error(`${app} endpoint is not configured.`);
  const browser =
    config.browserExecutable ||
    executable("chromium") ||
    executable("google-chrome-stable") ||
    executable("google-chrome");
  if (!browser)
    throw new Error("Chromium is required for persistent Office and Atlas app windows.");
  const url = urlOverride || (app === "switchboard" ? base : `${base}/app/`);
  return {
    command: browser,
    args: [
      // Keep the existing Office profile. Mail links authenticate the same origin
      // that the Atlas app uses; browser origins still isolate each app's data.
      `--user-data-dir=${NodePath.join(paths(env).profiles, app === "atlas" ? "office" : app)}`,
      `--class=loom-os-${app}`,
      `--app=${url}`,
      "--no-first-run",
    ],
    env,
  };
}
async function queryHyprland(args, env) {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "hyprctl",
      args,
      { env, timeout: 3000, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve({ stdout })),
    );
  });
}

export async function focusExistingApp(app, config, env = process.env, query) {
  if (!["office", "atlas", "switchboard"].includes(app)) return false;
  if (!query && !env.HYPRLAND_INSTANCE_SIGNATURE) return false;
  query ??= (args) => queryHyprland(args, env);
  const origin =
    app === "office"
      ? config.officeUrl
      : app === "atlas"
        ? config.atlasUrl
        : config.switchboardDashboardUrl;
  if (!origin) return false;
  // Chromium uses the app URL as its Wayland identity. --class is also used by
  // extension popups, so matching that flag can focus 1Password instead.
  const url = new URL(app === "switchboard" ? origin : `${origin}/app/`);
  const identity = `chrome-${url.host.replaceAll(":", "_")}_${url.pathname.replaceAll("/", "_")}-Default`;
  let clients;
  try {
    clients = JSON.parse((await query(["clients", "-j"])).stdout);
    if (!Array.isArray(clients)) throw new Error("Invalid client list");
  } catch (cause) {
    throw new Error("Cannot inspect existing app windows; retry after Hyprland is available.", {
      cause,
    });
  }
  const client = clients.find(
    (c) =>
      c.mapped !== false &&
      (c.class === identity || c.initialClass === identity) &&
      /^0x[0-9a-f]+$/i.test(c.address),
  );
  if (!client) return false;
  const address = `address:${client.address}`;
  const dispatches = [
    ["eval", `hl.dispatch(hl.dsp.focus({window="${address}"}))`],
    ["dispatch", "focuswindow", address],
  ];
  for (const args of dispatches) {
    try {
      const { stdout } = await query(args);
      if (stdout.trim() === "ok") return true;
    } catch {
      /* Try the legacy dispatcher when the Lua API is unavailable. */
    }
  }
  throw new Error(`Cannot focus the existing ${appNames[app]} window; no duplicate was opened.`);
}

async function run(command, args, { env = process.env, detached = false } = {}) {
  if (command === "omarchy-launch-tui") {
    const spec = await loomTuiCommand(args, env);
    command = spec.command;
    args = spec.args;
  }
  const uwsm = detached && executable("uwsm-app");
  if (uwsm) {
    args = ["--", command, ...args];
    command = uwsm;
  }
  const child = NodeChildProcess.spawn(command, args, {
    env,
    stdio: detached ? "ignore" : "inherit",
    detached,
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  if (detached) {
    child.unref();
    return;
  }
  await new Promise((resolve, reject) => {
    child.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Command exited ${code ?? signal}`)),
    );
    child.once("error", reject);
  });
}
export function officeCaptureUrl(config, { title = "", text = "", url = "" }) {
  if (title.length > 200 || text.length > 4000 || url.length > 2048)
    throw new Error("Office capture limits: title 200, text 4000, URL 2048 characters.");
  if ([title, text, url].some((s) => s.includes("\0")))
    throw new Error("Capture cannot contain NUL characters.");
  if (!title && !text && !url) throw new Error("Capture needs text, title, or a URL.");
  if (url) {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || hasControl(url))
      throw new Error(
        "Capture URL must be HTTP(S) without embedded credentials or control characters.",
      );
  }
  const capture = new URL("/app/share", config.officeUrl);
  for (const [key, value] of Object.entries({ title, text, url }))
    if (value) capture.searchParams.set(key, value);
  return capture.href;
}

const integrationFormat = "loom-app-integration";
const integrationCapabilities = [
  "launch",
  "search",
  "capture",
  "links",
  "notifications",
  "availability",
];
const integrationText = (value, max = 4000) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\p{Cc}\p{Cf}]/u.test(value);
function integrationPath(value, prefix = "/") {
  if (
    !integrationText(value, 2048) ||
    !value.startsWith(prefix) ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//") ||
    /%(?:2e|2f|5c)/i.test(value) ||
    value.split("/").some((v) => v === "." || v === "..") ||
    new URL(value, "https://integration.invalid").pathname !== value
  )
    throw Error("Invalid app integration path.");
  return value;
}
function integrationOperation(value, app) {
  if (
    !value ||
    !integrationText(value.id, 100) ||
    !new RegExp(`^${app}\\.[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`).test(value.id) ||
    !["GET", "POST"].includes(value.method) ||
    !["read", "write", "external"].includes(value.effect) ||
    !["read-only", "idempotent", "non-idempotent", "destructive"].includes(value.mutation) ||
    !integrationText(value.approval, 100) ||
    !Array.isArray(value.command) ||
    value.command.length !== 2 ||
    value.command[0] !== app ||
    value.command[1] !== value.id.slice(app.length + 1).replaceAll(".", "-") ||
    !Array.isArray(value.scopes) ||
    value.scopes.length > 32 ||
    value.scopes.some((v) => !integrationText(v, 100)) ||
    !Array.isArray(value.surfaces) ||
    !value.surfaces.includes("api") ||
    !value.surfaces.includes("cli")
  )
    throw Error("Invalid app integration operation.");
  return { ...value, path: integrationPath(value.path, `/api/${app}/`) };
}
export function validateAppIntegration(value, app) {
  if (!["office", "atlas"].includes(app)) throw Error("Unknown integration app.");
  if (
    !value ||
    value.format !== integrationFormat ||
    value.app !== app ||
    !integrationText(value.name, 100) ||
    !value.version ||
    !Number.isSafeInteger(value.version.major) ||
    !Number.isSafeInteger(value.version.minor) ||
    value.version.major < 1 ||
    value.version.minor < 0
  )
    throw Error("Invalid app integration declaration.");
  if (value.version.major !== 1) throw Error("Unsupported app integration version. Update LoomOS.");
  if (
    !value.capabilities ||
    !Array.isArray(value.actions) ||
    value.actions.length > 32 ||
    !value.offline ||
    ["savedReading", "supportedWriting", "requiresPriorUse"].some(
      (key) => typeof value.offline[key] !== "boolean",
    ) ||
    !integrationText(value.offline.detail)
  )
    throw Error("Invalid app integration declaration.");
  const capabilities = {};
  for (const id of integrationCapabilities) {
    const cap = value.capabilities[id];
    if (
      !cap ||
      !Number.isSafeInteger(cap.version) ||
      cap.version < 1 ||
      typeof cap.supported !== "boolean"
    )
      throw Error("Invalid app integration capability.");
    if (cap.version !== 1) {
      capabilities[id] = {
        version: cap.version,
        supported: false,
        reason: `Update LoomOS to use ${id} capability version ${cap.version}.`,
      };
      continue;
    }
    if (!cap.supported && !integrationText(cap.reason))
      throw Error("Unavailable capability needs an explanation.");
    const normalized = { ...cap };
    if (cap.path !== undefined) normalized.path = integrationPath(cap.path, "/app/");
    if (cap.operation !== undefined)
      normalized.operation = integrationOperation(cap.operation, app);
    if (cap.supported && id === "launch" && !cap.path) throw Error("App launch path is missing.");
    if (cap.supported && id === "search") {
      if (
        !cap.operation ||
        cap.operation.effect !== "read" ||
        cap.operation.mutation !== "read-only" ||
        cap.operation.approval !== "none" ||
        !Number.isSafeInteger(cap.queryLimit) ||
        cap.queryLimit < 1 ||
        cap.queryLimit > 2000 ||
        !["characters", "utf8-bytes"].includes(cap.queryUnit)
      )
        throw Error("Invalid read-only app search capability.");
      const expected = {
        "office-search-v1": "office.search",
        "atlas-workspace-search-v1": "atlas.workspace.search",
      };
      if (expected[cap.format] !== cap.operation.id) {
        normalized.supported = false;
        normalized.reason =
          "This search format needs a newer LoomOS adapter. Open search inside the app.";
      }
    }
    if (cap.supported && id === "capture") {
      for (const key of ["titleLimit", "textLimit", "urlLimit"])
        if (!Number.isSafeInteger(cap[key]) || cap[key] < 1 || cap[key] > 65536)
          throw Error("Invalid app capture limits.");
      if (!["utf16-units", "utf8-bytes"].includes(cap.captureUnit))
        throw Error("Invalid app capture length unit.");
      if (
        !Array.isArray(cap.destinations) ||
        cap.destinations.length > 16 ||
        cap.destinations.some((v) => !integrationText(v, 100))
      )
        throw Error("Invalid capture destinations.");
      if (
        (app === "office" &&
          (cap.format !== "review-in-app-v1" || !cap.path || cap.reviewed !== true)) ||
        (app === "atlas" &&
          (cap.format !== "private-source-v1" ||
            cap.operation?.id !== "atlas.sources.capture" ||
            cap.operation.effect !== "write" ||
            cap.operation.approval !== "none" ||
            cap.operation.mutation !== "idempotent" ||
            cap.reviewed === true))
      ) {
        normalized.supported = false;
        normalized.reason =
          "This capture format needs a newer LoomOS adapter. Capture inside the app.";
      }
    }
    capabilities[id] = normalized;
  }
  const ids = new Set();
  const actions = value.actions.map((action) => {
    if (
      !action ||
      !integrationText(action.id, 100) ||
      !/^[a-z][a-z0-9-]*$/.test(action.id) ||
      ids.has(action.id) ||
      !integrationText(action.label, 160) ||
      typeof action.capability !== "string"
    )
      throw Error("Invalid app integration action.");
    ids.add(action.id);
    return {
      id: action.id,
      label: action.label,
      capability: action.capability,
      available: Boolean(capabilities[action.capability]?.supported),
      reason:
        capabilities[action.capability]?.reason || "This action needs a newer LoomOS capability.",
    };
  });
  return {
    format: integrationFormat,
    version: value.version,
    app,
    name: value.name,
    actions,
    capabilities,
    offline: value.offline,
  };
}
async function integrationBody(response) {
  if (Number(response.headers.get("content-length")) > 128 * 1024) {
    await response.body?.cancel();
    throw Error("App integration declaration exceeds its size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("App integration declaration is empty.");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 128 * 1024) throw Error("App integration declaration exceeds its size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function discoverAppIntegration(app, config, { request = fetch } = {}) {
  if (!["office", "atlas"].includes(app) || !config[`${app}Url`])
    throw Error("Configure the app address before checking integration.");
  const origin = config[`${app}Url`];
  try {
    const response = await request(origin + "/.well-known/loom-app", {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        app,
        state: [404, 410].includes(response.status) ? "legacy" : "unavailable",
        detail: [404, 410].includes(response.status)
          ? "This app release has no integration declaration. Existing limited app controls remain available."
          : [401, 403].includes(response.status)
            ? "App integration requires authorization. Open the app or check its server policy."
            : "App integration is unavailable. Check connections and retry.",
        manifest: null,
      };
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw Error("Invalid app integration response type.");
    }
    const manifest = validateAppIntegration(await integrationBody(response), app);
    return {
      app,
      state: "available",
      detail: "Versioned app integration is available. App permissions remain authoritative.",
      manifest,
    };
  } catch (error) {
    return {
      app,
      state: "unavailable",
      detail: error.message?.startsWith("Unsupported app integration")
        ? "This app needs a newer LoomOS integration version. Update LoomOS or use the app directly."
        : "The app integration declaration is unavailable or invalid. Check connections or update the app, then retry.",
      manifest: null,
    };
  }
}
export async function integratedSearchCommand(
  app,
  query,
  config,
  env = process.env,
  dependencies = {},
) {
  if (!["office", "atlas"].includes(app) || !config[`${app}Cli`] || !config[`${app}Url`])
    throw Error("Configure the app CLI and reachable origin first.");
  if (
    typeof query !== "string" ||
    !query.trim() ||
    [...query].length > 2000 ||
    /[\p{Cc}\p{Cf}]/u.test(query)
  )
    throw Error("Search needs a bounded query without control characters.");
  const report = await (dependencies.discover ?? discoverAppIntegration)(app, config);
  if (report.state === "legacy")
    return { ...searchCommand(app, query, config, env), integrationState: "legacy" };
  if (report.state !== "available") throw Error(report.detail);
  const cap = report.manifest.capabilities.search;
  if (!cap.supported) throw Error(cap.reason);
  const size = cap.queryUnit === "characters" ? [...query].length : Buffer.byteLength(query);
  if (size > cap.queryLimit)
    throw Error(
      `Search is limited to ${cap.queryLimit} ${cap.queryUnit === "characters" ? "characters" : "UTF-8 bytes"}.`,
    );
  return {
    command: config[`${app}Cli`],
    args: [...cap.operation.command, "--query", query, "--limit", "20", "--json"],
    env: { ...env, API_URL: config[`${app}Url`] },
    integrationState: "available",
    resultFormat: cap.format,
  };
}
export async function integratedCaptureCommand(
  app,
  payload,
  config,
  env = process.env,
  dependencies = {},
) {
  if (!["office", "atlas"].includes(app) || !config[`${app}Url`])
    throw Error("Configure the app address first.");
  const { title = "", text = "", url = "" } = payload;
  if ([title, text, url].some((value) => typeof value !== "string" || value.includes("\0")))
    throw Error("Capture needs text without NUL characters.");
  if (!title.trim() && !text.trim() && !url) throw Error("Capture needs text, title, or a URL.");
  if (app === "atlas" && (!config.atlasCli || !title.trim() || !text.trim()))
    throw Error("Atlas capture needs a configured CLI/endpoint, --title and --text.");
  if (url) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      hasControl(url)
    )
      throw Error(
        "Capture URL must be HTTP(S) without embedded credentials or control characters.",
      );
  }
  const report = await (dependencies.discover ?? discoverAppIntegration)(app, config);
  if (!["available", "legacy"].includes(report.state)) throw Error(report.detail);
  const cap =
    report.state === "available"
      ? report.manifest.capabilities.capture
      : {
          supported: true,
          path: "/app/share",
          captureUnit: app === "office" ? "utf16-units" : "utf8-bytes",
          titleLimit: 200,
          textLimit: app === "office" ? 4000 : 65536,
          urlLimit: app === "office" ? 2048 : 2000,
          operation: { command: ["atlas", "sources-capture"] },
        };
  if (!cap.supported) throw Error(cap.reason);
  const size = (value) =>
    cap.captureUnit === "utf8-bytes" ? Buffer.byteLength(value) : value.length;
  for (const [field, value] of Object.entries({ title, text, url }))
    if (size(value) > cap[`${field}Limit`])
      throw Error(
        `Capture ${field} exceeds the app limit of ${cap[`${field}Limit`]} ${cap.captureUnit}.`,
      );
  if (app === "office") {
    const target = new URL(cap.path, config.officeUrl);
    for (const [key, value] of Object.entries({ title, text, url }))
      if (value) target.searchParams.set(key, value);
    return {
      ...appCommand(app, config, env, target.href),
      integrationState: report.state,
      reviewed: true,
    };
  }
  return {
    command: config.atlasCli,
    args: [
      ...cap.operation.command,
      "--title",
      title,
      "--text",
      text,
      ...(url ? ["--url", url] : []),
      "--audience",
      "private",
      "--topics",
      "omarchy",
      "--json",
    ],
    env: { ...env, API_URL: config.atlasUrl },
    integrationState: report.state,
    reviewed: false,
  };
}

export function integrationSearchResults(app, page, format) {
  if (format !== "atlas-workspace-search-v1") return finderResults(app, page);
  if (
    app !== "atlas" ||
    !Array.isArray(page?.matches) ||
    page.matches.length > 20 ||
    typeof page.next !== "string" ||
    !integrationText(page.coverage)
  )
    throw Error("The app returned an unsupported search response.");
  return {
    more: Boolean(page.next),
    coverage: terminalText(page.coverage),
    results: page.matches.map((item, index) => {
      if (
        !item ||
        !["source", "output", "draft", "opportunity"].includes(item.kind) ||
        !integrationText(item.id, 150) ||
        typeof item.title !== "string" ||
        typeof item.snippet !== "string" ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 1 ||
        typeof item.versionId !== "string"
      )
        throw Error("The app returned an unsupported search result.");
      const title = terminalText(item.title, 200) || "Untitled";
      return {
        label: `${index + 1}. ${title} (${item.kind})`,
        title,
        text: terminalText(item.snippet),
        reference: {
          kind: item.kind,
          id: item.id,
          revision: item.revision,
          versionId: item.versionId,
        },
      };
    }),
  };
}
function formatAppIntegration(report) {
  if (report.state !== "available") return `${appNames[report.app]}: ${report.detail}`;
  const manifest = report.manifest;
  return [
    `${manifest.name}: integration ${manifest.version.major}.${manifest.version.minor}`,
    ...integrationCapabilities.map(
      (id) =>
        `${id}: ${manifest.capabilities[id].supported ? "Supported" : manifest.capabilities[id].reason}`,
    ),
    "Offline support: " + manifest.offline.detail,
    "These are build capabilities, not a signed-in session, grant or live device status.",
  ].join("\n");
}

// Search text never becomes shell code, browser navigation or an AI prompt.
export function searchCommand(app, query, config, env = process.env) {
  if (!["office", "atlas"].includes(app) || !config[`${app}Cli`] || !config[`${app}Url`])
    throw new Error("Configure the app CLI and reachable origin first.");
  const limit = app === "office" ? 500 : 200;
  const length = app === "office" ? [...query].length : Buffer.byteLength(query);
  if (!query.trim() || length > limit || /[\p{Cc}\p{Cf}]/u.test(query))
    throw new Error(
      `Search needs a query without control characters, up to ${limit} ${app === "office" ? "characters" : "UTF-8 bytes"}.`,
    );
  return {
    command: config[`${app}Cli`],
    args: [
      app,
      app === "office" ? "search" : "sources-list",
      "--query",
      query,
      "--limit",
      "20",
      "--json",
    ],
    env: { ...env, API_URL: config[`${app}Url`] },
  };
}
const terminalText = (value, limit = 2000) =>
  typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, limit) : "";
export function finderResults(app, page) {
  const items = app === "office" ? page?.items : page?.sources;
  if (!Array.isArray(items) || items.length > 20)
    throw new Error("The app returned an unsupported search response.");
  const results = items.map((item, index) => {
    const source = app === "office" ? item : item?.source;
    const id = app === "office" ? item?.reference?.id : source?.id;
    if (!source || typeof id !== "string" || !id || typeof source.title !== "string")
      throw new Error("The app returned an unsupported search result.");
    const title = terminalText(source.title, 200) || "Untitled";
    const kind = terminalText(app === "office" ? item.app : source.project, 80);
    const text =
      app === "office"
        ? terminalText(item.snippet)
        : [
            terminalText(source.project),
            ...(Array.isArray(source.topics)
              ? source.topics.map((v) => terminalText(v, 100)).slice(0, 20)
              : []),
          ]
            .filter(Boolean)
            .join(" · ");
    return { label: `${index + 1}. ${title}${kind ? ` (${kind})` : ""}`, title, text };
  });
  return {
    results,
    more: Boolean(app === "office" ? page.nextCursor : page.next),
  };
}
async function readSearch(spec) {
  const cliEnv = await appCliEnvironment(spec.args[0], spec.env.API_URL, spec.env);
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      spec.command,
      spec.args,
      {
        env: cliEnv,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => {
        // CLI stderr may contain authentication details. Keep diagnostics local to its own login flow.
        if (error)
          return reject(
            new Error(
              "Search could not reach the app or its CLI session. Check connections or sign in to the CLI.",
            ),
          );
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("The app returned an unsupported search response."));
        }
      },
    );
  });
}
async function finderChoice(args, env) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn("gum", args, {
      env,
      stdio: ["inherit", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", () =>
      reject(
        new Error(
          "The native picker is unavailable. Search remains available with loom-os search.",
        ),
      ),
    );
    child.once("exit", (code) => {
      if ([1, 130].includes(code)) resolve(null);
      else if (code === 0) resolve(stdout.replace(/\r?\n$/, ""));
      else reject(new Error("The native picker could not be opened."));
    });
  });
}
async function copyFinderText(text, env) {
  const child = NodeChildProcess.spawn("wl-copy", [], { env, stdio: ["pipe", "ignore", "ignore"] });
  await new Promise((resolve, reject) => {
    const failure = () => reject(new Error("Could not copy text to the Wayland clipboard."));
    child.once("error", failure);
    child.stdin.once("error", failure);
    child.once("exit", (code) => (code === 0 ? resolve() : failure()));
    child.stdin.end(text);
  });
}
export async function nativeFinder(config, env, initialApp, dependencies = {}) {
  const choose =
    dependencies.choose ??
    ((header, choices) => finderChoice(["choose", "--header", header, "--", ...choices], env));
  const input =
    dependencies.input ??
    ((app) =>
      finderChoice(
        [
          "input",
          "--header",
          `Search ${appNames[app]}`,
          "--placeholder",
          app === "office"
            ? "Words, phrases or Office filters"
            : "Words in saved Research or Presence work",
          "--char-limit",
          app === "office" ? "500" : "200",
        ],
        env,
      ));
  const search = dependencies.search ?? readSearch;
  const copy = dependencies.copy ?? ((text) => copyFinderText(text, env));
  const show = dependencies.show ?? console.log;
  const open = dependencies.open ?? ((app) => main(["open", app], env));
  const login = dependencies.login ?? ((app) => main(["connect", app, "--inline"], env));
  const apps = ["office", "atlas"].filter((app) => config[`${app}Cli`] && config[`${app}Url`]);
  if (!apps.length || (initialApp && !apps.includes(initialApp)))
    throw new Error("Configure the app CLI and reachable origin first.");
  while (true) {
    const selected =
      initialApp ?? (await choose("Find in apps", [...apps.map((app) => appNames[app]), "Close"]));
    const app = initialApp ?? apps.find((app) => appNames[app] === selected);
    if (!app) return;
    const query = await input(app);
    if (query === null) return;
    let page;
    show(`Searching ${appNames[app]}…`);
    try {
      const spec = await integratedSearchCommand(app, query, config, env, {
        discover: dependencies.discover,
      });
      page = integrationSearchResults(app, await search(spec), spec.resultFormat);
    } catch (error) {
      show(terminalText(error.message));
      const recovery = await choose(`Search ${appNames[app]}`, [
        "Search again",
        "Connect search",
        "Connection status",
        "Close",
      ]);
      if (recovery === "Connect search") {
        try {
          await login(app);
        } catch {
          show("Search setup did not finish. Try again when the app is reachable.");
        }
      } else if (recovery === "Connection status") {
        try {
          await (dependencies.connections ?? (() => main(["doctor", "--human"], env)))();
        } catch {
          show("Connection checks did not finish. Use LoomOS > AI and connections.");
        }
      } else if (recovery !== "Search again") return;
      continue;
    }
    show(
      page.results.length
        ? `${page.results.length} results${page.more ? "; showing the first page. Refine your query for more." : "."}`
        : "No matches. Try different words.",
    );
    if (page.coverage) show(page.coverage);
    else if (app === "atlas")
      show("This older Atlas release searches library titles, projects and topics.");
    while (true) {
      const selectedResult = await choose(`Search ${appNames[app]}`, [
        ...page.results.map((r) => r.label),
        "Copy query and open app",
        "Search again",
        "Close",
      ]);
      if (!selectedResult || selectedResult === "Close") return;
      if (selectedResult === "Search again") break;
      if (selectedResult === "Copy query and open app") {
        try {
          await copy(query);
          await open(app);
        } catch (error) {
          show(terminalText(error.message));
          continue;
        }
        return;
      }
      const result = page.results.find((r) => r.label === selectedResult);
      if (!result) return;
      show(`${result.title}\n${result.text || "No excerpt available."}`);
      show(
        "Open the item using search inside the app. Opening the app focuses its existing window.",
      );
      const action = await choose("Search result", [
        "Copy excerpt",
        "Copy title and open app",
        "Back to results",
        "Close",
      ]);
      if (!action || action === "Close") return;
      try {
        if (action === "Copy excerpt") {
          await copy(`${result.title}\n${result.text}`);
          show("Copied.");
        } else if (action === "Copy title and open app") {
          await copy(result.title);
          await open(app);
          return;
        }
      } catch (error) {
        show(terminalText(error.message));
      }
    }
  }
}

// This catalog describes existing native actions. Listing it checks local state only;
// live availability and app permissions remain authoritative at execution.
export function loomActionCatalog(config, context = {}) {
  const missing = new Set(context.missingExecutables ?? []);
  const configured = (...keys) => keys.every((key) => Boolean(config[key]) && !missing.has(key));
  const actions = [];
  const add = (
    id,
    title,
    description,
    args,
    available = true,
    reason = "",
    shortcut = "",
    command = null,
  ) => {
    actions.push({
      id,
      title,
      description,
      args,
      command,
      available,
      unavailableReason: available ? null : reason,
      shortcut: context.shortcuts === undefined ? shortcut : (context.shortcuts[id] ?? ""),
    });
  };
  add("actions", "Loom actions", "Find native utilities", ["actions"]);
  add("shortcuts", "Shortcuts", "Review keyboard presets and personal bindings", ["shortcuts"]);
  add("readability", "Readability controls", "Larger dialog text, fonts and theme contrast", [
    "readability",
  ]);
  add(
    "compatibility",
    "Compatibility checks",
    "Inspect native menu, theme picker and integration ownership",
    ["compatibility", "--terminal"],
  );
  add(
    "app-integration",
    "App integration",
    "Inspect supported app capabilities and offline bounds",
    ["app-integration", "--terminal"],
  );
  add(
    "open-loom",
    "Open Loom",
    "Coding threads and agents",
    ["open", "loom"],
    configured("loomExecutable"),
    "Restore the installed Loom executable or update its configured path.",
    "Super+Ctrl+Alt+L",
  );
  add(
    "open-office",
    "Open Office",
    "Mail, notes, calendar and reminders",
    ["open", "office"],
    configured("officeUrl") && !missing.has("browserExecutable"),
    "Configure the Office address and restore the configured browser.",
    "Super+Ctrl+Alt+O",
  );
  add(
    "open-atlas",
    "Open Atlas",
    "Research sources and writing",
    ["open", "atlas"],
    configured("atlasUrl") && !missing.has("browserExecutable"),
    "Configure the Atlas address and restore the configured browser.",
    "Super+Ctrl+Alt+A",
  );
  add(
    "open-switchboard",
    "Open Switchboard",
    "Shared AI accounts, models and routing",
    ["open", "switchboard"],
    configured("switchboardDashboardUrl") && !missing.has("browserExecutable"),
    "Configure the Switchboard dashboard address and restore the configured browser.",
  );
  const searchable = (app) => configured(app + "Cli", app + "Url");
  add(
    "find",
    "Find in apps",
    "Search Office and Atlas",
    ["find"],
    searchable("office") || searchable("atlas"),
    "Install and configure an Office or Atlas search client.",
    "Super+Ctrl+Alt+F",
  );
  for (const app of ["office", "atlas"]) {
    const name = appNames[app];
    const reason = `Install and configure the ${name} search client and app address, then use Connect ${name} search.`;
    add(
      "search-" + app,
      "Search " + name,
      app === "office"
        ? "Find mail, notes and other records"
        : "Find library titles, projects and topics",
      ["find", app],
      searchable(app),
      reason,
    );
    add(
      "connect-" + app,
      "Connect " + name + " search",
      "Sign in and approve search access",
      ["connect", app],
      searchable(app),
      reason,
    );
  }
  add(
    "capture-office",
    "Capture in Office",
    "Save clipboard text as a note, reminder or Desk draft",
    ["capture", "office", "--clipboard"],
    configured("officeUrl") && !missing.has("browserExecutable"),
    "Configure Office and restore the browser before capturing clipboard text.",
    "Super+Ctrl+Alt+N",
  );
  add(
    "ask-ai",
    "Ask AI",
    "Ask the agent through private Switchboard routing",
    ["agent"],
    configured("switchboardCli", "switchboardUrl"),
    "Connect Switchboard and its installed client before using AI.",
    "Super+Shift+A",
  );
  add(
    "connections",
    "Connection status",
    "Check apps, private network and AI; recover connections",
    ["connections", "--terminal"],
  );
  add("doctor", "Check connections", "Inspect app access and the background Loom service", [
    "doctor",
    "--terminal",
  ]);
  add(
    "tailscale",
    "Open Tailscale",
    "Private network and device connections",
    ["omarchy.tailscale", "open"],
    true,
    "",
    "",
    "omarchy-shell",
  );
  for (const mode of ["dark", "light"])
    add(
      "iris-" + mode,
      "Iris " + (mode === "dark" ? "Dark" : "Light"),
      "Apply Iris colors using the native theme flow",
      ["loom-iris-" + mode],
      (context.availableThemes ?? []).includes(mode),
      "Install the Iris " +
        mode +
        " theme first. Other themes remain available in the native Theme picker.",
      "",
      "omarchy-theme-set",
    );
  add("integration", "Installed integration", "Version, profile, theme and retained rollback", [
    "pack",
    "status",
    "--terminal",
  ]);
  add(
    "rollback",
    "Restore previous integration",
    "Review and confirm the retained release",
    ["pack", "rollback", "--terminal"],
    Boolean(context.previousRelease) && !context.pendingActivation,
    context.pendingActivation
      ? "Finish the exact pending integration update before choosing a rollback."
      : "No verified previous integration release is available.",
  );
  add(
    "pair",
    "Connect another device",
    "Pair a laptop or phone with this workstation",
    ["pair", "--terminal"],
    config.profile === "workstation" && configured("serverExecutable", "serverBaseDir"),
    "Enable the workstation profile and configure its Loom server; start hosting before pairing.",
  );
  add(
    "about",
    "About LoomOS",
    "Native system overview and LOOM wordmark",
    [],
    true,
    "",
    "",
    "omarchy-launch-about",
  );
  return actions;
}
function validateActionQuery(query) {
  if (typeof query !== "string" || [...query].length > 200 || /[\p{Cc}\p{Cf}]/u.test(query))
    throw new Error("Action query must contain at most 200 characters without control characters.");
}
export function filterLoomActions(actions, query = "") {
  validateActionQuery(query);
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return actions.filter((action) =>
    words.every((word) =>
      `${action.title} ${action.description}`.toLocaleLowerCase().includes(word),
    ),
  );
}
async function collectLoomActions(config, env) {
  const p = paths(env);
  const missingExecutables = [];
  await Promise.all(
    [
      "loomExecutable",
      "browserExecutable",
      "officeCli",
      "atlasCli",
      "switchboardCli",
      "serverExecutable",
    ].map(async (key) => {
      if (!config[key]) return;
      try {
        await NodeFSP.access(config[key], NodeFSP.constants.X_OK);
      } catch {
        missingExecutables.push(key);
      }
    }),
  );
  const availableThemes = [];
  await Promise.all(
    ["dark", "light"].map(async (mode) => {
      try {
        if (
          (
            await NodeFSP.stat(NodePath.join(p.home, ".config/omarchy/themes/loom-iris-" + mode))
          ).isDirectory()
        )
          availableThemes.push(mode);
      } catch {
        /* The catalog provides setup guidance for a missing theme. */
      }
    }),
  );
  let previousRelease = false,
    pendingActivation = false;
  try {
    const { releaseStatus } = await import("./release.mjs");
    const status = await releaseStatus({ env });
    previousRelease = Boolean(status.previous?.verified);
    pendingActivation = Boolean(status.pending);
  } catch {
    /* A damaged release record must not enable rollback. */
  }
  const shortcuts = {};
  const defaults = loomActionCatalog(config);
  const recordShortcut = (keys, command) => {
    const action = defaults.find(
      (action) => !action.command && command === `${shellQuote(p.bin)} ${action.args.join(" ")}`,
    );
    if (
      action &&
      (!shortcuts[action.id] || keys.split("+").length < shortcuts[action.id].split("+").length)
    )
      shortcuts[action.id] = keys
        .replace(/SUPER/gi, "Super")
        .replace(/CTRL/gi, "Ctrl")
        .replace(/ALT/gi, "Alt")
        .replace(/SHIFT/gi, "Shift")
        .replace(/\s*\+\s*/g, "+");
  };
  const lua = await read(NodePath.join(p.config, "hypr/bindings.lua"));
  if (lua !== null) {
    for (const match of lua.matchAll(
      /o\.bind\(\s*("(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*")/g,
    )) {
      try {
        recordShortcut(JSON.parse(match[1]), JSON.parse(match[3]));
      } catch {
        // Ignore unsupported Lua string escapes in personal bindings.
      }
    }
  } else {
    const conf = await read(NodePath.join(p.config, "hypr/bindings.conf"));
    for (const line of (conf ?? "").split("\n")) {
      const fields = line.split(",").map((field) => field.trim());
      const commandIndex = fields[2] === "exec" ? 3 : fields[3] === "exec" ? 4 : null;
      if (/^bindd?\s*=/.test(fields[0]) && commandIndex !== null)
        recordShortcut(
          fields[0]
            .replace(/^bindd?\s*=\s*/, "")
            .split(/\s+/)
            .join("+") +
            "+" +
            fields[1],
          fields.slice(commandIndex).join(","),
        );
    }
  }
  return loomActionCatalog(config, {
    missingExecutables,
    availableThemes,
    previousRelease,
    pendingActivation,
    shortcuts,
  });
}
export async function nativeActions(config, env, query = "", dependencies = {}) {
  validateActionQuery(query);
  const catalog = dependencies.catalog ?? (() => collectLoomActions(config, env));
  const filter =
    dependencies.filter ??
    (async (value, actions) => {
      const rows = actions.map(
        (action) =>
          `${action.title}${action.shortcut ? " [" + action.shortcut + "]" : ""} | ${action.description}${action.available ? "" : " | Setup needed"}`,
      );
      const selected = await finderChoice(
        [
          "filter",
          "--header",
          "Loom actions · Esc leaves search; Esc again closes",
          "--placeholder",
          "Find apps, save notes, AI or connections",
          `--value=${value}`,
          "--strict",
          "--",
          ...rows,
        ],
        env,
      );
      return selected === null ? null : (actions[rows.indexOf(selected)]?.id ?? "unknown");
    });
  const choose =
    dependencies.choose ??
    ((choices) => finderChoice(["choose", "--header", "Loom actions", "--", ...choices], env));
  const show = dependencies.show ?? console.log;
  const execute =
    dependencies.execute ??
    ((action) =>
      action.command ? run(action.command, action.args, { env }) : main(action.args, env));
  let retry = null;
  while (true) {
    const actions = await catalog();
    const id = retry ?? (await filter(query, actions));
    retry = null;
    if (id === null) return;
    const action = actions.find((action) => action.id === id);
    if (!action) throw new Error("The picker returned an unknown action.");
    show(action.title + "\n" + action.description);
    if (!action.available) {
      show(action.unavailableReason);
      if ((await choose(["Back to actions", "Close"])) === "Back to actions") continue;
      return;
    }
    try {
      await execute(action);
      return;
    } catch {
      show(action.title + " did not finish. Check connections, retry, or return to actions.");
      const choice = await choose(["Retry action", "Back to actions", "Close"]);
      if (choice === "Retry action") retry = id;
      else if (choice !== "Back to actions") return;
    }
  }
}

function searchSecretArgs(app, origin) {
  return ["application", "loom-os-search", "app", app, "origin", origin];
}
async function searchSecret(operation, app, origin, env, key) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "secret-tool",
      [
        operation,
        ...(operation === "store" ? ["--label", `${appNames[app]} search on LoomOS`] : []),
        ...searchSecretArgs(app, origin),
      ],
      { env, stdio: ["pipe", "pipe", "ignore"] },
    );
    let value = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      value += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The desktop secret store did not respond."));
    }, 5000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("The desktop secret store is unavailable."));
    });
    child.stdin.once("error", () => {});
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(value.replace(/\r?\n$/, ""));
      else if (operation === "lookup") resolve("");
      else reject(new Error("The desktop secret store could not save this connection."));
    });
    child.stdin.end(key ?? "");
  });
}
export async function appCliEnvironment(app, origin, env, lookup = searchSecret) {
  if (env.API_TOKEN) return env;
  let token = "";
  try {
    token = await lookup("lookup", app, origin, env);
  } catch {
    /* Existing CLI device credentials still work without Secret Service. */
  }
  return token ? { ...env, API_TOKEN: token } : env;
}
export function searchBrowserCommand(app, config, env, url) {
  const candidate = new URL(url),
    expected = new URL(config[`${app}Url`]);
  if (
    candidate.origin !== expected.origin ||
    candidate.username ||
    candidate.password ||
    hasControl(url)
  )
    throw new Error("The approval page must belong to the configured app.");
  const spec = appCommand(app, config, env);
  return { ...spec, args: [spec.args[0], "--no-first-run", candidate.href] };
}
export async function searchLoginMode(origin, request = fetch) {
  const response = await request(new URL("/.well-known/oauth-authorization-server", origin), {
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (response.status === 404) return "key";
  if (!response.ok)
    throw new Error("The app's connection setup is unavailable. Check connections and retry.");
  const metadata = await response.json();
  if (!metadata.device_authorization_endpoint) return "key";
  if (
    typeof metadata.issuer !== "string" ||
    metadata.issuer.replace(/\/$/, "") !== origin ||
    !metadata.token_endpoint ||
    [metadata.device_authorization_endpoint, metadata.token_endpoint].some(
      (url) => typeof url !== "string" || new URL(url).origin !== origin,
    )
  )
    throw new Error("The app returned unsupported sign-in metadata.");
  return "device";
}
async function searchDeviceLogin(app, config, env, openPage, show) {
  const child = NodeChildProcess.spawn(config[`${app}Cli`], ["login"], {
    env: { ...env, API_URL: config[`${app}Url`] },
    stdio: ["inherit", "pipe", "inherit"],
  });
  let opened = false;
  const launches = [];
  const lines = NodeReadline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    show(line);
    const url = line.trim();
    if (!opened && /^https?:\/\//.test(url)) {
      try {
        searchBrowserCommand(app, config, env, url);
      } catch {
        show("The returned approval page is outside the configured app and was not opened.");
        return;
      }
      opened = true;
      launches.push(
        openPage(url).catch(() => show("The browser did not open. Use the approval link above.")),
      );
    }
  });
  const forward = (signal) => child.kill(signal);
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((signal) => () => forward(signal));
  signals.forEach((signal, i) => process.on(signal, handlers[i]));
  try {
    await new Promise((resolve, reject) => {
      child.once("error", () =>
        reject(new Error("The app's command-line client could not start.")),
      );
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("The app connection was not completed.")),
      );
    });
    await Promise.all(launches);
  } finally {
    lines.close();
    signals.forEach((signal, i) => process.removeListener(signal, handlers[i]));
  }
}
export async function connectSearch(app, config, env, dependencies = {}) {
  if (!["office", "atlas"].includes(app) || !config[`${app}Cli`] || !config[`${app}Url`])
    throw new Error("Configure the app CLI and reachable origin first.");
  const origin = config[`${app}Url`];
  const choose =
    dependencies.choose ??
    ((header, choices) => finderChoice(["choose", "--header", header, "--", ...choices], env));
  const show = dependencies.show ?? console.log;
  const secret = dependencies.secret ?? searchSecret;
  const openPage =
    dependencies.openPage ??
    (async (url) => {
      const spec = searchBrowserCommand(app, config, env, url);
      await run(spec.command, spec.args, { env, detached: true });
    });
  const mode = await (dependencies.mode ?? searchLoginMode)(origin);
  if (mode === "device") {
    show(
      `Connect ${appNames[app]} search. Review and approve the connection in the browser that opens.`,
    );
    await (dependencies.deviceLogin ?? searchDeviceLogin)(app, config, env, openPage, show);
    show("Search is connected. Return to Find in apps.");
    return;
  }
  show(
    `${appNames[app]} uses an API key for search access on this server. Create a key in the app, copy it, then choose Paste search key here.`,
  );
  if (app === "office")
    show(
      "In API keys & agents, give it Search and the app/mailbox permissions you want to search. The app decides which records it can access.",
    );
  while (true) {
    const choice = await choose(`Connect ${appNames[app]} search`, [
      "Open access settings",
      "Paste search key",
      "Forget saved search key",
      "Close",
    ]);
    if (!choice || choice === "Close") return;
    if (choice === "Open access settings")
      await openPage(
        new URL(app === "office" ? "/app/?view=connections" : "/account/api-keys", origin).href,
      );
    else if (choice === "Forget saved search key") {
      await secret("clear", app, origin, env);
      show("Saved search key removed. Revoke it in the app to remove its server access.");
    } else if (choice === "Paste search key") {
      const key = await (
        dependencies.password ??
        (() =>
          finderChoice(
            [
              "input",
              "--password",
              "--header",
              `Paste ${appNames[app]} search key`,
              "--placeholder",
              "Key stays in this desktop's secret store",
              "--char-limit",
              "4096",
            ],
            env,
          ))
      )();
      if (key === null) return;
      if (!key || key.length > 4096 || /[\p{Cc}\p{Cf}\s]/u.test(key)) {
        show("Paste the key without whitespace or control characters.");
        continue;
      }
      try {
        const spec = searchCommand(app, "loom-search-connection-check", config, {
          ...env,
          API_TOKEN: key,
        });
        finderResults(app, await (dependencies.validate ?? readSearch)(spec));
        await secret("store", app, origin, env, key);
        show("Search is connected. Return to Find in apps.");
        return;
      } catch {
        show(
          "This key could not connect search. Check its permissions and the app connection, then try again.",
        );
      }
    }
  }
}

function parseArgs(args) {
  const options = {},
    positional = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      positional.push(args[i]);
      continue;
    }
    const key = args[i].slice(2);
    if (["dry-run", "clipboard", "help", "terminal", "human", "enable-status"].includes(key))
      options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`Missing value for --${key}`);
      options[key] = args[++i];
    }
  }
  return { options, positional };
}
const print = (value) => console.log(JSON.stringify(value, null, 2));
export function compileNativeMenu(source) {
  if (typeof source !== "string" || source.length > 1024 * 1024)
    throw Error("Unsupported native menu parser.");
  const module = { exports: {} };
  NodeVM.runInNewContext(source, { module }, { timeout: 1000, filename: "MenuModel.js" });
  for (const name of ["parseMenuJsonc", "mergeMenuSources", "item"])
    if (typeof module.exports[name] !== "function")
      throw Error("Native menu parser contract has changed.");
  return module.exports;
}
export async function collectCompatibility(config, env) {
  const p = paths(env),
    root = env.OMARCHY_PATH || "/usr/share/omarchy",
    checks = [];
  if (!NodePath.isAbsolute(root) || hasControl(root)) throw Error("Omarchy path must be absolute.");
  const add = (id, state, detail) => checks.push({ id, state, detail });
  let version = "unknown";
  try {
    const raw = (await read(NodePath.join(root, "version")))?.trim();
    if (raw && /^[\w.+-]{1,80}$/.test(raw)) version = raw;
  } catch {
    /* Report an unknown version. */
  }
  add(
    "version",
    ["4.0.4", "4.0.0.alpha"].includes(version) ? "ok" : "warning",
    `Omarchy ${version}. Parser fixtures cover pinned upstream 4.0.0.alpha; Workstation 4.0.4 was previously verified. Other versions require native acceptance.`,
  );
  const lua = await read(NodePath.join(p.config, "hypr/bindings.lua")),
    legacy = await read(NodePath.join(p.config, "hypr/bindings.conf"));
  add(
    "bindings",
    lua !== null || legacy !== null ? "ok" : "error",
    lua !== null
      ? "Lua user bindings detected."
      : legacy !== null
        ? "Legacy user bindings detected; graphical menu extensions are unavailable."
        : "No supported user bindings file was found.",
  );
  if (lua !== null) {
    try {
      const parser = compileNativeMenu(
        await NodeFSP.readFile(NodePath.join(root, "shell/plugins/menu/MenuModel.js"), "utf8"),
      );
      const native = parser.parseMenuJsonc(
        await NodeFSP.readFile(NodePath.join(root, "default/omarchy/omarchy-menu.jsonc"), "utf8"),
      );
      const raw = await read(NodePath.join(p.config, "omarchy/extensions/omarchy-menu.jsonc"));
      const user = parser.parseMenuJsonc(raw ?? "{}");
      if (!native.length || (raw && !user.length && !/^\s*\{\s*\}\s*$/.test(raw)))
        throw Error("Native or user menu data did not parse.");
      const merged = parser.mergeMenuSources(native, user);
      if (!merged || !merged.items) throw Error("Native menu merge contract changed.");
      add("native-menu", "ok", "The installed native parser accepts the stock and user menus.");
      const theme = parser.item(merged.items, "style.theme"),
        stock = native.find((v) => v.id === "style.theme");
      add(
        "theme-picker",
        stock?.action && theme?.action === stock.action ? "ok" : "error",
        stock?.action && theme?.action === stock.action
          ? "The Theme entry retains the stock native picker."
          : "The Theme entry overrides or loses the stock picker. Review personal menu overrides before updating.",
      );
      for (const [id, key, suffix] of [
        ["loom-actions", "loomos.actions", "actions"],
        ["shortcuts", "loomos.appearance.shortcuts", "shortcuts"],
        ["readability", "loomos.appearance.readability", "readability"],
        ["compatibility", "loomos.maintenance.compatibility", "compatibility --terminal"],
      ]) {
        const entry = parser.item(merged.items, key);
        add(
          id,
          entry?.action === `${shellQuote(p.bin)} ${suffix}` ? "ok" : "error",
          entry?.action === `${shellQuote(p.bin)} ${suffix}`
            ? `${key} resolves to its installed Loom command.`
            : `${key} is missing or overridden.`,
        );
      }
      const about = parser.item(merged.items, "about"),
        nativeAbout = native.find((v) => v.id === "about");
      add(
        "about",
        about?.action === nativeAbout?.action && Boolean(about?.icon) ? "ok" : "error",
        "About must preserve the native action and icon when its label changes.",
      );
    } catch (error) {
      const existing = checks.find((v) => v.id === "native-menu");
      if (existing) {
        existing.state = "error";
        existing.detail = terminalText(error.message);
      } else add("native-menu", "error", terminalText(error.message));
    }
  } else
    add(
      "native-menu",
      "warning",
      "Native menu checks require the supported Omarchy Lua shell. Legacy bindings remain available.",
    );
  try {
    const manifest = await readJson(p.manifest);
    if (
      !manifest ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.patches)
    )
      throw Error("Integration ownership record is missing or invalid.");
    for (const entry of manifest.files) {
      await rejectSymlinks(entry.file);
      const current = await read(entry.file);
      if (current === null || sha(current) !== entry.hash)
        throw Error("An owned integration file has local edits or is missing.");
    }
    for (const entry of manifest.patches) {
      const comment = entry.kind === "menu" ? "//" : entry.kind === "bindings-lua" ? "--" : "#";
      await rejectSymlinks(entry.file);
      const block = ownedBlock((await read(entry.file)) ?? "", comment);
      if (block === null || sha(block) !== entry.blockHash)
        throw Error("An owned integration block has local edits or is missing.");
    }
    add(
      "ownership",
      "ok",
      "Owned files and integration blocks match their installation record; surrounding personal settings are preserved.",
    );
  } catch (error) {
    add("ownership", "error", terminalText(error.message));
  }
  add(
    "activation",
    (await read(NodePath.join(p.state, "loom-os/pack-pending.json"))) === null ? "ok" : "error",
    "A pending pack activation must be finished with its exact reviewed release before another update.",
  );
  add(
    "shortcut-update",
    (await read(NodePath.join(p.state, "loom-os/shortcut-pending.json"))) === null ? "ok" : "error",
    "An interrupted shortcut change must be recovered before another preset is applied.",
  );
  return {
    version,
    checks,
    errors: checks.filter((v) => v.state === "error").length,
    warnings: checks.filter((v) => v.state === "warning").length,
    readOnly: true,
    networkUsed: false,
    providerInference: false,
    physicalAcceptance:
      "Separate native keyboard, display and sleep/wake checks are required on applicable hardware.",
  };
}
function formatCompatibility(report) {
  return [
    `Compatibility: ${report.errors} errors, ${report.warnings} warnings`,
    ...report.checks.map((v) => `[${v.state.toUpperCase()}] ${v.id}: ${v.detail}`),
    report.physicalAcceptance,
  ].join("\n");
}

const help = `LoomOS: native Omarchy integration for your existing apps\n\ninstall|configure --loom-executable /absolute/Loom.AppImage [--profile laptop|workstation]\n  [--office-url ORIGIN] [--atlas-url ORIGIN] [--office-cli PATH] [--atlas-cli PATH]\n  [--browser-executable PATH] [--switchboard-url ORIGIN] [--switchboard-status-url URL]\n  [--switchboard-dashboard-url URL] [--switchboard-key-helper PATH] [--switchboard-cli PATH]\n  [--server-executable PATH] [--server-base-dir PATH] [--server-release-base-url URL]\n  [--server-host HOST] [--server-port PORT] [--dry-run]\nactions [--query TEXT] [--json]  (discover native actions; listing is offline and read-only)\nshortcuts [show|preview PRESET|apply PRESET|set ACTION CHORD|restore|recover] [--dry-run]\nreadability  (native utility text sizing and font/theme controls)\ncompatibility [--human|--terminal]  (read-only native menu and ownership checks)\napp-integration [--human|--terminal]  (app-owned capabilities and offline bounds)\nopen loom|office|atlas|switchboard\ncapture office [--clipboard] [--title TITLE] [--text TEXT] [--url URL]\ncapture atlas --title TITLE --text TEXT  (saves a private source)\nsearch office|atlas QUERY\nfind [office|atlas]  (native read-only search picker)\nconnect office|atlas  (open search access setup)\nlogin office|atlas\nai claude|codex [native CLI args]\nagent [--inline] [--prompt TEXT]\ndefault-agent [claude|codex]\nai-usage [--limits-only]\npair [--terminal] [--tailscale-serve-port PORT]  (private workstation pairing)\nservice status|install|restart|uninstall  (existing T3 CLI, explicit operations)\nservice install [--release-base-url URL]  (install-only verified archive mirror)\npack install DIRECTORY SHA256 [--dry-run]  (verified integration update)\npack rollback [--dry-run|--terminal]  (review the previous integration release)\npack status [--human|--terminal]  (version, profile, theme and verified retained releases)\nstatus\nconnections [--human|--terminal|--enable-status]  (private AI and workstation recovery)\ndoctor [--human|--terminal]  (read-only connection checks and recovery guidance)\nuninstall [--dry-run]\n\nProfiles share app behavior. Laptop starts no background service. Workstation\ncan enable the fork's existing T3 service explicitly. Offline capabilities\ncome from Office/Atlas, with their browser storage preserved.\n`;

export async function main(args = process.argv.slice(2), env = process.env) {
  const [action, ...rest] = args;
  if (!action || ["help", "--help", "-h"].includes(action)) {
    console.log(help);
    return;
  }
  const p = paths(env);
  if (action === "pack") {
    const release = await import("./release.mjs");
    if (["status", "rollback"].includes(rest[0]) && rest[1] === "--terminal") {
      if (rest.length !== 2)
        throw new Error("Use pack status --terminal or pack rollback --terminal.");
      await run(
        "omarchy-launch-tui",
        [
          `--app-id=org.omarchy.loom-pack-${rest[0]}`,
          NodePath.join(p.root, `pack-${rest[0]}-terminal`),
        ],
        { env },
      );
      return;
    }
    const result = await release.main(rest, env);
    if (typeof result === "string") console.log(result);
    else print(result);
    return;
  }
  if (action === "uninstall") {
    const { options } = parseArgs(rest);
    print(await uninstall({ env, dryRun: !!options["dry-run"] }));
    return;
  }
  if (["install", "configure"].includes(action)) {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("Node 24 or newer is required.");
    const { options } = parseArgs(rest);
    if (options.help) {
      console.log(help);
      return;
    }
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Portable standalone CLI has no Effect runtime dependency.
    if (process.platform !== "linux" && !options["dry-run"])
      throw new Error("Install LoomOS on Linux; use --dry-run to prepare elsewhere.");
    const config = (await readJson(p.configFile)) ?? {
      version: 1,
      profile: "laptop",
      officeUrl: "https://office.begam.in",
    };
    const mapping = {
      profile: "profile",
      "loom-executable": "loomExecutable",
      "office-url": "officeUrl",
      "atlas-url": "atlasUrl",
      "office-cli": "officeCli",
      "atlas-cli": "atlasCli",
      "browser-executable": "browserExecutable",
      "switchboard-url": "switchboardUrl",
      "switchboard-status-url": "switchboardStatusUrl",
      "switchboard-dashboard-url": "switchboardDashboardUrl",
      "switchboard-key-helper": "switchboardKeyHelper",
      "switchboard-cli": "switchboardCli",
      "server-executable": "serverExecutable",
      "server-base-dir": "serverBaseDir",
      "server-release-base-url": "serverReleaseBaseUrl",
      "server-host": "serverHost",
      "server-port": "serverPort",
    };
    for (const [key, value] of Object.entries(options)) {
      if (key === "dry-run") continue;
      if (!mapping[key]) throw new Error(`Unknown option: --${key}`);
      if (key === "server-port" && !/^\d+$/.test(value))
        throw new Error("--server-port must be an integer from 1 to 65535.");
      config[mapping[key]] = key === "server-port" ? Number(value) : value;
    }
    print(await install(config, { env, dryRun: !!options["dry-run"] }));
    return;
  }
  const config = validateConfig(await readJson(p.configFile));
  if (action === "app-integration") {
    if (rest.length > 1 || (rest.length && !["--human", "--terminal"].includes(rest[0])))
      throw Error("Usage: app-integration [--human|--terminal]");
    if (rest[0] === "--terminal")
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.loom-app-integration",
          NodePath.join(p.root, "app-integration-terminal"),
        ],
        { env },
      );
    else {
      const reports = await Promise.all(
        ["office", "atlas"]
          .filter((app) => config[`${app}Url`])
          .map((app) => discoverAppIntegration(app, config)),
      );
      if (rest[0] === "--human") console.log(reports.map(formatAppIntegration).join("\n\n"));
      else print(reports);
    }
    return;
  }
  if (action === "compatibility") {
    if (rest.length > 1 || (rest.length && !["--human", "--terminal"].includes(rest[0])))
      throw Error("Usage: compatibility [--human|--terminal]");
    if (rest[0] === "--terminal")
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.loom-compatibility",
          NodePath.join(p.root, "compatibility-terminal"),
        ],
        { env },
      );
    else {
      const report = await collectCompatibility(config, env);
      if (rest[0] === "--human") console.log(formatCompatibility(report));
      else print(report);
    }
    return;
  }
  if (action === "shortcuts") {
    if (!rest.length || (rest.length === 1 && rest[0] === "--inline")) {
      if (!rest.length)
        await run(
          "omarchy-launch-tui",
          ["--app-id=org.omarchy.loom-shortcuts", NodePath.join(p.root, "shortcuts-terminal")],
          { env },
        );
      else {
        if (!process.stdin.isTTY) throw Error("Shortcuts need an interactive terminal.");
        await nativeShortcuts(config, env);
      }
      return;
    }
    const [operation, ...values] = rest,
      dryRun = values.includes("--dry-run"),
      args = values.filter((v) => v !== "--dry-run");
    if (operation === "recover" && !values.length) {
      print(await recoverShortcuts(env));
      return;
    }
    if (operation === "show" && !values.length) {
      print(await shortcutStatus(config, env));
      return;
    }
    let prefs;
    if (["preview", "apply"].includes(operation) && args.length === 1) {
      prefs = { ...(await readShortcuts(env)), preset: args[0] };
      if (args[0] === "none") prefs.bindings = {};
    } else if (operation === "set" && args.length === 2) {
      prefs = await readShortcuts(env);
      prefs.bindings[args[0]] = args[1];
    } else if (operation === "restore" && !args.length) {
      if (dryRun) {
        const saved = await readJson(NodePath.join(p.state, "loom-os/shortcut-restore.json"));
        if (!saved) throw Error("No previous shortcuts.");
        prefs = saved.previous;
      } else {
        print(await restoreShortcuts(config, env));
        return;
      }
    } else
      throw Error(
        "Usage: shortcuts show|preview PRESET|apply PRESET|set ACTION CHORD|restore [--dry-run]",
      );
    const report =
      operation === "preview" || dryRun
        ? publicShortcutPlan(await shortcutPreview(config, env, prefs))
        : await applyShortcuts(config, env, prefs);
    print(report);
    return;
  }
  if (action === "readability") {
    if (!rest.length)
      await run(
        "omarchy-launch-tui",
        ["--app-id=org.omarchy.loom-readability", NodePath.join(p.root, "readability-terminal")],
        { env },
      );
    else if (rest.length === 1 && rest[0] === "--inline") {
      if (!process.stdin.isTTY) throw Error("Readability controls need an interactive terminal.");
      await nativeReadability(env);
    } else throw Error("Usage: readability");
    return;
  }
  if (action === "actions") {
    let inline = false,
      json = false,
      query = "";
    const seen = new Set();
    for (let i = 0; i < rest.length; i++) {
      const option = rest[i];
      if (seen.has(option) || !["--inline", "--json", "--query"].includes(option))
        throw new Error("Usage: loom-os actions [--query TEXT] [--json]");
      seen.add(option);
      if (option === "--inline") inline = true;
      else if (option === "--json") json = true;
      else {
        if (rest[i + 1] === undefined) throw new Error("Action query needs a value.");
        query = rest[++i];
      }
    }
    if (inline && json) throw new Error("Choose interactive actions or JSON listing.");
    validateActionQuery(query);
    if (json) print(filterLoomActions(await collectLoomActions(config, env), query));
    else if (inline) {
      if (!process.stdin.isTTY) throw new Error("Loom actions needs an interactive terminal.");
      await nativeActions(config, env, query);
    } else
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.loom-actions",
          NodePath.join(p.root, "actions-terminal"),
          "--query",
          query,
        ],
        { env },
      );
    return;
  }
  if (action === "connect") {
    const app = rest[0];
    if (
      !["office", "atlas"].includes(app) ||
      rest.slice(1).some((arg) => arg !== "--inline") ||
      rest.length > 2
    )
      throw new Error("Usage: loom-os connect office|atlas");
    if (rest[1] === "--inline") {
      if (!process.stdin.isTTY) throw new Error("Search setup needs an interactive terminal.");
      await connectSearch(app, config, env);
    } else
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.loom-search-connect",
          NodePath.join(p.root, "connect-search-terminal"),
          app,
        ],
        { env },
      );
    return;
  }
  if (action === "find") {
    const inline = rest.includes("--inline");
    const apps = rest.filter((arg) => arg !== "--inline");
    if (
      apps.length > 1 ||
      (apps[0] && !["office", "atlas"].includes(apps[0])) ||
      rest.filter((arg) => arg === "--inline").length > 1
    )
      throw new Error("Usage: loom-os find [office|atlas]");
    if (inline) {
      if (!process.stdin.isTTY) throw new Error("The native finder needs an interactive terminal.");
      await nativeFinder(config, env, apps[0]);
    } else {
      await run(
        "omarchy-launch-tui",
        ["--app-id=org.omarchy.loom-find", NodePath.join(p.root, "find-terminal"), ...apps],
        { env },
      );
    }
    return;
  }
  if (action === "connections") {
    const { options, positional } = parseArgs(rest);
    if (
      positional.length ||
      Object.keys(options).some((key) => !["human", "terminal", "enable-status"].includes(key)) ||
      Object.keys(options).length > 1
    )
      throw new Error("Usage: loom-os connections [--human|--terminal|--enable-status]");
    if (options["enable-status"]) {
      await run("omarchy-shell", ["shell", "putBarWidget", "loom.status", "{}"], { env });
    } else if (options.terminal) {
      await run(
        "omarchy-launch-tui",
        ["--app-id=org.omarchy.loom-connections", NodePath.join(p.root, "connections-terminal")],
        { env },
      );
    } else {
      const report = await collectPrivateConnections(config, env);
      if (options.human) console.log(formatPrivateConnections(report));
      else print(report);
    }
    return;
  }
  if (["status", "doctor"].includes(action)) {
    const { options, positional } = parseArgs(rest);
    if (
      positional.length ||
      Object.keys(options).some(
        (key) => action !== "doctor" || !["human", "terminal"].includes(key),
      )
    )
      throw new Error("Usage: loom-os status | doctor [--human|--terminal]");
    if (options.terminal) {
      await run(
        "omarchy-launch-tui",
        ["--app-id=org.omarchy.loom-health", NodePath.join(p.root, "doctor-terminal")],
        { env },
      );
      return;
    }
    const checks = {
      profile: config.profile,
      config: p.configFile,
      node: process.version,
      omarchy: executable("omarchy"),
      browser: config.browserExecutable || executable("chromium"),
      offline: "Uses the shared app implementation. OS integration adds no sync engine.",
    };
    for (const key of [
      "loomExecutable",
      "officeCli",
      "atlasCli",
      "switchboardCli",
      "switchboardKeyHelper",
      "serverExecutable",
    ]) {
      if (config[key]) {
        try {
          await NodeFSP.access(config[key], NodeFSP.constants.X_OK);
          checks[key] = "executable";
        } catch {
          checks[key] = "missing or not executable";
        }
      }
    }
    if (action === "doctor") {
      const report = await collectConnections(config, env);
      for (const [key, state] of Object.entries(checks)) {
        if (state === "missing or not executable")
          report.diagnostics.push({
            id: key,
            title: key,
            state: "error",
            detail: "The configured executable is missing or unavailable.",
            repair:
              "Restore its installed custom release or correct the executable path with loom-os configure. App data is preserved.",
          });
      }
      Object.assign(checks, report, { summary: connectionSummary(report) });
      if (options.human) console.log(formatConnections(report));
      else print(checks);
      return checks.summary.errors ? 1 : 0;
    }
    print(checks);
    return;
  }
  if (action === "open") {
    const spec = appCommand(rest[0], config, env);
    if (!(await focusExistingApp(rest[0], config, env)))
      await run(spec.command, spec.args, { env: spec.env, detached: true });
    return;
  }
  if (await aiAction(action, rest, config, env, p, run)) return;
  if (action === "pair") {
    if (config.profile !== "workstation" || !config.serverExecutable || !config.serverBaseDir)
      throw new Error(
        "Pairing requires the workstation profile and configured server-executable and server-base-dir. Start its existing service first.",
      );
    const { options, positional } = parseArgs(rest);
    if (
      positional.length ||
      Object.keys(options).some((key) => !["terminal", "tailscale-serve-port"].includes(key))
    )
      throw new Error("Usage: loom-os pair [--terminal] [--tailscale-serve-port PORT]");
    const rawPort = options["tailscale-serve-port"] ?? "443";
    if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
      throw new Error("--tailscale-serve-port must be an integer from 1 to 65535.");
    const port = String(Number(rawPort));
    if (options.terminal) {
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.loom-pair",
          NodePath.join(p.root, "pair-terminal"),
          "--tailscale-serve-port",
          port,
        ],
        { env },
      );
    } else {
      // The supported CLI discovers the configured running environment, refuses
      // occupied routes, and owns short-lived pairing credentials and QR output.
      await run(
        config.serverExecutable,
        [
          "pair",
          "--tailscale",
          "--base-dir",
          config.serverBaseDir,
          "--tailscale-serve-port",
          port,
          "--label",
          "LoomOS workstation",
        ],
        { env: serverEnvironment(config, env) },
      );
    }
    return;
  }
  if (action === "service") {
    if (
      !config.serverExecutable ||
      !["status", "install", "restart", "uninstall"].includes(rest[0])
    )
      throw new Error(
        "Configure the custom fork server-executable, then use service status|install|restart|uninstall.",
      );
    const operation = rest[0];
    const { options, positional } = parseArgs(rest.slice(1));
    if (
      positional.length ||
      Object.keys(options).some((key) => key !== "release-base-url") ||
      (options["release-base-url"] && operation !== "install")
    )
      throw new Error(
        "Service accepts only install --release-base-url URL; configure persistent settings with loom-os configure.",
      );
    if (!config.serverBaseDir)
      throw new Error(
        "Configure --server-base-dir before managing the service to select its data directory explicitly.",
      );
    if (["install", "restart"].includes(operation) && !config.serverReleaseBaseUrl)
      throw new Error(
        "Configure --server-release-base-url for the custom fork before installation or restart; upstream runtime substitution is disabled.",
      );
    const mirror =
      options["release-base-url"] === undefined
        ? undefined
        : validateOrigin(options["release-base-url"], "release-base-url", { allowPath: true });
    const unitDirectory = NodePath.join(p.home, ".config/systemd/user");
    if (operation !== "status") {
      // T3 uses one unit name per user, and its uninstall ignores --base-dir.
      // Preserve another environment even when its executable is a different fork.
      const unit = await read(NodePath.join(unitDirectory, "t3code.service"));
      if (unit !== null) {
        const raw = /^Environment=T3CODE_HOME=(.*)$/m.exec(unit)?.[1]?.trim();
        const installedHome =
          raw?.startsWith('"') && raw.endsWith('"')
            ? raw.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
            : raw;
        if (
          !installedHome ||
          NodePath.resolve(installedHome.replaceAll("%%", "%")) !==
            NodePath.resolve(config.serverBaseDir)
        )
          throw new Error(
            "Preserving t3code.service for an unknown or different data directory; select its server-base-dir or migrate it explicitly.",
          );
      }
    }
    let environmentChanged = false;
    // The upstream renderer does not persist ambient variables. Keep startup
    // settings in its actual HOME/.config unit directory, including with custom XDG paths.
    if (["install", "restart"].includes(operation)) {
      const quote = (s) =>
        `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
      const variables = serverEnvironment(config, {});
      const content = `[Service]\n${Object.entries(variables)
        .map(([key, value]) => `Environment=${quote(`${key}=${value}`)}`)
        .join("\n")}\n`;
      const file = NodePath.join(unitDirectory, "t3code.service.d/loom-os.conf");
      const stateFile = NodePath.join(p.state, "loom-os/service-environment.json");
      const ownership = await readJson(stateFile);
      const prior = await read(file);
      const next = `# LoomOS service environment\n${content}`;
      if (prior !== null && sha(prior) !== ownership?.hash && prior !== next)
        throw new Error(`Preserving edited or unowned service configuration: ${file}`);
      await rejectSymlinks(stateFile);
      environmentChanged = prior !== null && prior !== next;
      await write(file, next);
      await write(stateFile, `${JSON.stringify({ file, hash: sha(next) }, null, 2)}\n`);
    }
    await run(config.serverExecutable, ["service", operation, "--base-dir", config.serverBaseDir], {
      env: {
        ...serverEnvironment(config, env),
        ...(mirror === undefined ? {} : { T3CODE_RELEASE_BASE_URL: mirror }),
      },
    });
    if (operation === "install" && environmentChanged)
      console.log(
        "Service startup settings changed. If the CLI reported an already-current service, run loom-os service restart to apply them when agent work can stop.",
      );
    return;
  }
  if (action === "capture") {
    const { options, positional } = parseArgs(rest),
      app = positional[0];
    let text = options.text || "";
    if (options.clipboard) {
      const result = NodeChildProcess.spawnSync("wl-paste", ["--no-newline"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 3000,
      });
      if (result.error || result.status !== 0)
        throw new Error("Could not read text from the Wayland clipboard.");
      text = result.stdout;
    }
    const spec = await integratedCaptureCommand(
      app,
      { title: options.title, text, url: options.url },
      config,
      env,
    );
    await run(spec.command, spec.args, {
      env: app === "atlas" ? await appCliEnvironment(app, config.atlasUrl, spec.env) : env,
      detached: app === "office",
    });
    return;
  }
  if (["login", "search"].includes(action)) {
    const [app, ...query] = rest;
    if (!["office", "atlas"].includes(app) || !config[`${app}Cli`] || !config[`${app}Url`])
      throw new Error("Configure the app CLI and reachable origin first.");
    if (action === "login")
      await run(config[`${app}Cli`], ["login"], { env: { ...env, API_URL: config[`${app}Url`] } });
    else {
      const spec = await integratedSearchCommand(app, query.join(" "), config, env);
      await run(spec.command, spec.args, {
        env: await appCliEnvironment(app, config[`${app}Url`], spec.env),
      });
    }
    return;
  }
  throw new Error(`Unknown command: ${action}. Run loom-os help.`);
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      if (typeof code === "number") process.exitCode = code;
    })
    .catch((error) => {
      console.error(`LoomOS: ${error.message}`);
      process.exitCode = 1;
    });
}
