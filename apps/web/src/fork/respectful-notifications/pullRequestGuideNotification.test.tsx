import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  previews: true,
  data: null as unknown,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/state/pullRequests", () => ({ pullRequestEnvironment: { reviewGuide: () => null } }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.data, refresh: () => undefined }),
}));
vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => ({
    notificationMode: "notifications",
    notificationPreviewsEnabled: state.previews,
  }),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn(), close: vi.fn() } }));

import { PullRequestGuideRunCoordinator } from "~/components/pullRequest/guide/PullRequestGuideRunCoordinator";
import { useGuideRunStore } from "~/components/pullRequest/guide/guideRunStore";

const sent: { title: string; options: NotificationOptions }[] = [];
class TestNotification extends EventTarget {
  static permission = "granted";
  constructor(title: string, options: NotificationOptions) {
    super();
    sent.push({ title, options });
  }
}

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  sent.length = 0;
  state.data = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { focus: vi.fn() }));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hasFocus: () => false, visibilityState: "hidden" }),
  );
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  useGuideRunStore.setState({ watches: {} });
  vi.unstubAllGlobals();
});

async function finishGuideRun() {
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
  await act(async () => {
    renderer = create(<PullRequestGuideRunCoordinator />);
  });
  state.data = { run: null, guide: { generatedAt: "2026-10-15T00:00:00.000Z" } };
  await act(async () => renderer?.update(<PullRequestGuideRunCoordinator />));
}

it.each([
  [true, "Private pull request title"],
  [false, "Open Loom to review this pull request."],
])("with previews %s, a finished guide's system notification says %s", async (previews, body) => {
  state.previews = previews;
  await finishGuideRun();
  expect(sent).toEqual([
    { title: "Review guide ready", options: expect.objectContaining({ body, tag: "guide:run" }) },
  ]);
});
