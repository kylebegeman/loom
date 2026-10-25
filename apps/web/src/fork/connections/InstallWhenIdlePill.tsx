import type { DesktopBridge } from "@t3tools/contracts";

import { setLocalInstallWhenIdle } from "./localUpdateInstall";

/** Takes the sidebar update button's place while a downloaded update waits for local agents. */
export function InstallWhenIdlePill({ bridge }: { readonly bridge: DesktopBridge }) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center rounded-full bg-sidebar-control-surface text-sidebar-foreground">
      <span className="min-w-0 flex-1 truncate pl-3 text-xs">Installs when agents finish</span>
      <button
        type="button"
        aria-label="Cancel installing when agents finish"
        className="shrink-0 cursor-pointer pr-3 pl-1.5 text-xs underline decoration-muted-foreground/60 underline-offset-3 hover:decoration-current"
        onClick={() => void setLocalInstallWhenIdle(bridge, false)}
      >
        Cancel
      </button>
    </div>
  );
}
