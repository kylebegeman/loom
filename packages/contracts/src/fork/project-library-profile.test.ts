import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { LibraryError, LibraryProject, LibraryUpdateProjectRequest } from "./project-library.ts";
import {
  LIBRARY_PROFILE_LIMITS,
  LIBRARY_TOOL_CATALOG,
  LibraryProjectProfile,
  LibraryProjectProfileInput,
  libraryProfileAddedUnknownTools,
  libraryProfileSecretValueField,
  libraryProfileUnknownToolsMessage,
  looksLikeSecretValue,
} from "./project-library-profile.ts";

const profile = {
  scripts: [
    {
      id: "dev",
      name: "Dev server",
      command: "pnpm dev",
      icon: "play",
      runOnWorktreeCreate: false,
      previewUrl: "http://localhost:5173",
    },
    {
      id: "setup",
      name: "Install",
      command: "pnpm i",
      icon: "configure",
      runOnWorktreeCreate: true,
    },
  ],
  defaultModelSelection: {
    instanceId: "codex",
    model: "gpt-6",
    options: [{ id: "effort", value: "high" }],
  },
  requiredTools: [{ id: "node", minimumVersion: "22.4" }, { id: "pnpm" }],
  secretNames: ["GITHUB_TOKEN", "OPENAI_API_KEY"],
  preferredEnvironmentIds: ["mac-studio"],
  allowMini: true,
};
const project = {
  id: "project-1",
  title: "Loom",
  brief: "Build it.",
  revision: 2,
  resources: [],
  profile,
  archived: false,
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
};
const accepts = Schema.is(LibraryProjectProfileInput);
const decodeInput = Schema.decodeUnknownSync(LibraryProjectProfileInput);
const reads = Schema.is(LibraryProjectProfile);
// Plain literals stand in for branded ids, and the ghp_ name is one the schema would refuse.
const secretField = (value: object, saved?: object) =>
  libraryProfileSecretValueField(
    value as LibraryProjectProfileInput,
    saved as LibraryProjectProfileInput | undefined,
  );
// LibraryProject as a computer from before profiles knew it.
const { profile: _added, ...olderFields } = LibraryProject.fields;
const decodeOlder = Schema.decodeUnknownSync(Schema.Struct(olderFields));

