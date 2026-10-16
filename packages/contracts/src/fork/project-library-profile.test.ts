import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { LibraryProject, LibraryUpdateProjectRequest } from "./project-library.ts";
import {
  LIBRARY_PROFILE_LIMITS,
  LIBRARY_TOOL_CATALOG,
  LibraryProjectProfile,
  LibraryProjectProfileInput,
  libraryProfileAddedUnknownTools,
  libraryProfileSecretValueField,
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
// LibraryProject as a computer from before profiles knew it.
const { profile: _added, ...olderFields } = LibraryProject.fields;
const decodeOlder = Schema.decodeUnknownSync(Schema.Struct(olderFields));

describe("LibraryProjectProfile", () => {
  it("round-trips a full profile through the saved project JSON exactly", () => {
    const codec = Schema.fromJsonString(LibraryProject);
    const decoded = Schema.decodeUnknownSync(codec)(JSON.stringify(project));
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
    for (const name of [
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
      "ghp_abcdefghijklmnopqrstuvwxyz0123",
      "sk-ant-api03-abcdefghijklmnop",
      "AKIAIOSFODNN7EXAMPLE",
      "my token",
      "2FA",
    ])
      expect(accepts({ secretNames: [name] })).toBe(false);
    // Free-text script fields refuse credential-shaped text but keep references to secrets.
    const withCommand = (command: string, extra: object = {}) => ({
      scripts: [{ ...profile.scripts[0], command, ...extra }],
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
      expect(accepts(withCommand(command))).toBe(true);
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
      expect(accepts(withCommand(command))).toBe(false);
    expect(accepts(withCommand("pnpm dev", { previewUrl: "https://me:pass@host.dev" }))).toBe(
      false,
    );
    expect(
      accepts({
        defaultModelSelection: {
          instanceId: "codex",
          model: "gpt-6",
          options: [{ id: "key", value: "sk-abc123defghijklmnopqrstu" }],
        },
      }),
    ).toBe(false);
    expect(accepts({ preferredEnvironmentIds: ["ghp_abcdefghijklmnopqrstuvwxyz0123"] })).toBe(
      false,
    );
  });

  it("names the offending field without echoing its value", () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
    const field = libraryProfileSecretValueField({
      scripts: [{ ...profile.scripts[0]!, name: secret, icon: "play" }],
    });
    expect(field).toBe("Script 1");
    expect(() =>
      decodeInput({ secretNames: [], scripts: [{ ...profile.scripts[0], name: secret }] }),
    ).toThrow(/Script 1 looks like it holds a secret/);
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
