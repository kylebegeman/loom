import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  reachLibraryErrorText,
  reachLibraryView,
  supportsLoomFeature,
  type ReachLibraryComputerView,
} from "@t3tools/client-runtime/fork";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { REACH_LIBRARY_FEATURE } from "@t3tools/contracts/fork";
import { useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAuthority } from "../project-library/state";
import { ReachLineText } from "./ComputerReach";
import { confirmCopy } from "./reachChange";
import { reach } from "./state";

/**
 * The reach addresses the chosen Library handed out, for its operator. Hidden unless the Library
 * advertises `reach-library`. The list reads when the section mounts and on Refresh, never on a
 * timer. It has no secret inputs: the Library reads its credentials from files.
 */
export function LibraryReach() {
  const authority = useLibraryAuthority();
  const capabilities = authority.environment?.serverConfig?.environment.capabilities;
  if (authority.authorityId === null || !supportsLoomFeature(capabilities, REACH_LIBRARY_FEATURE))
    return null;
  return <LibraryReachSection libraryId={authority.authorityId} />;
}

function LibraryReachSection({ libraryId }: { readonly libraryId: EnvironmentId }) {
  const listAtom = reach.libraryList(libraryId);
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const canRetire = useAtomValue(reach.libraryRetire.permissionAtom(libraryId));
  const [retiring, setRetiring] = useState<ReachLibraryComputerView | null>(null);
  const view = reachLibraryView({ result, libraryId, supported: true, canRetire });

  return (
    <>
      <SettingsSection
        title="Reach addresses"
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={view.refreshing}
            onClick={() => refresh()}
          >
            {view.refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        }
      >
        {view.setup.length > 0 ? (
          <div className="space-y-1 px-3 py-3 sm:px-4">
            {view.setup.map((line) => (
              <ReachLineText key={line.text} line={line} />
            ))}
          </div>
        ) : null}
        {view.notice || view.error || view.retireDisabledReason ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
            <div className="min-w-0 space-y-1">
              {view.error ? (
                <p role="alert" className="text-xs text-destructive-foreground">
                  {view.error}
                </p>
              ) : null}
              {view.notice ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {view.notice}
                </p>
              ) : null}
              {view.retireDisabledReason && view.computers.length > 0 ? (
                <p className="text-xs text-muted-foreground">{view.retireDisabledReason}</p>
              ) : null}
            </div>
            {view.retry ? (
              <Button
                size="xs"
                variant="outline"
                disabled={view.refreshing}
                onClick={() => refresh()}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        {view.computers.map((computer) => (
          <div
            key={computer.environmentId}
            className="flex items-start justify-between gap-3 px-3 py-2.5 sm:px-4"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm">{computer.title}</p>
              {computer.hostname && computer.hostname !== computer.title ? (
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {computer.hostname}
                </p>
              ) : null}
              <ReachLineText line={computer.state} />
              {computer.notes.map((note) => (
                <p key={note} className="text-xs leading-relaxed text-warning-foreground">
                  {note}
                </p>
              ))}
            </div>
            {computer.retire ? (
              <Button size="xs" variant="destructive-outline" onClick={() => setRetiring(computer)}>
                Retire
              </Button>
            ) : null}
          </div>
        ))}
      </SettingsSection>
      {retiring?.retire ? (
        <RetireReachDialog
          key={retiring.environmentId}
          libraryId={libraryId}
          computer={retiring}
          retire={retiring.retire}
          onClose={() => setRetiring(null)}
        />
      ) : null}
    </>
  );
}

function RetireReachDialog({
  libraryId,
  computer,
  retire,
  onClose,
}: {
  readonly libraryId: EnvironmentId;
  readonly computer: ReachLibraryComputerView;
  readonly retire: NonNullable<ReachLibraryComputerView["retire"]>;
  readonly onClose: () => void;
}) {
  const run = useAtomCommand(reach.libraryRetire, { reportFailure: false });
  const [endIdentity, setEndIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const copy = confirmCopy(retire.confirm);

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const outcome = await run({
      environmentId: libraryId,
      input: { environmentId: computer.environmentId, endIdentity },
    });
    setBusy(false);
    if (outcome._tag === "Success") onClose();
    else if (!isAtomCommandInterrupted(outcome))
      setFailure(reachLibraryErrorText(outcome.cause, "retire"));
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          {copy.description ? (
            <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          ) : null}
          <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-left text-sm">
            <Checkbox
              checked={endIdentity}
              disabled={busy}
              onCheckedChange={(checked) => setEndIdentity(checked === true)}
            />
            <span className="space-y-0.5">
              <span className="block">{retire.endIdentityLabel}</span>
              <span className="block text-xs text-muted-foreground">{retire.endIdentityHint}</span>
            </span>
          </label>
          {failure ? (
            <p role="alert" className="text-left text-xs text-destructive-foreground">
              {failure}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Retiring..." : "Retire"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