describe("LibraryProjectProfile", () => {
  it("round-trips a full profile through the saved project JSON exactly", () => {
    const codec = Schema.fromJsonString(LibraryProject);
    const decoded = Schema.decodeSync(codec)(JSON.stringify(project));
    expect(decoded.profile).toEqual(profile);
    expect(JSON.parse(Schema.encodeSync(codec)(decoded))).toEqual(project);
    expect(decodeInput(profile)).toEqual(profile);
  });

  it("is dropped, not rejected, by a computer that predates it", () => {
    const older = decodeOlder(project);
    expect("profile" in older).toBe(false);
    expect(older.title).toBe("Loom");
  });

  it("rejects tool ids outside the catalog unless the project already has them", () => {
    for (const tool of LIBRARY_TOOL_CATALOG)
      expect(accepts({ requiredTools: [{ id: tool.id }] })).toBe(true);
    // Only id-shaped text gets through the schema; never a command.
    for (const id of ["node; rm -rf /", "$(whoami)", "Node", "", "a".repeat(33)])
      expect(accepts({ requiredTools: [{ id }] })).toBe(false);
    expect(accepts({ requiredTools: [{ id: "node" }, { id: "node" }] })).toBe(false);
    expect(reads({ requiredTools: [{ id: "zig" }] })).toBe(true);
    expect(reads({ requiredTools: [{ id: "zig; curl" }] })).toBe(false);
    // A well-formed id outside the catalog is new unless a newer catalog already saved it.
    const tools = { requiredTools: [{ id: "node" }, { id: "curl" }, { id: "zig" }] };
    expect(libraryProfileAddedUnknownTools(tools, undefined)).toEqual(["curl", "zig"]);
    expect(libraryProfileAddedUnknownTools(tools, { requiredTools: [{ id: "zig" }] })).toEqual([
      "curl",
    ]);
  });

  it("accepts only plain version numbers as a minimum", () => {
    for (const minimumVersion of ["20", "3.12", "16.0.1", "1.2.3.4"])
      expect(accepts({ requiredTools: [{ id: "node", minimumVersion }] })).toBe(true);
    for (const minimumVersion of ["", ">=20", "latest", "20 && curl x", "1.2.3.4.5"])
      expect(accepts({ requiredTools: [{ id: "node", minimumVersion }] })).toBe(false);
  });

  it("bounds every list and the whole profile", () => {
    const script = (index: number) => ({
      id: `s${index}`,
      name: `Script ${index}`,
      command: "pnpm test",
      icon: "test",
      runOnWorktreeCreate: false,
    });
    const many = <A>(count: number, make: (index: number) => A) =>
      Array.from({ length: count }, (_, index) => make(index));
    const limits = LIBRARY_PROFILE_LIMITS;
    expect(accepts({ scripts: many(limits.scripts, script) })).toBe(true);
    expect(accepts({ scripts: many(limits.scripts + 1, script) })).toBe(false);
    expect(accepts({ secretNames: many(limits.secretNames + 1, (i) => `NAME_${i}`) })).toBe(false);
    expect(
      accepts({
        preferredEnvironmentIds: many(limits.preferredEnvironmentIds + 1, (i) => `c${i}`),
      }),
    ).toBe(false);
    expect(
      accepts({ scripts: [{ ...script(0), command: `echo ${"a".repeat(limits.bytes)}` }] }),
    ).toBe(false);
  });

  it("has no field that can hold a secret value", () => {
    // Secret names are environment variable names: no assignment, spaces or lowercase tokens.
    for (const name of ["GITHUB_TOKEN", "_PRIVATE", "API_KEY_2"])
      expect(accepts({ secretNames: [name] })).toBe(true);
    for (const name of ["GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123", "my token", "2FA"])
      expect(accepts({ secretNames: [name] })).toBe(false);
    // Name-shaped values pass the schema, so the Library refuses them by their shape.
    for (const name of ["ghp_abcdefghijklmnopqrstuvwxyz0123", "AKIAIOSFODNN7EXAMPLE"])
      expect(secretField({ secretNames: [name] })).toBe("A secret name");
    // Free-text script fields refuse credential-shaped text but keep references to secrets.
    const withCommand = (command: string, extra: object = {}) => ({
      scripts: [{ ...profile.scripts[0]!, command, icon: "play" as const, ...extra }],
    });
    for (const command of [
      "GITHUB_TOKEN=$GITHUB_TOKEN pnpm release",
      "NODE_ENV=production pnpm build",
      'deploy --token "$TOKEN"',
      "pnpm test",
      "SECRET=`op read op://vault/item` pnpm deploy",
      'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com',
      "psql postgres://app:$DB_PASSWORD@localhost/app",
      "pnpm --filter @acme/sk-design-system-components build",
      "MAX_TOKENS=4096 TOKEN_FILE=./token pnpm eval",
      "ssh://git@github.com:22/acme/app.git",
    ])
      expect(secretField(withCommand(command))).toBeNull();
    for (const command of [
      "GITHUB_TOKEN=abc123 pnpm release",
      "deploy --password=hunter2",
      "curl -H 'Authorization: Bearer sk-proj-abcdefghijklmnopqrstu' api",
      "curl -H 'Authorization: Bearer 4f9c2e1ab7d3e8f60a5b' api",
      "STRIPE_KEY=$KEY stripe listen --api-key sk_live_51Habcdefghij",
      "npm publish --//registry.npmjs.org/:_authToken npm_abcdefghijklmnopqrstuvwxyz0123456789",
      "huggingface-cli login hf_abcdefghijklmnopqrstuvwxyz0123",
      "git clone https://kyle:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/x/y",
      "echo '-----BEGIN OPENSSH PRIVATE KEY-----'",
    ])
      expect(secretField(withCommand(command))).toBe("Script 1");
    expect(secretField(withCommand("pnpm dev", { previewUrl: "https://me:pass@host.dev" }))).toBe(
      "Script 1",
    );
    expect(
      secretField({
        defaultModelSelection: {
          instanceId: "codex",
          model: "gpt-6",
          options: [{ id: "key", value: "sk-abc123defghijklmnopqrstu" }],
        },
      }),
    ).toBe("The default model");
    expect(secretField({ preferredEnvironmentIds: ["ghp_abcdefghijklmnopqrstuvwxyz0123"] })).toBe(
      "A preferred computer",
    );
  });

  it("flags opaque random literals but not paths, hashes or identifiers", () => {
    // Random 40-character base62 and base64url tokens with no known prefix.
    for (const token of [
      "CGu46u5amB4HBpUsiU7g78UdCQgxY956Zsn2IBAT",
      "034EoYiAKt9DsyMalKxX3ZRbiGkW7xiK2fbYgKXg",
      "jkTFulcxsfR2GVqKcDuBhiYn9NbZJXmM9eIFx470",
      "aEPx-3lnKv0PJ3AGowrq9FPRyBYm_xQPGST2qldW",
      "AqWM2pE5PjIGPO07O1Oa6_WqBnepyjgseJSyUjfw",
    ]) {
      expect(looksLikeSecretValue(token)).toBe(true);
      expect(looksLikeSecretValue(`deploy --key ${token} --region us-east-1`)).toBe(true);
      expect(looksLikeSecretValue(`DEPLOY_HOOK=${token} ./ship`)).toBe(true);
      expect(looksLikeSecretValue(`curl "https://hooks.example.com/run?key=${token}"`)).toBe(true);
    }
    for (const text of [
      // Paths and hosts, even with a random-looking segment.
      "/Users/kyle/Library/Developer/CoreSimulator/Devices/CGu46u5amB4HBpUsiU7g78UdCQgxY956Zsn2IBAT/data",
      "./build/034EoYiAKt9DsyMalKxX3ZRbiGkW7xiK2fbYgKXg.tar.gz",
      "https://cdn.example.com/assets/jkTFulcxsfR2GVqKcDuBhiYn9NbZJXmM9eIFx470/app.js",
      "jkTFulcxsfR2GVqKcDuBhiYn9NbZJXmM9eIFx470.example.com",
      // Identifiers and hashes.
      "550e8400-e29b-41d4-a716-446655440000",
      "6F9619FF-8B86-D011-B42D-00CF4FC964FF",
      "git checkout 3f786850e387550fdab836ed7e6dc881de23001b",
      "docker pull node@sha256:2a9e5ad0c3b8f0dc1e1a4d0e5c3a2b6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b",
      "LibraryProjectProfileInputDecodeFailureForEnvironment",
      "useLibraryProjectProfileV2ForEnvironment2026",
      "AWSLambdaBasicExecutionRole2024Policy",
      "createProjectLibraryAtomsForEnvironment3",
      "pnpm --filter @acme/design-system-components-for-marketing-site build",
      "xcodebuild -scheme MyApplicationTests2-iPhone15ProMaxSimulator test",
      "TestFlightBuild2026-10-16-ReleaseCandidate3",
      "x86_64-unknown-linux-gnu-ReleaseWithDebInfo2",
      "NODE_OPTIONS=--max-old-space-size=8192 pnpm build",
      "CLOUDFLARE_ACCOUNT_IDENTIFIER_FOR_PRODUCTION_DEPLOYS_2026 pnpm deploy",
      "deploy --token $CGu46u5amB4HBpUsiU7g78UdCQgxY956Zsn2IBAT",
      'deploy --token "${DEPLOY_TOKEN_FOR_PRODUCTION_2026}"',
      // Short tokens and repeated placeholders are left to the known shapes.
      "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr",
      "Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0Xx0",
    ])
      expect(looksLikeSecretValue(text)).toBe(false);
  });

  it("checks only entries a save adds, so an unchanged profile can always be resent", () => {
    const token = "CGu46u5amB4HBpUsiU7g78UdCQgxY956Zsn2IBAT";
    const flagged = {
      ...profile.scripts[0]!,
      icon: "play" as const,
      command: `deploy --key ${token}`,
    };
    const saved = {
      scripts: [flagged],
      defaultModelSelection: { instanceId: "codex", model: token },
      preferredEnvironmentIds: [token],
      secretNames: ["NAME"],
    };
    expect(secretField(saved)).toBe("Script 1");
    expect(secretField(saved, saved)).toBeNull();
    // Keeping old entries while changing others is fine; a new flagged entry is named.
    expect(secretField({ ...saved, scripts: [flagged, profile.scripts[1]!] }, saved)).toBeNull();
    expect(secretField({ ...saved, scripts: [flagged, { ...flagged, id: "copy" }] }, saved)).toBe(
      "Script 2",
    );
    expect(
      secretField(
        { ...saved, defaultModelSelection: { instanceId: "codex", model: `${token}x` } },
        saved,
      ),
    ).toBe("The default model");
    expect(secretField({ ...saved, preferredEnvironmentIds: [token, `x${token}`] }, saved)).toBe(
      "A preferred computer",
    );
  });

  it("explains a refused save in the error message, never the secret itself", () => {
    expect(libraryProfileUnknownToolsMessage(["zig", "curl"])).toMatch(
      /^This Library does not know the required tools "zig", "curl"\. Use tool ids from git, node,/,
    );
    const error = new LibraryError({
      reason: "invalid",
      cause: libraryProfileUnknownToolsMessage(["zig"]),
    });
    expect(error.message).toMatch(/required tool "zig"/);
    // The detail survives the trip to an RPC client.
    const codec = Schema.fromJsonString(LibraryError);
    const decoded = Schema.decodeSync(codec)(Schema.encodeSync(codec)(error));
    expect(decoded.message).toBe(error.message);
    // An invalid error from a caught failure keeps the generic text.
    expect(new LibraryError({ reason: "invalid", cause: new Error("x") }).message).toMatch(
      /^Review the project/,
    );
  });

  it("names the offending field without echoing its value", () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
    const field = libraryProfileSecretValueField({
      scripts: [{ ...profile.scripts[0]!, name: secret, icon: "play" }],
    });
    expect(field).toBe("Script 1");
  });

  it("lets an update keep, replace or remove the profile", () => {
    const decode = Schema.decodeUnknownSync(LibraryUpdateProjectRequest);
    const base = {
      requestId: "r",
      projectId: "project-1",
      expectedRevision: 1,
      title: "Loom",
      brief: "",
      resources: [],
    };
    expect("profile" in decode(base)).toBe(false);
    expect(decode({ ...base, profile: null }).profile).toBeNull();
    expect(decode({ ...base, profile }).profile).toEqual(profile);
    expect(() => decode({ ...base, profile: { requiredTools: [{ id: "curl; sh" }] } })).toThrow();
  });
});
