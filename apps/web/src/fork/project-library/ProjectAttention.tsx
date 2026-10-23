import { Link } from "@tanstack/react-router";
import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryProjectAttention } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
export function ProjectAttention({
  threads,
  copies,
  onFiles,
}: {
  readonly threads: readonly LibraryThreadSummary[];
  readonly copies: readonly LibraryWorkingCopy[];
  readonly onFiles: () => void;
}) {
  const items = libraryProjectAttention(threads, copies);
  return (
    <section aria-label="Needs attention" className="space-y-3">
      <h2 className="text-base font-semibold">Needs attention</h2>
      {items.length ? (
        items.slice(0, 8).map((item) => (
          <div
            key={`${item.kind}:${item.id}`}
            className="flex items-start justify-between gap-3 py-1"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
              <p className="text-xs text-muted-foreground">
                Observed {new Date(item.checkedAt).toLocaleString()}
              </p>
            </div>
            {item.kind === "conversation" ? (
              <Button
                size="xs"
                variant="outline"
                render={
                  <Link
                    to="/library/conversations/$conversationId"
                    params={{ conversationId: item.id }}
                  />
                }
              >
                Resume
              </Button>
            ) : (
              <Button size="xs" variant="outline" onClick={onFiles}>
                Review files
              </Button>
            )}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No problems in the saved observations. Open Files to check connected computers and
          remotes.
        </p>
      )}
    </section>
  );
}
