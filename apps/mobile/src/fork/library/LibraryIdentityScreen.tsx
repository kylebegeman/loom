import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { savedIdentitySignIn } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import { useLibraryAuthority } from "./libraryState";
import {
  NativeIdentitySignInExpired,
  saveNativeIdentitySignIn,
  signInWithNativeIdentity,
} from "./nativeIdentitySignIn";

type IdentityRouteParams = { readonly environmentId?: string; readonly address?: string };

const SIGN_IN_PROGRESS = {
  "signing-in": "Sign in with your account...",
  verifying: "Verifying computer access...",
} as const;
const SAVING = "Saving computer access...";
const CANCELLED_OR_EXPIRED = "Sign-in cancelled or expired. Try again.";

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
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const entry = environmentId === null ? undefined : catalog.entries.get(environmentId);
  // The resource this computer first signed in with; a computer naming another is refused.
  const expectedResource =
    entry === undefined
      ? undefined
      : savedIdentitySignIn(entry, "native")?.request.expectedResource;
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
  // Aborting closes an open provider sheet; `signInWithNativeIdentity` listens for it.
  useEffect(() => () => active.current?.abort(), []);

  function cancel() {
    active.current?.abort();
  }

  function signIn() {
    if (active.current || !address.trim()) return;
    const abort = new AbortController();
    active.current = abort;
    setPending("Checking computer...");
    setError(null);
    // A promise chain, not try/finally, which the React Compiler cannot compile.
    return (async () => {
      const signedIn = await signInWithNativeIdentity({
        httpBaseUrl: address,
        expectedEnvironmentId: environmentId ?? undefined,
        options: {
          requireSessionExchange: true,
          ...(connection?.identity ? { expectedIdentity: connection.identity } : {}),
          ...(expectedResource === undefined ? {} : { expectedResource }),
        },
        label: connection?.environmentLabel,
        signal: abort.signal,
        onProgress: (stage) => setPending(SIGN_IN_PROGRESS[stage]),
      });
      if (signedIn === null) {
        // Closing the provider sheet is not an error; Cancel sign-in or leaving the screen is.
        if (abort.signal.aborted) setError(CANCELLED_OR_EXPIRED);
        return;
      }
      setPending(SAVING);
      await saveNativeIdentitySignIn(signedIn, { register, enable });
      const savedId = signedIn.registration.profile.environmentId;
      if (purpose === "library") {
        await authority.select(savedId);
        navigation.navigate("Library");
      } else
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: {
            screen: "SettingsEnvironmentDetail",
            params: { environmentId: savedId },
          },
        });
    })()
      .catch((cause: unknown) =>
        setError(
          abort.signal.aborted || cause instanceof NativeIdentitySignInExpired
            ? CANCELLED_OR_EXPIRED
            : cause instanceof Error
              ? cause.message
              : "Identity sign-in could not complete.",
        ),
      )
      .finally(() => {
        active.current = null;
        setPending(null);
      });
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
            disabled={pending === SAVING}
            onPress={cancel}
          />
        ) : null}
        {error ? <LibraryNotice error={error} /> : null}
        <Text className="text-xs text-foreground-muted">
          Each sign-in lasts up to an hour. If this computer sets a sign-in limit, Loom renews it on
          its own until then. Removing this computer from Connections ends this device's sign-in.
          Pairing remains available.
        </Text>
      </View>
    </LibraryPage>
  );
}
