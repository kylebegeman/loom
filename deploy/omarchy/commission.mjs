#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import {
  paths,
  validateConfig,
  validateOrigin,
  collectCompatibility,
  compileNativeMenu,
  shortcutBindings,
  applyShortcuts,
  recoverShortcuts,
  main as loomMain,
} from "./loom-os.mjs";
import { verifyRelease, activateRelease, releaseStatus } from "./release.mjs";
import { guidedConnectionReport, connectionCommand } from "./connections.mjs";

const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const hash = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
async function fileHash(file) {
  const digest = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const isHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v);
const commands = {
  loom: ["loomExecutable"],
  office: ["officeCli"],
  atlas: ["atlasCli"],
  switchboard: ["switchboardCli", "switchboardKeyHelper"],
  server: ["serverExecutable"],
};
const bootstrap =
  '#!/bin/sh\nset -eu\nroot=$(CDPATH=\'\' cd -- "$(dirname -- "$0")" && pwd)\nexec node "$root/integration/pack/commission.mjs" "$@"\n';
const usage =
  "LoomOS reproducible setup\n\nbuild SPEC INPUTS OUTPUT  (prepare a portable kit from checked release payloads)\nplan KIT [--profile laptop|workstation] [--review-sha256 HASH]\napply KIT --review-sha256 HASH [--profile laptop|workstation]\nstatus [--human]  (verify installed recipe and remaining local steps)\ncontinue  (native setup and recovery controls)\n\nA kit contains no credentials or personal state. Keep its printed recipe SHA256\nwith an independent recovery copy. Laptop never starts background hosting.\n";
