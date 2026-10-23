import type { MenuAction } from "@react-native-menu/menu";
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { BOTS_FEATURE, BOTS_FROM_THREAD_FEATURE, isBotRunThreadId } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";

export function buildThreadBotsMenuItems(input: {
  readonly capabilities: ExecutionEnvironmentCapabilities | undefined;
  readonly threadId: string;
  readonly canOperate: boolean;
}): MenuAction[] {
  if (!supportsLoomFeature(input.capabilities, BOTS_FEATURE) || isBotRunThreadId(input.threadId))
    return [];
  const attributes = { disabled: !input.canOperate };
  return [
    { id: "bots-run", title: "Run bot", image: "bolt", attributes },
    ...(supportsLoomFeature(input.capabilities, BOTS_FROM_THREAD_FEATURE)
      ? [{ id: "bots-create", title: "Create bot from thread", image: "plus", attributes }]
      : []),
  ];
}
