import * as NodeAssert from "node:assert/strict";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import {
  appCommand,
  appCliEnvironment,
  connectSearch,
  searchBrowserCommand,
  searchLoginMode,
  focusExistingApp,
  finderResults,
  nativeFinder,
  searchCommand,
  install,
  main,
  officeCaptureUrl,
  paths,
  uninstall,
  validateConfig,
  validateOrigin,
} from "./loom-os.mjs";

const test = NodeTest.test;

async function legacyServer(t, config) {
  const server = NodeHttp.createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  config.officeUrl = origin;
  config.atlasUrl = origin;
}

async function fixture(t, { bindings = "lua", menu = true } = {}) {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-os-test-"));
  const root = await NodeFSP.realpath(temporary);
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = {
    HOME: NodePath.join(root, "home"),
    XDG_CONFIG_HOME: NodePath.join(root, "config"),
    XDG_DATA_HOME: NodePath.join(root, "data"),
    XDG_STATE_HOME: NodePath.join(root, "state"),
    PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
    LOOM_OS_TEST_RECORD: NodePath.join(root, "invocation.json"),
  };
  const p = paths(env);
  const executable = NodePath.join(root, "fake app executable.mjs");
  await NodeFSP.writeFile(
    executable,
    `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.LOOM_OS_TEST_RECORD, JSON.stringify({ args: process.argv.slice(2), origin: process.env.API_URL ?? null, service: { home: process.env.T3CODE_HOME ?? null, host: process.env.T3CODE_HOST ?? null, port: process.env.T3CODE_PORT ?? null, releaseBaseUrl: process.env.T3CODE_RELEASE_BASE_URL ?? null } }));\n`,
    { mode: 0o755 },
  );
  const originalBindings =
    bindings === "lua"
      ? 'local o = require("omarchy")\no.bind("SUPER + E", "Files", "open-files")\n'
      : "# Personal bindings\nbind = SUPER, E, exec, open-files\n";
  const bindingsFile = NodePath.join(
    p.config,
    "hypr",
    bindings === "lua" ? "bindings.lua" : "bindings.conf",
  );
  if (bindings) {
    await NodeFSP.mkdir(NodePath.dirname(bindingsFile), { recursive: true });
    await NodeFSP.writeFile(bindingsFile, originalBindings);
  }
  const menuFile = NodePath.join(p.config, "omarchy/extensions/omarchy-menu.jsonc");
  const originalMenu = '{\n"personal": {"label": "Personal", "action": "my-tool"}\n}\n';
  if (menu) {
    await NodeFSP.mkdir(NodePath.dirname(menuFile), { recursive: true });
    await NodeFSP.writeFile(menuFile, originalMenu);
  }
  const config = {
    version: 1,
    profile: "laptop",
    officeUrl: "https://office.example.test",
    atlasUrl: "http://atlas.example.test:8397",
    switchboardDashboardUrl: "https://switchboard.example.test/dashboard",
    loomExecutable: executable,
    browserExecutable: executable,
    officeCli: executable,
    atlasCli: executable,
  };
  return { root, env, p, config, bindingsFile, originalBindings, menuFile, originalMenu };
}

async function tree(root) {
  const result = {};
  async function visit(directory) {
    for (const item of await NodeFSP.readdir(directory, { withFileTypes: true })) {
      const full = NodePath.join(directory, item.name);
      const relative = NodePath.relative(root, full);
      const stat = await NodeFSP.lstat(full);
      if (item.isDirectory()) {
        result[`${relative}/`] = stat.mode & 0o777;
        await visit(full);
      } else if (item.isSymbolicLink()) {
        result[relative] = { link: await NodeFSP.readlink(full) };
      } else {
        result[relative] = {
          mode: stat.mode & 0o777,
          content: (await NodeFSP.readFile(full)).toString("base64"),
        };
      }
    }
  }
  await visit(root);
  return result;
}

async function missing(file) {
  await NodeAssert.rejects(NodeFSP.stat(file), { code: "ENOENT" });
}

async function save(file, text) {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  await NodeFSP.writeFile(file, text);
}

test("install dry-run plans integration without creating or changing any files", async (t) => {
  const f = await fixture(t);
  const before = await tree(f.root);
  const result = await install(f.config, { env: f.env, dryRun: true });
  NodeAssert.equal(result.dryRun, true);
  NodeAssert.ok(result.files.includes(f.p.configFile));
  NodeAssert.ok(result.files.includes(f.bindingsFile));
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("install is repeatable and keeps personal bindings and menu actions", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const first = await tree(f.root);
  await install(f.config, { env: f.env });
  NodeAssert.deepEqual(await tree(f.root), first);
  NodeAssert.ok((await NodeFSP.readFile(f.bindingsFile, "utf8")).startsWith(f.originalBindings));
  NodeAssert.ok((await NodeFSP.readFile(f.menuFile, "utf8")).includes('"action": "my-tool"'));
  NodeAssert.equal((await NodeFSP.stat(f.p.configFile)).mode & 0o777, 0o600);
  await NodeFSP.access(f.p.bin, NodeFSP.constants.X_OK);
  const manifest = JSON.parse(await NodeFSP.readFile(f.p.manifest, "utf8"));
  NodeAssert.ok(manifest.files.some((entry) => entry.file === f.p.bin));
});

test("installation keeps stock Omarchy utility and Agent shortcuts available", async (t) => {
  const f = await fixture(t);
  const stock = [
    ["CTRL + SUPER + L", "Lock system", "omarchy-lock-screen"],
    ["SUPER + CTRL + O", "Toggle menu", "omarchy-menu"],
    ["SUPER + CTRL + A", "Audio", "omarchy-audio"],
    ["SUPER + CTRL + N", "Nightlight", "omarchy-nightlight"],
    ["SUPER + CTRL + SHIFT + A", "Agent", "omarchy-agent"],
  ];
  await NodeFSP.writeFile(
    f.bindingsFile,
    f.originalBindings +
      stock
        .map(([chord, label, command]) => `o.bind("${chord}", "${label}", "${command}")`)
        .join("\n") +
      "\n",
  );
  await install(f.config, { env: f.env });
  const normalize = (chord) =>
    chord
      .split("+")
      .map((part) => part.trim())
      .sort()
      .join("+");
  const active = new Map();
  const installed = await NodeFSP.readFile(f.bindingsFile, "utf8");
  for (const binding of installed.matchAll(/o\.bind\("([^"\n]+)",\s*"[^"\n]*",\s*"([^"\n]*)"\)/g)) {
    active.set(normalize(binding[1]), binding[2]);
  }
  for (const [chord, , command] of stock) {
    NodeAssert.equal(active.get(normalize(chord)), command, `${chord} keeps its stock action`);
  }
});

