import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatThreadActionContext } from "../lib/chatThreadActions";

const state = vi.hoisted(() => ({
  library: vi.fn<() => Promise<boolean>>(),
  palette: vi.fn(),
}));
vi.mock("~/fork/project-library/useLibraryNewConversation", () => ({
  useLibraryNewConversation: () => state.library,
}));
vi.mock("../commandPaletteBus", () => ({ openCommandPalette: state.palette }));
vi.mock("./useStableCallback", () => ({
  useStableCallback: (callback: unknown) => callback,
}));

import { useNewConversationShortcut } from "./useNewConversationShortcut";

const environmentId = EnvironmentId.make("source-computer");
const projectId = ProjectId.make("source-project");
const defaultProjectRef = scopeProjectRef(environmentId, ProjectId.make("default-project"));
const createContext = (overrides: Partial<ChatThreadActionContext> = {}) => ({
  activeThread: { environmentId, projectId },
  activeDraftThread: null,
  defaultProjectRef,
  handleNewThread: vi.fn<ChatThreadActionContext["handleNewThread"]>().mockResolvedValue(null),
  showProjectPicker: true,
  ...overrides,
});

beforeEach(() => {
  state.library.mockReset().mockResolvedValue(false);
  state.palette.mockReset();
});

describe("new conversation shortcuts", () => {
  it.each(["chat.new", "chat.newLocal"] as const)(
    "%s opens the Library form before ordinary project selection or draft creation",
    async (command) => {
      state.library.mockResolvedValue(true);
      const context = createContext();

      await useNewConversationShortcut(context)(command);

      expect(state.library).toHaveBeenCalledExactlyOnceWith();
      expect(state.palette).not.toHaveBeenCalled();
      expect(context.handleNewThread).not.toHaveBeenCalled();
    },
  );

  it("opens Library without an ordinary project available", async () => {
    state.library.mockResolvedValue(true);
    const context = createContext({ activeThread: undefined, defaultProjectRef: null });

    await useNewConversationShortcut(context)("chat.newLocal");

    expect(state.library).toHaveBeenCalledOnce();
    expect(context.handleNewThread).not.toHaveBeenCalled();
  });

  it("keeps the ordinary multi-project picker when Library declines", async () => {
    const context = createContext();

    await useNewConversationShortcut(context)("chat.new");

    expect(state.library).toHaveBeenCalledOnce();
    expect(state.palette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
    expect(context.handleNewThread).not.toHaveBeenCalled();
  });

  it.each(["chat.new", "chat.newLocal"] as const)(
    "%s keeps ordinary source project defaults when no picker is needed",
    async (command) => {
      const context = { ...createContext(), showProjectPicker: false };

      await useNewConversationShortcut(context)(command);

      expect(context.handleNewThread).toHaveBeenCalledExactlyOnceWith(
        scopeProjectRef(environmentId, projectId),
      );
      expect(state.palette).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      activeDraftThread: { environmentId, projectId },
      expected: scopeProjectRef(environmentId, projectId),
    },
    { activeDraftThread: null, expected: defaultProjectRef },
  ])(
    "keeps the ordinary draft/default fallback for $activeDraftThread",
    async ({ activeDraftThread, expected }) => {
      const context = createContext({ activeThread: undefined, activeDraftThread });

      await useNewConversationShortcut(context)("chat.newLocal");

      expect(context.handleNewThread).toHaveBeenCalledExactlyOnceWith(expected);
      expect(state.palette).not.toHaveBeenCalled();
    },
  );

  it("waits for Library context resolution before using the ordinary fallback", async () => {
    let complete!: (handled: boolean) => void;
    state.library.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const context = createContext();

    const starting = useNewConversationShortcut(context)("chat.newLocal");

    expect(context.handleNewThread).not.toHaveBeenCalled();
    complete(false);
    await starting;
    expect(context.handleNewThread).toHaveBeenCalledExactlyOnceWith(
      scopeProjectRef(environmentId, projectId),
    );
  });
});
