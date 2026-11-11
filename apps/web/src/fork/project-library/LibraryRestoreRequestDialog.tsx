import { useEffect, useInsertionEffect, useRef, useState } from "react";
import {
  checkLibraryRestoreRequest,
  continueLibraryRestoreRequest,
  renewLibraryRestoreRequest,
  libraryAccessRepairFromFailure,
  squashLibraryCommandFailure,
} from "@t3tools/client-runtime/fork";
import type { LibraryOperation, LibraryRecoveryGrant } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentSessionState } from "~/state/session";
import { useEnvironment } from "~/state/environments";
import { LibraryDialog, LibraryErrorNotice } from "./LibraryControls";
import { LibraryAccessNotice, LibraryAccessRepairNotice } from "./LibraryAccessNotice";
import {
  projectLibrary,
  useAccessBlock,
  useLibraryAuthorityId,
  useLibraryPermission,
} from "./state";

export function LibraryRestoreRequestDialog(props: {
  readonly operation: LibraryOperation;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  return (
    <RestoreRequestContent
      key={`${props.operation.environmentId}:${props.operation.id}`}
      {...props}
    />
  );
}

function RestoreRequestContent({
  operation: original,
  onChanged,
  onClose,
}: Parameters<typeof LibraryRestoreRequestDialog>[0]) {
  const context = original.restoreRequest;
  const authorityId = useLibraryAuthorityId();
  const identity = useEnvironmentSessionState(original.environmentId).data?.identity;
  const authorityIdentity = useEnvironmentSessionState(context?.libraryEnvironmentId ?? null).data
    ?.identity;
  const computer = useEnvironment(original.environmentId);
  const connected = computer?.entry.enabled === true && computer.connection.phase === "connected";
  const correctAuthority = context !== undefined && authorityId === context.libraryEnvironmentId;
  const canRead = useLibraryPermission(projectLibrary.operationOutcome, original.environmentId);
  const canAuthorize = useLibraryPermission(
    projectLibrary.authorizeRecovery,
    context?.libraryEnvironmentId ?? null,
  );
  const canExecute = useLibraryPermission(projectLibrary.executeOperation, original.environmentId);
  const access = useAccessBlock(original.environmentId, [projectLibrary.executeOperation]);
  const authorityAccess = useAccessBlock(context?.libraryEnvironmentId ?? null, [
    projectLibrary.authorizeRecovery,
  ]);
  const lookup = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
  const authorize = useAtomCommand(projectLibrary.authorizeRecovery, { reportFailure: false });
  const execute = useAtomCommand(projectLibrary.executeOperation, { reportFailure: false });
  const [checked, setChecked] = useState<LibraryOperation | null>(null);
  const [grant, setGrant] = useState<LibraryRecoveryGrant | null>(null);
  const [checkedAccount, setCheckedAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessRepair, setAccessRepair] =
    useState<ReturnType<typeof libraryAccessRepairFromFailure>>();
  const accountKey = JSON.stringify([
    authorityId,
    identity?.issuer,
    identity?.subject,
    authorityIdentity?.issuer,
    authorityIdentity?.subject,
    connected,
    canRead,
    canAuthorize,
    canExecute,
  ]);
  const active = useRef(accountKey),
    mounted = useRef(true),
    working = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- guards recovery replies and grants against account or connection changes during an await
  useInsertionEffect(() => {
    active.current = accountKey;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prevents a closed restore dialog from accepting a late authorization
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const resumable = checked?.state === "failed" || checked?.state === "needs-input";
  const sameAccount = checkedAccount === accountKey;
  async function act(action: "check" | "authorize" | "continue") {
    if (working.current || !context || !correctAuthority || !connected) return;
    if (
      action === "check"
        ? !canRead
        : !sameAccount ||
          !resumable ||
          (action === "authorize" ? !canAuthorize : !canExecute || !grant)
    )
      return;
    const assertCurrent = () => {
      if (!mounted.current || active.current !== accountKey)
        throw new Error(
          "The account or computer access changed. Check the original restore again before continuing.",
        );
    };
    working.current = true;
    setBusy(true);
    setError(null);
    setAccessRepair(undefined);
    const run = async () => {
      if (action === "check") {
        setGrant(null);
        const result = await checkLibraryRestoreRequest(original, async (target) => {
          const answer = await lookup(target);
          if (answer._tag === "Failure") throw squashLibraryCommandFailure(answer);
          return answer.value;
        });
        assertCurrent();
        setChecked(result);
        setError(result.error);
        setCheckedAccount(accountKey);
        setAccessRepair(result.accessRepair);
      } else if (action === "authorize") {
        setGrant(null);
        const renewed = await renewLibraryRestoreRequest(checked!, authorityId, {
          assertCurrent,
          authorize: async (target) => {
            const result = await authorize(target);
            if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
            return result.value;
          },
        });
        setGrant(renewed);
      } else {
        const selected = checked!;
        setGrant(null);
        const result = await continueLibraryRestoreRequest(selected, grant!, Date.now(), {
          assertCurrent,
          execute: async (target) => {
            setChecked(null);
            const answer = await execute(target);
            if (answer._tag === "Failure") throw squashLibraryCommandFailure(answer);
            return answer.value;
          },
        });
        assertCurrent();
        setChecked(result);
        setError(result.error);
        setAccessRepair(result.accessRepair);
        onChanged();
      }
    };
    await run()
      .catch((cause: unknown) => {
        if (mounted.current && active.current === accountKey) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not recover this restore. Check its original receipt again.",
          );
          setAccessRepair(
            libraryAccessRepairFromFailure(
              cause,
              action === "authorize" ? context.libraryEnvironmentId : original.environmentId,
            ),
          );
        }
      })
      .finally(() => {
        working.current = false;
        if (mounted.current) setBusy(false);
      });
  }
  return (
    <LibraryDialog
      open
      title="Continue saved restore"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      description="Check the original request, renew its authorization, then explicitly continue restoring its files."
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={busy || !context || !correctAuthority || !connected || !canRead}
            onClick={() => void act("check")}
          >
            Check restore result
          </Button>
          {resumable && !grant ? (
            <Button
              disabled={busy || !sameAccount || !correctAuthority || !canAuthorize}
              onClick={() => void act("authorize")}
            >
              Renew restore authorization
            </Button>
          ) : null}
          {resumable && grant ? (
            <Button
              disabled={busy || !sameAccount || !correctAuthority || !canExecute}
              onClick={() => void act("continue")}
            >
              Continue original restore
            </Button>
          ) : null}
        </>
      }
    >
      {context ? (
        <div className="space-y-2 text-sm">
          <p>{context.project.title}</p>
          <p>
            Source: {context.sourceCopy.environmentId} · {context.sourceCopy.rootPath}
          </p>
          <p>
            Destination: {original.environmentId} ·{" "}
            {context.rootPath ?? "Original computer-selected folder"}
          </p>
          <p className="text-muted-foreground">
            Request {context.requestId}. Renewing authorization keeps this selection and does not
            restore files.
          </p>
        </div>
      ) : (
        <p role="status">
          Update the destination computer and refresh this request to recover its original restore
          selection.
        </p>
      )}
      {busy ? <p role="status">Checking the saved restore…</p> : null}
      {checked ? (
        <p role="status">
          {checked.state === "succeeded" && checked.result && "rootPath" in checked.result
            ? `Files restored at ${checked.result.rootPath}.`
            : checked.phase}
        </p>
      ) : null}
      {grant ? (
        <p role="status">
          Authorization is ready until {grant.expiresAt}. Continue explicitly when you are ready.
        </p>
      ) : null}
      {!correctAuthority && context ? (
        <LibraryAccessRepairNotice
          accessRepair={{ kind: "connection", environmentId: context.libraryEnvironmentId }}
        />
      ) : null}
      <LibraryAccessNotice block={access} />
      <LibraryAccessNotice block={authorityAccess} />
      <LibraryErrorNotice
        error={error}
        accessRepair={accessRepair}
        accessContext={{
          environmentId: original.environmentId,
          authorityEnvironmentId: context?.libraryEnvironmentId,
        }}
      />
      {!error && checked?.accessRepair ? (
        <LibraryAccessRepairNotice accessRepair={checked.accessRepair} />
      ) : null}
    </LibraryDialog>
  );
}