test("reconfiguration updates profile and origin while preserving personal additions", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const personal = 'o.bind("SUPER + T", "Terminal", "my-terminal")\n';
  await NodeFSP.appendFile(f.bindingsFile, personal);
  const updated = {
    ...f.config,
    profile: "workstation",
    officeUrl: "https://new-office.example.test/",
  };
  await install(updated, { env: f.env });
  await install(updated, { env: f.env });
  const stored = JSON.parse(await NodeFSP.readFile(f.p.configFile, "utf8"));
  NodeAssert.equal(stored.profile, "workstation");
  NodeAssert.equal(stored.officeUrl, "https://new-office.example.test");
  NodeAssert.ok((await NodeFSP.readFile(f.bindingsFile, "utf8")).endsWith(personal));
  await missing(f.env.LOOM_OS_TEST_RECORD);
});

test("reconfiguration removes optional launchers when their app endpoint is disabled", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const updated = { ...f.config };
  delete updated.atlasUrl;
  delete updated.switchboardDashboardUrl;
  await install(updated, { env: f.env });
  await missing(NodePath.join(f.p.data, "applications/loom-os-atlas.desktop"));
  await missing(NodePath.join(f.p.data, "applications/loom-os-switchboard.desktop"));
  await NodeFSP.access(NodePath.join(f.p.data, "applications/loom-os-office.desktop"));
});

test("reinstall refuses to overwrite a locally edited launcher before making writes", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const edited = NodePath.join(f.p.data, "applications/loom-os-office.desktop");
  await NodeFSP.appendFile(edited, "# My launch preference\n");
  const before = await tree(f.root);
  await NodeAssert.rejects(install(f.config, { env: f.env }), /local edits|Preserving/i);
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("uninstall dry-run preserves all installed files and personal state", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  await save(NodePath.join(f.p.profiles, "office/session.txt"), "synthetic session");
  const before = await tree(f.root);
  const result = await uninstall({ env: f.env, dryRun: true });
  NodeAssert.equal(result.dryRun, true);
  NodeAssert.ok(result.removed.includes(f.p.bin));
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("uninstall preserves edited launchers, browser storage, app data and personal bindings", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const edited = NodePath.join(f.p.data, "applications/loom-os-office.desktop");
  await NodeFSP.appendFile(edited, "# My launch preference\n");
  const personal = 'o.bind("SUPER + T", "Terminal", "my-terminal")\n';
  await NodeFSP.appendFile(f.bindingsFile, personal);
  const retained = [
    NodePath.join(f.p.profiles, "office/session.txt"),
    NodePath.join(f.p.config, "office-cli/credentials.json"),
    NodePath.join(f.p.home, ".t3/userdata/synthetic-data.txt"),
  ];
  for (const file of retained) await save(file, "synthetic retained state");
  const result = await uninstall({ env: f.env });
  NodeAssert.ok(result.preserved.includes(edited));
  NodeAssert.ok((await NodeFSP.readFile(edited, "utf8")).includes("# My launch preference"));
  await missing(f.p.bin);
  NodeAssert.equal(await NodeFSP.readFile(f.bindingsFile, "utf8"), f.originalBindings + personal);
  NodeAssert.equal(await NodeFSP.readFile(f.menuFile, "utf8"), f.originalMenu);
  for (const file of retained)
    NodeAssert.equal(await NodeFSP.readFile(file, "utf8"), "synthetic retained state");
  NodeAssert.ok((await NodeFSP.readdir(NodePath.join(f.p.state, "loom-os/backups"))).length > 0);
});

test("legacy Hyprland bindings install and uninstall without changing personal commands", async (t) => {
  const f = await fixture(t, { bindings: "conf" });
  await install(f.config, { env: f.env });
  NodeAssert.ok((await NodeFSP.readFile(f.bindingsFile, "utf8")).startsWith(f.originalBindings));
  await uninstall({ env: f.env });
  NodeAssert.equal(await NodeFSP.readFile(f.bindingsFile, "utf8"), f.originalBindings);
  NodeAssert.equal(await NodeFSP.readFile(f.menuFile, "utf8"), f.originalMenu);
  await missing(f.p.manifest);
});

test("malformed managed bindings fail before any installation writes", async (t) => {
  const f = await fixture(t);
  await NodeFSP.appendFile(f.bindingsFile, "-- BEGIN LOOM OS\nincomplete\n");
  const before = await tree(f.root);
  await NodeAssert.rejects(install(f.config, { env: f.env }), /Malformed.*markers/i);
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("a symlinked install destination is preserved rather than followed", async (t) => {
  const f = await fixture(t);
  const target = NodePath.join(f.root, "personal-script");
  await NodeFSP.writeFile(target, "personal script");
  await NodeFSP.mkdir(NodePath.dirname(f.p.bin), { recursive: true });
  await NodeFSP.symlink(target, f.p.bin);
  const before = await tree(f.root);
  await NodeAssert.rejects(install(f.config, { env: f.env }), /symlink/i);
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("configuration accepts normalized origins and rejects credentials, paths and malformed executable paths", async (t) => {
  const f = await fixture(t);
  NodeAssert.equal(
    validateConfig({ ...f.config, officeUrl: "https://office.example.test/" }).officeUrl,
    "https://office.example.test",
  );
  NodeAssert.equal(validateOrigin("http://[::1]:8397/", "atlasUrl"), "http://[::1]:8397");
  for (const origin of [
    "file:///tmp/app",
    "https://user:password@example.test",
    "https://office.example.test/app/",
    "https://office.example.test?token=test",
    "https://office.example.test/#private",
  ]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, officeUrl: origin }));
  }
  for (const executable of ["relative/Loom.AppImage", "", "/tmp/line\napp", "/tmp/nul\0app"]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, loomExecutable: executable }));
  }
  NodeAssert.throws(() => validateConfig({ ...f.config, profile: "server" }));
  NodeAssert.throws(() => validateConfig({ ...f.config, copiedToken: "synthetic" }));
});

test("Office capture opens the existing review flow with the original text and link", async (t) => {
  const f = await fixture(t);
  const text = "Line one\nQuotes \" and apostrophes ' & $literal";
  const url = "https://example.test/path?q=one&another=two";
  const capture = new URL(officeCaptureUrl(f.config, { title: "Review this", text, url }));
  NodeAssert.equal(capture.origin, f.config.officeUrl);
  NodeAssert.equal(capture.pathname, "/app/share");
  NodeAssert.equal(capture.searchParams.get("text"), text);
  NodeAssert.equal(capture.searchParams.get("url"), url);
  NodeAssert.equal(capture.searchParams.get("title"), "Review this");
});

