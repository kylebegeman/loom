import * as NodeTest from "node:test";
const test = NodeTest.test;
import * as NodeAssert from "node:assert/strict";
const assert = NodeAssert;
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import {
  normalizeShortcut,
  shortcutBindings,
  shortcutPreview,
  applyShortcuts,
  restoreShortcuts,
  install,
  paths,
  nativeShortcuts,
  recoverShortcuts,
  loomTuiCommand,
  nativeReadability,
} from "./loom-os.mjs";
const config = {
  version: 1,
  profile: "laptop",
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  loomExecutable: "/usr/bin/true",
  officeCli: "/usr/bin/true",
};
async function fixture(t, legacy = false) {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-shortcuts-")),
  );
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = { HOME: root };
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  const file = NodePath.join(p.config, "hypr/bindings." + (legacy ? "conf" : "lua"));
  await NodeFSP.writeFile(file, legacy ? "# personal\n" : "-- personal\n");
  await install(config, { env });
  return { root, env, p, file };
}
const live = async () => ({ stdout: "[]" });
test("shortcut normalization accepts deliberate chords and rejects unsupported or executable input", () => {
  assert.equal(normalizeShortcut("alt + super + o"), "SUPER + ALT + O");
  assert.equal(normalizeShortcut("Super+F12"), "SUPER + F12");
  assert.equal(normalizeShortcut("none"), null);
  for (const key of [
    "O",
    "SUPER + SUPER + O",
    "Super+Alt+$(bad)",
    "Super+foo+O",
    "Super+O\nexec bad",
    "Super+F25",
    "Super+keycode:9",
  ])
    assert.throws(() => normalizeShortcut(key), /shortcut/i);
});
test("presets include actions, honor individual overrides, and never move OS AI routes", () => {
  const keys = shortcutBindings(config, {
    version: 1,
    preset: "compact",
    bindings: { "open-office": "SUPER + F12", find: "none" },
  });
  assert.equal(keys.find((k) => k.id === "open-office").chord, "SUPER + F12");
  assert.equal(keys.find((k) => k.id === "actions").chord, "SUPER + ALT + SPACE");
  assert.ok(!keys.some((k) => k.id === "find"));
  assert.ok(!keys.some((k) => k.id === "ask-ai"));
  assert.throws(
    () =>
      shortcutBindings(config, { version: 1, preset: "compact", bindings: { wrong: "Super+O" } }),
    /action/i,
  );
});
for (const legacy of [false, true])
  test(`preview/apply/restore preserve personal ${legacy ? "legacy" : "Lua"} edits and survive reinstall`, async (t) => {
    const f = await fixture(t, legacy);
    const before = await NodeFSP.readFile(f.file, "utf8");
    const proposed = { version: 1, preset: "compact", bindings: {} };
    const preview = await shortcutPreview(config, f.env, proposed, { query: live });
    assert.equal(preview.conflicts.length, 0);
    assert.equal(await NodeFSP.readFile(f.file, "utf8"), before);
    await applyShortcuts(config, f.env, proposed, { query: live });
    let now = await NodeFSP.readFile(f.file, "utf8");
    assert.match(now, /SUPER(?: \+)? ALT/);
    assert.match(now, /personal/);
    await install(config, { env: f.env });
    assert.equal(await NodeFSP.readFile(f.file, "utf8"), now);
    await NodeFSP.appendFile(f.file, legacy ? "# new personal edit\n" : "-- new personal edit\n");
    await restoreShortcuts(config, f.env, { query: live });
    now = await NodeFSP.readFile(f.file, "utf8");
    assert.match(now, /new personal edit/);
    assert.match(now, /SUPER(?: \+)? CTRL(?: \+)? ALT/);
  });
