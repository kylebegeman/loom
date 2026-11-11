// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { LibraryError, type LibraryProject } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  outcome: vi.fn(),
  identity: { issuer: "https://identity.test", subject: "original" },
  allowed: true,
  authority: "library",
}));
vi.mock("./state", () => ({
  projectLibrary: { updateProject: "update", operationOutcome: "outcome" },
  useLibraryPermission: () => state.allowed,
}));
vi.mock("~/state/session", () => ({
  useEnvironmentSessionState: () => ({ data: { identity: state.identity } }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: "update" | "outcome") => state[command],
}));
import { useProjectUpdate } from "./useProjectUpdate";
import { saveLibraryAttempt } from "./attempts";

const authorityId = EnvironmentId.make("library");
const project: LibraryProject = {
  id: "update-recovery",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
};

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.update.mockReset();
  state.outcome.mockReset().mockResolvedValue(AsyncResult.success(null));
  state.identity = { issuer: "https://identity.test", subject: "original" };
  state.allowed = true;
  state.authority = "library";
  saveLibraryAttempt(`loom:library:update:${authorityId}:${project.id}`, null, localStorage);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let hook: ReturnType<typeof useProjectUpdate>;
  const onSaved = vi.fn();
  function Editor({ currentAuthority }: { currentAuthority: EnvironmentId }) {
    const current = useProjectUpdate({
      project,
      authorityId: currentAuthority,
      connected: true,
      onSaved,
    });
    useEffect(() => {
      hook = current;
    });
    return <p>{current.error}</p>;
  }
  await act(() => root.render(<Editor currentAuthority={EnvironmentId.make(state.authority)} />));
  return {
    get hook() {
      return hook!;
    },
    onSaved,
    async reopen() {
      await act(() => root.render(null));
      await act(() =>
        root.render(<Editor currentAuthority={EnvironmentId.make(state.authority)} />),
      );
    },
    async render() {
      await act(() =>
        root.render(<Editor currentAuthority={EnvironmentId.make(state.authority)} />),
      );
    },
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
      saveLibraryAttempt(`loom:library:update:${authorityId}:${project.id}`, null, localStorage);
      vi.unstubAllGlobals();
    },
  };
}

it("recovers a reopened edit with its original request before an explicit retry", async () => {
  await using screen = await setup();
  state.update.mockResolvedValueOnce(AsyncResult.failure(Cause.interrupt(0)));
  await act(() => screen.hook.save({ brief: "Reviewed brief" }));
  const original = state.update.mock.calls[0]![0];
  await screen.reopen();
  expect(screen.hook.needsRecovery).toBe(true);
  expect(state.outcome).not.toHaveBeenCalled();
  await act(() => screen.hook.save({ brief: "Reviewed brief" }));
  expect(state.update).toHaveBeenCalledOnce();
  expect(state.outcome).toHaveBeenCalledExactlyOnceWith({
    environmentId: authorityId,
    input: { requestId: original.input.requestId, kind: "update" },
  });
  state.update.mockResolvedValueOnce(AsyncResult.success(project));
  await act(() => screen.hook.save({ brief: "Reviewed brief" }));
  expect(state.update.mock.calls[1]![0]).toEqual(original);
});

it("retains typed access repair and refuses recovery by a different account", async () => {
  await using screen = await setup();
  state.update.mockResolvedValueOnce(
    AsyncResult.failure(
      Cause.fail(
        new LibraryError({
          reason: "blocked",
          accessRepair: { kind: "sign-in", environmentId: authorityId },
        }),
      ),
    ),
  );
  await act(() => screen.hook.save({ brief: "Reviewed brief" }));
  expect(screen.hook).toMatchObject({
    accessRepair: { kind: "sign-in", environmentId: authorityId },
    accessContext: { originalAccount: state.identity, environmentId: authorityId },
  });
  state.identity = { ...state.identity, subject: "another-account" };
  await screen.render();
  await act(() => screen.hook.save({ brief: "Reviewed brief" }));
  expect(state.outcome).not.toHaveBeenCalled();
  expect(state.update).toHaveBeenCalledOnce();
  expect(screen.hook.error).toContain("account that started");
});

it("keeps an unreadable saved update instead of replacing its request identity", async () => {
  await using screen = await setup();
  await act(() =>
    saveLibraryAttempt(
      `loom:library:update:${authorityId}:${project.id}`,
      "unreadable request",
      localStorage,
    ),
  );
  await act(() => screen.hook.save({ brief: "New brief" }));
  expect(state.update).not.toHaveBeenCalled();
  expect(screen.hook.error).toContain("could not be read");
});

it("does not complete an editor on another Library when the original update returns late", async () => {
  await using screen = await setup();
  const response = AsyncResult.success(project);
  let complete!: (result: typeof response) => void;
  state.update.mockReturnValue(
    new Promise<typeof response>((resolve) => {
      complete = resolve;
    }),
  );
  let saved!: Promise<boolean>;
  await act(() => {
    saved = screen.hook.save({ brief: "Reviewed brief" });
  });
  state.authority = "another-library";
  await screen.render();
  expect(screen.hook.accessContext.environmentId).toBe("another-library");
  await act(() => complete(response));
  expect(await saved).toBe(false);
  expect(screen.onSaved).not.toHaveBeenCalled();
});
