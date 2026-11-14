import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  accountComputerEnrollmentReady,
  directoryReportingView,
  ownComputerEnrollment,
  squashLibraryCommandFailure,
  supportsLoomFeature,
  type OwnComputerEnrollment,
} from "@t3tools/client-runtime/fork";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { ACCOUNT_ENROLLMENT_FEATURE, LibraryError } from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { directoryReporting } from "../directory-computers/state";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";
import { reach } from "../reach/state";

const isLibraryError = Schema.is(LibraryError);
const RequestId = Schema.NullOr(Schema.String);
const RETRY_TEXT = "Setup could not finish. Try again to resume it.";

export type AccountEnrollmentRun =
  | { readonly phase: "running" }
  | { readonly phase: "done" }
  | { readonly phase: "failed"; readonly error: string };

// One run per computer and Library this session, shared by the automatic and manual paths.
const runsAtom = Atom.make<ReadonlyMap<string, AccountEnrollmentRun>>(new Map()).pipe(
  Atom.keepAlive,
  Atom.withLabel("account-enrollment-runs"),
);

const setRun = (key: string, run: AccountEnrollmentRun) =>
  appAtomRegistry.set(runsAtom, new Map(appAtomRegistry.get(runsAtom)).set(key, run));

/** Computers that can join an account: this excludes the Library itself and LoomOS hosts. */
export function accountSetupApplies(environment: EnvironmentPresentation) {
  const capabilities = environment.serverConfig?.environment.capabilities;
  return (
    supportsLoomFeature(capabilities, ACCOUNT_ENROLLMENT_FEATURE) &&
    capabilities?.libraryAuthority !== true &&
    capabilities?.supportsExecution !== false
  );
}

const CHECKING: OwnComputerEnrollment = { kind: "waiting", reason: "checking" };

/**
 * Adds a computer to the signed-in Library account: prepare on the computer, approve on the
 * Library, install on the computer. A saved request id makes an interrupted run resume.
 */
export function useComputerEnrollment(environment: EnvironmentPresentation) {
  const authority = useLibraryAuthority();
  const connected = environment.connection.phase === "connected";
  const source = useEnvironmentQuery(
    connected ? projectLibrary.info({ environmentId: environment.environmentId, input: {} }) : null,
  );
  const computers = useEnvironmentQuery(
    authority.connected && authority.authorityId
      ? projectLibrary.accountComputers({ environmentId: authority.authorityId, input: {} })
      : null,
  );
  const canInstall = useAtomValue(
    projectLibrary.enrollComputer.permissionAtom(environment.environmentId),
  );
  const canApprove = useEnvironmentScope(authority.authorityId, AuthSettingsWriteScope);
  const enroll = useAtomCommand(projectLibrary.enrollComputer, { reportFailure: false });
  const reportAtom = directoryReporting(connected ? environment.environmentId : null);
  const refreshReport = useAtomRefresh(reportAtom);
  const report = directoryReportingView(useAtomValue(reportAtom), connected).report;
  const route = useAtomValue(reach.status(connected ? environment.environmentId : null));
  const key = `loom:account-enrollment:v1:${environment.environmentId}:${authority.authorityId}`;
  const [savedRequestId, saveRequestId] = useLocalStorage(key, null, RequestId);
  const run = useAtomValue(runsAtom).get(key) ?? null;
  const signedIn = report?.signIn?.state === "ready" || report?.signIn?.state === "expiring";
  const membership = computers.isSuccess
    ? (computers.data?.find((computer) => computer.environmentId === environment.environmentId) ??
      null)
    : undefined;
  const sourceLibraryEnvironmentId = source.isSuccess
    ? (source.data?.destination?.environmentId ?? null)
    : undefined;
  const plan =
    connected && report === null
      ? CHECKING
      : ownComputerEnrollment({
          libraryEnvironmentId: authority.authorityId,
          libraryConnected: authority.connected,
          computerConnected: connected,
          permitted: canInstall && canApprove,
          sourceLibraryEnvironmentId,
          membership,
          signedIn,
        });
  const ready = accountComputerEnrollmentReady({
    libraryEnvironmentId: authority.authorityId,
    sourceLibraryEnvironmentId: sourceLibraryEnvironmentId ?? null,
    membership: membership ?? null,
    signedIn,
    remoteEnabled: Option.exists(AsyncResult.value(route), (status) => status.enabled),
  });

  const start = async (): Promise<AccountEnrollmentRun> => {
    const current = appAtomRegistry.get(runsAtom).get(key);
    if (current?.phase === "running") return current;
    if (authority.authorityId === null) return { phase: "failed", error: RETRY_TEXT };
    const finish = (next: AccountEnrollmentRun) => {
      setRun(key, next);
      return next;
    };
    setRun(key, { phase: "running" });
    try {
      // Read at call time: a retry from an older render must resume the same request.
      const requestId = getLocalStorageItem(key, RequestId) ?? randomUUID();
      saveRequestId(requestId);
      if (getLocalStorageItem(key, RequestId) !== requestId)
        return finish({
          phase: "failed",
          error: "Loom could not save this setup request. Allow site storage and try again.",
        });
      const result = await enroll({
        environmentId: environment.environmentId,
        input: { authorityEnvironmentId: authority.authorityId, requestId },
      });
      if (result._tag === "Failure") {
        const cause = squashLibraryCommandFailure(result);
        if (isLibraryError(cause) && cause.reason === "request-conflict") saveRequestId(null);
        return finish({
          phase: "failed",
          error: cause instanceof Error ? cause.message : RETRY_TEXT,
        });
      }
      saveRequestId(null);
      refreshReport();
      source.refresh();
      computers.refresh();
      return finish({ phase: "done" });
    } catch (cause) {
      return finish({
        phase: "failed",
        error: cause instanceof Error ? cause.message : RETRY_TEXT,
      });
    }
  };

  return {
    plan,
    ready,
    run,
    resuming: savedRequestId !== null,
    accountError: computers.error,
    checkAccountAgain: computers.refresh,
    start,
  };
}
