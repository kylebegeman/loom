import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useEffect, useInsertionEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  checkLibraryRestoreRequest,
  continueLibraryRestoreRequest,
  renewLibraryRestoreRequest,
  libraryAccessRepairFromFailure,
  squashLibraryCommandFailure,
} from "@t3tools/client-runtime/fork";
import type { LibraryOperation, LibraryRecoveryGrant } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentSessionState } from "../../state/session";
import { useEnvironments } from "../../state/environments";
import { LibraryPage, LibraryNotice } from "./LibraryPage";
import { library, refreshLibraryWork, useLibraryAuthorityId } from "./libraryState";

export function LibraryRestoreRouteScreen({
  route,
}: StaticScreenProps<{ readonly operation: LibraryOperation }>) {
  return (
    <RestoreRequestContent
      key={`${route.params.operation.environmentId}:${route.params.operation.id}`}
      operation={route.params.operation}
    />
  );
}
function RestoreRequestContent({ operation: original }: { operation: LibraryOperation }) {
  const navigation = useNavigation();
  const context = original.restoreRequest;
  const authorityId = useLibraryAuthorityId();
  const identity = useEnvironmentSessionState(original.environmentId)?.identity;
  const authorityIdentity = useEnvironmentSessionState(
    context?.libraryEnvironmentId ?? null,
  )?.identity;
  const { environments } = useEnvironments();
  const computer = environments.find((entry) => entry.environmentId === original.environmentId);
  const sourceComputer = environments.find(
    (entry) => entry.environmentId === context?.sourceCopy.environmentId,
  );
  const connected = computer?.entry.enabled === true && computer.connection.phase === "connected";
  const correctAuthority = context !== undefined && authorityId === context.libraryEnvironmentId;
  const canRead = useAtomValue(library.operationOutcome.permissionAtom(original.environmentId));
  const canAuthorize = useAtomValue(
    library.authorizeRecovery.permissionAtom(context?.libraryEnvironmentId ?? null),
  );
  const canExecute = useAtomValue(library.executeOperation.permissionAtom(original.environmentId));
  const lookup = useAtomCommand(library.operationOutcome, { reportFailure: false });
  const authorize = useAtomCommand(library.authorizeRecovery, { reportFailure: false });
  const execute = useAtomCommand(library.executeOperation, { reportFailure: false });
  const onChanged = () => {
    if (context) refreshLibraryWork(context.libraryEnvironmentId, context.project.id);
  };
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
    <LibraryPage title="Continue saved restore" back>
      <View className="gap-3">
        <Text>
          Check the original request, renew its authorization, then explicitly continue restoring
          its files.
        </Text>
        {context ? (
          <>
            <Text className="font-semibold">{context.project.title}</Text>
            <Text>
              Source: {sourceComputer?.label ?? context.sourceCopy.environmentId} ·{" "}
              {context.sourceCopy.rootPath}
            </Text>
            <Text>
              Destination: {computer?.label ?? original.environmentId} ·{" "}
              {context.rootPath ?? "Original computer-selected folder"}
            </Text>
            <Text className="text-sm text-foreground-muted">
              Request {context.requestId}. Renewing authorization keeps this selection and does not
              restore files.
            </Text>
          </>
        ) : (
          <LibraryNotice detail="Update the destination computer and refresh this request to recover its original restore selection." />
        )}
        {busy ? <Text accessibilityLiveRegion="polite">Checking the saved restore…</Text> : null}
        {checked ? (
          <Text accessibilityLiveRegion="polite">
            {checked.state === "succeeded" && checked.result && "rootPath" in checked.result
              ? `Files restored at ${checked.result.rootPath}.`
              : checked.phase}
          </Text>
        ) : null}
        {grant ? (
          <Text>
            Authorization is ready until {grant.expiresAt}. Continue explicitly when you are ready.
          </Text>
        ) : null}
        {!correctAuthority && context ? (
          <LibraryNotice
            detail="Reconnect the Library used for this restore."
            accessRepair={{ kind: "connection", environmentId: context.libraryEnvironmentId }}
          />
        ) : null}
        {!connected || !canRead || !canExecute ? (
          <LibraryNotice
            detail={
              !connected
                ? "Reconnect the destination computer to check this restore."
                : "Review this connection's permission to recover the saved restore."
            }
            accessRepair={{
              kind: !connected ? "connection" : "permission",
              environmentId: original.environmentId,
            }}
          />
        ) : null}
        {!canAuthorize && context ? (
          <LibraryNotice
            detail="Recovery authorization access is required on the original Library."
            accessRepair={{ kind: "permission", environmentId: context.libraryEnvironmentId }}
          />
        ) : null}
        <LibraryNotice
          error={error}
          accessRepair={accessRepair ?? checked?.accessRepair}
          accessContext={{
            environmentId: original.environmentId,
            authorityEnvironmentId: context?.libraryEnvironmentId,
          }}
        />
        <Button
          label="Check restore result"
          tone="secondary"
          disabled={busy || !context || !correctAuthority || !connected || !canRead}
          onPress={() => void act("check")}
        />
        {resumable && !grant ? (
          <Button
            label="Renew restore authorization"
            disabled={busy || !sameAccount || !correctAuthority || !canAuthorize}
            onPress={() => void act("authorize")}
          />
        ) : null}
        {resumable && grant ? (
          <Button
            label="Continue original restore"
            disabled={busy || !sameAccount || !correctAuthority || !canExecute}
            onPress={() => void act("continue")}
          />
        ) : null}
        <Button label="Done" tone="text" onPress={() => navigation.goBack()} />
      </View>
    </LibraryPage>
  );
}
