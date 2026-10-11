#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeReadline from "node:readline";

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
  const bindings = [
    ["L", "Loom", "open loom"],
    ["O", "Office", "open office"],
    ...(config.atlasUrl ? [["A", "Atlas", "open atlas"]] : []),
    ["N", "Capture in Office", "capture office --clipboard"],
    ...(finderEnabled ? [["F", "Find in apps", "find"]] : []),
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
          app === "office" ? "Words, phrases or Office filters" : "Source title, project or topic",
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
      page = finderResults(app, await search(searchCommand(app, query, config, env)));
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
    if (app === "atlas") show("Atlas searches library titles, projects and topics.");
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
const help = `LoomOS: native Omarchy integration for your existing apps\n\ninstall|configure --loom-executable /absolute/Loom.AppImage [--profile laptop|workstation]\n  [--office-url ORIGIN] [--atlas-url ORIGIN] [--office-cli PATH] [--atlas-cli PATH]\n  [--browser-executable PATH] [--switchboard-url ORIGIN] [--switchboard-status-url URL]\n  [--switchboard-dashboard-url URL] [--switchboard-key-helper PATH] [--switchboard-cli PATH]\n  [--server-executable PATH] [--server-base-dir PATH] [--server-release-base-url URL]\n  [--server-host HOST] [--server-port PORT] [--dry-run]\nopen loom|office|atlas|switchboard\ncapture office [--clipboard] [--title TITLE] [--text TEXT] [--url URL]\ncapture atlas --title TITLE --text TEXT  (saves a private source)\nsearch office|atlas QUERY\nfind [office|atlas]  (native read-only search picker)\nconnect office|atlas  (open search access setup)\nlogin office|atlas\nai claude|codex [native CLI args]\nagent [--inline] [--prompt TEXT]\ndefault-agent [claude|codex]\nai-usage [--limits-only]\npair [--terminal] [--tailscale-serve-port PORT]  (private workstation pairing)\nservice status|install|restart|uninstall  (existing T3 CLI, explicit operations)\nservice install [--release-base-url URL]  (install-only verified archive mirror)\npack install DIRECTORY SHA256 [--dry-run]  (verified integration update)\npack rollback [--dry-run|--terminal]  (review the previous integration release)\npack status [--human|--terminal]  (version, profile, theme and verified retained releases)\nstatus\nconnections [--human|--terminal|--enable-status]  (private AI and workstation recovery)\ndoctor [--human|--terminal]  (read-only connection checks and recovery guidance)\nuninstall [--dry-run]\n\nProfiles share app behavior. Laptop starts no background service. Workstation\ncan enable the fork's existing T3 service explicitly. Offline capabilities\ncome from Office/Atlas, with their browser storage preserved.\n`;

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
    if (action === "login")
      await run(config[`${app}Cli`], ["login"], { env: { ...env, API_URL: config[`${app}Url`] } });
    else {
      const spec = searchCommand(app, query.join(" "), config, env);
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
