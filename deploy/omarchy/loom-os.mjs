#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { aiFiles, aiBindings, aiMenu, aiEnvironment, aiAction } from "./ai.mjs";
import { collectConnections, connectionSummary, formatConnections } from "./health.mjs";

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

export async function installationPlan(config, env = process.env, packDir = sourceDir) {
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
  writes.set(NodePath.join(p.root, "doctor-terminal"), {
    content: `#!/bin/bash\nprintf '\\033]0;Check connections\\007'\n${shellQuote(p.bin)} doctor --human\nstatus=$?\nprintf '\\nPress Enter to close. '\nread -r _\nexit "$status"\n`,
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
  const bindings = [
    ["L", "Loom", "open loom"],
    ["O", "Office", "open office"],
    ...(config.atlasUrl ? [["A", "Atlas", "open atlas"]] : []),
    ["N", "Capture in Office", "capture office --clipboard"],
  ];
  const patches = [];
  if (lua !== null) {
    const body =
      (aiEnabled ? aiBindings(p) + "\n" : "") +
      bindings
        .map(
          ([key, name, suffix]) =>
            `o.bind("SUPER + CTRL + ALT + ${key}", ${JSON.stringify(name)}, ${JSON.stringify(command(suffix))})`,
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
      .map(
        ([key, name, suffix]) =>
          `bindd = SUPER CTRL ALT, ${key}, ${name}, exec, ${command(suffix)}`,
      )
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
    const entries = { loomos: { label: "LoomOS", description: "Your apps and native utilities" } };
    for (const [app, name] of Object.entries(appNames)) {
      if (
        (app === "atlas" && !config.atlasUrl) ||
        (app === "switchboard" && !config.switchboardDashboardUrl)
      )
        continue;
      entries[`loomos.${app}`] = { label: name, action: command(`open ${app}`) };
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

function parseArgs(args) {
  const options = {},
    positional = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      positional.push(args[i]);
      continue;
    }
    const key = args[i].slice(2);
    if (["dry-run", "clipboard", "help", "terminal", "human"].includes(key)) options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`Missing value for --${key}`);
      options[key] = args[++i];
    }
  }
  return { options, positional };
}
const print = (value) => console.log(JSON.stringify(value, null, 2));
const help = `LoomOS: native Omarchy integration for your existing apps\n\ninstall|configure --loom-executable /absolute/Loom.AppImage [--profile laptop|workstation]\n  [--office-url ORIGIN] [--atlas-url ORIGIN] [--office-cli PATH] [--atlas-cli PATH]\n  [--browser-executable PATH] [--switchboard-url ORIGIN] [--switchboard-status-url URL]\n  [--switchboard-dashboard-url URL] [--switchboard-key-helper PATH] [--switchboard-cli PATH]\n  [--server-executable PATH] [--server-base-dir PATH] [--server-release-base-url URL]\n  [--server-host HOST] [--server-port PORT] [--dry-run]\nopen loom|office|atlas|switchboard\ncapture office [--clipboard] [--title TITLE] [--text TEXT] [--url URL]\ncapture atlas --title TITLE --text TEXT  (saves a private source)\nsearch office|atlas QUERY\nlogin office|atlas\nai claude|codex [native CLI args]\nagent [--inline] [--prompt TEXT]\ndefault-agent [claude|codex]\nai-usage [--limits-only]\npair [--terminal] [--tailscale-serve-port PORT]  (private workstation pairing)\nservice status|install|restart|uninstall  (existing T3 CLI, explicit operations)\nservice install [--release-base-url URL]  (install-only verified archive mirror)\npack install DIRECTORY SHA256 [--dry-run]  (verified integration update)\npack rollback [--dry-run]  (previous integration release)\nstatus\ndoctor [--human|--terminal]  (read-only connection checks and recovery guidance)\nuninstall [--dry-run]\n\nProfiles share app behavior. Laptop starts no background service. Workstation\ncan enable the fork's existing T3 service explicitly. Offline capabilities\ncome from Office/Atlas, with their browser storage preserved.\n`;

export async function main(args = process.argv.slice(2), env = process.env) {
  const [action, ...rest] = args;
  if (!action || ["help", "--help", "-h"].includes(action)) {
    console.log(help);
    return;
  }
  const p = paths(env);
  if (action === "pack") {
    const release = await import("./release.mjs");
    print(await release.main(rest));
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
    if (app === "office") {
      const url = officeCaptureUrl(config, { title: options.title, text, url: options.url });
      const spec = appCommand(app, config, env, url);
      await run(spec.command, spec.args, { env, detached: true });
      return;
    }
    if (app === "atlas") {
      if (!config.atlasCli || !config.atlasUrl || !options.title || !text)
        throw new Error("Atlas capture needs a configured CLI/endpoint, --title and --text.");
      await run(
        config.atlasCli,
        [
          "atlas",
          "sources-capture",
          "--title",
          options.title,
          "--text",
          text,
          "--audience",
          "private",
          "--topics",
          "omarchy",
          "--json",
        ],
        { env: { ...env, API_URL: config.atlasUrl } },
      );
      return;
    }
    throw new Error("Capture supports office or atlas.");
  }
  if (["login", "search"].includes(action)) {
    const [app, ...query] = rest;
    if (!["office", "atlas"].includes(app) || !config[`${app}Cli`] || !config[`${app}Url`])
      throw new Error("Configure the app CLI and reachable origin first.");
    const argv =
      action === "login"
        ? ["login"]
        : [
            app,
            app === "office" ? "search" : "sources-list",
            "--query",
            query.join(" "),
            "--limit",
            "20",
            "--json",
          ];
    if (action === "search" && !query.length) throw new Error("Search needs a query.");
    await run(config[`${app}Cli`], argv, { env: { ...env, API_URL: config[`${app}Url`] } });
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
