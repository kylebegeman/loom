import { useClerk, useSignIn, useUser } from "@clerk/expo";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { NativeHeaderToolbar } from "../../native/NativeHeaderToolbar";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { Button } from "../../components/ui/Button";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import {
  connectEmailSignInError,
  CONNECT_FACTOR_LABELS,
  connectAccountPageUrl,
  connectSecondFactors,
  prepareConnectSecondFactor,
  verifyConnectSecondFactor,
  type ConnectSecondFactor,
  normalizeConnectEmail,
  sendConnectEmailCode,
  verifyConnectEmailCode,
} from "./connectEmailSignIn";
import { hasCloudPublicConfig, resolveCloudPublicConfig } from "../../features/cloud/publicConfig";
import { T3ConnectProfilePage } from "../../features/cloud/T3ConnectProfilePage";

const RESEND_DELAY_MS = 30_000;

/** A complete account flow without another app's passkeys or OAuth callback schemes. */
export function ConnectEmailAuthView(props: { readonly onBack: () => void }) {
  const { signIn } = useSignIn();
  const accountPortalUrl = resolveCloudPublicConfig().clerk.accountPortalUrl;
  const [secondFactor, setSecondFactor] = useState<ConnectSecondFactor | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [pending, setPending] = useState<"send" | "verify" | "reset" | "signup" | "factor" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount state so async sign-in errors arriving after unmount are dropped
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the resend cooldown timer after a code is sent and clears it on change
  useEffect(() => {
    if (sentAt === null) return;
    const timer = setTimeout(() => setCanResend(true), RESEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sentAt]);

  const run = async (kind: NonNullable<typeof pending>, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(connectEmailSignInError(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const sendCode = () =>
    void run("send", async () => {
      if (!signIn) return;
      const normalized = normalizeConnectEmail(email);
      if (secondFactor) await prepareConnectSecondFactor(signIn, secondFactor);
      else await sendConnectEmailCode(signIn, normalized);
      if (!mounted.current) return;
      setEmail(normalized);
      setCode("");
      setCanResend(false);
      setSentAt(Date.now());
    });
  const verifyCode = () =>
    void run("verify", async () => {
      if (!signIn) return;
      const result = secondFactor
        ? await verifyConnectSecondFactor(signIn, secondFactor, code)
        : await verifyConnectEmailCode(signIn, code);
      if (result === "second-factor") {
        const factor = connectSecondFactors(signIn)[0]!;
        if (!mounted.current) return;
        setSecondFactor(factor);
        setCode("");
        setCanResend(false);
        setSentAt(Date.now());
        await prepareConnectSecondFactor(signIn, factor);
      }
    });
  const selectFactor = (factor: ConnectSecondFactor) =>
    void run("factor", async () => {
      if (!signIn) return;
      await prepareConnectSecondFactor(signIn, factor);
      if (!mounted.current) return;
      setSecondFactor(factor);
      setCode("");
      setCanResend(false);
      setSentAt(Date.now());
    });
  const changeEmail = () =>
    void run("reset", async () => {
      if (signIn) {
        const result = await signIn.reset();
        if (result.error) throw result.error;
      }
      if (!mounted.current) return;
      setSentAt(null);
      setSecondFactor(null);
      setCode("");
    });

  return (
    <View className="flex-1 bg-sheet">
      <AppBar title="Sign in to Connect" sidebar={false} onBack={props.onBack} />
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="w-full max-w-xl self-center gap-5 px-5 py-6">
          <AppText className="text-foreground-secondary">
            Sign in with the same Connect account you use on your computers. Your linked computers
            will appear here automatically.
          </AppText>
          {!signIn ? (
            <AppActivityIndicator accessibilityLabel="Loading sign-in" />
          ) : sentAt === null ? (
            <>
              <View className="gap-2">
                <AppText className="font-t3-medium">Email address</AppText>
                <AppTextInput
                  accessibilityLabel="Connect account email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  returnKeyType="go"
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={sendCode}
                  editable={!pending}
                />
              </View>
              <Button
                label={pending === "send" ? "Sending code…" : "Send sign-in code"}
                tone="primary"
                loading={pending !== null}
                disabled={!email.trim()}
                onPress={sendCode}
                fullWidth
              />
              <Button
                label="Create a Connect account"
                tone="text"
                disabled={pending !== null}
                onPress={() =>
                  void run("signup", async () => {
                    await Linking.openURL(connectAccountPageUrl(accountPortalUrl, "sign-up"));
                  })
                }
              />
            </>
          ) : (
            <>
              <AppText>
                {secondFactor === "totp"
                  ? "Enter the six-digit code from your authenticator app."
                  : secondFactor === "backup_code"
                    ? "Enter an unused backup code from your account."
                    : secondFactor === "phone_code"
                      ? "Enter the six-digit code sent to your enrolled phone number."
                      : secondFactor === "email_code"
                        ? "Verify this device with the additional code sent to your email."
                        : `A six-digit code was sent to ${email}. Enter it below.`}
              </AppText>
              <View className="gap-2">
                <AppText className="font-t3-medium">
                  {secondFactor ? CONNECT_FACTOR_LABELS[secondFactor] : "Sign-in code"}
                </AppText>
                <AppTextInput
                  accessibilityLabel={
                    secondFactor
                      ? `${CONNECT_FACTOR_LABELS[secondFactor]} verification code`
                      : "Six-digit sign-in code"
                  }
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  keyboardType={secondFactor === "backup_code" ? "default" : "number-pad"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={secondFactor === "backup_code" ? 64 : 6}
                  value={code}
                  onChangeText={(value) =>
                    setCode(secondFactor === "backup_code" ? value : value.replace(/\D/g, ""))
                  }
                  onSubmitEditing={verifyCode}
                  editable={!pending}
                  autoFocus
                />
              </View>
              <Button
                label={pending === "verify" ? "Signing in…" : "Sign in"}
                tone="primary"
                loading={pending !== null}
                disabled={secondFactor === "backup_code" ? !code.trim() : code.length !== 6}
                onPress={verifyCode}
                fullWidth
              />
              <View className="gap-2">
                {!secondFactor || secondFactor === "email_code" || secondFactor === "phone_code" ? (
                  <Button
                    label={
                      pending === "send"
                        ? "Sending code…"
                        : canResend
                          ? "Resend code"
                          : "Wait a moment to resend"
                    }
                    tone="text"
                    disabled={pending !== null || !canResend}
                    onPress={sendCode}
                  />
                ) : null}
                {secondFactor
                  ? connectSecondFactors(signIn)
                      .filter((factor) => factor !== secondFactor)
                      .map((factor) => (
                        <Button
                          key={factor}
                          label={`Use ${CONNECT_FACTOR_LABELS[factor].toLowerCase()}`}
                          tone="text"
                          disabled={pending !== null}
                          onPress={() => selectFactor(factor)}
                        />
                      ))
                  : null}
                <Button
                  label="Use a different email"
                  tone="text"
                  disabled={pending !== null}
                  onPress={changeEmail}
                />
              </View>
            </>
          )}
          {error ? <ErrorBanner message={error} /> : null}
        </View>
      </ScreenScrollView>
    </View>
  );
}

/** Profile edits happen on the account service; sign-out keeps the existing relay cleanup path. */
export function ConnectEmailAccountView(props: { readonly onBack: () => void }) {
  const clerk = useClerk();
  const { user } = useUser();
  const accountPortalUrl = resolveCloudPublicConfig().clerk.accountPortalUrl;
  const linkedComputersAvailable = hasCloudPublicConfig();
  const [page, setPage] = useState<"account" | "computers">("account");
  const [pending, setPending] = useState<"open" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount state so async sign-in errors arriving after unmount are dropped
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (kind: NonNullable<typeof pending>, action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(connectEmailSignInError(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };
  if (page === "computers" && linkedComputersAvailable) {
    return (
      <View className="flex-1 bg-sheet">
        <AppBar
          title="Linked computers"
          sidebar={false}
          options={{ headerBackVisible: false }}
          onBack={() => setPage("account")}
        />
        {Platform.OS === "ios" ? (
          <NativeHeaderToolbar placement="left">
            <NativeHeaderToolbar.Button
              accessibilityLabel="Back to account"
              icon="chevron.left"
              onPress={() => setPage("account")}
              separateBackground
            />
          </NativeHeaderToolbar>
        ) : null}
        <T3ConnectProfilePage />
      </View>
    );
  }
  return (
    <View className="flex-1 bg-sheet">
      <AppBar title="Connect account" sidebar={false} onBack={props.onBack} />
      <ScreenScrollView contentInsetAdjustmentBehavior="automatic">
        <View className="w-full max-w-xl self-center gap-5 px-5 py-6">
          <AppText className="font-t3-medium">
            {user?.primaryEmailAddress?.emailAddress ?? "Signed in"}
          </AppText>
          <AppText className="text-foreground-secondary">
            Manage your account's linked computers here, or open profile and sign-in settings in the
            browser. Connections manages access on this device.
          </AppText>
          {linkedComputersAvailable ? (
            <Button
              label="Linked computers"
              tone="primary"
              disabled={pending !== null}
              onPress={() => setPage("computers")}
              fullWidth
            />
          ) : null}
          <Button
            label="Manage account"
            tone="primary"
            disabled={pending !== null}
            onPress={() =>
              void run("open", () =>
                Linking.openURL(connectAccountPageUrl(accountPortalUrl, "user")),
              )
            }
          />
          <Button
            label={pending === "signout" ? "Signing out…" : "Sign out"}
            disabled={pending !== null}
            onPress={() => void run("signout", () => clerk.signOut())}
          />
          {error ? <ErrorBanner message={error} /> : null}
        </View>
      </ScreenScrollView>
    </View>
  );
}
