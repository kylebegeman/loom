// @effect-diagnostics globalDate:off globalTimers:off -- Expo OAuth is an imperative native boundary with a bounded cancellation timer.
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { AuthRequest, exchangeCodeAsync, makeRedirectUri, ResponseType } from "expo-auth-session";
import { dismissAuthSession } from "expo-web-browser";
import Constants from "expo-constants";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import {
  assertNativeIdentityUnchanged,
  exchangeLibraryIdentityToken,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
  loadNativeIdentityDiscovery,
} from "./libraryIdentity";
import { useLibraryAuthority } from "./libraryState";

type IdentityRouteParams = { readonly environmentId?: string; readonly address?: string };

export function LibraryIdentityRouteScreen({ route }: StaticScreenProps<IdentityRouteParams>) {
  const environmentId = route.params?.environmentId
    ? EnvironmentId.make(route.params.environmentId)
    : null;
  return (
    <IdentityContent
      key={environmentId ?? "new-library"}
      environmentId={environmentId}
      purpose="library"
      initialAddress={route.params?.address ?? ""}
    />
  );
}

export function ComputerIdentityRouteScreen({ route }: StaticScreenProps<IdentityRouteParams>) {
  const environmentId = route.params?.environmentId
    ? EnvironmentId.make(route.params.environmentId)
    : null;
  return (
    <IdentityContent
      key={environmentId ?? "new-computer"}
      environmentId={environmentId}
      purpose="computer"
      initialAddress={route.params?.address ?? ""}
    />
  );
}

