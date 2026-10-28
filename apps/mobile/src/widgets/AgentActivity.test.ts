import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@expo/ui/swift-ui", () => ({
  HStack: "HStack",
  Image: "Image",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));

vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  accessibilityElement: (value: unknown) => value,
  accessibilityLabel: (value: unknown) => value,
  activityBackgroundTint: (value: unknown) => value,
  font: (value: unknown) => value,
  foregroundStyle: (value: unknown) => value,
  frame: (value: unknown) => value,
  layoutPriority: (value: unknown) => value,
  lineLimit: (value: unknown) => value,
  minimumScaleFactor: (value: unknown) => value,
  padding: (value: unknown) => value,
  resizable: (value: unknown) => value,
  widgetURL: (value: unknown) => ({ widgetURL: value }),
}));

vi.mock("expo-widgets", () => ({
  createLiveActivity: vi.fn((name: string, layout: unknown) => ({ layout, name })),
}));

import { createLiveActivity } from "expo-widgets";

import "./AgentActivity";
import type { AgentActivityProps, AgentActivityRowProps } from "./AgentActivity";

// The widget module exports only its factory; the mock above captures the layout it wraps.
const AgentActivity = vi.mocked(createLiveActivity).mock.calls[0]![1];

function makeRow(overrides: Partial<AgentActivityRowProps>): AgentActivityRowProps {
  return {
    environmentId: "env-1",
    threadId: "thread-1",
    projectTitle: "Project",
    threadTitle: "Thread",
    modelTitle: "gpt-5.4",
    phase: "running",
    status: "Working",
    updatedAt: "2026-05-25T13:07:00.000Z",
    deepLink: "/threads/env-1/thread-1",
    ...overrides,
  };
}

const props = {
  title: "T3 Code",
  subtitle: "Agent work in progress",
  activeCount: 1,
  updatedAt: "2026-05-25T13:07:00.000Z",
  activities: [],
} satisfies AgentActivityProps;

const environment = {
  colorScheme: "dark",
  isLuminanceReduced: false,
} as const;

describe("AgentActivity widget layout", () => {
  // fork: mobile-identity: widget links default to the loom scheme.
  it("deep links the banner to the row that needs attention", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({
            threadId: "thread-2",
            phase: "waiting_for_approval",
            status: "Approval",
            deepLink: "/threads/env-1/thread-2",
          }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(layout.banner)).toContain('"widgetURL":"loom://threads/env-1/thread-2"');
  });

  // fork: mobile-identity
  it("deep links the banner to the first row when nothing needs attention", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.banner)).toContain('"widgetURL":"loom://threads/env-1/thread-1"');
  });
});

// fork: mobile-identity
it.each(["loom", "loom-dev", "loom-preview"])(
  "keeps %s widget taps in the originating variant",
  (appScheme) => {
    const layout = AgentActivity(
      { ...props, appScheme, activities: [makeRow({})] },
      environment as never,
    );
    expect(JSON.stringify(layout.banner)).toContain(
      `"widgetURL":"${appScheme}://threads/env-1/thread-1"`,
    );
  },
);

// fork: mobile-identity
it("does not turn an untrusted widget scheme into an external URL", () => {
  const layout = AgentActivity(
    { ...props, appScheme: "javascript", activities: [makeRow({})] },
    environment as never,
  );
  expect(JSON.stringify(layout.banner)).toContain('"widgetURL":"loom://threads/env-1/thread-1"');
});
