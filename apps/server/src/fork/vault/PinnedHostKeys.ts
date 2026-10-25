import {
  VaultSshError,
  VaultSshPinnedKeysInput,
  VaultSshPublicKey,
  type VaultSshPinnedKey,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../../processRunner.ts";
import * as SshCrypto from "./SshCrypto.ts";

export class PinnedHostKeys extends Context.Service<
  PinnedHostKeys,
  {
    readonly resolve: (
      input: VaultSshPinnedKeysInput,
    ) => Effect.Effect<ReadonlyArray<VaultSshPinnedKey>, VaultSshError>;
  }
>()("t3/fork/vault/PinnedHostKeys") {}

const isInput = Schema.is(VaultSshPinnedKeysInput);
const isKey = Schema.is(VaultSshPublicKey);
export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const keys = yield* SshCrypto.SshCrypto;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const run = Effect.fn("PinnedHostKeys.command")((command: string, args: ReadonlyArray<string>) =>
    runner
      .run({
        command,
        args,
        cwd: home,
        timeout: 5000,
        maxOutputBytes: 65536,
        outputMode: "error",
      })
      .pipe(Effect.mapError(() => new VaultSshError({ reason: "failed" }))),
  );
  return PinnedHostKeys.of({
    resolve: Effect.fn("PinnedHostKeys.resolve")(function* (input) {
      if (!isInput(input)) return yield* new VaultSshError({ reason: "invalid-key" });
      if (platform === "win32") return yield* new VaultSshError({ reason: "unsupported" });
      // Resolve this server's configuration only. Never scan the network or import another computer's trust.
      const config = yield* run("ssh", [
        "-G",
        "-o",
        "CanonicalizeHostname=no",
        "-p",
        String(input.port),
        input.hostname,
      ]);
      if (config.code !== 0) return yield* new VaultSshError({ reason: "failed" });
      const fields = new Map(
        config.stdout.split(/\r?\n/).map((line) => {
          const index = line.indexOf(" ");
          return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
        }),
      );
      const hostname = fields.get("hostname") ?? input.hostname;
      if (!isInput({ hostname, port: input.port }))
        return yield* new VaultSshError({ reason: "invalid-key" });
      const alias = fields.get("hostkeyalias");
      const lookup =
        alias && alias !== "none"
          ? alias
          : input.port === 22
            ? hostname
            : `[${hostname}]:${input.port}`;
      const candidates: VaultSshPinnedKey[] = [];
      const revoked = new Set<string>();
      for (const [field, source] of [
        ["globalknownhostsfile", "global"],
        ["userknownhostsfile", "user"],
      ] as const) {
        // ssh -G quotes paths containing spaces. Do not ask a shell to interpret configuration text.
        const files = (fields.get(field) ?? "").match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? [];
        for (const raw of files.slice(0, 16)) {
          const name = raw.replace(/^["']|["']$/g, "");
          if (name === "none" || name === "/dev/null") continue;
          const expanded = name
            .replace(/^~(?=\/|$)/, home)
            .replaceAll("%d", home)
            .replaceAll("%h", hostname)
            .replaceAll("%p", String(input.port));
          if (expanded.includes("%") || !path.isAbsolute(expanded)) continue;
          if (
            !(yield* fs
              .exists(expanded)
              .pipe(Effect.mapError(() => new VaultSshError({ reason: "failed" }))))
          )
            continue;
          const found = yield* run("ssh-keygen", ["-F", lookup, "-f", expanded]);
          if (found.code === 1) continue;
          if (found.code !== 0) return yield* new VaultSshError({ reason: "failed" });
          for (const line of found.stdout.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === "@cert-authority") continue;
            const offset = parts[0] === "@revoked" ? 1 : 0;
            const publicKey = `${parts[1 + offset]} ${parts[2 + offset]}`;
            if (!isKey(publicKey)) continue;
            if (offset) {
              revoked.add(publicKey);
              continue;
            }
            const fingerprint = yield* keys.fingerprint(publicKey);
            if (
              !candidates.some((key) => key.publicKey === publicKey && key.sourceFile === expanded)
            )
              candidates.push({
                publicKey,
                fingerprint,
                sourceFile: expanded,
                source,
                hostname,
                port: input.port,
              });
          }
        }
      }
      return candidates.filter((key) => !revoked.has(key.publicKey)).slice(0, 32);
    }),
  });
});
export const layer = Layer.effect(PinnedHostKeys, make).pipe(
  Layer.provide(Layer.merge(ProcessRunner.layer, SshCrypto.layer)),
);
