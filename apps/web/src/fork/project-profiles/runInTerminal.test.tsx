// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { projectScriptTerminalInput } from "@t3tools/shared/projectScripts";
const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  canWrite: vi.fn(),
  launch: vi.fn(),
  write: vi.fn(),
  place: vi.fn(),
}));
vi.mock("./state", () => ({ profiles: { command: "prepare" }, runProfileCommand: state.prepare }));
vi.mock("~/components/terminal/useThreadTerminalActions", () => ({
  useThreadTerminalActions: () => ({
    canWrite: state.canWrite,
    launchTerminal: state.launch,
    writeToTerminal: state.write,
  }),
}));
vi.mock("~/terminalUiStateStore", () => ({
  useTerminalUiStateStore: { getState: () => ({ newTerminal: state.place }) },
}));
vi.mock("~/state/entities", () => ({
  useQuietThreadShell: () => ({ projectId: ProjectId.make("project"), worktreePath: "/worktree" }),
}));
import { useRunProfileCommand } from "./runInTerminal";
const threadRef = { environmentId: EnvironmentId.make("host"), threadId: ThreadId.make("thread") };
let root: Root;
let container: HTMLDivElement;
let run: ReturnType<typeof useRunProfileCommand>;
function Harness({ target = threadRef }: { target?: typeof threadRef }) {
  const execute = useRunProfileCommand(target);
  useEffect(() => {
    run = execute;
  }, [execute]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(state)) mock.mockReset();
  state.canWrite.mockReturnValue(true);
  state.prepare.mockResolvedValue({
    commandLine: "varlock run -- sh -c 'vp test'",
    cwd: "/worktree",
  });
  state.launch.mockImplementation((input) => {
    input.place("profile-terminal");
    return {
      terminalId: "profile-terminal",
      result: Promise.resolve({ _tag: "Success", value: undefined }),
    };
  });
  state.write.mockResolvedValue({ _tag: "Success", value: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("uses guarded preparation, a new thread terminal and telemetry opt-outs before writing", async () => {
  await run({ intent: "test" });
  expect(state.prepare).toHaveBeenCalledWith("prepare", {
    environmentId: threadRef.environmentId,
    input: {
      projectId: ProjectId.make("project"),
      threadId: threadRef.threadId,
      target: { intent: "test" },
    },
  });
  expect(state.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      location: { cwd: "/worktree", worktreePath: "/worktree" },
      extraEnv: { VARLOCK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
    }),
  );
  expect(state.place).toHaveBeenCalledWith(threadRef, "profile-terminal");
  expect(state.write).toHaveBeenCalledWith(
    "profile-terminal",
    projectScriptTerminalInput("varlock run -- sh -c 'vp test'"),
  );
});
it("rejects missing terminal access before preparing or opening anything", async () => {
  state.canWrite.mockReturnValue(false);
  await expect(run({ intent: "test" })).rejects.toThrow("Terminal access is required");
  expect(state.prepare).not.toHaveBeenCalled();
  expect(state.launch).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});
it("never writes when access changes before opening or when terminal open fails", async () => {
  state.launch.mockReturnValueOnce(null);
  await expect(run({ scriptId: "test-action" })).rejects.toThrow("could not be opened");
  state.launch.mockReturnValueOnce({
    terminalId: "failed",
    result: Promise.resolve({ _tag: "Failure" }),
  });
  await expect(run({ intent: "test" })).rejects.toThrow("could not be opened");
  expect(state.write).not.toHaveBeenCalled();
});

it("does not launch a command after switching threads while preparation is pending", async () => {
  let finish!: (value: { commandLine: string; cwd: string }) => void;
  state.prepare.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = run({ intent: "test" });
  act(() => root.render(<Harness target={{ ...threadRef, threadId: ThreadId.make("other") }} />));
  finish({ commandLine: "vp test", cwd: "/worktree" });
  await expect(pending).rejects.toThrow("active thread changed");
  expect(state.launch).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});
it("does not write after unmounting while the terminal opens", async () => {
  let opened!: (value: { _tag: "Success"; value: undefined }) => void;
  let launched!: () => void;
  const launchDone = new Promise<void>((resolve) => {
    launched = resolve;
  });
  state.launch.mockImplementationOnce(() => {
    launched();
    return {
      terminalId: "pending",
      result: new Promise((resolve) => {
        opened = resolve;
      }),
    };
  });
  const pending = run({ intent: "test" });
  await launchDone;
  act(() => root.render(null));
  opened({ _tag: "Success", value: undefined });
  await expect(pending).rejects.toThrow("active thread changed");
  expect(state.write).not.toHaveBeenCalled();
});
