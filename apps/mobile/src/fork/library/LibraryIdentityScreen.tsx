import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
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
import Constants from "expo-constants";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import {
  exchangeLibraryIdentityToken,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
} from "./libraryIdentity";
import { useLibraryAuthority } from "./libraryState";

export function LibraryIdentityRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId?: string }>) {
  const environmentId = route.params?.environmentId
    ? EnvironmentId.make(route.params.environmentId)
    : null;
  return (
    <LibraryIdentityContent key={environmentId ?? "new-library"} environmentId={environmentId} />
  );
}
function LibraryIdentityContent({ environmentId }: { environmentId: EnvironmentId | null }) {
  const connection = useSavedRemoteConnection(environmentId);
  const authority = useLibraryAuthority(),
    navigation = useNavigation();
  const register = useAtomCommand(environmentCatalog.register, { reportFailure: false });
  const enable = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const [address, setAddress] = useState(connection?.httpBaseUrl ?? "");
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  usePreventRemove(pending !== null, () => undefined);
  async function signIn() {
    if (busy.current || !address.trim()) return;
    busy.current = true;
    setPending("Connecting to library…");
    setError(null);
    try {
      const destination = libraryIdentityAddress(address);
      const metadata = await loadLibraryIdentity(
        destination.httpBaseUrl,
        environmentId ?? undefined,
      );
      const configuredScheme = Constants.expoConfig?.scheme;
      const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
      if (!scheme) throw new Error("This app does not have a sign-in callback configured.");
      const redirectUri = makeRedirectUri({ scheme, path: "library-auth" });
      const discovery = {
        authorizationEndpoint: metadata.authorizationEndpoint,
        tokenEndpoint: metadata.tokenEndpoint,
      };
      const auth = new AuthRequest({
        clientId: metadata.nativeClientId,
        redirectUri,
        responseType: ResponseType.Code,
        usePKCE: true,
        scopes: [...metadata.scopes],
        extraParams: libraryIdentityResourceParameters(metadata),
      });
      setPending("Sign in with your account…");
      const result = await auth.promptAsync(discovery);
      if (result.type === "cancel" || result.type === "dismiss") return;
      if (result.type !== "success" || !result.params.code || !auth.codeVerifier)
        throw new Error("Account sign-in did not complete. Try again.");
      setPending("Saving library access…");
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
      await loadLibraryIdentity(destination.httpBaseUrl, metadata.environmentId);
      const session = await exchangeLibraryIdentityToken(
        destination.httpBaseUrl,
        account.accessToken,
      );
      const connectionId = `bearer:${metadata.environmentId}:${destination.httpBaseUrl}`;
      const label = connection?.environmentLabel ?? new URL(destination.httpBaseUrl).hostname;
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
          }),
          credential: new BearerConnectionCredential({ token: session.access_token }),
        }),
      );
      if (AsyncResult.isFailure(registration)) throw squashAtomCommandFailure(registration);
      const enabled = await enable({ environmentId: metadata.environmentId, enabled: true });
      if (AsyncResult.isFailure(enabled)) throw squashAtomCommandFailure(enabled);
      await authority.select(metadata.environmentId);
      navigation.navigate("Library");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Library sign-in could not complete.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  return (
    <LibraryPage title="Library sign-in" back>
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          Sign in with your library account and passkey. Your projects and saved conversations stay
          with this library; you choose a computer separately when starting work.
        </Text>
        <TextInput
          accessibilityLabel="Library server address"
          placeholder="https://your-library.example"
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
            This address must reach the saved library server.
          </Text>
        ) : null}
        <MaterialButton
          label={pending ?? "Sign in to library"}
          tone="primary"
          disabled={pending !== null || !address.trim()}
          onPress={() => {
            void signIn();
          }}
        />
        {error ? <LibraryNotice error={error} /> : null}
        <Text className="text-xs text-foreground-muted">
          Access is saved on this device. When it expires, sign in again. You can remove the saved
          connection in Connections.
        </Text>
      </View>
    </LibraryPage>
  );
}