test("Office capture refuses empty, oversized, credential-bearing or NUL-containing content", async (t) => {
  const f = await fixture(t);
  for (const capture of [
    {},
    { text: "a".repeat(4001) },
    { title: "a".repeat(201) },
    { url: "file:///tmp/private" },
    { url: "https://user:password@example.test/path" },
    { text: "bad\0text" },
    { title: "bad\0title" },
  ]) {
    NodeAssert.throws(() => officeCaptureUrl(f.config, capture));
  }
});

test("Office and Atlas share the retained Office profile so email sign-in reaches both app windows", async (t) => {
  const f = await fixture(t);
  const office = appCommand("office", f.config, f.env);
  const atlas = appCommand("atlas", f.config, f.env);
  const capture = appCommand(
    "office",
    f.config,
    f.env,
    officeCaptureUrl(f.config, { text: "Review before saving" }),
  );
  const profile = (command) => command.args.find((arg) => arg.startsWith("--user-data-dir="));
  NodeAssert.equal(profile(office), profile(atlas));
  NodeAssert.notEqual(profile(office), profile(appCommand("switchboard", f.config, f.env)));
  NodeAssert.equal(profile(office), profile(capture));
  NodeAssert.equal(profile(office), `--user-data-dir=${NodePath.join(f.p.profiles, "office")}`);
  NodeAssert.equal(office.command, f.config.browserExecutable);
  NodeAssert.ok(office.args.includes(`--app=${f.config.officeUrl}/app/`));
  NodeAssert.ok(atlas.args.includes(`--app=${f.config.atlasUrl}/app/`));
  NodeAssert.ok(
    capture.args.some((arg) => arg.startsWith(`--app=${f.config.officeUrl}/app/share?`)),
  );
  NodeAssert.throws(() => appCommand("atlas", { ...f.config, atlasUrl: undefined }, f.env));
});

test("native search forwards the correct app origin and preserves query words as one argument", async (t) => {
  const f = await fixture(t);
  await legacyServer(t, f.config);
  await install(f.config, { env: f.env });
  await main(["search", "office", "from:person@example.test", "design & notes"], f.env);
  const office = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.equal(office.origin, f.config.officeUrl);
  NodeAssert.deepEqual(office.args, [
    "office",
    "search",
    "--query",
    "from:person@example.test design & notes",
    "--limit",
    "20",
    "--json",
  ]);
  await main(["search", "atlas", "a research topic"], f.env);
  const atlas = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.equal(atlas.origin, f.config.atlasUrl);
  NodeAssert.deepEqual(atlas.args, [
    "atlas",
    "sources-list",
    "--query",
    "a research topic",
    "--limit",
    "20",
    "--json",
  ]);
});

test("Atlas capture opens the native review picker without a direct write or AI command", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const tui = NodePath.join(f.root, "omarchy-launch-tui");
  await NodeFSP.copyFile(f.config.browserExecutable, tui);
  await NodeFSP.chmod(tui, 0o755);
  f.env.PATH = f.root + NodePath.delimiter + f.env.PATH;
  const text = "Synthetic text with $literal and `literal`.";
  await main(["capture", "atlas", "--title", "Synthetic capture", "--text", text], f.env);
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.equal(recorded.origin, null);
  NodeAssert.deepEqual(recorded.args, [
    "--app-id=org.omarchy.loom-capture",
    NodePath.join(f.p.root, "capture-terminal"),
    "atlas",
    "--title",
    "Synthetic capture",
    "--text",
    text,
  ]);
});

test("configure refuses an edited managed block and uninstall preserves it with its ownership record", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const before = await NodeFSP.readFile(f.bindingsFile, "utf8");
  const edited = before.replace("open office", "open office --personal-option");
  NodeAssert.notEqual(edited, before);
  await NodeFSP.writeFile(f.bindingsFile, edited);
  const beforeConfigure = await tree(f.root);
  await NodeAssert.rejects(
    install({ ...f.config, profile: "workstation" }, { env: f.env }),
    /edited.*integration block/i,
  );
  NodeAssert.deepEqual(await tree(f.root), beforeConfigure);
  const result = await uninstall({ env: f.env });
  NodeAssert.ok(result.preserved.some((entry) => entry.startsWith(f.bindingsFile)));
  NodeAssert.equal(await NodeFSP.readFile(f.bindingsFile, "utf8"), edited);
  await NodeFSP.access(f.p.manifest);
});

test("malformed bindings at uninstall fail before removing any installed file", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const bindings = await NodeFSP.readFile(f.bindingsFile, "utf8");
  await NodeFSP.writeFile(
    f.bindingsFile,
    bindings.replace("-- END LOOM OS", "-- USER REMOVED END MARKER"),
  );
  const before = await tree(f.root);
  await NodeAssert.rejects(uninstall({ env: f.env }), /Malformed.*markers/i);
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("app CLI login remains app-specific and invokes its supported device-login command", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  await main(["login", "office"], f.env);
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.deepEqual(recorded.args, ["login"]);
  NodeAssert.equal(recorded.origin, f.config.officeUrl);
});

test("service setup updates its owned gateway environment and preserves later user edits", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, "t3"),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download",
    switchboardUrl: "http://gateway.example.test:8317",
  };
  await install(config, { env: f.env });
  await main(["service", "install"], f.env);
  const dropIn = NodePath.join(f.p.home, ".config/systemd/user/t3code.service.d/loom-os.conf");
  NodeAssert.ok(
    (await NodeFSP.readFile(dropIn, "utf8")).includes("http://gateway.example.test:8317"),
  );
  const updated = { ...config, switchboardUrl: "https://other-gateway.example.test" };
  await install(updated, { env: f.env });
  await main(["service", "install"], f.env);
  NodeAssert.ok(
    (await NodeFSP.readFile(dropIn, "utf8")).includes("https://other-gateway.example.test"),
  );
  await NodeFSP.appendFile(dropIn, "# A personal service setting\n");
  const before = await tree(f.root);
  await NodeAssert.rejects(
    main(["service", "install"], f.env),
    /Preserving edited or unowned service/,
  );
  NodeAssert.deepEqual(await tree(f.root), before);
});