function IdentityContent({
  environmentId,
  purpose,
  initialAddress,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly purpose: "library" | "computer";
  readonly initialAddress: string;
}) {
  const connection = useSavedRemoteConnection(environmentId);
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const register = useAtomCommand(environmentCatalog.register, { reportFailure: false });
  const enable = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const [address, setAddress] = useState(
    initialAddress ||
      connection?.identityHttpBaseUrl ||
      connection?.httpBaseUrl ||
      (purpose === "library" ? authority.destination?.url : "") ||
      "",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (active.current) {
        active.current.abort();
        try {
          dismissAuthSession();
        } catch {}
      }
    },
    [],
  );

  function cancel() {
    active.current?.abort();
    try {
      dismissAuthSession();
    } catch {
      /* The provider browser may already be closed. */
    }
  }

  async function signIn() {
    if (active.current || !address.trim()) return;
    const abort = new AbortController();
    active.current = abort;
    const timer = setTimeout(() => {
      abort.abort();
      try {
        dismissAuthSession();
      } catch {}
    }, 300_000);
    setPending("Checking computer...");
    setError(null);
    try {
      const destination = libraryIdentityAddress(address);
      const options = {
        requireSessionExchange: true,
        signal: abort.signal,
        ...(connection?.identity ? { expectedIdentity: connection.identity } : {}),
      };
      const metadata = await loadLibraryIdentity(
        destination.httpBaseUrl,
        environmentId ?? undefined,
        fetch,
        options,
      );
      const discovery = await loadNativeIdentityDiscovery(metadata, fetch, abort.signal);
      const configuredScheme = Constants.expoConfig?.scheme;
      const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
      if (!scheme) throw new Error("This app does not have a sign-in callback configured.");
      // Reuse the registered native callback for Library and ordinary computers.
      const redirectUri = makeRedirectUri({ scheme, path: "library-auth" });
      const auth = new AuthRequest({
        clientId: metadata.nativeClientId,
        redirectUri,
        responseType: ResponseType.Code,
        usePKCE: true,
        scopes: [
          ...new Set(["openid", ...metadata.scopes.filter((scope) => scope !== "offline_access")]),
        ],
        extraParams: libraryIdentityResourceParameters(metadata),
      });
      setPending("Sign in with your account...");
      const result = await auth.promptAsync(discovery);
      if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
      if (result.type === "cancel" || result.type === "dismiss") return;
      if (result.type !== "success" || !result.params.code || !auth.codeVerifier)
        throw new Error("Account sign-in did not complete. Try again.");
      setPending("Verifying computer access...");
      const account = await exchangeCodeAsync(
        {
          clientId: metadata.nativeClientId,
          code: result.params.code,
          redirectUri,
          extraParams: {
            code_verifier: auth.codeVerifier,
            ...libraryIdentityResourceParameters(metadata),
          },
        },
        discovery,
      );
      if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
      if (account.tokenType.toLowerCase() !== "bearer")
        throw new Error("The Identity provider returned an unsupported token type.");
      const current = await loadLibraryIdentity(
        destination.httpBaseUrl,
        metadata.environmentId,
        fetch,
        options,
      );
      assertNativeIdentityUnchanged(metadata, current);
      const session = await exchangeLibraryIdentityToken(
        destination.httpBaseUrl,
        account.accessToken,
        fetch,
        { ...options, metadata },
      );
      if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
      if (!session.identity || session.environmentId !== metadata.environmentId)
        throw new Error(
          "The computer did not return verified Identity access. Update it or use pairing.",
        );
      const connectionId = `bearer:${metadata.environmentId}:${destination.httpBaseUrl}`;
      const label = connection?.environmentLabel ?? new URL(destination.httpBaseUrl).hostname;
      const expiresAt = Math.min(
        Date.now() + session.expires_in * 1000,
        account.expiresIn === undefined
          ? Number.MAX_SAFE_INTEGER
          : (account.issuedAt + account.expiresIn) * 1000,
      );
      if (expiresAt <= Date.now()) throw new Error("Identity access expired. Sign in again.");
      clearTimeout(timer);
      setPending("Saving computer access...");
      const registration = await register(
        new BearerConnectionRegistration({
          target: new BearerConnectionTarget({
            environmentId: metadata.environmentId,
            label,
            connectionId,
          }),
          profile: new BearerConnectionProfile({
            connectionId,
            environmentId: metadata.environmentId,
            label,
            ...destination,
            identity: session.identity,
          }),
          credential: new BearerConnectionCredential({
            token: session.access_token,
            identity: { ...session.identity, environmentId: metadata.environmentId, expiresAt },
          }),
        }),
      );
      if (AsyncResult.isFailure(registration)) throw squashAtomCommandFailure(registration);
      if (!registration.value)
        throw new Error("This computer is managed by this app and cannot be added here.");
      const enabled = await enable({ environmentId: metadata.environmentId, enabled: true });
      if (AsyncResult.isFailure(enabled)) throw squashAtomCommandFailure(enabled);
      if (purpose === "library") {
        await authority.select(metadata.environmentId);
        navigation.navigate("Library");
      } else
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: {
            screen: "SettingsEnvironmentDetail",
            params: { environmentId: metadata.environmentId },
          },
        });
    } catch (cause) {
      setError(
        abort.signal.aborted
          ? "Sign-in cancelled or expired. Try again."
          : cause instanceof Error
            ? cause.message
            : "Identity sign-in could not complete.",
      );
    } finally {
      clearTimeout(timer);
      active.current = null;
      setPending(null);
    }
  }
  return (
    <LibraryPage title={purpose === "library" ? "Library sign-in" : "Computer sign-in"} back>
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          {purpose === "library"
            ? "Sign in to your Library with its configured Identity account. Choose an execution computer separately when starting work."
            : "Sign in with the Identity account configured by this computer's administrator. No pairing code is needed. Direct and tailnet addresses are supported; T3 Connect uses its own account."}
        </Text>
        {connection?.identity ? (
          <Text className="text-xs text-foreground-muted">
            Saved Identity provider: {connection.identity.issuer}. Sign in with the same account to
            renew access.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Computer address"
          placeholder="https://your-computer.example"
          value={address}
          onChangeText={setAddress}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          editable={pending === null}
          className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
        />
        {environmentId ? (
          <Text className="text-xs text-foreground-muted">
            This address must reach the saved computer.
          </Text>
        ) : null}
        <Button
          label={pending ?? "Sign in with Identity"}
          tone="primary"
          disabled={pending !== null || !address.trim()}
          onPress={() => void signIn()}
        />
        {pending ? (
          <Button
            label="Cancel sign-in"
            tone="text"
            disabled={pending === "Saving computer access..."}
            onPress={cancel}
          />
        ) : null}
        {error ? <LibraryNotice error={error} /> : null}
        <Text className="text-xs text-foreground-muted">
          Access lasts up to one hour. Sign in again when it expires. Removing this computer from
          Connections revokes this device's current Identity session. Pairing remains available.
        </Text>
      </View>
    </LibraryPage>
  );
}
