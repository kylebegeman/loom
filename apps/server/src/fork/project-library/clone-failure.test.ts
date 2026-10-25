import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { libraryCloneFailure } from "./clone-failure.ts";
const input = {
  environmentId: EnvironmentId.make("test-host"),
  computer: "Build computer",
  remoteUrl: "https://github.com/team/repo.git",
  timedOut: false,
};
it.each([
  [
    "fatal: Authentication failed for 'https://secret@github.com/team/repo'",
    "Git authentication failed",
  ],
  ["git@github.com: Permission denied (publickey).", "Git authentication failed"],
  ["Host key verification failed.", "SSH host key is not verified"],
  [
    "fatal: repository 'https://secret@github.com/team/repo' not found",
    "repository could not be reached",
  ],
])("classifies clone failures without leaking stderr: %s", (stderr, message) => {
  const error = libraryCloneFailure({ ...input, stderr });
  expect(error.reason).toBe("blocked");
  expect(error.message).toContain(message);
  expect(error.message).toContain(input.computer);
  expect(JSON.stringify(error)).not.toContain("secret@");
  expect(error.repair).toMatchObject({
    kind: "github-host-setup",
    environmentId: input.environmentId,
    agentTool: "loom_github_host_setup",
    action: "start",
  });
});
it("keeps unrelated errors generic and does not suggest GitHub for other hosts", () => {
  expect(libraryCloneFailure({ ...input, stderr: "fatal: no space left on device" }).reason).toBe(
    "io",
  );
  expect(libraryCloneFailure({ ...input, stderr: "remote: authentication failed" }).reason).toBe(
    "io",
  );
  const error = libraryCloneFailure({
    ...input,
    remoteUrl: "git@example.test:team/repo",
    stderr: "Host key verification failed.",
  });
  expect(error.repair).toBeUndefined();
  expect(error.reason).toBe("blocked");
  expect(libraryCloneFailure({ ...input, stderr: "", timedOut: true }).message).toContain(
    "timed out on Build computer",
  );
});
