import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AppRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { environmentServerConfigsAtom } from "~/state/server";
import { canSaveAsBot } from "./logic";

/** `canSaveAsBot` read from the app's current connections, for menus built outside React. */
export const threadCanBeSavedAsBot = (thread: ScopedThreadRef) =>
  canSaveAsBot(
    thread,
    appAtomRegistry.get(environmentServerConfigsAtom).get(thread.environmentId)?.environment
      .capabilities,
    appAtomRegistry.get(primaryEnvironmentIdAtom),
  );

/** Opens the Bots page, which drafts a bot from the thread and shows it in the editor. */
export const openSaveAsBot = (router: Pick<AppRouter, "navigate">, thread: ScopedThreadRef) =>
  void router.navigate({ to: "/loom/bots", search: { fromThread: thread.threadId } });
