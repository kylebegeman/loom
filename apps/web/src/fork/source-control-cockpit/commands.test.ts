import { beforeEach, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { requestGitAction, useGitActionRequestStore } from "./commands";

const ref = { environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("thread") };
beforeEach(() => {
  useGitActionRequestStore.setState({ pending: null });
});

it("retains a shortcut while details are closed and consumes it only once", () => {
  requestGitAction(ref, "commit");
  const request = useGitActionRequestStore.getState().pending!;
  expect(request).toEqual({ threadRef: ref, action: "commit" });
  expect(
    useRightPanelStore.getState().threadPanelVisibilityByThreadKey[scopedThreadKey(ref)],
  ).toEqual({ inlineOpen: true, popoverOpen: true });
  expect(useGitActionRequestStore.getState().consume(request)).toBe(true);
  expect(useGitActionRequestStore.getState().consume(request)).toBe(false);
});

it("a stale details render cannot consume the latest request for another environment", () => {
  requestGitAction(ref, "commit");
  const previous = useGitActionRequestStore.getState().pending!;
  const other = { ...ref, environmentId: EnvironmentId.make("other-host") };
  requestGitAction(other, "commit_push");
  expect(useGitActionRequestStore.getState().consume(previous)).toBe(false);
  expect(useGitActionRequestStore.getState().pending?.threadRef).toEqual(other);
});
