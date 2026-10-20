// @effect-diagnostics nodeBuiltinImport:off -- Tests independently construct and verify SSH wire signatures with Node crypto.
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SshCrypto from "./SshCrypto.ts";

const setup = Effect.gen(function* () {
  const crypto = yield* SshCrypto.SshCrypto,
    key = yield* crypto.create,
    host = yield* crypto.create;
  const target = { hostname: "example.test", username: "git", port: 22, hostKey: host.publicKey };
  const hostBlob = Buffer.from(host.publicKey.split(" ")[1]!, "base64"),
    keyBlob = Buffer.from(key.publicKey.split(" ")[1]!, "base64"),
    sessionId = Buffer.alloc(32, 7);
  const signature = NodeCrypto.sign(
    null,
    sessionId,
    NodeCrypto.createPrivateKey(Redacted.value(host.privateKey)),
  );
  const bind = Buffer.concat([
    Buffer.from([27]),
    SshCrypto.sshString("session-bind@openssh.com"),
    SshCrypto.sshString(hostBlob),
    SshCrypto.sshString(sessionId),
    SshCrypto.sshString(
      Buffer.concat([SshCrypto.sshString("ssh-ed25519"), SshCrypto.sshString(signature)]),
    ),
    Buffer.from([0]),
  ]);
  const auth = (
    username = target.username,
    method = "publickey-hostbound-v00@openssh.com",
    hostKey = hostBlob,
  ) =>
    Buffer.concat([
      SshCrypto.sshString(sessionId),
      Buffer.from([50]),
      SshCrypto.sshString(username),
      SshCrypto.sshString("ssh-connection"),
      SshCrypto.sshString(method),
      Buffer.from([1]),
      SshCrypto.sshString("ssh-ed25519"),
      SshCrypto.sshString(keyBlob),
      SshCrypto.sshString(hostKey),
    ]);
  const frame = (data: Buffer) =>
    Buffer.concat([
      Buffer.from([13]),
      SshCrypto.sshString(keyBlob),
      SshCrypto.sshString(data),
      SshCrypto.sshUint32(0),
    ]);
  return { crypto, key, host, target, bind, auth, frame };
});
it.effect("signs only a verified host-bound user authentication with the assigned identity", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    const binding = yield* f.crypto.respond({
      ...f.key,
      target: f.target,
      frame: f.bind,
      binding: null,
    });
    const data = f.auth(),
      result = yield* f.crypto.respond({
        ...f.key,
        target: f.target,
        frame: f.frame(data),
        binding: binding.binding,
      });
    expect(result.signed).toBe(true);
    const response = new SshCrypto.SshReader(result.response);
    expect(response.byte()).toBe(14);
    const signature = new SshCrypto.SshReader(response.string());
    expect(signature.string().toString()).toBe("ssh-ed25519");
    expect(
      NodeCrypto.verify(
        null,
        data,
        NodeCrypto.createPublicKey(Redacted.value(f.key.privateKey)),
        signature.string(),
      ),
    ).toBe(true);
    expect(yield* f.crypto.fingerprint(f.key.publicKey)).toMatch(/^SHA256:/);
  }).pipe(Effect.provide(SshCrypto.layer)),
);
it.effect("rejects generic signing, wrong users, changed host keys and unbound sessions", () =>
  Effect.gen(function* () {
    const f = yield* setup,
      binding = yield* f.crypto.respond({
        ...f.key,
        target: f.target,
        frame: f.bind,
        binding: null,
      });
    for (const data of [
      Buffer.from("arbitrary"),
      f.auth("other"),
      f.auth("git", "publickey"),
      f.auth("git", undefined, Buffer.alloc(51)),
    ]) {
      expect(
        (yield* f.crypto
          .respond({ ...f.key, target: f.target, frame: f.frame(data), binding: binding.binding })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-key");
    }
    expect(
      (yield* f.crypto
        .respond({ ...f.key, target: f.target, frame: f.frame(f.auth()), binding: null })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-key");
  }).pipe(Effect.provide(SshCrypto.layer)),
);
it.effect("rejects forged and forwarded host binding, wrong pins and malformed keys", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    const forged = Buffer.from(f.bind);
    forged[forged.length - 2] = forged[forged.length - 2]! ^ 1;
    const forwarded = Buffer.from(f.bind);
    forwarded[forwarded.length - 1] = 1;
    for (const frame of [forged, forwarded, Buffer.from([27])])
      expect(
        (yield* f.crypto
          .respond({ ...f.key, target: f.target, frame, binding: null })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-key");
    expect(
      (yield* f.crypto
        .respond({
          ...f.key,
          target: { ...f.target, hostKey: f.key.publicKey },
          frame: f.bind,
          binding: null,
        })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-key");
    expect(
      (yield* f.crypto.fingerprint("ssh-ed25519 " + "A".repeat(68)).pipe(Effect.flip)).reason,
    ).toBe("invalid-key");
  }).pipe(Effect.provide(SshCrypto.layer)),
);