test("pack removal preserves explicitly installed service configuration", async (t) => {
  const f = await fixture(t);
  await install(
    {
      ...f.config,
      serverExecutable: f.config.loomExecutable,
      serverBaseDir: NodePath.join(f.p.root, "t3"),
      serverReleaseBaseUrl: "https://releases.example.test/custom/download",
    },
    { env: f.env },
  );
  await main(["service", "install"], f.env);
  const dropIn = NodePath.join(f.p.home, ".config/systemd/user/t3code.service.d/loom-os.conf");
  const before = await NodeFSP.readFile(dropIn, "utf8");
  await uninstall({ env: f.env });
  NodeAssert.equal(await NodeFSP.readFile(dropIn, "utf8"), before);
});

test("service configuration accepts explicit release paths and rejects unsafe runtime locations and ports", async (t) => {
  const f = await fixture(t);
  const config = validateConfig({
    ...f.config,
    serverBaseDir: NodePath.join(f.p.root, "t3"),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download/",
    serverHost: "::1",
    serverPort: 3774,
  });
  NodeAssert.equal(config.serverReleaseBaseUrl, "https://releases.example.test/custom/download");
  for (const value of ["relative/t3", "", "/tmp/line\nstate", "/tmp/nul\0state"]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, serverBaseDir: value }), /serverBaseDir/);
  }
  for (const value of [0, 65536, -1, 3.5, "3774", null]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, serverPort: value }), /serverPort/);
  }
  for (const value of ["", "bad host", "http://host.test", "host.test\n"]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, serverHost: value }), /serverHost/);
  }
  for (const value of [
    "file:///tmp/releases",
    "https://user:key@example.test/releases",
    "https://example.test/releases?token=key",
  ]) {
    NodeAssert.throws(() => validateConfig({ ...f.config, serverReleaseBaseUrl: value }));
  }
});

test("custom service install requires a persisted release origin and isolated home before any side effect", async (t) => {
  const f = await fixture(t);
  for (const options of [{}, { serverBaseDir: NodePath.join(f.p.root, "t3") }]) {
    await install(
      { ...f.config, serverExecutable: f.config.loomExecutable, ...options },
      { env: f.env },
    );
    const before = await tree(f.root);
    await NodeAssert.rejects(
      main(["service", "install"], {
        ...f.env,
        T3CODE_RELEASE_BASE_URL: "https://ambient.example.test/releases",
      }),
      /server-base-dir|server-release-base-url/,
    );
    NodeAssert.deepEqual(await tree(f.root), before);
    await missing(f.env.LOOM_OS_TEST_RECORD);
  }
});

test("service commissioning uses only its temporary mirror while persisting the fork home and network settings", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, "service % home"),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download",
    serverHost: "127.0.0.1",
    serverPort: 3774,
    switchboardKeyHelper: NodePath.join(f.root, "credential % helper"),
  };
  await install(config, { env: f.env });
  await main(["service", "install", "--release-base-url", "http://127.0.0.1:8766/releases/"], {
    ...f.env,
    T3CODE_HOME: "/ambient/live-state",
    T3CODE_PORT: "3773",
    T3CODE_RELEASE_BASE_URL: "https://ambient.example.test/upstream",
  });
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.deepEqual(recorded.args, ["service", "install", "--base-dir", config.serverBaseDir]);
  NodeAssert.deepEqual(recorded.service, {
    home: config.serverBaseDir,
    host: config.serverHost,
    port: "3774",
    releaseBaseUrl: "http://127.0.0.1:8766/releases",
  });
  const dropIn = await NodeFSP.readFile(
    NodePath.join(f.p.home, ".config/systemd/user/t3code.service.d/loom-os.conf"),
    "utf8",
  );
  NodeAssert.ok(dropIn.includes(`T3CODE_RELEASE_BASE_URL=${config.serverReleaseBaseUrl}`));
  NodeAssert.ok(dropIn.includes("T3CODE_PORT=3774"));
  NodeAssert.ok(dropIn.includes("T3CODE_HOST=127.0.0.1"));
  NodeAssert.ok(dropIn.includes("service %% home"));
  NodeAssert.ok(dropIn.includes("credential %% helper"));
  NodeAssert.ok(!dropIn.includes("8766"));
  NodeAssert.equal(appCommand("loom", config, f.env).env.T3CODE_HOME, undefined);
  NodeAssert.equal(appCommand("loom", config, f.env).env.T3CODE_PORT, undefined);
});

test("explicit service restart refreshes owned startup settings and status or uninstall never rewrites them", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, "t3"),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download",
    serverPort: 3774,
  };
  await install(config, { env: f.env });
  await main(["service", "install"], f.env);
  await install({ ...config, serverPort: 3775 }, { env: f.env });
  await main(["service", "restart"], f.env);
  const dropIn = NodePath.join(f.p.home, ".config/systemd/user/t3code.service.d/loom-os.conf");
  NodeAssert.ok((await NodeFSP.readFile(dropIn, "utf8")).includes("T3CODE_PORT=3775"));
  const before = await NodeFSP.readFile(dropIn, "utf8");
  for (const action of ["status", "uninstall"]) {
    await main(["service", action], f.env);
    const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
    NodeAssert.deepEqual(recorded.args, ["service", action, "--base-dir", config.serverBaseDir]);
    NodeAssert.equal(await NodeFSP.readFile(dropIn, "utf8"), before);
  }
});

test("service options cannot silently override the configured home or persist a temporary mirror", async (t) => {
  const f = await fixture(t);
  await install(
    {
      ...f.config,
      serverExecutable: f.config.loomExecutable,
      serverBaseDir: NodePath.join(f.p.root, "t3"),
      serverReleaseBaseUrl: "https://releases.example.test/custom/download",
    },
    { env: f.env },
  );
  const before = await tree(f.root);
  for (const args of [
    ["install", "--base-dir", "/ambient/live-state"],
    ["restart", "--release-base-url", "http://127.0.0.1:8766"],
    ["install", "unexpected-positional"],
    ["install", "--release-base-url", "https://user:key@example.test"],
  ]) {
    await NodeAssert.rejects(main(["service", ...args], f.env));
    NodeAssert.deepEqual(await tree(f.root), before);
  }
  await missing(f.env.LOOM_OS_TEST_RECORD);
});

test("service lifecycle preserves a unit owned by a different or unknown environment", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, "t3"),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download",
  };
  await install(config, { env: f.env });
  const unit = NodePath.join(f.p.home, ".config/systemd/user/t3code.service");
  for (const content of [
    "[Service]\nEnvironment=T3CODE_HOME=/another/environment\n",
    "[Service]\nExecStart=/another/server\n",
  ]) {
    await save(unit, content);
    const before = await tree(f.root);
    for (const action of ["install", "restart", "uninstall"]) {
      await NodeAssert.rejects(main(["service", action], f.env), /Preserving t3code.service/);
      NodeAssert.deepEqual(await tree(f.root), before);
    }
  }
  await missing(f.env.LOOM_OS_TEST_RECORD);
});

