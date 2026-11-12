import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { useLibraryAuthority } from "../project-library/state";
import { requestLibraryConnect } from "../project-library/libraryPaletteSession";

export function AccountAccessSummary() {
  const authority = useLibraryAuthority();
  return (
    <section
      aria-label="Your Loom account"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-secondary/40 p-5 sm:p-6"
    >
      <div className="max-w-prose space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Your Loom account</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {authority.connected
            ? `Connected to ${authority.environment?.label ?? "your Library"}. Your compatible computers appear automatically.`
            : "Sign in once to find your computers and open your threads from any of your devices."}
        </p>
      </div>
      {authority.connected ? (
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/settings/connections" hash="library-sign-in" />}
        >
          Manage account
        </Button>
      ) : (
        <Button size="sm" onClick={() => requestLibraryConnect("computers")}>
          Sign in to Loom
        </Button>
      )}
    </section>
  );
}
