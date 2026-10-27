import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import { reachLibraryAdvertised } from "./advertised.ts";
import {
  credentialFileState,
  reachLibraryConfig,
  readReachCredential,
  reachZoneFromEnv,
} from "./credentials.ts";

const withFile = <A, E>(
  contents: string,
  mode: number,
  use: (file: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-reach-credential-" });
    const file = `${directory}/credential`;
    yield* fs.writeFileString(file, contents);
    yield* fs.chmod(file, mode);
    return yield* use(file);
  }).pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

const reasonOf = (file: string | null) =>
  readReachCredential(file).pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("reach credentials", () => {
  it.effect("reads a private file's single value, trimmed, as a redacted value", () =>
    withFile("  token-value\n", 0o600, (file) =>
      Effect.gen(function* () {
        const value = yield* readReachCredential(file);
        expect(Redacted.value(value)).toBe("token-value");
        expect(String(value)).not.toContain("token-value");
        expect(yield* credentialFileState(file)).toBe("ready");
      }),
    ),
  );

  it.effect("refuses a file group or other users can read", () =>
    Effect.gen(function* () {
      for (const mode of [0o640, 0o604, 0o644]) {
        yield* withFile("token-value", mode, (file) =>
          Effect.gen(function* () {
            expect(yield* reasonOf(file)).toBe("refused");
            expect(yield* credentialFileState(file)).toBe("refused");
          }),
        );
      }
    }),
  );

  it.effect("refuses an oversized file and one with inner whitespace or no value", () =>
    Effect.gen(function* () {
      for (const contents of ["a".repeat(16_385), "token value", "two\nlines", "   \n"]) {
        yield* withFile(contents, 0o600, (file) =>
          Effect.gen(function* () {
            expect(yield* reasonOf(file)).toBe("refused");
          }),
        );
      }
    }),
  );

  it.effect("reports an unset variable or an absent file as missing", () =>
    withFile("token-value", 0o600, (file) =>
      Effect.gen(function* () {
        expect(yield* reasonOf(null)).toBe("missing");
        expect(yield* reasonOf(`${file}-absent`)).toBe("missing");
        expect(yield* credentialFileState(`${file}-absent`)).toBe("missing");
      }),
    ),
  );

  it("accepts only a lowercase zone with room for every hostname", () => {
    expect(reachZoneFromEnv({ LOOM_REACH_ZONE: " reach.example.com " })).toBe("reach.example.com");
    for (const zone of [
      undefined,
      "",
      "example",
      "Reach.Example.com",
      'reach.example.com" or true',
      "reach..example.com",
      "127.0.0.1",
      `${"a".repeat(240)}.com`,
    ]) {
      expect(reachZoneFromEnv({ LOOM_REACH_ZONE: zone })).toBeNull();
    }
  });

  it("advertises reach only on a directory authority with a zone and a token file", () => {
    const library = {
      LOOM_LIBRARY_AUTHORITY: "true",
      LOOM_IDENTITY_REDIRECT_URI: "https://library.example.com/api/auth/identity/callback",
      LOOM_REACH_ZONE: "reach.example.com",
      LOOM_REACH_CLOUDFLARE_TOKEN_FILE: "/etc/loom/cloudflare-token",
    };
    expect(reachLibraryAdvertised(library)).toBe(true);
    expect(reachLibraryConfig(library).audience).toBe("https://library.example.com");
    expect(reachLibraryAdvertised({ ...library, LOOM_LIBRARY_AUTHORITY: "false" })).toBe(false);
    expect(reachLibraryAdvertised({ ...library, LOOM_REACH_ZONE: "Bad Zone" })).toBe(false);
    expect(reachLibraryAdvertised({ ...library, LOOM_REACH_CLOUDFLARE_TOKEN_FILE: " " })).toBe(
      false,
    );
    expect(
      reachLibraryAdvertised({ ...library, LOOM_IDENTITY_REDIRECT_URI: "http://library.local/cb" }),
    ).toBe(false);
  });

  it("advertises the records list on a Library that prepares Loom sign-in without a zone", () => {
    const library = {
      LOOM_LIBRARY_AUTHORITY: "true",
      LOOM_IDENTITY_REDIRECT_URI: "https://library.example.com/api/auth/identity/callback",
      LOOM_IDENTITY_ISSUER: "https://id.example.com",
      LOOM_IDENTITY_NATIVE_CLIENT_ID: "loom-native",
      LOOM_IDENTITY_ADMIN_API_KEY_FILE: "/etc/loom/pocket-id-key",
    };
    expect(reachLibraryAdvertised(library)).toBe(true);
    expect(reachLibraryAdvertised({ ...library, LOOM_LIBRARY_AUTHORITY: "false" })).toBe(false);
    for (const unset of [
      "LOOM_IDENTITY_ISSUER",
      "LOOM_IDENTITY_NATIVE_CLIENT_ID",
      "LOOM_IDENTITY_ADMIN_API_KEY_FILE",
    ]) {
      expect(reachLibraryAdvertised({ ...library, [unset]: undefined })).toBe(false);
    }
    expect(reachLibraryAdvertised({ ...library, LOOM_IDENTITY_ISSUER: "http://id.local" })).toBe(
      false,
    );
  });
});
