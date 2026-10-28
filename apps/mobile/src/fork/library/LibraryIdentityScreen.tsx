import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { loadIdentityDirectoryAddresses } from "@t3tools/client-runtime/fork";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { openSettings } from "../../features/settings/settings-navigation";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { LibraryNotice, LibraryPage } from "./LibraryPage";
import { identityAddressNeedsCheck } from "./libraryIdentity";
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
const ADDRESS_CHECK_FAILED =
  "Loom could not check this address with your Library. Try again, or use a pairing link.";

const loadDirectoryAddresses = createRuntimeCommand(connectionAtomRuntime, {
  label: "loom:identity:directory-addresses",
  execute: (libraryEnvironmentId: EnvironmentId | null) =>
    loadIdentityDirectoryAddresses(libraryEnvironmentId),
});

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
  const directoryAddresses = useAtomCommand(loadDirectoryAddresses, { reportFailure: false });
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
      // Any server can copy a computer's public sign-in settings, so a typed address must be one
      // the Library knows for the computer it claims to be.
      // A separate statement: the React Compiler cannot compile optional chaining in a ternary test.
      const needsCheck = identityAddressNeedsCheck(address, [
        connection?.httpBaseUrl,
        connection?.identityHttpBaseUrl,
      ]);
      const checked = needsCheck
        ? await Promise.race([
            directoryAddresses(authority.environmentId),
            // Cancel sign-in does not wait for a slow Library; the aborted sign-in below ends it.
            new Promise<null>((resolve) =>
              abort.signal.addEventListener("abort", () => resolve(null), { once: true }),
            ),
          ])
        : null;
      // An error must not switch the check off; desktop's sign-in fails here too.
      if (checked !== null && !AsyncResult.isSuccess(checked))
        throw new Error(ADDRESS_CHECK_FAILED);
      const directory = checked === null ? null : checked.value;
      const signedIn = await signInWithNativeIdentity({
        httpBaseUrl: address,
        expectedEnvironmentId: environmentId ?? undefined,
        options: {
          requireSessionExchange: true,
          ...(connection?.identity ? { expectedIdentity: connection.identity } : {}),
          ...(directory === null ? {} : { directory }),
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
      } else openSettings(navigation, "SettingsEnvironmentDetail", { environmentId: savedId });
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