test("service ownership matches quoted and systemd-escaped base directories", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, 'service % " home'),
    serverReleaseBaseUrl: "https://releases.example.test/custom/download",
  };
  await install(config, { env: f.env });
  const escaped = config.serverBaseDir
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  await save(
    NodePath.join(f.p.home, ".config/systemd/user/t3code.service"),
    `[Service]\nEnvironment=T3CODE_HOME="${escaped}"\n`,
  );
  await main(["service", "restart"], f.env);
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.equal(recorded.service.home, config.serverBaseDir);
});

test("repeated Office launches focus its app window and ignore password popups", async (t) => {
  const f = await fixture(t);
  const calls = [];
  const hyprctl = async (args) => {
    calls.push(args);
    return {
      stdout:
        args[0] === "clients"
          ? JSON.stringify([
              { address: "0x11", class: "loom-os-office", title: "1Password" },
              { address: "0x22", class: "chrome-office.example.test__app_-Default" },
              { address: "0x33", class: "chrome-atlas.example.test__app_-Default" },
            ])
          : "ok",
    };
  };
  for (let i = 0; i < 3; i++) {
    NodeAssert.equal(await focusExistingApp("office", f.config, f.env, hyprctl), true);
  }
  NodeAssert.equal(calls.filter((args) => args[0] === "eval").length, 3);
  NodeAssert.ok(
    calls.filter((args) => args[0] === "eval").every((args) => args[1].includes("address:0x22")),
  );
});

test("Atlas focuses its native hostname identity while preserving the configured port for launch", async (t) => {
  const f = await fixture(t);
  const calls = [];
  const hyprctl = async (args) => {
    calls.push(args);
    return {
      stdout:
        args[0] === "clients"
          ? JSON.stringify([
              {
                address: "0x33",
                initialClass: "chrome-atlas.example.test__app_-Default",
                class: "changed",
              },
            ])
          : "ok",
    };
  };
  NodeAssert.equal(await focusExistingApp("atlas", f.config, f.env, hyprctl), true);
  NodeAssert.ok(calls[1][1].includes("address:0x33"));
  NodeAssert.equal(await focusExistingApp("office", f.config, f.env, hyprctl), false);
});

test("focus supports legacy Hyprland and refuses a duplicate when focus fails", async (t) => {
  const f = await fixture(t);
  const calls = [];
  const hyprctl = async (args) => {
    calls.push(args);
    if (args[0] === "clients")
      return {
        stdout: JSON.stringify([
          { address: "0x44", class: "chrome-office.example.test__app_-Default" },
        ]),
      };
    if (args[0] === "eval") throw new Error("unknown request");
    return { stdout: "ok" };
  };
  NodeAssert.equal(await focusExistingApp("office", f.config, f.env, hyprctl), true);
  NodeAssert.deepEqual(calls[2], ["dispatch", "focuswindow", "address:0x44"]);
  await NodeAssert.rejects(
    focusExistingApp("office", f.config, f.env, async (args) => {
      if (args[0] === "clients") return hyprctl(args);
      throw new Error("focus unavailable");
    }),
    /Cannot focus the existing Office window/,
  );
});

test("workstation pairing delegates to the configured running server without changing service startup", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    profile: "workstation",
    serverExecutable: f.config.loomExecutable,
    serverBaseDir: NodePath.join(f.p.root, "workstation state"),
    serverHost: "127.0.0.1",
    serverPort: 3774,
  };
  await install(config, { env: f.env });
  const dropIn = NodePath.join(f.p.home, ".config/systemd/user/t3code.service.d/credentials.conf");
  await save(dropIn, "# Existing user-owned credential setup\n");
  const before = await tree(f.root);
  await main(["pair", "--tailscale-serve-port", "8443"], {
    ...f.env,
    T3CODE_HOME: "/ambient/live-state",
    T3CODE_HOST: "0.0.0.0",
    T3CODE_PORT: "9999",
  });
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.deepEqual(recorded.args, [
    "pair",
    "--tailscale",
    "--base-dir",
    config.serverBaseDir,
    "--tailscale-serve-port",
    "8443",
    "--label",
    "LoomOS workstation",
  ]);
  NodeAssert.equal(recorded.service.home, config.serverBaseDir);
  NodeAssert.equal(recorded.service.host, config.serverHost);
  NodeAssert.equal(recorded.service.port, "3774");
  await NodeFSP.rm(f.env.LOOM_OS_TEST_RECORD);
  NodeAssert.deepEqual(await tree(f.root), before);
  await main(["pair"], f.env);
  NodeAssert.ok(
    JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8")).args.includes("443"),
  );
});

test("pairing rejects wrong profiles, missing server configuration and unsafe options before launching", async (t) => {
  const f = await fixture(t);
  for (const config of [
    f.config,
    { ...f.config, profile: "workstation" },
    { ...f.config, profile: "workstation", serverExecutable: f.config.loomExecutable },
  ]) {
    await install(config, { env: f.env });
    await NodeAssert.rejects(main(["pair"], f.env), /workstation|server-base-dir/);
    await missing(f.env.LOOM_OS_TEST_RECORD);
  }
  await install(
    {
      ...f.config,
      profile: "workstation",
      serverExecutable: f.config.loomExecutable,
      serverBaseDir: NodePath.join(f.p.root, "t3"),
    },
    { env: f.env },
  );
  const before = await tree(f.root);
  for (const args of [
    ["--base-dir", "/other/live-state"],
    ["--host", "0.0.0.0"],
    ["unexpected"],
    ["--scope", "access:write"],
    ...["0", "65536", "3.5", "443; touch /tmp/fixture", "443\n"].map((port) => [
      "--tailscale-serve-port",
      port,
    ]),
  ]) {
    await NodeAssert.rejects(main(["pair", ...args], f.env));
    await missing(f.env.LOOM_OS_TEST_RECORD);
    NodeAssert.deepEqual(await tree(f.root), before);
  }
});

test("native pairing opens a dedicated terminal and forwards only the validated port", async (t) => {
  const f = await fixture(t);
  await install(
    {
      ...f.config,
      profile: "workstation",
      serverExecutable: f.config.loomExecutable,
      serverBaseDir: NodePath.join(f.p.root, "t3"),
    },
    { env: f.env },
  );
  const fakeBin = NodePath.join(f.root, "bin");
  await NodeFSP.mkdir(fakeBin);
  await NodeFSP.copyFile(f.config.loomExecutable, NodePath.join(fakeBin, "omarchy-launch-tui"));
  await main(["pair", "--terminal", "--tailscale-serve-port", "8443"], {
    ...f.env,
    PATH: `${fakeBin}:${f.env.PATH}`,
  });
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.deepEqual(recorded.args, [
    "--app-id=org.omarchy.loom-pair",
    NodePath.join(f.p.root, "pair-terminal"),
    "--tailscale-serve-port",
    "8443",
  ]);
});

