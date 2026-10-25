import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as ProcessRunner from "../../processRunner.ts";
import * as SshCrypto from "./SshCrypto.ts";
import * as PinnedHostKeys from "./PinnedHostKeys.ts";

it.effect("resolves aliases, ports, hashed entries and trust sources without connecting", () =>
  Effect.gen(function* () {
    const crypto = yield* SshCrypto.SshCrypto;
    const global = yield* crypto.create;
    const tofu = yield* crypto.create;
    const revoked = yield* crypto.create;
    const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    const resolver = yield* PinnedHostKeys.make.pipe(
      Effect.provide(
        FileSystem.layerNoop({ exists: (file) => Effect.succeed(file !== "/fixture/missing") }),
      ),
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return {
              code: 0,
              stdout:
                input.command === "ssh"
                  ? 'hostname example.test\nglobalknownhostsfile /fixture/missing "/fixture/home/pinned hosts"\nuserknownhostsfile ~/.ssh/known_hosts\n'
                  : input.args.includes("/fixture/home/pinned hosts")
                    ? `# Host found\n|1|hash|hash ${global.publicKey}\n|1|hash|hash ${revoked.publicKey}\n`
                    : `example.test ${tofu.publicKey}\n@revoked example.test ${revoked.publicKey}\n@cert-authority example.test ${global.publicKey}\n`,
              stderr: "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            } as ProcessRunner.ProcessRunOutput;
          }),
      }),
    );
    const result = yield* resolver.resolve({ hostname: "alias", port: 2222 });
    expect(result.map((key) => [key.source, key.publicKey])).toEqual([
      ["global", global.publicKey],
      ["user", tofu.publicKey],
    ]);
    expect(result[0]).toMatchObject({
      hostname: "example.test",
      sourceFile: "/fixture/home/pinned hosts",
      fingerprint: yield* crypto.fingerprint(global.publicKey),
    });
    expect(calls[0]?.args).toEqual(["-G", "-o", "CanonicalizeHostname=no", "-p", "2222", "alias"]);
    expect(
      calls
        .slice(1)
        .every((call) => call.command === "ssh-keygen" && call.args[1] === "[example.test]:2222"),
    ).toBe(true);
    expect(
      (yield* resolver.resolve({ hostname: "-oProxyCommand=bad", port: 22 }).pipe(Effect.flip))
        .reason,
    ).toBe("invalid-key");
    expect(calls).toHaveLength(3);
  }).pipe(
    Effect.provideService(HostProcess.HomeDirectory, "/fixture/home"),
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provide(Layer.merge(NodeServices.layer, SshCrypto.layer)),
  ),
);

it.effect("returns no import candidates when this computer has no matching keys", () =>
  Effect.gen(function* () {
    const resolver = yield* PinnedHostKeys.make.pipe(
      Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(true) })),
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.succeed({
            code: input.command === "ssh" ? 0 : 1,
            stdout: "hostname example.test\nuserknownhostsfile /fixture/known_hosts\n",
            stderr: "",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          } as ProcessRunner.ProcessRunOutput),
      }),
    );
    expect(yield* resolver.resolve({ hostname: "example.test", port: 22 })).toEqual([]);
  }).pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provide(Layer.merge(NodeServices.layer, SshCrypto.layer)),
  ),
);

it.effect("uses HostKeyAlias verbatim for a non-default port", () =>
  Effect.gen(function* () {
    const calls: ReadonlyArray<string>[] = [];
    const resolver = yield* PinnedHostKeys.make.pipe(
      Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(true) })),
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.sync(() => {
            calls.push(input.args);
            return {
              code: input.command === "ssh" ? 0 : 1,
              stdout:
                "hostname example.test\nhostkeyalias verified-alias\nuserknownhostsfile /fixture/known_hosts\n",
              stderr: "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            } as ProcessRunner.ProcessRunOutput;
          }),
      }),
    );
    expect(yield* resolver.resolve({ hostname: "alias", port: 2222 })).toEqual([]);
    expect(calls[1]).toEqual(["-F", "verified-alias", "-f", "/fixture/known_hosts"]);
  }).pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provide(Layer.merge(NodeServices.layer, SshCrypto.layer)),
  ),
);
