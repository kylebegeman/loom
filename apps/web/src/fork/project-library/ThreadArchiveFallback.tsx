import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import type { ThreadRouteRenderState, ThreadRouteTarget } from "~/threadRoutes";
import { projectLibrary, useLibraryAuthority } from "./state";

/**
 * Opens the Library's saved copy of a server thread its computer cannot show, either because the
 * computer is offline or because the thread is gone from it. `canUseArchive` tells the route not
 * to treat a missing thread as final while the Library may still have it; `fallback` replaces the
 * empty route body.
 */
export function useThreadArchiveFallback(input: {
  readonly target: ThreadRouteTarget;
  readonly renderState: ThreadRouteRenderState;
  readonly serverThreadRef: ScopedThreadRef | null;
}): { readonly canUseArchive: boolean; readonly fallback: ReactNode } {
  const { target, renderState, serverThreadRef } = input;
  const navigate = useNavigate();
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const source = environments.find(
    (entry) => entry.environmentId === serverThreadRef?.environmentId,
  );
  const canUseArchive =
    target.kind === "server" &&
    renderState !== "ready" &&
    (source == null || source.connection.phase !== "connected" || renderState === "missing");
  const archive = useEnvironmentQuery(
    canUseArchive && authority.authorityId && serverThreadRef
      ? projectLibrary.lookupThread({
          environmentId: authority.authorityId,
          input: {
            sourceEnvironmentId: serverThreadRef.environmentId,
            threadId: serverThreadRef.threadId,
          },
        })
      : null,
  );
  useEffect(() => {
    if (canUseArchive && archive.data)
      void navigate({
        to: "/library/conversations/$conversationId",
        params: { conversationId: archive.data.id },
        replace: true,
      });
  }, [canUseArchive, archive.data, navigate]);

  const fallback =
    target.kind === "server" ? (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-4">
          <h1 className="text-lg font-semibold">
            {archive.isPending ? "Opening saved conversation..." : "Conversation unavailable"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {archive.error ??
              (source?.connection.phase === "connected"
                ? "Loom is loading this conversation from its computer."
                : "Connect the original computer or your Library to open this conversation.")}
          </p>
          <div className="flex gap-2">
            {authority.authorityId ? (
              <Button variant="outline" onClick={archive.refresh}>
                Try again
              </Button>
            ) : null}
            <Button onClick={() => void navigate({ to: "/" })}>Back to threads</Button>
          </div>
        </div>
      </div>
    ) : null;

  return { canUseArchive, fallback };
}