test("live default and personal conflicts, duplicate proposed chords, and offline preflight refuse mutations", async (t) => {
  const f = await fixture(t);
  const proposed = { version: 1, preset: "compact", bindings: {} };
  const before = await NodeFSP.readFile(f.file, "utf8");
  const query = async () => ({
    stdout: JSON.stringify([{ modmask: 72, key: "o", dispatcher: "exec", arg: "personal-editor" }]),
  });
  const report = await shortcutPreview(config, f.env, proposed, { query });
  assert.equal(report.conflicts[0].action, "open-office");
  await assert.rejects(applyShortcuts(config, f.env, proposed, { query }), /conflict/i);
  await assert.rejects(
    applyShortcuts(config, f.env, proposed, {
      query: async () => {
        throw Error("offline");
      },
    }),
    /live bindings/i,
  );
  await assert.rejects(
    applyShortcuts(
      config,
      f.env,
      { ...proposed, bindings: { "open-office": "Super+Alt+L" } },
      { query: live },
    ),
    /conflict/i,
  );
  assert.equal(await NodeFSP.readFile(f.file, "utf8"), before);
});
test("managed bindings are ignored in the live conflict check but personal edits inside the block are protected", async (t) => {
  const f = await fixture(t);
  const query = async () => ({
    stdout: JSON.stringify([
      { modmask: 76, key: "o", dispatcher: "exec", arg: `'${f.p.bin}' open office` },
    ]),
  });
  assert.equal(
    (
      await shortcutPreview(
        config,
        f.env,
        { version: 1, preset: "standard", bindings: {} },
        { query },
      )
    ).conflicts.length,
    0,
  );
  await NodeFSP.writeFile(
    f.file,
    (await NodeFSP.readFile(f.file, "utf8")).replace("open office", "open office --personal"),
  );
  await assert.rejects(
    applyShortcuts(config, f.env, { version: 1, preset: "compact", bindings: {} }, { query: live }),
    /edited.*block/i,
  );
});
test("restore refuses an edited preferences file and cancellation changes nothing", async (t) => {
  const f = await fixture(t);
  await applyShortcuts(
    config,
    f.env,
    { version: 1, preset: "compact", bindings: {} },
    { query: live },
  );
  const prefs = NodePath.join(f.p.config, "loom-os/shortcuts.json");
  await NodeFSP.writeFile(prefs, JSON.stringify({ version: 1, preset: "none", bindings: {} }));
  await assert.rejects(restoreShortcuts(config, f.env, { query: live }), /edited.*preferences/i);
  let writes = 0;
  await nativeShortcuts(config, f.env, {
    choose: async () => null,
    show: () => {},
    status: async () => ({ bindings: [] }),
    apply: async () => {
      writes++;
    },
  });
  assert.equal(writes, 0);
});

test("interrupted shortcut writes recover exactly and preserve later personal edits", async (t) => {
  const f = await fixture(t),
    before = await NodeFSP.readFile(f.file, "utf8");
  let writes = 0;
  await assert.rejects(
    applyShortcuts(
      config,
      f.env,
      { version: 1, preset: "compact", bindings: {} },
      {
        query: live,
        write: async (file, content) => {
          if (++writes === 4) throw Error("interrupted");
          await NodeFSP.writeFile(file, content);
        },
      },
    ),
    /interrupted/,
  );
  await assert.rejects(
    shortcutPreview(config, f.env, { version: 1, preset: "none", bindings: {} }, { query: live }),
    /interrupted/,
  );
  await recoverShortcuts(f.env);
  assert.equal(await NodeFSP.readFile(f.file, "utf8"), before);
  await applyShortcuts(
    config,
    f.env,
    { version: 1, preset: "compact", bindings: {} },
    { query: live },
  );
});
test("larger dialogs pass literal arguments and change only per-window terminal options", async (t) => {
  const f = await fixture(t),
    args = [
      "--app-id=org.omarchy.loom-actions",
      "/fixture/script",
      "--query",
      "$(literal) with spaces",
    ];
  assert.deepEqual(await loomTuiCommand(args, f.env), { command: "omarchy-launch-tui", args });
  await NodeFSP.writeFile(
    NodePath.join(f.p.config, "loom-os/readability.json"),
    JSON.stringify({ version: 1, size: "larger" }),
  );
  const spec = await loomTuiCommand(args, f.env, (name) =>
    name === "alacritty" ? "/usr/bin/alacritty" : null,
  );
  assert.equal(spec.command, "uwsm-app");
  assert.ok(spec.args.includes("font.size=14"));
  assert.deepEqual(spec.args.slice(-3), args.slice(1));
  await assert.rejects(
    loomTuiCommand(args, f.env, () => null),
    /Foot or Alacritty/,
  );
  const recovery = ["--app-id=org.omarchy.loom-readability", "/fixture/readability"];
  assert.deepEqual(await loomTuiCommand(recovery, f.env, () => null), {
    command: "omarchy-launch-tui",
    args: recovery,
  });
});

