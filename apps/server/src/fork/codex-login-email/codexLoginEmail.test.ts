// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { emailFromCodexAuth, withCodexLoginEmail } from "./codexLoginEmail.ts";

const idToken = (claims: object) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const authJson = (claims: object) =>
  JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: idToken(claims) } });

const ready: { readonly status: string; readonly auth: ServerProvider["auth"] } = {
  status: "ready",
  auth: { status: "unknown" },
};

describe("emailFromCodexAuth", () => {
  it("reads the email claim of a ChatGPT login", () => {
    expect(emailFromCodexAuth(authJson({ email: "kid@example.com" }))).toBe("kid@example.com");
  });

  it("ignores API-key logins and malformed files", () => {
    expect(
      emailFromCodexAuth(JSON.stringify({ OPENAI_API_KEY: "x", tokens: null })),
    ).toBeUndefined();
    expect(emailFromCodexAuth(authJson({ sub: "no-email" }))).toBeUndefined();
    expect(emailFromCodexAuth("{not json")).toBeUndefined();
  });
});

describe("withCodexLoginEmail", () => {
  it.effect("names a signed-in home that Codex reported without an account", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-")),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(home, "auth.json"), authJson({ email: "kid@example.com" })),
      );
      const result = yield* withCodexLoginEmail(
        ready,
        { account: { account: null } },
        { homePath: home },
      );
      expect(result.auth.email).toBe("kid@example.com");
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true }));
    }),
  );

  it.effect("keeps what Codex reported", () =>
    Effect.gen(function* () {
      const reported = {
        status: "ready",
        auth: { status: "authenticated", email: "a@example.com" },
      } as const;
      const result = yield* withCodexLoginEmail(
        reported,
        { account: { account: { type: "chatgpt" } } },
        { homePath: "/nonexistent" },
      );
      expect(result).toBe(reported);
    }),
  );

  it.effect("does not guess a home the instance did not name", () =>
    Effect.gen(function* () {
      const result = yield* withCodexLoginEmail(
        ready,
        { account: { account: null } },
        { homePath: "" },
      );
      expect(result).toBe(ready);
    }),
  );

  it.effect("leaves the status alone when the home has no login", () =>
    Effect.gen(function* () {
      const result = yield* withCodexLoginEmail(
        ready,
        { account: { account: null } },
        { homePath: "/nonexistent/codex" },
      );
      expect(result).toBe(ready);
    }),
  );
});
