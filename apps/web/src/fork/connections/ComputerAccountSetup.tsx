import type { EnvironmentPresentation } from "~/state/environments";
import { Button } from "~/components/ui/button";
import { accountSetupApplies, useComputerEnrollment } from "./accountEnrollment";

export function ComputerAccountSetup({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  if (!accountSetupApplies(environment)) return null;
  return <ComputerAccountSetupForm key={environment.environmentId} environment={environment} />;
}

const WAITING_TEXT = {
  "signed-out": "Sign in to Loom on this device to add this computer to your account.",
  reconnect: "Reconnect this computer to add it to your account.",
  permission: "Adding a computer needs full settings access on it and on your Library.",
  checking: "Checking your account...",
} as const;

function ComputerAccountSetupForm({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const { plan, ready, run, resuming, accountError, checkAccountAgain, start } =
    useComputerEnrollment(environment);
  // This device's own computer joins on its own once signed in; others join with a click.
  const automatic = environment.entry.target._tag === "PrimaryConnectionTarget";
  const label = environment.label;
  const running = run?.phase === "running";
  const enrolled = plan.kind === "enrolled";
  const heading = ready
    ? `${label} is ready for your other devices`
    : enrolled
      ? `${label} is in your account`
      : plan.kind === "removed"
        ? `${label} was removed from your account`
        : `Add ${label} to your account`;
  const body = ready
    ? "Open this computer’s conversations from your phone, browser and other Macs."
    : enrolled
      ? "Remote access is off for this computer, so your other devices reach it only on networks where they can reach it directly."
      : plan.kind === "removed"
        ? "Loom does not add a removed computer back on its own. Add it again to open its conversations from your other devices."
        : plan.kind === "other-library"
          ? "This computer publishes its history to a different Library, so it cannot join this account."
          : automatic
            ? "Loom adds this computer to your account automatically after you sign in, so your other devices can open its conversations."
            : "Approve this computer once to open its conversations from your other devices.";
  const offered = plan.kind === "enroll" || plan.kind === "removed";
  return (
    <section aria-label="Account access" className="space-y-3 border-t border-border/60 pt-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {offered || running ? (
        <Button size="sm" variant="default" disabled={running} onClick={() => void start()}>
          {running
            ? "Adding computer..."
            : plan.kind === "removed"
              ? "Add again"
              : resuming || run?.phase === "failed"
                ? "Resume setup"
                : "Add computer"}
        </Button>
      ) : null}
      {plan.kind === "waiting" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {WAITING_TEXT[plan.reason]}
        </p>
      ) : null}
      {run?.phase === "done" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Computer added. Remote access starts automatically.
        </p>
      ) : null}
      {accountError ? (
        <p role="alert" className="text-sm text-destructive">
          {accountError}
          <Button size="sm" variant="outline" onClick={checkAccountAgain}>
            Check account setup again
          </Button>
        </p>
      ) : null}
      {run?.phase === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {run.error}
        </p>
      ) : null}
    </section>
  );
}
