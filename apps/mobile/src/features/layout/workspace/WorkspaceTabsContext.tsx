import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import { mobilePreferencesAtom } from "../../../state/preferences";
import {
  navigationCustomizationAvailable,
  navigationTabsForPlatform,
  resolveHiddenNavigationTabs,
  resolveSelectedNavigationTab,
} from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";
import type { WorkspaceRegularTab } from "./workspace-primary-navigation";

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
  /** Leaves search and returns the list to where it was when search began. */
  readonly cancelSearch: (tab: WorkspaceSearchTab) => void;
} | null>(null);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

/** Moves the selection off a tab the user has hidden or that no longer exists. */
// fork: mobile-navigation
function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = navigationTabsForPlatform(
    Platform.OS,
    resolveWorkspaceTabOrder(saved?.navigationTabOrder),
  );
  const hidden = navigationCustomizationAvailable()
    ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
    : [];
  const selected =
    Platform.OS === "ios"
      ? order.includes(state.selectedTab)
        ? state.selectedTab
        : "threads"
      : resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

// One model per provider. Handlers on frozen screens keep stale closures, so
// they read the current selection from the registry at call time.
function createWorkspaceTabsModel(selectedTab?: WorkspaceTab) {
  const stored = Atom.make(initialWorkspaceTabsState(selectedTab));
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    threads: 0,
    sites: 0,
    search: 0,
    pullRequests: 0,
    usage: 0,
    settings: 0,
  };
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
  };
}

// fork: mobile-navigation
export function WorkspaceTabsProvider(props: {
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
  readonly initialTab?: WorkspaceTab;
  readonly selectedTab?: WorkspaceTab;
  readonly searchReturnTab?: WorkspaceRegularTab;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(() => createWorkspaceTabsModel(props.initialTab));
  const selection = useRef({ tab: props.selectedTab, searchReturnTab: props.searchReturnTab });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- frozen native screens need the committed route selection when their event handlers run
  useLayoutEffect(() => {
    selection.current = { tab: props.selectedTab, searchReturnTab: props.searchReturnTab };
  }, [props.selectedTab, props.searchReturnTab]);
  const controlledSelection = (state: WorkspaceTabsState, selected: typeof selection.current) => {
    const next =
      selected.tab === undefined
        ? state
        : workspaceTabsReducer(state, { type: "select", tab: selected.tab });
    return selected.searchReturnTab === undefined ||
      selected.searchReturnTab === next.searchReturnTab
      ? next
      : { ...next, searchReturnTab: selected.searchReturnTab };
  };
  const resolveSelection = (state: WorkspaceTabsState) =>
    controlledSelection(state, selection.current);
  const storedState = useAtomValue(model.resolved);
  const state = controlledSelection(storedState, {
    tab: props.selectedTab,
    searchReturnTab: props.searchReturnTab,
  });
  const dispatch = (action: WorkspaceTabsAction) =>
    registry.set(
      model.stored,
      workspaceTabsReducer(resolveSelection(registry.get(model.resolved)), action),
    );
  const context = {
    state,
    dispatch,
    isTabActive: (tab: WorkspaceTab) =>
      resolveSelection(registry.get(model.resolved)).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
    cancelSearch: (tab: WorkspaceSearchTab) => {
      model.recordScrollOffset(tab, registry.get(model.resolved).tabs[tab].searchEntryOffset);
      dispatch({ type: "cancel", tab });
    },
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