test("native health inspection opens the diagnostic terminal without touching services", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const fakeBin = NodePath.join(f.root, "bin");
  await NodeFSP.mkdir(fakeBin);
  await NodeFSP.copyFile(f.config.loomExecutable, NodePath.join(fakeBin, "omarchy-launch-tui"));
  await main(["doctor", "--terminal"], { ...f.env, PATH: `${fakeBin}:${f.env.PATH}` });
  const recorded = JSON.parse(await NodeFSP.readFile(f.env.LOOM_OS_TEST_RECORD, "utf8"));
  NodeAssert.deepEqual(recorded.args, [
    "--app-id=org.omarchy.loom-health",
    NodePath.join(f.p.root, "doctor-terminal"),
  ]);
  await NodeFSP.rm(f.env.LOOM_OS_TEST_RECORD);
  for (const args of [
    ["doctor", "--restart"],
    ["doctor", "unexpected"],
    ["status", "--terminal"],
  ]) {
    await NodeAssert.rejects(main(args, f.env));
    await missing(f.env.LOOM_OS_TEST_RECORD);
  }
});

test("native rollback confirmation cancels safely and a failed review never offers or applies rollback", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  const bin = NodePath.join(f.root, "tools");
  await NodeFSP.mkdir(bin);
  const log = NodePath.join(f.root, "rollback.log");
  await NodeFSP.writeFile(
    f.p.bin,
    `#!/bin/bash\nprintf '%s\\n' "$*" >> "$LOOM_OS_ROLLBACK_LOG"\nif [[ "$*" == 'pack rollback --dry-run' ]]; then printf '%s\\n' '{"sha256":"${"0".repeat(64)}"}'; exit "$LOOM_OS_PREFLIGHT_EXIT"; fi\n`,
    { mode: 0o755 },
  );
  await NodeFSP.writeFile(
    NodePath.join(bin, "gum"),
    `#!/bin/bash\nprintf '%s\\n' confirm >> "$LOOM_OS_ROLLBACK_LOG"\nexit "$LOOM_OS_CONFIRM_EXIT"\n`,
    { mode: 0o755 },
  );
  const { spawn } = await import("node:child_process");
  async function invoke(preflight, confirm) {
    const child = spawn("/bin/bash", [NodePath.join(f.p.root, "pack-rollback-terminal")], {
      env: {
        ...f.env,
        PATH: `${bin}:${f.env.PATH}`,
        LOOM_OS_ROLLBACK_LOG: log,
        LOOM_OS_PREFLIGHT_EXIT: String(preflight),
        LOOM_OS_CONFIRM_EXIT: String(confirm),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (part) => {
      output += part;
    });
    child.stderr.on("data", (part) => {
      output += part;
    });
    child.stdin.end("\n");
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { exit, output };
  }
  const cancelled = await invoke(0, 1);
  NodeAssert.equal(cancelled.exit, 0);
  NodeAssert.match(cancelled.output, /Cancelled/);
  NodeAssert.equal(
    await NodeFSP.readFile(log, "utf8"),
    "pack status --human\npack rollback --dry-run\nconfirm\n",
  );
  await NodeFSP.writeFile(log, "");
  NodeAssert.equal((await invoke(1, 0)).exit, 1);
  NodeAssert.equal(
    await NodeFSP.readFile(log, "utf8"),
    "pack status --human\npack rollback --dry-run\n",
  );
  await NodeFSP.writeFile(log, "");
  NodeAssert.equal((await invoke(0, 0)).exit, 0);
  NodeAssert.equal(
    await NodeFSP.readFile(log, "utf8"),
    `pack status --human\npack rollback --dry-run\nconfirm\npack rollback --expected-sha256 ${"0".repeat(64)}\n`,
  );
});

const officePage = {
  items: [
    {
      reference: { id: "note-1", kind: "note" },
      app: "notes",
      title: "Project notes",
      snippet: "A matched excerpt",
    },
  ],
  nextCursor: "next-page",
};
const atlasPage = {
  sources: [
    {
      source: {
        id: "source-1",
        title: "Project research",
        project: "Loom",
        topics: ["Linux", "Omarchy"],
      },
    },
  ],
  next: "",
};

function finderFixture(choices, queries = ["project"]) {
  const events = [];
  return {
    events,
    dependencies: {
      discover: async (app) => ({ app, state: "legacy", manifest: null }),
      choose: async (header, options) => {
        events.push(["choose", header, options]);
        NodeAssert.ok(choices.length, "Unexpected additional action");
        const choice = choices.shift();
        NodeAssert.ok(
          choice === null || options.includes(choice),
          `Invalid fixture choice: ${choice}`,
        );
        return choice;
      },
      input: async (app) => {
        events.push(["input", app]);
        return queries.shift() ?? null;
      },
      search: async (spec) => {
        events.push(["search", spec]);
        return spec.args[0] === "office" ? officePage : atlasPage;
      },
      copy: async (text) => {
        events.push(["copy", text]);
      },
      open: async (app) => {
        events.push(["open", app]);
      },
      login: async (app) => {
        events.push(["login", app]);
      },
      show: (text) => {
        events.push(["show", text]);
      },
    },
  };
}

test("finder uses exact app contracts, bounded literal argv and endpoint", async (t) => {
  const f = await fixture(t);
  const query = '$(touch /tmp/never) "quoted" & --query';
  const spec = searchCommand("office", query, f.config, f.env);
  NodeAssert.equal(spec.command, f.config.officeCli);
  NodeAssert.equal(spec.env.API_URL, f.config.officeUrl);
  NodeAssert.deepEqual(spec.args, [
    "office",
    "search",
    "--query",
    query,
    "--limit",
    "20",
    "--json",
  ]);
  NodeAssert.equal(searchCommand("atlas", "research", f.config, f.env).args[1], "sources-list");
  for (const query of ["", " ", "\x1b[31m", "a\u202Eb", "a".repeat(501)])
    NodeAssert.throws(() => searchCommand("office", query, f.config, f.env));
  NodeAssert.throws(() => searchCommand("atlas", "é".repeat(101), f.config, f.env));
  NodeAssert.equal(
    searchCommand("atlas", "é".repeat(100), f.config, f.env).args[3],
    "é".repeat(100),
  );
  NodeAssert.throws(() => searchCommand("atlas", "x", { ...f.config, atlasCli: undefined }, f.env));
});

test("finder reads Office excerpts and Atlas metadata with accurate pagination", () => {
  NodeAssert.deepEqual(finderResults("office", officePage), {
    more: true,
    results: [
      {
        label: "1. Project notes (notes)",
        title: "Project notes",
        text: "A matched excerpt",
        reference: officePage.items[0].reference,
      },
    ],
  });
  NodeAssert.deepEqual(finderResults("atlas", atlasPage), {
    more: false,
    results: [
      {
        label: "1. Project research (Loom)",
        title: "Project research",
        text: "Loom · Linux · Omarchy",
      },
    ],
  });
  const unsafe = {
    items: [0, 1].map(() => ({
      reference: { kind: "note", id: "x" },
      title: "--title\x1b]0;spoof\x07\n",
      snippet: "\x1b[31m\u202Esecret",
    })),
  };
  const results = finderResults("office", unsafe).results;
  NodeAssert.notEqual(results[0].label, results[1].label);
  NodeAssert.ok(!/[\p{Cc}\p{Cf}]/u.test(results[0].title + results[0].text));
  for (const page of [
    {},
    { items: "bad" },
    { items: [{ title: "x" }] },
    { items: Array(21).fill(officePage.items[0]) },
  ])
    NodeAssert.throws(() => finderResults("office", page));
});

test("finder cancellation never opens apps, writes clipboard, logs in or searches again", async (t) => {
  const f = await fixture(t);
  for (const [app, choices, queries, searches] of [
    [undefined, [null], ["project"], 0],
    ["office", [], [null], 0],
    ["office", [null], ["project"], 1],
    ["office", ["1. Project notes (notes)", null], ["project"], 1],
  ]) {
    const flow = finderFixture(choices, queries);
    await nativeFinder(f.config, f.env, app, flow.dependencies);
    NodeAssert.equal(flow.events.filter(([type]) => type === "search").length, searches);
    NodeAssert.ok(!flow.events.some(([type]) => ["open", "copy", "login"].includes(type)));
  }
});

test("finder previews, copies and focuses only the explicitly selected app", async (t) => {
  const f = await fixture(t);
  const flow = finderFixture([
    "Atlas",
    "1. Project research (Loom)",
    "Copy excerpt",
    "1. Project research (Loom)",
    "Copy title and open app",
  ]);
  await nativeFinder(f.config, f.env, undefined, flow.dependencies);
  NodeAssert.deepEqual(
    flow.events.filter(([type]) => ["copy", "open"].includes(type)),
    [
      ["copy", "Project research\nLoom · Linux · Omarchy"],
      ["copy", "Project research"],
      ["open", "atlas"],
    ],
  );
  NodeAssert.equal(
    flow.events.find(([type]) => type === "search")[1].env.API_URL,
    f.config.atlasUrl,
  );
});

test("empty finder results can refine the query and return the literal query to the app", async (t) => {
  const f = await fixture(t);
  const query = '"literal" $(command) & spaces';
  const flow = finderFixture(["Search again", "Copy query and open app"], ["missing", query]);
  flow.dependencies.search = async (spec) => {
    flow.events.push(["search", spec]);
    return { items: [] };
  };
  await nativeFinder(f.config, f.env, "office", flow.dependencies);
  NodeAssert.equal(flow.events.filter(([type]) => type === "search").length, 2);
  NodeAssert.deepEqual(
    flow.events.filter(([type]) => ["copy", "open"].includes(type)),
    [
      ["copy", query],
      ["open", "office"],
    ],
  );
  NodeAssert.ok(
    flow.events.some(([type, text]) => type === "show" && text.startsWith("No matches")),
  );
});

test("finder errors require explicit retry or sign-in and clipboard failure prevents launch", async (t) => {
  const f = await fixture(t);
  const flow = finderFixture(["Connect search", "Close"], ["x", "x"]);
  flow.dependencies.search = async () => {
    throw new Error("Unavailable");
  };
  await nativeFinder(f.config, f.env, "office", flow.dependencies);
  NodeAssert.deepEqual(
    flow.events.filter(([type]) => ["login", "open", "copy"].includes(type)),
    [["login", "office"]],
  );
  const failedCopy = finderFixture(["Copy query and open app", "Close"]);
  failedCopy.dependencies.copy = async () => {
    throw new Error("Clipboard unavailable");
  };
  await nativeFinder(f.config, f.env, "office", failedCopy.dependencies);
  NodeAssert.ok(!failedCopy.events.some(([type]) => type === "open"));
});

test("finder captures CLI JSON privately and hides raw failed-command diagnostics", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(
    f.config.officeCli,
    `#!${process.execPath}\nconsole.error('private-token-should-not-appear');process.exit(1);\n`,
    { mode: 0o755 },
  );
  const failed = finderFixture(["Close"]);
  delete failed.dependencies.search;
  await nativeFinder(f.config, f.env, "office", failed.dependencies);
  NodeAssert.ok(JSON.stringify(failed.events).includes("Search could not reach"));
  NodeAssert.ok(!JSON.stringify(failed.events).includes("private-token-should-not-appear"));
  await NodeFSP.writeFile(
    f.config.officeCli,
    `#!${process.execPath}\nconsole.log(JSON.stringify(${JSON.stringify(officePage)}));\n`,
    { mode: 0o755 },
  );
  const success = finderFixture(["Close"]);
  delete success.dependencies.search;
  await nativeFinder(f.config, f.env, "office", success.dependencies);
  NodeAssert.ok(
    success.events.some(
      ([type, text]) => type === "show" && text.includes("showing the first page"),
    ),
  );
});

