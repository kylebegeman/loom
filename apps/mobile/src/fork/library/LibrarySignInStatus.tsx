import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  identityRenewalLimitSeconds,
  LIBRARY_SIGN_IN_STATE_LABEL,
  librarySignIn,
  librarySignInText,
  loomIdentityAccountLabel,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { useEnvironmentPresentation } from "../../state/presentation";
import { environmentSession } from "../../state/session";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { loadLibraryIdentity } from "./libraryIdentity";
import { useLibraryAuthorityId } from "./libraryState";

const minuteAtom = Atom.make((get) => {
  // @effect-diagnostics-next-line globalDate:off -- Client clock for the sign-in's end time.
  const now = Date.now();
  // @effect-diagnostics-next-line globalTimers:off -- Atom-owned tick is disposed on refresh and unmount.
  const timer = setTimeout(() => get.refreshSelf(), 60_000 - (now % 60_000));
  get.addFinalizer(() => clearTimeout(timer));
  return now;
}).pipe(Atom.withLabel("mobile:library-sign-in:minute"));

const identityMetadata = Atom.family((key: string) => {
  const [environmentId, httpBaseUrl] = JSON.parse(key) as [string, string];
  return Atom.make(
    Effect.promise(() =>
      loadLibraryIdentity(httpBaseUrl, EnvironmentId.make(environmentId)).catch(() => null),
    ),
  ).pipe(Atom.setIdleTTL(5 * 60_000), Atom.withLabel(`mobile:library-identity:${key}`));
});
const NO_METADATA: Atom.Atom<AsyncResult.AsyncResult<LoomIdentityMetadata | null>> = Atom.make(
  AsyncResult.success(null),
);
const NO_SESSION = Atom.make(null);

const hostOf = (url: string | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** The phone's sign-in to its Library, in the words every client uses. */
export function useLibrarySignInStatus() {
  const environmentId = useLibraryAuthorityId();
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connection = useSavedRemoteConnection(environmentId);
  const session = useAtomValue(
    environmentId === null ? NO_SESSION : environmentSession.sessionStateValueAtom(environmentId),
  );
  const identityBaseUrl = connection?.identity
    ? (connection.identityHttpBaseUrl ?? connection.httpBaseUrl)
    : null;
  const metadata = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(
        environmentId !== null && identityBaseUrl !== null
          ? identityMetadata(JSON.stringify([environmentId, identityBaseUrl]))
          : NO_METADATA,
      ),
    ),
  );
  const now = useAtomValue(minuteAtom);
  // The phone renews whenever its Library allows it.
  const signIn = librarySignIn({
    connection:
      presentation?.entry.enabled === true
        ? { phase: presentation.connection.phase, identity: connection?.identity !== undefined }
        : null,
    session: session
      ? {
          authenticated: session.authenticated,
          expiresAt: session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : null,
        }
      : null,
    renews: metadata !== null && identityRenewalLimitSeconds(metadata) !== null,
    now,
  });
  const account = connection?.identity;
  return {
    environmentId,
    label: connection?.environmentLabel ?? "Your Library",
    address: hostOf(connection?.identityHttpBaseUrl ?? connection?.displayUrl),
    account: account
      ? `Signed in as ${loomIdentityAccountLabel(account) ?? `an account on ${hostOf(account.issuer)}`}`
      : connection
        ? "Connected with a pairing link, not an account."
        : null,
    signIn,
    text: librarySignInText(signIn, now),
    stateLabel: LIBRARY_SIGN_IN_STATE_LABEL[signIn.state],
  };
}

/** Which Library the phone signs in to, as whom, whether it is current, and Sign in again. */
export function LibrarySignInSection() {
  const navigation = useNavigation();
  const status = useLibrarySignInStatus();
  if (status.environmentId === null) return null;
  const environmentId = status.environmentId;
  return (
    <SettingsSection title="Sign-in">
      <Text className="px-4 pt-3 text-base text-foreground">
        {[status.label, status.address].filter(Boolean).join(" · ")}
      </Text>
      {status.account ? (
        <Text className="px-4 pt-1 text-sm text-foreground-muted">{status.account}</Text>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        className={cn(
          "px-4 pt-1 pb-3 text-sm",
          status.signIn.state === "expired" ? "text-danger-foreground" : "text-foreground-muted",
        )}
      >
        {status.text}
      </Text>
      {status.signIn.identity || status.signIn.state === "signed-out" ? (
        <SettingsActionRow
          icon="person.crop.circle"
          label={status.signIn.state === "signed-out" ? "Sign in" : "Sign in again"}
          onPress={() => navigation.navigate("LibrarySignIn", { environmentId })}
        />
      ) : null}
    </SettingsSection>
  );
}

/** The repair for a Library denial that says to sign in again. */
export function LibrarySignInAgainButton() {
  const navigation = useNavigation();
  const environmentId = useLibraryAuthorityId();
  return (
    <Button
      label="Sign in again"
      tone="secondary"
      onPress={() => navigation.navigate("LibrarySignIn", environmentId ? { environmentId } : {})}
    />
  );
}
