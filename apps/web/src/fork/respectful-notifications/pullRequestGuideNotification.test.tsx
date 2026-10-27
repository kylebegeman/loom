import type { AnyRouter } from "@tanstack/react-router";
import { EnvironmentId, type PullRequestReviewGuideResult } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  previews: true,
  guide: null as unknown,
}));
vi.mock("~/state/pullRequests", () => ({
  observedPullRequestTitle: () => null,
  pullRequestEnvironment: { reviewGuide: () => state.guide },
}));
vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => ({
    notificationMode: "notifications",
    notificationPreviewsEnabled: state.previews,
  }),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn(), close: vi.fn() } }));

import { startGuideRunNotifications } from "~/components/pullRequest/guide/PullRequestGuideRunCoordinator";
import { useGuideRunStore } from "~/components/pullRequest/guide/guideRunStore";

const sent: { title: string; options: NotificationOptions }[] = [];
class TestNotification extends EventTarget {
  static permission = "granted";
  constructor(title: string, options: NotificationOptions) {
    super();
    sent.push({ title, options });
  }
}

let stop: (() => void) | undefined;

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { focus: vi.fn() }));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hasFocus: () => false, visibilityState: "hidden" }),
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
  useGuideRunStore.setState({ watches: {} });
  vi.unstubAllGlobals();
});

function finishGuideRun() {
  const guide = Atom.make<AsyncResult.AsyncResult<PullRequestReviewGuideResult, never>>(
    AsyncResult.initial(),
  );
  state.guide = guide;
  const registry = AtomRegistry.make();
  useGuideRunStore.setState({
    watches: {
      run: {
        environmentId: EnvironmentId.make("one"),
        reference: { repository: "acme/app", number: 7 } as never,
        title: "Private pull request title",
        previousGuideAt: null,
        previousFailedAt: null,
        since: Date.now(),
      },
    },
  });
  stop = startGuideRunNotifications(registry, { navigate: vi.fn() } as unknown as AnyRouter);
  registry.set(
    guide,
    AsyncResult.success({
      run: null,
      guide: { generatedAt: "2026-10-15T00:00:00.000Z" },
    } as unknown as PullRequestReviewGuideResult),
  );
}

it.each([
  [true, "Private pull request title"],
  [false, "Open Loom to review this pull request."],
])("with previews %s, a finished guide's system notification says %s", (previews, body) => {
  state.previews = previews;
  finishGuideRun();
  expect(sent).toEqual([
    { title: "Review guide ready", options: expect.objectContaining({ body, tag: "guide:run" }) },
  ]);
});