test("finder installation supplies launcher, native menu and a matching removable shortcut", async (t) => {
  const f = await fixture(t);
  await install(f.config, { env: f.env });
  NodeAssert.ok(
    (await NodeFSP.readFile(f.bindingsFile, "utf8")).includes("SUPER + CTRL + ALT + F"),
  );
  NodeAssert.ok((await NodeFSP.readFile(f.menuFile, "utf8")).includes('"loomos.find-office"'));
  NodeAssert.ok(
    (await NodeFSP.readFile(NodePath.join(f.p.root, "find-terminal"), "utf8")).includes(
      'find --inline "$@"',
    ),
  );
  await install({ ...f.config, officeCli: undefined, atlasCli: undefined }, { env: f.env });
  NodeAssert.ok(
    !(await NodeFSP.readFile(f.bindingsFile, "utf8")).includes("SUPER + CTRL + ALT + F"),
  );
  await NodeAssert.rejects(NodeFSP.readFile(NodePath.join(f.p.root, "find-terminal")), {
    code: "ENOENT",
  });
  await NodeAssert.rejects(
    NodeFSP.readFile(NodePath.join(f.p.data, "applications/loom-os-find.desktop")),
    { code: "ENOENT" },
  );
});

test("search setup discovers deployed device support and refuses invalid authority", async () => {
  const origin = "https://app.example.test";
  NodeAssert.equal(await searchLoginMode(origin, async () => ({ status: 404 })), "key");
  NodeAssert.equal(
    await searchLoginMode(origin, async () => ({
      ok: true,
      json: async () => ({ issuer: origin }),
    })),
    "key",
  );
  const metadata = {
    issuer: origin,
    device_authorization_endpoint: origin + "/oauth/device",
    token_endpoint: origin + "/oauth/token",
  };
  NodeAssert.equal(
    await searchLoginMode(origin, async () => ({ ok: true, json: async () => metadata })),
    "device",
  );
  await NodeAssert.rejects(
    searchLoginMode(origin, async () => ({ status: 503, ok: false })),
    /unavailable/,
  );
  await NodeAssert.rejects(
    searchLoginMode(origin, async () => ({
      ok: true,
      json: async () => ({ ...metadata, token_endpoint: "https://other.test/token" }),
    })),
    /unsupported/,
  );
});

