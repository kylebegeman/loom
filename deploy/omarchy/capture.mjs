import * as cp from "node:child_process";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  appCommand,
  discoverAppIntegration,
  validateAppIntegration,
  paths,
  focusExistingApp,
  launchExactItem,
} from "./loom-os.mjs";
const names = { office: "Office", atlas: "Atlas" };
const labels = {
  note: "Office Note",
  reminder: "Office Reminder",
  conversation: "Office Desk draft",
  source: "Atlas Research source",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe = (value) =>
  value.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
export function captureEnvelope(
  app,
  target,
  payload,
  cap,
  { id = crypto.randomUUID(), reuse = false } = {},
) {
  const { title = "", text = "", url = "" } = payload;
  if (
    !uuid.test(id) ||
    typeof reuse !== "boolean" ||
    !["office", "atlas"].includes(app) ||
    !cap.destinations.includes(target) ||
    !["note", "reminder", "conversation", "source"].includes(target)
  )
    throw Error("Choose a supported capture destination.");
  if (
    [title, text, url].some((v) => typeof v !== "string" || v.includes("\0")) ||
    ![title, text, url].some((v) => v.trim())
  )
    throw Error("Capture text or a link first.");
  const size = (v) => (cap.captureUnit === "utf8-bytes" ? Buffer.byteLength(v) : v.length);
  for (const [name, value] of Object.entries({ title, text, url }))
    if (size(value) > cap[name + "Limit"])
      throw Error(
        `${names[app]} ${name} limit: ${cap[name + "Limit"]} ${cap.captureUnit}. Refine the capture in the app.`,
      );
  if (url) {
    const u = new URL(url);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      /[\u0000-\u001f\u007f]/.test(url)
    )
      throw Error("Use an HTTP(S) link without embedded credentials.");
  }
  return { version: 1, app, id, target, title, text, url, reuse };
}
export function reviewedCaptureCommand(envelope, cap, config, env) {
  if (
    cap.handoff !== "loom-capture-review-v1" ||
    cap.format !== "review-in-app-v1" ||
    cap.reviewed !== true ||
    cap.path !== "/app/share"
  )
    throw Error("Update the app before using reviewed capture.");
  const frame =
    "v1." + zlib.deflateSync(Buffer.from(JSON.stringify(envelope))).toString("base64url");
  if (frame.length > 100000)
    throw Error("This capture exceeds the native transport limit. Capture inside the app.");
  const url = new URL(cap.path, config[envelope.app + "Url"]);
  url.hash = "loomCapture=" + frame;
  return appCommand(envelope.app, config, env, url.href);
}
async function choice(args, env) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn("gum", args, { env, stdio: ["inherit", "pipe", "inherit"] });
    let value = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (s) => (value += s));
    child.once("error", () => reject(Error("The native capture picker is unavailable.")));
    child.once("exit", (code) =>
      [1, 130].includes(code)
        ? resolve(null)
        : code === 0
          ? resolve(value.replace(/\r?\n$/, ""))
          : reject(Error("The capture picker failed.")),
    );
  });
}
export async function captureCapabilities(
  app,
  config,
  env,
  { discover = discoverAppIntegration } = {},
) {
  const cache = path.join(paths(env).state, "loom-os", "capture-" + app + ".json");
  const report = await discover(app, config);
  if (report.state === "available") {
    const record = { origin: config[app + "Url"], manifest: report.manifest };
    try {
      await fs.mkdir(path.dirname(cache), { recursive: true, mode: 0o700 });
      await fs.writeFile(cache, JSON.stringify(record), { mode: 0o600 });
    } catch {
      /* Optional offline build metadata. */
    }
    return { ...report, fromCache: false };
  }
  if (app === "office" && report.state === "unavailable") {
    try {
      const saved = JSON.parse(await fs.readFile(cache, "utf8"));
      const manifest = validateAppIntegration(saved.manifest, app);
      if (saved.origin === config.officeUrl && manifest.offline.supportedWriting)
        return { app, state: "available", manifest, fromCache: true };
    } catch {
      /* No prior usable declaration. */
    }
  }
  return report;
}
export async function nativeCapture(
  config,
  env,
  { initialApp, payload = {}, selected = false, ...deps } = {},
) {
  const choose =
    deps.choose ??
    ((header, values) => choice(["choose", "--header", header, "--", ...values], env));
  const show = deps.show ?? console.log;
  let text = payload.text ?? "";
  if (payload.clipboard || selected) {
    const read =
      deps.clipboard ??
      (() =>
        cp.spawnSync("wl-paste", ["--no-newline", ...(selected ? ["--primary"] : [])], {
          env,
          encoding: "utf8",
          maxBuffer: 128 * 1024,
          timeout: 3000,
        }));
    const result = await read();
    if (result.error || result.status !== 0)
      throw Error(
        selected
          ? "Could not read selected text. Copy it and use Capture clipboard."
          : "Could not read clipboard text. Copy some text first.",
      );
    text = result.stdout;
  }
  const content = { title: payload.title ?? "", text, url: payload.url ?? "" };
  if (!content.url && !content.title) {
    try {
      const u = new URL(text.trim());
      if (["http:", "https:"].includes(u.protocol) && !u.username && !u.password) {
        content.url = text.trim();
        content.text = "";
      }
    } catch {
      /* Ordinary text. */
    }
  }
  if (![content.title, content.text, content.url].some((v) => v.trim()))
    throw Error("Copy or select some text first.");
  if ([content.title, content.text, content.url].some((v) => v.includes("\0")))
    throw Error("Capture does not support NUL characters.");
  show(
    "Capture preview\n" +
      [content.title, content.text, content.url].filter(Boolean).map(safe).join("\n\n"),
  );
  if ((await choose("Capture", ["Choose destination", "Cancel"])) !== "Choose destination")
    return { state: "cancelled" };
  while (true) {
    const reports = await Promise.all(
      ["office", "atlas"]
        .filter((app) => config[app + "Url"] && (!initialApp || app === initialApp))
        .map(async (app) => ({
          app,
          report: await (deps.capabilities ?? captureCapabilities)(app, config, env),
        })),
    );
    const candidates = [];
    for (const { app, report } of reports) {
      const cap = report.manifest?.capabilities.capture;
      if (
        report.state !== "available" ||
        !cap?.supported ||
        cap.handoff !== "loom-capture-review-v1" ||
        !cap.reviewed
      ) {
        show(`${names[app]}: ${report.detail ?? "Update the app to enable reviewed capture."}`);
        continue;
      }
      for (const target of cap.destinations) {
        if (labels[target] && (app === "office") !== (target === "source"))
          candidates.push({ app, target, cap, cached: report.fromCache });
      }
    }
    const value = await choose("Where should it go?", [
      ...candidates.map((c) => labels[c.target]),
      "Try connection again",
      "Cancel",
    ]);
    if (!value || value === "Cancel") return { state: "cancelled" };
    if (value === "Try connection again") continue;
    const dest = candidates.find((c) => labels[c.target] === value);
    if (!dest) return { state: "cancelled" };
    try {
      const envelope = captureEnvelope(dest.app, dest.target, content, dest.cap, {
        reuse: await (deps.focus ?? focusExistingApp)(dest.app, config, env),
      });
      const spec = reviewedCaptureCommand(envelope, dest.cap, config, env);
      if (dest.cached)
        show(
          "Office will use its previously saved workspace where available. Review before saving.",
        );
      await (
        deps.launch ??
        (async (spec) => {
          const child = cp.spawn(spec.command, spec.args, {
            env: spec.env,
            stdio: "ignore",
            detached: true,
          });
          await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", reject);
          });
          child.unref();
        })
      )(spec);
      await (
        deps.watch ??
        (async (envelope) => {
          const child = cp.spawn(
            process.execPath,
            [paths(env).bin, "capture-watch", envelope.app, envelope.id],
            { env, stdio: "ignore", detached: true },
          );
          child.unref();
        })
      )(envelope);
      return { state: "reviewing", app: dest.app, target: dest.target };
    } catch (e) {
      show(safe(e.message));
      if (
        (await choose("Capture retained here", ["Choose destination again", "Cancel"])) !==
        "Choose destination again"
      )
        return { state: "cancelled" };
    }
  }
}
/** Only nonce-labelled completed/cancelled review windows are owned by this watcher. */
export async function watchCapture(app, id, config, env, { query, pause } = {}) {
  if (!["office", "atlas"].includes(app) || !uuid.test(id)) throw Error("Invalid capture watcher.");
  const identity = `chrome-${new URL(config[app + "Url"]).hostname}__app_share-Default`;
  const run = query ?? ((args) => cp.execFileSync("hyprctl", args, { env, encoding: "utf8" }));
  const wait = pause ?? (() => new Promise((r) => setTimeout(r, 1000)));
  let ownedAddress = "";
  for (let n = 0; n < 1800; n++) {
    const clients = JSON.parse(await run(["clients", "-j"]));
    const owned = clients.find(
      (c) =>
        (c.class === identity || c.initialClass === identity) &&
        /^0x[0-9a-f]+$/i.test(c.address) &&
        c.title.startsWith(`Loom capture ${id}: `),
    );
    if (owned) ownedAddress = owned.address;
    if (ownedAddress && !clients.some((c) => c.address === ownedAddress)) {
      await focusExistingApp(app, config, env);
      return;
    }
    if (owned) {
      const state = owned.title.slice(`Loom capture ${id}: `.length);
      if (state.startsWith("open ")) {
        const encoded = state.slice(5);
        if (encoded.length > 3000 || !/^[-_A-Za-z0-9]+$/.test(encoded))
          throw Error("Invalid capture destination.");
        const route = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (
          typeof route !== "string" ||
          !route.startsWith("/app/?") ||
          /[\\\u0000-\u001f#]/.test(route) ||
          new URL(route, config[app + "Url"]).origin !== new URL(config[app + "Url"]).origin
        )
          throw Error("Invalid capture destination.");
        await launchExactItem(app, new URL(route, config[app + "Url"]), config, env);
      }
      if (["complete", "cancelled"].includes(state) || state.startsWith("open ")) {
        await run([
          "eval",
          `hl.dispatch(hl.dsp.window.close({window="address:${owned.address}"}))`,
        ]);
        await focusExistingApp(app, config, env);
        return;
      }
    }
    await wait();
  }
}
