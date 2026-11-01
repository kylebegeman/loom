import { lazy, Suspense } from "react";
import { BotIcon } from "lucide-react";
import { BOTS_FEATURE } from "@t3tools/contracts/fork";
import type { ForkPanelDefinition } from "../panels/types";

export const BOT_ACTIVITY_PANEL_ID = "bot-activity";
const BotActivityPanel = lazy(() => import("./BotActivityPanel"));

export const botActivityPanel: ForkPanelDefinition = {
  id: BOT_ACTIVITY_PANEL_ID,
  title: "Bot activity",
  icon: BotIcon,
  shortcut: "",
  description: "Tasks, approvals and results for this conversation's Loom bots.",
  unavailableHint: "Open a conversation on a computer that supports Loom bots.",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes(BOTS_FEATURE),
  Component: (props) => (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading bot activity…
        </p>
      }
    >
      <BotActivityPanel {...props} />
    </Suspense>
  ),
};