test("search approval opens only the configured origin in the retained shared profile", async (t) => {
  const f = await fixture(t);
  const spec = searchBrowserCommand(
    "office",
    f.config,
    f.env,
    f.config.officeUrl + "/app/?view=connections",
  );
  NodeAssert.equal(spec.args[0], appCommand("office", f.config, f.env).args[0]);
  NodeAssert.equal(spec.args[2], f.config.officeUrl + "/app/?view=connections");
  NodeAssert.ok(!spec.args.some((arg) => arg.startsWith("--app=")));
  for (const url of [
    "https://other.test/approve",
    "javascript:evil",
    f.config.officeUrl.replace("https://", "https://user:password@"),
  ])
    NodeAssert.throws(() => searchBrowserCommand("office", f.config, f.env, url));
});

test("search keys are looked up by app and exact origin without replacing explicit CLI credentials", async () => {
  const calls = [];
  const lookup = async (...args) => {
    calls.push(args);
    return "fixture-key";
  };
  const env = { API_URL: "https://office.example.test" };
  NodeAssert.equal(
    (await appCliEnvironment("office", env.API_URL, env, lookup)).API_TOKEN,
    "fixture-key",
  );
  NodeAssert.deepEqual(calls[0], ["lookup", "office", env.API_URL, env]);
  const explicit = { ...env, API_TOKEN: "explicit" };
  NodeAssert.equal(await appCliEnvironment("office", env.API_URL, explicit, lookup), explicit);
  NodeAssert.equal(calls.length, 1);
  NodeAssert.equal(
    await appCliEnvironment("office", env.API_URL, env, async () => {
      throw new Error("Unavailable");
    }),
    env,
  );
});

test("Office key setup validates before saving and never prints or opens a URL containing the key", async (t) => {
  const f = await fixture(t);
  const events = [];
  const choices = ["Open access settings", "Paste search key"];
  const key = "fixture-only-key";
  await connectSearch("office", f.config, f.env, {
    mode: async () => "key",
    choose: async () => choices.shift(),
    password: async () => key,
    openPage: async (url) => events.push(["page", url]),
    show: (text) => events.push(["show", text]),
    validate: async (spec) => {
      NodeAssert.equal(spec.env.API_TOKEN, key);
      NodeAssert.ok(!spec.args.includes(key));
      events.push(["validate"]);
      return { items: [] };
    },
    secret: async (operation, app, origin, env, value) => {
      NodeAssert.equal(value, key);
      events.push([operation, app, origin]);
    },
  });
  NodeAssert.ok(!JSON.stringify(events).includes(key));
  NodeAssert.deepEqual(
    events.filter(([type]) => ["validate", "store"].includes(type)),
    [["validate"], ["store", "office", f.config.officeUrl]],
  );
  NodeAssert.equal(
    events.find(([type]) => type === "page")[1],
    f.config.officeUrl + "/app/?view=connections",
  );
});

test("search setup cancellation, invalid keys and failed validation do not save credentials", async (t) => {
  const f = await fixture(t);
  for (const value of [null, "bad key", "candidate-key"]) {
    const choices = ["Paste search key", "Close"];
    let stored = false;
    await connectSearch("office", f.config, f.env, {
      mode: async () => "key",
      choose: async () => choices.shift(),
      password: async () => value,
      show: () => {},
      validate: async () => {
        throw new Error("Rejected");
      },
      secret: async () => {
        stored = true;
      },
    });
    NodeAssert.equal(stored, false);
  }
});

test("Atlas device setup delegates its login and key removal is restricted to the selected app origin", async (t) => {
  const f = await fixture(t);
  let device = false;
  let secret = false;
  await connectSearch("atlas", f.config, f.env, {
    mode: async () => "device",
    show: () => {},
    deviceLogin: async (app) => {
      NodeAssert.equal(app, "atlas");
      device = true;
    },
    secret: async () => {
      secret = true;
    },
  });
  NodeAssert.ok(device);
  NodeAssert.ok(!secret);
  const choices = ["Forget saved search key", "Close"];
  const calls = [];
  await connectSearch("office", f.config, f.env, {
    mode: async () => "key",
    choose: async () => choices.shift(),
    show: () => {},
    secret: async (...args) => calls.push(args),
  });
  NodeAssert.deepEqual(calls, [["clear", "office", f.config.officeUrl, f.env]]);
});

test("device connection opens the actual CLI approval URL once and blocks other origins", async (t) => {
  const f = await fixture(t);
  for (const link of [
    f.config.atlasUrl + "/approve?user_code=synthetic",
    "https://untrusted.test/approve",
  ]) {
    await NodeFSP.writeFile(
      f.config.atlasCli,
      `#!${process.execPath}\nconsole.log(${JSON.stringify(link)});console.log('Signed in');\n`,
      { mode: 0o755 },
    );
    const opened = [];
    await connectSearch("atlas", f.config, f.env, {
      mode: async () => "device",
      show: () => {},
      openPage: async (url) => opened.push(url),
    });
    NodeAssert.deepEqual(opened, link.startsWith(f.config.atlasUrl) ? [link] : []);
  }
});
