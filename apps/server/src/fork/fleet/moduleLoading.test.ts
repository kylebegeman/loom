import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

it("loads the server's orchestrator service with native ESM dependency ordering", async () => {
  const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('./src/mcp/OrchestratorMcpService.ts'); process.stdout.write('loaded');",
    ],
    { cwd: NodeURL.fileURLToPath(new URL("../../..", import.meta.url)) },
  );
  expect(stdout).toBe("loaded");
});
