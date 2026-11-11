// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { expect, it } from "vite-plus/test";
import { proxyConfig } from "./proxy.ts";

async function withProvider(command: string, check: (codexHome: string) => void) {
  const codexHome = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-eval-proxy-"));
  try {
    await NodeFSP.writeFile(
      NodePath.join(codexHome, "config.toml"),
      `
[model_providers.fixture]
base_url = "https://gateway.example.test/v1/"
[model_providers.fixture.auth]
command = ${JSON.stringify(NodeProcess.execPath)}
args = ["-e", ${JSON.stringify(command)}]
timeout_ms = 5000
`,
    );
    check(codexHome);
  } finally {
    await NodeFSP.rm(codexHome, { recursive: true, force: true });
  }
}
const fixtureEnv = () => ({
  ...NodeProcess.env,
  T3_EVAL_CODEX_PROVIDER: "fixture",
  T3_EVAL_PROXY_API_KEY: "",
});

it("uses the configured credential helper and trims its bearer token", async () => {
  await withProvider("process.stdout.write('  fixture-token ')", (codexHome) => {
    expect(proxyConfig({ codexHome, env: fixtureEnv() })).toEqual({
      url: "https://gateway.example.test/v1",
      headers: { Authorization: "Bearer fixture-token" },
    });
  });
});

it("does not expose credential helper output when authentication fails", async () => {
  await withProvider("process.stderr.write('fixture-secret'); process.exit(1)", (codexHome) => {
    let failure: unknown;
    try {
      proxyConfig({ codexHome, env: fixtureEnv() });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Provider authentication command failed");
    expect(String(failure)).not.toContain("fixture-secret");
  });
});

it("uses an explicit eval key without running the configured helper", async () => {
  await withProvider("process.exit(1)", (codexHome) => {
    expect(
      proxyConfig({ codexHome, env: { ...fixtureEnv(), T3_EVAL_PROXY_API_KEY: "explicit-token" } })
        .headers.Authorization,
    ).toBe("Bearer explicit-token");
  });
});