test("larger dialogs work with Foot when Alacritty is absent and preserve normal configuration", async (t) => {
  const f = await fixture(t);
  const footConfig = NodePath.join(f.p.config, "foot/foot.ini");
  await NodeFSP.mkdir(NodePath.dirname(footConfig), { recursive: true });
  const before = "[main]\nfont=monospace:size=12\npad=14x14\n";
  await NodeFSP.writeFile(footConfig, before);
  const choices = ["Larger Loom dialogs", "Close"];
  await nativeReadability(f.env, {
    choose: async () => choices.shift(),
    resolve: (name) => (name === "foot" ? "/usr/bin/foot" : null),
    show: () => {},
  });
  const args = ["--app-id=org.omarchy.loom-actions", "/fixture/script", "$(literal) with spaces"];
  const spec = await loomTuiCommand(args, f.env, (name) =>
    name === "foot" ? "/usr/bin/foot" : null,
  );
  assert.equal(spec.command, "uwsm-app");
  assert.ok(spec.args.includes("/usr/bin/foot"));
  assert.ok(spec.args.includes("font=monospace:size=14"));
  assert.ok(spec.args.includes("pad=12x12"));
  assert.ok(spec.args.includes("org.omarchy.loom-actions"));
  assert.deepEqual(spec.args.slice(-2), args.slice(1));
  assert.equal(await NodeFSP.readFile(footConfig, "utf8"), before);
  assert.deepEqual(
    JSON.parse(
      await NodeFSP.readFile(NodePath.join(f.p.config, "loom-os/readability.json"), "utf8"),
    ),
    { version: 1, size: "larger" },
  );
});

test("unsupported larger-dialog selection leaves preferences intact and explains recovery", async (t) => {
  const f = await fixture(t);
  const file = NodePath.join(f.p.config, "loom-os/readability.json");
  await NodeFSP.writeFile(file, '{"version":1,"size":"system"}\n');
  const before = await NodeFSP.readFile(file, "utf8");
  const choices = ["Larger Loom dialogs", "Close"],
    messages = [];
  await nativeReadability(f.env, {
    choose: async () => choices.shift(),
    resolve: () => null,
    show: (message) => messages.push(message),
  });
  assert.equal(await NodeFSP.readFile(file, "utf8"), before);
  assert.ok(messages.some((message) => /Foot or Alacritty/.test(message)));
});

test("reviewed previews cannot overwrite a concurrent edit and recovery never overwrites later edits", async (t) => {
  const f = await fixture(t),
    prefs = { version: 1, preset: "compact", bindings: {} };
  const reviewed = await shortcutPreview(config, f.env, prefs, { query: live });
  await NodeFSP.appendFile(f.file, "-- another editor\n");
  await assert.rejects(
    applyShortcuts(config, f.env, prefs, { query: live, reviewed }),
    /changed during review/,
  );
  let count = 0;
  await assert.rejects(
    applyShortcuts(config, f.env, prefs, {
      query: live,
      write: async (file, content) => {
        if (++count === 4) throw Error("interrupted");
        await NodeFSP.writeFile(file, content);
      },
    }),
    /interrupted/,
  );
  await NodeFSP.appendFile(f.file, "-- preserve after interruption\n");
  await assert.rejects(recoverShortcuts(f.env), /Preserving edits/);
  assert.match(await NodeFSP.readFile(f.file, "utf8"), /preserve after interruption/);
});
test("native preset review defaults to keeping existing shortcuts", async (t) => {
  const f = await fixture(t);
  let applied = 0;
  const choices = ["Compact shortcuts", "Keep current shortcuts", "Close"];
  await nativeShortcuts(config, f.env, {
    status: async () => ({ bindings: [] }),
    show: () => {},
    choose: async () => choices.shift(),
    preview: async () => ({ bindings: [], conflicts: [] }),
    apply: async () => {
      applied++;
    },
  });
  assert.equal(applied, 0);
});