function object(v, keys, label) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Invalid " + label + " fields.");
}
function relative(v) {
  if (
    typeof v !== "string" ||
    !v ||
    hasControl(v) ||
    v.includes("\\") ||
    NodePath.posix.isAbsolute(v) ||
    v.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("Use a portable relative payload path.");
  return v;
}
async function safePath(path) {
  let current = NodePath.resolve(path);
  for (;;) {
    try {
      if ((await NodeFSP.lstat(current)).isSymbolicLink())
        throw Error("Preserving a symlink at " + current);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const parent = NodePath.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function readJSON(file) {
  await safePath(file);
  try {
    return JSON.parse(await NodeFSP.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function atomicJSON(file, value) {
  await safePath(file);
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + NodeCrypto.randomUUID();
  await NodeFSP.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await NodeFSP.rename(temp, file);
}
async function inventory(root, prefix = "", base = root) {
  await safePath(root);
  const files = {};
  for (const entry of (await NodeFSP.readdir(root)).sort()) {
    const name = relative(prefix + entry),
      file = NodePath.join(root, entry),
      stat = await NodeFSP.lstat(file);
    if (stat.isDirectory()) Object.assign(files, await inventory(file, name + "/", base));
    else if (stat.isSymbolicLink()) {
      const link = await NodeFSP.readlink(file);
      if (NodePath.isAbsolute(link) || hasControl(link) || link.includes("\\"))
        throw Error("Nonportable payload symlink.");
      const resolved = await NodeFSP.realpath(file);
      if (!resolved.startsWith(NodePath.resolve(base) + NodePath.sep))
        throw Error("Payload symlink leaves its release.");
      files[name] = { link };
    } else if (stat.isFile()) {
      if (
        /^(?:\.env(?:\..*)?|id_rsa|id_ed25519|authorized_keys)$/.test(entry) ||
        name.split("/").some((part) => [".ssh", "userdata", "browser-profiles"].includes(part))
      )
        throw Error("Personal state or credential files cannot enter a recovery kit.");
      files[name] = {
        sha256: await fileHash(file),
        executable: Boolean(stat.mode & 0o111),
      };
    } else throw Error("Unsupported release payload member.");
  }
  return files;
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function baseRecipe(v, withFiles = true) {
  object(
    v,
    [
      "format",
      "version",
      "name",
      "profile",
      "target",
      "pack",
      "components",
      "apps",
      "switchboard",
      "server",
      "preferences",
    ],
    "recipe",
  );
  if (
    v.format !== "loom-os-recipe" ||
    v.version !== 1 ||
    !id(v.name) ||
    !["laptop", "workstation"].includes(v.profile)
  )
    throw Error("Use a named version 1 LoomOS recipe and laptop/workstation profile.");
  object(v.target, ["platform", "arch", "omarchy"], "target");
  if (
    v.target.platform !== "linux" ||
    !["x64", "arm64"].includes(v.target.arch) ||
    !Array.isArray(v.target.omarchy) ||
    !v.target.omarchy.length ||
    !v.target.omarchy.every(id)
  )
    throw Error("Declare Linux architecture and explicitly supported Omarchy versions.");
  object(v.pack, ["version", "sha256"], "pack");
  if (!id(v.pack.version) || !isHash(v.pack.sha256))
    throw Error("Pin the reviewed pack version and SHA256.");
  object(v.components, Object.keys(commands), "components");
  if (!v.components.loom) throw Error("A custom Loom release is required.");
  for (const [name, c] of Object.entries(v.components)) {
    object(
      c,
      withFiles
        ? ["version", "commands", "appImage", "appDir", "runtimeDirectory", "files"]
        : ["version", "commands", "appImage", "appDir", "runtimeDirectory"],
      name,
    );
    if (!id(c.version)) throw Error("Pin each component release version.");
    object(c.commands, commands[name], name + " commands");
    if (!commands[name].every((k) => typeof c.commands[k] === "string"))
      throw Error("Declare each component command.");
    for (const value of Object.values(c.commands)) relative(value);
    if (c.appImage !== undefined || c.appDir !== undefined) {
      if (name !== "loom") throw Error("Only Loom supports an extracted AppImage launcher.");
      relative(c.appImage);
      relative(c.appDir);
      if (c.commands.loomExecutable !== c.appDir + "/AppRun")
        throw Error("Loom AppRun must belong to its pinned app directory.");
    }
    if (c.runtimeDirectory !== undefined) {
      if (name !== "server") throw Error("Only the custom T3 server supports a runtime mirror.");
      relative(c.runtimeDirectory);
      if (c.commands.serverExecutable !== "t3")
        throw Error("A mirrored T3 distribution must expose its standard t3 entry at the root.");
    }
    if (withFiles) {
      if (
        !c.files ||
        typeof c.files !== "object" ||
        Array.isArray(c.files) ||
        !Object.keys(c.files).length
      )
        throw Error("Pin every payload member.");
      for (const [path, f] of Object.entries(c.files)) {
        relative(path);
        object(f, ["sha256", "executable", "link"], "payload member");
        if (f.link !== undefined) {
          if (
            Object.keys(f).length !== 1 ||
            typeof f.link !== "string" ||
            NodePath.isAbsolute(f.link) ||
            hasControl(f.link) ||
            f.link.includes("\\")
          )
            throw Error("Invalid internal payload link.");
          const target = NodePath.posix.normalize(
            NodePath.posix.join(NodePath.posix.dirname(path), f.link),
          );
          relative(target);
        } else if (
          !isHash(f.sha256) ||
          typeof f.executable !== "boolean" ||
          Object.keys(f).length !== 2
        )
          throw Error("Invalid pinned payload digest or executable mode.");
      }
      for (const value of Object.values(c.commands))
        if (!c.files[value]) throw Error("A declared command is absent from its payload.");
      if (c.runtimeDirectory) {
        const prefix = c.runtimeDirectory + "/v" + c.version + "/";
        const filename = "t3-" + c.version + "-linux-" + v.target.arch + ".tar.gz";
        if (!c.files[prefix + filename]?.sha256 || !c.files[prefix + "SHA256SUMS"]?.sha256)
          throw Error("Pin the T3 runtime archive and its checksum file.");
      }
      if (c.appImage && !c.files[c.appImage]?.sha256)
        throw Error("The original AppImage must be pinned.");
    }
  }
  object(v.apps, ["office", "atlas"], "apps");
  validateOrigin(v.apps.office, "Office");
  if (v.apps.atlas) validateOrigin(v.apps.atlas, "Atlas");
  if (v.components.atlas && !v.apps.atlas) throw Error("Atlas CLI requires its shared app origin.");
  if (v.switchboard !== undefined) {
    object(v.switchboard, ["gateway", "status", "dashboard"], "Switchboard");
    validateOrigin(v.switchboard.gateway, "Switchboard");
    for (const k of ["status", "dashboard"])
      if (v.switchboard[k]) validateOrigin(v.switchboard[k], k, { allowPath: true });
    if (!v.components.switchboard)
      throw Error("Every AI route requires the pinned Switchboard client.");
  } else if (v.components.switchboard) throw Error("Declare the commissioned Switchboard origin.");
  if (v.server !== undefined) {
    object(v.server, ["releaseBaseUrl", "port"], "server");
    validateOrigin(v.server.releaseBaseUrl, "Fork release origin", { allowPath: true });
    if (
      !v.components.server ||
      !Number.isInteger(v.server.port) ||
      v.server.port < 1 ||
      v.server.port > 65535
    )
      throw Error("Declare a pinned custom server and valid local port.");
  } else if (v.components.server) throw Error("Declare the custom server release origin.");
  object(
    v.preferences,
    ["appearance", "shortcuts", "textSize", "statusWidget", "branding"],
    "preferences",
  );
  if (
    !["preserve", "dark", "light"].includes(v.preferences.appearance) ||
    !["preserve", "standard", "compact", "none"].includes(v.preferences.shortcuts) ||
    !["preserve", "system", "larger"].includes(v.preferences.textSize) ||
    typeof v.preferences.statusWidget !== "boolean" ||
    typeof v.preferences.branding !== "boolean"
  )
    throw Error("Declare supported appearance, keyboard and readability preferences.");
  return v;
}
export function validateRecipe(v) {
  return baseRecipe(v);
}
async function prepareRuntimeArchive(root, component, arch) {
  if (!component.runtimeDirectory) return;
  const stem = "t3-" + component.version + "-linux-" + arch;
  const directory = NodePath.join(root, component.runtimeDirectory, "v" + component.version);
  const archive = NodePath.join(directory, stem + ".tar.gz");
  await safePath(archive);
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await NodeFSP.access(archive);
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // Normalized tar/gzip metadata and stored deflate blocks make the mirror portable
  // without depending on host ownership, timestamps or zlib compression revisions.
  const script = [
    "import sys,tarfile,gzip,os",
    "source,output,stem,excluded=sys.argv[1:]",
    "def normalize(info):",
    " if info.name==stem+'/'+excluded or info.name.startswith(stem+'/'+excluded+'/'):return None",
    " info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0",
    " info.mode=0o755 if info.isdir() or info.mode&0o111 else 0o644",
    " return info",
    "with open(output,'wb') as dest:",
    " with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0,compresslevel=0) as gz:",
    "  with tarfile.open(fileobj=gz,mode='w|',format=tarfile.USTAR_FORMAT) as tar:",
    "   tar.add(source,arcname=stem,filter=normalize)",
  ].join("\n");
  NodeChildProcess.execFileSync(
    "python3",
    ["-c", script, root, archive, stem, component.runtimeDirectory],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  await NodeFSP.writeFile(
    NodePath.join(directory, "SHA256SUMS"),
    (await fileHash(archive)) + "  " + stem + ".tar.gz\n",
    { mode: 0o600 },
  );
}
export async function buildKit(spec, inputs, output) {
  const recipe = structuredClone(baseRecipe(spec, false));
  const pack = await verifyRelease(NodePath.join(inputs, "integration"), recipe.pack.sha256);
  if (pack.version !== recipe.pack.version || !pack.files["pack/commission.mjs"])
    throw Error("Choose a matching pack with reproducible setup support.");
  if (NodePath.resolve(output).startsWith(NodePath.resolve(inputs) + NodePath.sep))
    throw Error("Build the kit outside its input directory.");
  await safePath(output);
  await NodeFSP.mkdir(output, { mode: 0o700 }); // Never overwrite a recovery kit.
  try {
    await NodeFSP.cp(NodePath.join(inputs, "integration"), NodePath.join(output, "integration"), {
      recursive: true,
    });
    for (const [name, c] of Object.entries(recipe.components)) {
      const input = NodePath.join(inputs, "components", name);
      await inventory(input); // Refuse personal state before copying a distribution.
      const destination = NodePath.join(output, "components", name);
      await NodeFSP.cp(input, destination, { recursive: true, verbatimSymlinks: true });
      await prepareRuntimeArchive(destination, c, recipe.target.arch);
      c.files = await inventory(destination);
    }
    validateRecipe(recipe);
    const bytes = Buffer.from(JSON.stringify(recipe, null, 2) + "\n");
    await NodeFSP.writeFile(NodePath.join(output, "recipe.json"), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    await NodeFSP.writeFile(NodePath.join(output, "setup.sh"), bootstrap, {
      mode: 0o755,
      flag: "wx",
    });
    const sha256 = hash(bytes);
    await verifyKit(output, sha256);
    return {
      name: recipe.name,
      directory: NodePath.resolve(output),
      sha256,
      profile: recipe.profile,
      components: Object.keys(recipe.components),
    };
  } catch (e) {
    await NodeFSP.rm(output, { recursive: true, force: true });
    throw e;
  }
}
export async function verifyKit(directory, expected) {
  await safePath(directory);
  const bytes = await NodeFSP.readFile(NodePath.join(directory, "recipe.json"));
  const sha256 = hash(bytes);
  if (expected !== undefined && (!isHash(expected) || sha256 !== expected))
    throw Error("Recipe differs from the reviewed SHA256.");
  const recipe = validateRecipe(JSON.parse(bytes));
  const manifest = await verifyRelease(NodePath.join(directory, "integration"), recipe.pack.sha256);
  if (manifest.version !== recipe.pack.version || !manifest.files["pack/commission.mjs"])
    throw Error("The recipe and integration release are incompatible.");
  if ((await NodeFSP.readFile(NodePath.join(directory, "setup.sh"), "utf8")) !== bootstrap)
    throw Error("Setup entry point changed.");
  const actual = await inventory(directory);
  const required = [
    "recipe.json",
    "setup.sh",
    "integration/release.json",
    ...Object.keys(manifest.files).map((k) => "integration/" + k),
  ];
  for (const [name, c] of Object.entries(recipe.components)) {
    const prefix = "components/" + name + "/";
    const observed = Object.fromEntries(
      Object.entries(actual)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, value]) => [path.slice(prefix.length), value]),
    );
    if (!same(observed, c.files)) throw Error("Component payload changed: " + name);
    required.push(...Object.keys(c.files).map((k) => "components/" + name + "/" + k));
    for (const value of Object.values(c.commands))
      await NodeFSP.access(
        NodePath.join(directory, "components", name, value),
        NodeFSP.constants.X_OK,
      );
  }
  if (!same(Object.keys(actual).sort(), required.sort()))
    throw Error("Recovery kit contains unreviewed extra files.");
  return { recipe, sha256 };
}
function profileComponents(recipe, profile) {
  return Object.entries(recipe.components).filter(
    ([name]) => name !== "server" || profile === "workstation",
  );
}
function componentRoot(p, name, c) {
  return NodePath.join(p.root, "components", name + "-" + hash(JSON.stringify(c)).slice(0, 16));
}
function desiredConfig(recipe, profile, env, browser) {
  const p = paths(env);
  const config = { version: 1, profile, officeUrl: recipe.apps.office, browserExecutable: browser };
  if (recipe.apps.atlas) config.atlasUrl = recipe.apps.atlas;
  for (const [name, c] of profileComponents(recipe, profile))
    for (const [key, path] of Object.entries(c.commands))
      config[key] =
        name === "loom" && c.appImage
          ? NodePath.join(
              p.root,
              "commission/launchers/loom-" + hash(JSON.stringify(c)).slice(0, 16),
            )
          : NodePath.join(componentRoot(p, name, c), path);
  if (recipe.switchboard)
    Object.assign(config, {
      switchboardUrl: recipe.switchboard.gateway,
      ...(recipe.switchboard.status ? { switchboardStatusUrl: recipe.switchboard.status } : {}),
      ...(recipe.switchboard.dashboard
        ? { switchboardDashboardUrl: recipe.switchboard.dashboard }
        : {}),
    });
  if (recipe.server && profile === "workstation")
    Object.assign(config, {
      serverBaseDir: NodePath.join(p.root, "t3"),
      serverHost: "127.0.0.1",
      serverPort: recipe.server.port,
      serverReleaseBaseUrl: recipe.server.releaseBaseUrl,
    });
  return validateConfig(config);
}
async function resolve(command, env) {
  for (const directory of (env.PATH ?? "").split(NodePath.delimiter)) {
    if (!directory || !NodePath.isAbsolute(directory)) continue;
    const file = NodePath.join(directory, command);
    try {
      await NodeFSP.access(file, NodeFSP.constants.X_OK);
      return file;
    } catch {
      /* Try next directory. */
    }
  }
  throw Error(
    "Install the system prerequisite " +
      command +
      " using Omarchy's normal package setup, then retry.",
  );
}
async function preflight(recipe, env, dependencies) {
  const platform = dependencies.platform ?? NodeProcess.platform,
    arch = dependencies.arch ?? NodeProcess.arch;
  if (
    platform !== "linux" ||
    arch !== recipe.target.arch ||
    Number(NodeProcess.versions.node.split(".")[0]) < 24
  )
    throw Error("This recipe needs Linux " + recipe.target.arch + " and Node 24 or newer.");
  const p = paths(env),
    omarchy = env.OMARCHY_PATH || "/usr/share/omarchy";
  const version = (await NodeFSP.readFile(NodePath.join(omarchy, "version"), "utf8")).trim();
  if (!recipe.target.omarchy.includes(version))
    throw Error("Omarchy " + version + " is outside this recipe's checked versions.");
  await NodeFSP.access(NodePath.join(p.config, "hypr/bindings.lua")); // Native shell is part of the recipe contract.
  const model = compileNativeMenu(
    await NodeFSP.readFile(NodePath.join(omarchy, "shell/plugins/menu/MenuModel.js"), "utf8"),
  );
  if (
    !model.parseMenuJsonc(
      await NodeFSP.readFile(NodePath.join(omarchy, "default/omarchy/omarchy-menu.jsonc"), "utf8"),
    ).length
  )
    throw Error("The native Omarchy menu is incompatible.");
  const browser = await (dependencies.resolve ?? resolve)("chromium", env);
  for (const name of [
    "node",
    ...(recipe.components.server ? ["tar"] : []),
    ...(recipe.switchboard ? ["tailscale", "secret-tool", "python3", "bash"] : []),
    ...(recipe.preferences.appearance !== "preserve"
      ? ["python3", "rsvg-convert", "magick", "omarchy-theme-set", "omarchy-shell"]
      : []),
  ])
    await (dependencies.resolve ?? resolve)(name, env);
  return { version, browser };
}
export async function planCommission(
  directory,
  { env = NodeProcess.env, expected, profile, ...dependencies } = {},
) {
  const kit = await verifyKit(directory, expected),
    selected = profile ?? kit.recipe.profile;
  if (!["laptop", "workstation"].includes(selected)) throw Error("Choose laptop or workstation.");
  const p = paths(env),
    stateFile = NodePath.join(p.state, "loom-os/commission.json");
  const previous = await readJSON(stateFile);
  if (
    previous &&
    previous.phase !== "complete" &&
    (previous.sha256 !== kit.sha256 || previous.profile !== selected)
  )
    throw Error(
      "Resume the interrupted setup with its exact recipe and profile before changing either.",
    );
  const native = await preflight(kit.recipe, env, dependencies);
  const config = desiredConfig(kit.recipe, selected, env, native.browser);
  const current = await readJSON(p.configFile);
  if (
    selected === "workstation" &&
    current?.serverBaseDir &&
    current.serverBaseDir !== config.serverBaseDir
  )
    throw Error(
      "Preserving an existing server data directory. Migrate it explicitly before commissioning.",
    );
  if (current?.profile === "workstation" && selected === "laptop") {
    try {
      await NodeFSP.access(NodePath.join(p.home, ".config/systemd/user/t3code.service"));
      throw Error("Uninstall background hosting explicitly before selecting the laptop profile.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  for (const [name, c] of profileComponents(kit.recipe, selected)) {
    const target = componentRoot(p, name, c);
    await safePath(target);
    try {
      if (!same(await inventory(target), c.files))
        throw Error("Preserving edited installed component: " + name);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (current) {
    const existing = await releaseStatus({ env });
    if (existing.pending && existing.pending.sha256 !== kit.recipe.pack.sha256)
      throw Error("Finish the existing interrupted pack activation first.");
    const compatibility = await collectCompatibility(validateConfig(current), env);
    if (
      compatibility.checks.some(
        (v) => v.state === "error" && !["activation", "shortcut-update"].includes(v.id),
      )
    )
      throw Error(
        "Repair the existing native compatibility/ownership errors before commissioning.",
      );
  }
  const installer = await import(
    NodeURL.pathToFileURL(NodePath.resolve(directory, "integration/pack/loom-os.mjs")).href
  );
  const changes = await installer.install(config, {
    env,
    dryRun: true,
    packDir: NodePath.resolve(directory, "integration/pack"),
  });
  return {
    name: kit.recipe.name,
    sha256: kit.sha256,
    profile: selected,
    omarchy: native.version,
    pack: kit.recipe.pack,
    components: Object.fromEntries(
      profileComponents(kit.recipe, selected).map(([k, c]) => [k, c.version]),
    ),
    config,
    changes,
    existingInstall: Boolean(current),
    preferences: kit.recipe.preferences,
    service:
      selected === "laptop"
        ? "No background hosting"
        : "Explicit install only; running agents are preserved",
    connections:
      "Existing app/CLI and Switchboard authorizations are reused; missing access is completed locally",
    recovery:
      "Keep this kit and its reviewed SHA256 outside this machine. Restore personal data through each owning app.",
  };
}
async function stageComponents(recipe, directory, env, profile) {
  const p = paths(env);
  for (const [name, c] of profileComponents(recipe, profile)) {
    const target = componentRoot(p, name, c);
    try {
      await inventory(target);
      continue;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await safePath(target);
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = target + ".stage-" + NodeCrypto.randomUUID();
    try {
      await NodeFSP.cp(NodePath.join(directory, "components", name), temporary, {
        recursive: true,
        verbatimSymlinks: true,
      });
      if (!same(await inventory(temporary), c.files))
        throw Error("Component changed while staging: " + name);
      await NodeFSP.rename(temporary, target);
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  }
  const c = recipe.components.loom;
  if (c.appImage) {
    const root = componentRoot(p, "loom", c),
      file = NodePath.join(
        p.root,
        "commission/launchers/loom-" + hash(JSON.stringify(c)).slice(0, 16),
      );
    const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    const content =
      "#!/usr/bin/bash\nset -euo pipefail\nexport T3CODE_HOME=" +
      quote(NodePath.join(p.root, "desktop")) +
      "\nunset T3CODE_HOST T3CODE_PORT\nexport APPDIR=" +
      quote(NodePath.join(root, c.appDir)) +
      "\nexport APPIMAGE=" +
      quote(NodePath.join(root, c.appImage)) +
      '\nexec "$APPDIR/AppRun" "$@"\n';
    await safePath(file);
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
    const prior = await NodeFSP.readFile(file, "utf8").catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (prior !== null && prior !== content)
      throw Error("Preserving an edited Loom commissioning launcher.");
    if (prior === null) await NodeFSP.writeFile(file, content, { mode: 0o755, flag: "wx" });
  }
}
async function probeServerVersion(component, root, env, stateRoot) {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(stateRoot, "server-validation-"));
  const isolated = { ...env, T3CODE_HOME: NodePath.join(temporary, "state") };
  for (const key of ["NODE_PATH", "NODE_OPTIONS", "T3CODE_HOST", "T3CODE_PORT"])
    delete isolated[key];
  try {
    const output = NodeChildProcess.execFileSync(
      NodePath.join(root, component.commands.serverExecutable),
      ["--version"],
      { env: isolated, encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
    );
    if (output.trim().split(/\s+/).at(-1)?.replace(/^v/, "") !== component.version)
      throw Error("Version mismatch");
    return true;
  } catch {
    throw Error(
      "The selected T3 release cannot launch or reports a different version. Restore its complete checked distribution, including SDKs and client assets, then review a new kit. Existing services are retained.",
    );
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
}
export async function applyCommission(
  directory,
  { env = NodeProcess.env, expected, profile, ...dependencies } = {},
) {
  if (!isHash(expected)) throw Error("Apply requires the reviewed recipe SHA256.");
  const plan = await planCommission(directory, { env, expected, profile, ...dependencies });
  const { recipe } = await verifyKit(directory, expected),
    p = paths(env);
  const file = NodePath.join(p.state, "loom-os/commission.json");
  const saved = await readJSON(file);
  const state = {
    format: "loom-os-commission",
    version: 1,
    name: recipe.name,
    sha256: expected,
    profile: plan.profile,
    kit: NodePath.resolve(directory),
    phase: "components",
    existingInstall:
      saved?.sha256 === expected
        ? (saved.existingInstall ?? plan.existingInstall)
        : plan.existingInstall,
    completed: saved?.sha256 === expected ? (saved.completed ?? []) : [],
    preferences: recipe.preferences,
  };
  async function step(name, fn) {
    state.phase = name;
    await atomicJSON(file, state);
    await fn();
    if (!state.completed.includes(name)) state.completed.push(name);
    await atomicJSON(file, state);
    await dependencies.afterStep?.(name);
  }
  try {
    await step("components", async () => {
      await stageComponents(recipe, directory, env, plan.profile);
      if (plan.profile === "workstation" && recipe.components.server) {
        const checks = NodePath.join(p.state, "loom-os");
        await NodeFSP.mkdir(checks, { recursive: true, mode: 0o700 });
        await probeServerVersion(
          recipe.components.server,
          componentRoot(p, "server", recipe.components.server),
          env,
          checks,
        );
      }
      const snapshot = NodePath.join(p.root, "commission/recipes", expected + ".json");
      const bytes = await NodeFSP.readFile(NodePath.join(directory, "recipe.json"));
      await safePath(snapshot);
      await NodeFSP.mkdir(NodePath.dirname(snapshot), { recursive: true, mode: 0o700 });
      const prior = await NodeFSP.readFile(snapshot).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (prior && hash(prior) !== expected) throw Error("Installed recipe snapshot changed.");
      if (!prior) await NodeFSP.writeFile(snapshot, bytes, { mode: 0o600, flag: "wx" });
    });
    await step("integration", async () => {
      const pack = NodePath.resolve(directory, "integration");
      const installer = await import(
        NodeURL.pathToFileURL(NodePath.join(pack, "pack/loom-os.mjs")).href
      );
      if (await readJSON(p.configFile)) await activateRelease(pack, recipe.pack.sha256, { env });
      await installer.install(plan.config, { env, packDir: NodePath.join(pack, "pack") });
      await activateRelease(pack, recipe.pack.sha256, { env });
    });
    await step("preferences", async () => {
      const pending = await readJSON(NodePath.join(p.state, "loom-os/shortcut-pending.json"));
      if (pending) await recoverShortcuts(env);
      const shortcuts = NodePath.join(p.config, "loom-os/shortcuts.json");
      // Existing Lua bindings can be represented only by opaque live callback IDs.
      // Absence of a preferences file does not make those active keys unconfigured.
      if (
        !state.existingInstall &&
        recipe.preferences.shortcuts !== "preserve" &&
        !(await readJSON(shortcuts))
      ) {
        const prefs = { version: 1, preset: recipe.preferences.shortcuts, bindings: {} };
        shortcutBindings(plan.config, prefs);
        await applyShortcuts(plan.config, env, prefs, dependencies.shortcutDependencies ?? {});
      }
      const text = NodePath.join(p.config, "loom-os/readability.json");
      if (recipe.preferences.textSize !== "preserve" && !(await readJSON(text)))
        await atomicJSON(text, { version: 1, size: recipe.preferences.textSize });
    });
    await step("verification", async () => {
      const active = await releaseStatus({ env });
      if (
        !active.active?.verified ||
        !active.active.matchesInstalled ||
        active.active.sha256 !== recipe.pack.sha256
      )
        throw Error("Installed pack verification failed; retry this same kit.");
      const compatibility = await collectCompatibility(plan.config, env);
      if (compatibility.errors) throw Error("Installed native compatibility verification failed.");
    });
    state.phase = "complete";
    delete state.error;
    await atomicJSON(file, state);
  } catch (e) {
    state.error =
      "Setup stopped during " +
      state.phase +
      ". Review the command error and retry the same kit and profile.";
    await atomicJSON(file, state);
    throw e;
  }
  return commissioningStatus({ env, ...dependencies });
}
async function equalFiles(a, b) {
  try {
    return hash(await NodeFSP.readFile(a)) === hash(await NodeFSP.readFile(b));
  } catch {
    return false;
  }
}
export async function commissioningStatus({ env = NodeProcess.env, ...dependencies } = {}) {
  const p = paths(env),
    state = await readJSON(NodePath.join(p.state, "loom-os/commission.json"));
  if (!state)
    return {
      commissioned: false,
      ready: false,
      steps: [],
      detail: "Apply a reviewed recovery kit to commission this machine.",
    };
  if (
    state.format !== "loom-os-commission" ||
    state.version !== 1 ||
    !isHash(state.sha256) ||
    !id(state.name) ||
    !["laptop", "workstation"].includes(state.profile) ||
    !["components", "integration", "preferences", "verification", "complete"].includes(state.phase)
  )
    throw Error("Invalid commissioning journal; preserve it and review the recovery kit.");
  const steps = [];
  const add = (id, state, detail) => steps.push({ id, state, detail });
  if (state.phase !== "complete")
    return {
      commissioned: false,
      ready: false,
      name: state.name,
      profile: state.profile,
      sha256: state.sha256,
      kit: state.kit,
      phase: state.phase,
      steps: [
        {
          id: "resume",
          state: "attention",
          detail: state.error ?? "Resume the same reviewed kit and profile.",
        },
      ],
      recovery:
        "Completed steps are retained. Resume verifies the kit and actual installed state again.",
    };
  const config = validateConfig(await readJSON(p.configFile));
  const release = await releaseStatus({ env });
  add(
    "integration",
    state.phase === "complete" && release.active?.verified && release.active.matchesInstalled
      ? "ready"
      : "attention",
    state.phase === "complete"
      ? "Installed pack integrity checked."
      : (state.error ?? "Resume the same recovery kit."),
  );
  const native = await collectCompatibility(config, env);
  add(
    "compatibility",
    native.errors ? "attention" : "ready",
    "Native menu, ownership and theme picker: " + native.errors + " errors.",
  );
  const snapshot = NodePath.join(p.root, "commission/recipes", state.sha256 + ".json");
  const snapshotBytes = await NodeFSP.readFile(snapshot);
  if (hash(snapshotBytes) !== state.sha256)
    throw Error("The installed recipe snapshot differs from its reviewed digest.");
  const recipe = validateRecipe(JSON.parse(snapshotBytes));
  if (release.active?.sha256 !== recipe.pack.sha256) {
    steps[0].state = "attention";
    steps[0].detail =
      "The active pack differs from the commissioned recipe. Review the newer release before revising the recovery kit.";
  }
  const expectedConfig = desiredConfig(recipe, state.profile, env, config.browserExecutable);
  add(
    "configuration",
    same(config, expectedConfig) ? "ready" : "attention",
    "Installed profile, app origins and Switchboard routes are checked against the recipe; personal changes are preserved.",
  );
  for (const [name, c] of profileComponents(recipe, state.profile)) {
    let valid = false;
    try {
      valid = same(await inventory(componentRoot(p, name, c)), c.files);
    } catch {
      /* Keep damaged releases unavailable. */
    }
    if (valid && name === "server") {
      try {
        valid = await probeServerVersion(
          c,
          componentRoot(p, name, c),
          env,
          NodePath.join(p.state, "loom-os"),
        );
      } catch {
        valid = false;
      }
    }
    add(
      "component-" + name,
      valid ? "ready" : "attention",
      c.version +
        (valid
          ? " payload verified."
          : " changed or missing. Reapply the original kit; edited bytes are preserved."),
    );
  }
  const theme = (
    await NodeFSP.readFile(
      NodePath.join(p.home, ".local/state/omarchy/current/theme.name"),
      "utf8",
    ).catch(() => "")
  ).trim();
  const requestedTheme =
    state.preferences.appearance === "preserve"
      ? null
      : "loom-iris-" + state.preferences.appearance;
  const skinInstalled = await NodeFSP.access(
    NodePath.join(p.home, ".local/lib/loom-os/iris/install.py"),
  ).then(
    () => true,
    () => false,
  );
  add(
    "appearance",
    !requestedTheme || skinInstalled ? "ready" : "attention",
    requestedTheme && !skinInstalled
      ? "Apply the pinned Iris skin in an unlocked local session."
      : "Current appearance and personal shell settings are preserved: " + (theme || "unknown"),
  );
  if (state.preferences.branding) {
    const nativeAdapters = await Promise.all(
      ["fastfetch", "ttfx"].map((name) =>
        equalFiles(
          NodePath.join(p.home, ".local/lib/loom-os/iris/native-bin", name),
          "/usr/local/bin/" + name,
        ),
      ),
    );
    const logo = NodePath.join(p.home, ".config/omarchy/themes", theme, "unlock.png");
    const logos = await Promise.all(
      [
        "/usr/share/plymouth/themes/omarchy/logo.png",
        "/usr/share/sddm/themes/omarchy/logo.png",
      ].map((path) => equalFiles(logo, path)),
    );
    add(
      "branding",
      [...nativeAdapters, ...logos].every(Boolean) ? "ready" : "local-auth",
      "Boot/login gradient assets and terminal adapters use the skin's existing protected publisher.",
    );
  }
  const connections = await (dependencies.connections ?? guidedConnectionReport)(config, env);
  for (const connection of connections.steps.filter((v) =>
    v.id === "office"
      ? Boolean(config.officeCli)
      : v.id === "atlas"
        ? Boolean(config.atlasCli)
        : Boolean(config.switchboardUrl),
  ))
    add(connection.id, connection.state === "connected" ? "ready" : "attention", connection.detail);
  if (state.profile === "workstation" && config.serverExecutable) {
    const unit = await NodeFSP.readFile(
      NodePath.join(p.home, ".config/systemd/user/t3code.service"),
      "utf8",
    ).catch(() => "");
    const ownsHome =
      unit.includes("T3CODE_HOME=" + config.serverBaseDir) ||
      unit.includes('T3CODE_HOME="' + config.serverBaseDir + '"');
    const result = await (dependencies.command ?? connectionCommand)(
      "systemctl",
      ["--user", "show", "t3code.service", "-p", "ActiveState", "--value"],
      env,
    );
    add(
      "hosting",
      ownsHome && result.exit === 0 && result.stdout.trim() === "active" ? "ready" : "attention",
      "Workstation hosting is explicit. Existing jobs are never restarted; install only when no other environment owns its unit.",
    );
  } else add("hosting", "ready", "Laptop setup starts no background service.");
  if (state.preferences.statusWidget) {
    const shell = await readJSON(NodePath.join(p.home, ".config/omarchy/shell.json"));
    const layouts = shell?.bar?.layout;
    const enabled =
      layouts &&
      Object.values(layouts).some(
        (widgets) =>
          Array.isArray(widgets) && widgets.some((widget) => widget?.id === "loom.status"),
      );
    add(
      "status-widget",
      enabled ? "ready" : "attention",
      enabled
        ? "The Loom status widget is enabled in its existing position."
        : "Enable the existing status widget in an unlocked local session.",
    );
  }
  return {
    commissioned: state.phase === "complete",
    ready: steps.every((v) => v.state === "ready"),
    name: state.name,
    profile: state.profile,
    sha256: state.sha256,
    kit: state.kit,
    phase: state.phase,
    steps,
    release,
    recovery:
      "Keep the portable kit and reviewed SHA256 elsewhere. Credentials, app data, T3 data and system recovery remain with their owners.",
  };
}
export function formatCommissionStatus(report) {
  return [
    "LoomOS setup",
    report.detail ?? report.name + " · " + report.profile,
    ...report.steps.map((v) => "[" + v.state.toUpperCase() + "] " + v.id + ": " + v.detail),
    report.recovery ?? "",
  ].join("\n");
}
/** Only initial installation sees this loopback mirror; persisted update origin stays on the custom fork. */
export async function withServerRuntimeMirror(recipe, env, callback) {
  const component = recipe.components.server;
  if (!component?.runtimeDirectory) return callback(undefined);
  const root = componentRoot(paths(env), "server", component);
  if (!same(await inventory(root), component.files))
    throw Error("The pinned server distribution changed.");
  const filename = "t3-" + component.version + "-linux-" + recipe.target.arch + ".tar.gz";
  const prefix = component.runtimeDirectory + "/v" + component.version + "/";
  const archive = NodePath.join(root, prefix, filename),
    sums = NodePath.join(root, prefix, "SHA256SUMS");
  const expected = component.files[prefix + filename].sha256;
  if (
    !(await NodeFSP.readFile(sums, "utf8"))
      .split(/\r?\n/)
      .some((line) => line.trim() === expected + "  " + filename)
  )
    throw Error("The pinned runtime checksum file does not describe its archive.");
  const routes = new Map([
    ["/releases/v" + component.version + "/" + filename, archive],
    ["/releases/v" + component.version + "/SHA256SUMS", sums],
  ]);
  const server = NodeHttp.createServer((request, response) => {
    const file = request.method === "GET" ? routes.get(request.url) : undefined;
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    });
    const stream = NodeFS.createReadStream(file);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await callback("http://127.0.0.1:" + server.address().port + "/releases");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
export async function nativeCommission(env, dependencies = {}) {
  const choose =
    dependencies.choose ??
    (async (values) => {
      const p = NodeChildProcess.spawnSync(
        "gum",
        ["choose", "--header", "LoomOS setup", ...values],
        { env, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
      );
      return p.status === 0 ? p.stdout.trim() : null;
    });
  for (;;) {
    const report = await commissioningStatus({ env, ...dependencies });
    console.log(formatCommissionStatus(report));
    if (!report.commissioned) {
      if (!report.kit) return;
      const action = await choose(["Resume reviewed setup", "Done"]);
      if (action !== "Resume reviewed setup") return;
      await (dependencies.apply ?? applyCommission)(report.kit, {
        env,
        expected: report.sha256,
        profile: report.profile,
        ...dependencies,
      });
      continue;
    }
    const values = [
      "Check again",
      "Continue app and AI connections",
      "Apply Iris appearance",
      "Enable status widget",
      ...(report.profile === "workstation" ? ["Install workstation hosting"] : []),
      "Publish boot/login branding",
      "Done",
    ];
    const selection = await choose(values);
    if (!selection || selection === "Done") return;
    if (!values.includes(selection)) throw Error("Unknown setup action.");
    const p = paths(env);
    if (selection === "Check again") continue;
    if (selection === "Continue app and AI connections")
      await (dependencies.loomMain ?? loomMain)(["setup", "--inline"], env);
    else {
      const lock = await (dependencies.command ?? connectionCommand)(
        "omarchy-shell",
        ["lock", "status"],
        env,
      );
      let unlocked = false;
      try {
        const s = JSON.parse(lock.stdout);
        unlocked =
          lock.exit === 0 && s.locked === false && s.secure === false && !s.pending && !s.requested;
      } catch {
        /* Refuse unknown lock state. */
      }
      if (!unlocked) {
        console.log("Unlock this desktop normally before continuing.");
        continue;
      }
      if (selection === "Enable status widget")
        await (dependencies.loomMain ?? loomMain)(["connections", "--enable-status"], env);
      else if (selection === "Install workstation hosting") {
        try {
          await NodeFSP.access(NodePath.join(p.home, ".config/systemd/user/t3code.service"));
          console.log(
            "Existing service retained. Review service status and active work before changing hosting.",
          );
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          const state = await readJSON(NodePath.join(p.state, "loom-os/commission.json"));
          const kit = await verifyKit(state.kit, state.sha256);
          await withServerRuntimeMirror(kit.recipe, env, (mirror) =>
            (dependencies.loomMain ?? loomMain)(
              ["service", "install", ...(mirror ? ["--release-base-url", mirror] : [])],
              env,
            ),
          );
        }
      } else {
        const state = await readJSON(NodePath.join(p.state, "loom-os/commission.json"));
        const kit = await verifyKit(state.kit, state.sha256);
        const args =
          selection === "Apply Iris appearance"
            ? [
                "python3",
                [
                  NodePath.join(state.kit, "integration/iris/install.py"),
                  "--mode",
                  kit.recipe.preferences.appearance === "light" ? "light" : "dark",
                ],
              ]
            : ["/usr/bin/bash", [NodePath.join(p.home, "loom-branding.sh")]];
        // Local authenticated publication inherits the terminal; no password or token enters the journal.
        const child = NodeChildProcess.spawnSync(args[0], args[1], { env, stdio: "inherit" });
        if (child.status !== 0)
          console.log(
            "The local step did not finish. Existing progress is retained; retry when ready.",
          );
      }
    }
  }
}
/** Retire only a failed setup journal when deliberately reviewing an amended recipe. */
export async function abandonCommission(expected, env = NodeProcess.env) {
  const p = paths(env),
    file = NodePath.join(p.state, "loom-os/commission.json");
  const state = await readJSON(file);
  if (!isHash(expected) || state?.sha256 !== expected || state.phase === "complete")
    throw Error("Abandon requires the interrupted journal's exact reviewed SHA256.");
  const archive = NodePath.join(
    p.state,
    "loom-os/commission-abandoned",
    expected + "-" + NodeCrypto.randomUUID() + ".json",
  );
  await atomicJSON(archive, { ...state, abandoned: true });
  await NodeFSP.rm(file);
  return {
    abandoned: true,
    archive,
    detail:
      "Only the unfinished setup journal was retired. Installed releases, settings, app data and services are retained. Review a new recipe before applying it.",
  };
}
export async function main(args = NodeProcess.argv.slice(2), env = NodeProcess.env) {
  const [action, ...rest] = args;
  if (!action || ["help", "--help"].includes(action)) return console.log(usage);
  if (action === "build" && rest.length === 3)
    return buildKit(JSON.parse(await NodeFSP.readFile(rest[0], "utf8")), rest[1], rest[2]);
  if (action === "status" && (!rest.length || (rest.length === 1 && rest[0] === "--human"))) {
    const report = await commissioningStatus({ env });
    return rest.length ? formatCommissionStatus(report) : report;
  }
  if (action === "continue" && !rest.length) return nativeCommission(env);
  if (action === "abandon" && rest.length === 2 && rest[0] === "--review-sha256")
    return abandonCommission(rest[1], env);
  if (["plan", "apply"].includes(action)) {
    const directory = rest.shift(),
      options = {};
    while (rest.length) {
      const flag = rest.shift(),
        value = rest.shift();
      if (!["--review-sha256", "--profile"].includes(flag) || !value || options[flag])
        throw Error(usage);
      options[flag] = value;
    }
    if (!directory) throw Error(usage);
    const fn = action === "apply" ? applyCommission : planCommission;
    return fn(NodePath.resolve(directory), {
      env,
      expected: options["--review-sha256"],
      profile: options["--profile"],
    });
  }
  throw Error(usage);
}
if (
  NodeProcess.argv[1] &&
  NodePath.resolve(NodeProcess.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main()
    .then((value) => {
      if (value !== undefined)
        console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
