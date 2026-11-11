import { Button } from "~/components/ui/button";
import { LibraryErrorNotice } from "./LibraryControls";
import type { useProjectUpdate } from "./useProjectUpdate";

export function ProjectUpdateRecovery({
  update,
}: {
  readonly update: ReturnType<typeof useProjectUpdate>;
}) {
  const input = update.pendingInput;
  return (
    <>
      {input ? (
        <section aria-label="Saved project update" className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Saved project update</h3>
            <p role="status" className="text-xs text-muted-foreground">
              {update.busy
                ? "Working on the saved update..."
                : update.needsRecovery
                  ? "Check whether this update finished. Checking its receipt does not repeat it."
                  : "This update is ready for an explicit retry with its original details."}
            </p>
          </div>
          <details className="min-w-0 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Review saved changes</summary>
            <div className="mt-2 space-y-2 break-words">
              {input.title !== undefined ? <p>Name: {input.title}</p> : null}
              {input.brief !== undefined ? (
                <div>
                  <p>Brief:</p>
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {input.brief || "Empty brief"}
                  </p>
                </div>
              ) : null}
              {input.color !== undefined ? <p>Color: {input.color ?? "Automatic"}</p> : null}
              {input.dependencies !== undefined ? (
                <p>Dependencies: {input.dependencies.join(", ") || "None"}</p>
              ) : null}
              {input.resources !== undefined ? (
                <p>
                  Repositories:{" "}
                  {input.resources.map((resource) => resource.title).join(", ") || "None"}
                </p>
              ) : null}
              {input.resourceUpdates !== undefined ? (
                <p>
                  Repository changes:{" "}
                  {input.resourceUpdates
                    .map((resource) => resource.title ?? resource.id)
                    .join(", ")}
                </p>
              ) : null}
              {input.profile !== undefined ? (
                <p>Preparation profile: {input.profile === null ? "Remove" : "Update"}</p>
              ) : null}
              <p>Project revision: {input.expectedRevision}</p>
              <p className="break-all select-text">Request reference: {input.requestId}</p>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={update.busy || !update.canRecover}
              onClick={() => void update.recover()}
            >
              Check saved update
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={update.busy || !update.canRecover}
              onClick={() => void update.cancel()}
            >
              Cancel remaining update
            </Button>
            {!update.needsRecovery ? (
              <Button
                size="sm"
                disabled={update.busy || !update.canResume}
                onClick={() => void update.resume()}
              >
                Resume saved update
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Cancellation keeps completed changes. Unconfirmed and running requests stay saved.
          </p>
        </section>
      ) : null}
      <LibraryErrorNotice
        error={
          update.error ??
          (update.accessRepair ? "Access is needed to continue the saved update." : null)
        }
        accessRepair={update.accessRepair}
        accessContext={update.accessContext}
      />
    </>
  );
}