test("native conflict resolution keeps the proposed preset and existing custom overrides", async (t) => {
  const f = await fixture(t);
  await applyShortcuts(
    config,
    f.env,
    { version: 1, preset: "standard", bindings: { "open-loom": "Super+F12" } },
    { query: live },
  );
  const choices = [
    "Compact shortcuts",
    "Adjust a shortcut",
    "Office",
    "Apply reviewed shortcuts",
    "Activate later",
    "Close",
  ];
  let applied;
  await nativeShortcuts(config, f.env, {
    status: async () => ({ bindings: [] }),
    show: () => {},
    choose: async () => choices.shift(),
    input: async () => "Super+F11",
    preview: async (prefs) => ({
      bindings: [],
      conflicts: prefs.bindings["open-office"]
        ? []
        : [{ chord: "SUPER + ALT + O", reason: "personal shortcut" }],
    }),
    apply: async (prefs) => {
      applied = prefs;
    },
  });
  assert.equal(applied.preset, "compact");
  assert.equal(applied.bindings["open-loom"], "SUPER + F12");
  assert.equal(applied.bindings["open-office"], "SUPER + F11");
});
test("an unchanged owned preset introduces no conflict from opaque native Lua callbacks", async (t) => {
  const f = await fixture(t);
  const prefs = { version: 1, preset: "standard", bindings: { actions: "none" } };
  const native = {
    query: async () => ({
      stdout: JSON.stringify([{ modmask: 76, key: "L", dispatcher: "__lua", arg: "57" }]),
    }),
  };
  const before = await NodeFSP.readFile(f.file, "utf8");
  assert.equal((await shortcutPreview(config, f.env, prefs, native)).conflicts.length, 0);
  await applyShortcuts(config, f.env, prefs, native);
  assert.equal(await NodeFSP.readFile(f.file, "utf8"), before);
  const changed = { ...prefs, bindings: { ...prefs.bindings, "open-office": "Super+Ctrl+Alt+L" } };
  assert.ok((await shortcutPreview(config, f.env, changed, native)).conflicts.length > 0);
});

test("restore preserves an absent preference file and exact existing formatting", async (t) => {
  const f = await fixture(t);
  const file = NodePath.join(f.p.config, "loom-os/shortcuts.json");
  await assert.rejects(NodeFSP.access(file));
  const proposed = { version: 1, preset: "none", bindings: {} };
  await applyShortcuts(config, f.env, proposed, { query: live });
  await restoreShortcuts(config, f.env, { query: live });
  await assert.rejects(NodeFSP.access(file));
  const original = '{"version":1,"preset":"standard","bindings":{}}\n';
  await NodeFSP.writeFile(file, original);
  await applyShortcuts(config, f.env, proposed, { query: live });
  await restoreShortcuts(config, f.env, { query: live });
  assert.equal(await NodeFSP.readFile(file, "utf8"), original);
});

test("interrupted restoration of an absent file recovers the applied preferences", async (t) => {
  const f = await fixture(t),
    proposed = { version: 1, preset: "none", bindings: {} };
  await applyShortcuts(config, f.env, proposed, { query: live });
  const file = NodePath.join(f.p.config, "loom-os/shortcuts.json"),
    before = await NodeFSP.readFile(file, "utf8");
  await assert.rejects(
    restoreShortcuts(config, f.env, {
      query: live,
      write: async (path, content) => {
        if (path === f.p.manifest) throw Error("interrupted after preference removal");
        await NodeFSP.writeFile(path, content);
      },
    }),
    /interrupted/,
  );
  await assert.rejects(NodeFSP.access(file));
  await recoverShortcuts(f.env);
  assert.equal(await NodeFSP.readFile(file, "utf8"), before);
});
