import { useAtomValue } from "@effect/atom-react";
import { accountJoinCode, squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import { ACCOUNT_JOIN_FEATURE, type AccountJoinReview } from "@t3tools/contracts/fork";
import { useId, useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";

export function ApproveComputer() {
  const authority = useLibraryAuthority();
  const canDecide = useAtomValue(projectLibrary.decideJoin.permissionAtom(authority.authorityId));
  const lookup = useAtomCommand(projectLibrary.lookupJoin, { reportFailure: false });
  const decide = useAtomCommand(projectLibrary.decideJoin, { reportFailure: false });
  const [code, setCode] = useState("");
  const [reviewed, setReviewed] = useState<{
    authorityId: string;
    review: AccountJoinReview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (!authority.connected || !authority.info.data?.features?.includes(ACCOUNT_JOIN_FEATURE))
    return null;
  const review =
    reviewed?.authorityId === authority.authorityId &&
    reviewed.review.code === accountJoinCode(code)
      ? reviewed.review
      : null;
  const run = async (approve?: boolean) => {
    const environmentId = authority.authorityId;
    if (busy || !canDecide || !environmentId) return;
    const normalized = accountJoinCode(code);
    if (normalized === null) {
      setError("Enter the code shown on the computer you are adding.");
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      approve === undefined
        ? await lookup({ environmentId, input: { code: normalized } })
        : await decide({ environmentId, input: { code: normalized, approve } });
    if (result._tag === "Success")
      setReviewed({ authorityId: environmentId, review: result.value });
    else {
      const cause = squashLibraryCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The request could not be checked. Try again.",
      );
    }
    setBusy(false);
  };
  return (
    <SettingsSection title="Add computer" id="library-join">
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Enter the code shown on the computer you are adding. Review its name and matching code
          before approving.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              Computer code
            </label>
            <Input
              id={id}
              value={code}
              maxLength={20}
              autoComplete="off"
              placeholder="A1B2C-D3E4F"
              onChange={(event) => {
                setCode(event.target.value);
                setReviewed(null);
                setError(null);
              }}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !canDecide}>
            {busy ? "Checking..." : "Review computer"}
          </Button>
        </form>
        {!canDecide ? (
          <p className="text-sm text-muted-foreground">
            Your account connection needs full settings access to approve a computer.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {review ? (
          <div className="space-y-3 rounded-xl bg-secondary/40 p-4">
            <p className="text-base font-semibold wrap-anywhere">{review.label}</p>
            <p className="font-mono text-sm">{review.code}</p>
            <p className="text-sm text-muted-foreground">
              Approve only if both match the computer’s terminal. Loom will save its conversations
              and connect it to your other devices.
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Computer identity</summary>
              <p className="pt-2 break-all">{review.keyFingerprint}</p>
            </details>
            {review.state === "approved" ? (
              <p role="status" className="text-sm">
                Approved. Leave the join command running on the computer to finish setup.
              </p>
            ) : review.state === "denied" ? (
              <p role="status" className="text-sm">
                Declined. Start a new request on the computer if you want to add it.
              </p>
            ) : null}
            {review.state !== "denied" ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !canDecide} onClick={() => void run(true)}>
                  {review.state === "approved" ? "Refresh approval" : "Approve computer"}
                </Button>
                {review.state === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !canDecide}
                    onClick={() => void run(false)}
                  >
                    Decline
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
