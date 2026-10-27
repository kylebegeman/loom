import { Button } from "../../components/ui/Button"; // fork: fleet-connections
import { ListRow } from "../../components/ui/ListRow";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAuth } from "@clerk/expo";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  useRoute,
  type StaticScreenProps,
} from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react"; // fork: fleet-connections
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../../lib/cn";
// fork: fleet-connections -- the Connect button below replaces the header checkmark and its icon color
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { AppText as Text, AppTextInput, type AppTextInputProps } from "../../components/ui/AppText";
import { FrostedCutout } from "../../components/ui/FrostedCutout";
import { buildPairingUrl, extractPairingUrlFromQrPayload, parsePairingUrl } from "./pairing";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { SymbolView } from "../../components/ui/AppSymbol";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { CloudEnvironmentRows } from "./CloudEnvironmentRows";
import { autoConnectReport, devAutoConnectAttemptAtom } from "./devAutoConnect";
import { splitEnvironmentSections } from "./environmentSections";
// fork: directory-computers
import { pairingFormChecks } from "../../fork/directory-computers/directoryComputers";
import { leaveSettingsPage } from "../settings/settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";

type ConnectionsNewRouteParams = {
  readonly libraryComputer?: EnvironmentId; // fork: directory-computers
  readonly mode?: string;
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
  readonly routeFor?: EnvironmentId;
};

export function ConnectionsNewRouteScreen({
  route,
}: StaticScreenProps<ConnectionsNewRouteParams | undefined>) {
  const params = route.params ?? {};
  // Dev-only prefill prevents production links from supplying an attacker-chosen host and token.
  const routePairingUrl = __DEV__ ? (params.pairingUrl?.trim() ?? "") : "";
  // A new prefill link replaces whatever the form held.
  return (
    <PairingForm
      key={routePairingUrl}
      routePairingUrl={routePairingUrl}
      routeFor={params.routeFor}
      checks={pairingFormChecks(params)} // fork: directory-computers
    />
  );
}

function PairingForm({
  routePairingUrl,
  routeFor,
  checks, // fork: directory-computers
}: {
  readonly routePairingUrl: string;
  readonly routeFor: EnvironmentId | undefined;
  readonly checks: ReturnType<typeof pairingFormChecks>; // fork: directory-computers
}) {
  const { connectionPairingUrl, onChangeConnectionPairingUrl, onConnectPress } =
    useRemoteConnections();
  const navigation = useNavigation();
  const routeName = useRoute().name;
  const insets = useSafeAreaInsets();
  const [initialPairing] = useState(() => parsePairingUrl(routePairingUrl || connectionPairingUrl));
  const [hostInput, setHostInput] = useState(initialPairing.host);
  const [codeInput, setCodeInput] = useState(initialPairing.code);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The user's own edit or submit dismisses the dev auto-connect report.
  const [ownAttempt, setOwnAttempt] = useState(false);
  const autoConnect = autoConnectReport(
    useAtomValue(devAutoConnectAttemptAtom),
    routePairingUrl,
    ownAttempt,
  );
  const connecting = isSubmitting || autoConnect.connecting;
  const pairingConnectionError = submitError ?? autoConnect.error;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const screenFocused = useIsFocused();
  // fork: fleet-connections
  const scannerLockedRef = useRef(false);
  const [scannerRequested, setScannerRequested] = useState(false);
  // A good scan parks the camera so it can't re-read the code over later edits.
  const [scanComplete, setScanComplete] = useState(false);

  // fork: fleet-connections
  const connectDisabled =
    connecting || hostInput.trim().length === 0 || codeInput.trim().length === 0;

  const clearError = () => {
    setSubmitError(null);
    setOwnAttempt(true);
  };

  const handleHostChange = (value: string) => {
    // fork: fleet-connections
    const parsed = parsePairingUrl(value);
    setHostInput(parsed.code ? parsed.host : value);
    if (parsed.code) {
      setCodeInput(parsed.code);
      setScanComplete(true);
    }
    setScannerRequested(false);
    clearError();
  };

  const handleCodeChange = (value: string) => {
    setCodeInput(value);
    setScannerRequested(false); // fork: fleet-connections
    clearError();
  };

  const handleScanPress = async () => {
    if (connecting) return; // fork: fleet-connections
    const permission = await requestCameraPermission();
    if (permission.granted) {
      // fork: fleet-connections
      scannerLockedRef.current = false;
      setScannerRequested(true);
      setScanComplete(false);
      return;
    }
    if (permission.canAskAgain) return;
    Dialog.alert(
      "Camera access needed",
      "Camera access was denied for this app. Open Settings to enable it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  };

  const handleQrScan = ({ data }: { readonly data: string }) => {
    // fork: fleet-connections
    if (scannerLockedRef.current || connecting) {
      return;
    }

    scannerLockedRef.current = true; // fork: fleet-connections

    try {
      const pairingUrl = extractPairingUrlFromQrPayload(data);
      const { host, code } = parsePairingUrl(pairingUrl);
      setHostInput(host);
      setCodeInput(code);
      onChangeConnectionPairingUrl(pairingUrl);
      setScanComplete(true);
      clearError(); // fork: fleet-connections
    } catch (error) {
      setScannerRequested(false); // fork: fleet-connections
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Dialog.alert(
        "Invalid QR code",
        error instanceof Error ? error.message : "Scanned QR code was not recognized.",
      );
      // fork: fleet-connections -- a parked scanner restarts only from Scan, not on a timer
    }
  };

  const handleSubmit = async () => {
    const pairingUrl = buildPairingUrl(hostInput, codeInput);
    setOwnAttempt(true);
    setSubmitError(null);
    setIsSubmitting(true);
    onChangeConnectionPairingUrl(pairingUrl);
    // fork: directory-computers
    const outcome = await onConnectPress(pairingUrl, checks.expectedEnvironmentId);
    setIsSubmitting(false);
    setSubmitError(outcome.error);
    void Haptics.notificationAsync(
      outcome.ok
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
    if (outcome.ok) {
      // Replacing with Home would nest it inside any sheet below; return to the opener.
      if (!navigation.canGoBack()) {
        navigation.dispatch(StackActions.replace("Library")); // fork: library
      } else {
        // Added from the Settings list, the new environment shows on Environments.
        leaveSettingsPage(navigation, workspaceHasColumns(), "SettingsEnvironments");
      }
    }
  };

  const cameraActive =
    scannerRequested &&
    cameraPermission?.granted === true &&
    screenFocused &&
    !scanComplete &&
    !connecting;

  // fork: fleet-connections - The title distinguishes a computer from another address for it.
  return (
    <SettingsScreen
      formSheet={routeName === "ConnectionsNew"}
      title={routeFor ? "Add connection address" : "Connect computer"} // fork: fleet-connections
    >
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets // fork: fleet-connections
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
        }}
      >
        <View collapsable={false} className="gap-6.5">
          {/* fork: fleet-connections - Pairing guidance follows the selected computer. */}
          <Text className="px-4 text-sm leading-normal text-foreground-muted">
            {routeFor
              ? "Open Connections settings on this same computer to add another way to reach it."
              : "Open Connections settings in Loom on your computer to get a pairing code."}
          </Text>
          {scanComplete ? (
            <Button
              label="Scan another code"
              icon="qrcode.viewfinder"
              tone="text"
              disabled={connecting}
              onPress={() => void handleScanPress()}
            />
          ) : (
            <PairingScanCard
              cameraActive={cameraActive}
              onScan={handleQrScan}
              onScanPress={() => {
                void handleScanPress();
              }}
            />
          )}

          {cameraActive ? (
            <Button label="Stop scanning" tone="text" onPress={() => setScannerRequested(false)} />
          ) : null}

          <View collapsable={false} className="gap-2">
            {/* fork: fleet-connections */}
            <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
              Or enter the address and pairing code
            </Text>
            <View
              collapsable={false}
              className={cn(
                "overflow-hidden rounded-[26px] border-continuous border bg-grouped-card",
                pairingConnectionError ? "border-danger-foreground" : "border-transparent",
              )}
            >
              <PairingInputRow
                label="Address"
                keyboardType="url"
                placeholder="192.168.1.100:3773"
                value={hostInput}
                editable={!connecting} // fork: fleet-connections
                onChangeText={handleHostChange}
              />
              <View className="ml-4 border-t border-border-subtle" />
              <PairingInputRow
                label="Code"
                placeholder="Pairing code"
                returnKeyType="go"
                value={codeInput}
                editable={!connecting} // fork: fleet-connections
                onChangeText={handleCodeChange}
                onSubmitEditing={() => {
                  if (!connectDisabled) void handleSubmit();
                }}
              />
            </View>
            <Text
              accessibilityLiveRegion="polite"
              className={cn(
                "px-4 text-sm leading-normal",
                pairingConnectionError ? "text-danger-foreground" : "text-foreground-muted",
              )}
            >
              {pairingConnectionError ??
                // fork: fleet-connections
                "Use the address and code shown on your computer. You can also paste its full pairing link into Address."}
            </Text>
          </View>

          {/* fork: directory-computers */}
          {checks.offersIdentity ? (
            <View className="gap-2 px-4">
              <Text className="text-sm text-foreground-muted">
                If this computer has Identity configured, use its address to sign in without a
                pairing code.
              </Text>
              <Button
                label="Sign in with Identity" // fork: directory-computers
                tone="text"
                disabled={connecting}
                onPress={() =>
                  navigation.navigate("IdentitySignIn", {
                    ...(hostInput.trim() ? { address: hostInput.trim() } : {}),
                    ...(routeFor ? { environmentId: routeFor } : {}),
                  })
                }
              />
            </View>
          ) : null}
          <Button
            label={routeFor ? "Add connection address" : "Connect computer"}
            tone="primary"
            fullWidth
            loading={connecting}
            disabled={connectDisabled}
            onPress={() => void handleSubmit()}
          />

          {hasCloudPublicConfig() && !routeFor ? <T3ConnectSection /> : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

const SCAN_CARD_HEIGHT = 250;
const SCAN_RETICLE_SIZE = 150;
const SCAN_RETICLE_TOP = 36;
const SCAN_RETICLE_RADIUS = 28;

function PairingScanCard(props: {
  readonly cameraActive: boolean;
  readonly onScan: (result: { readonly data: string }) => void;
  readonly onScanPress: () => void;
}) {
  const light = useAppearancePreferences().themeAppearance === "light";
  return (
    <Pressable
      accessibilityRole={props.cameraActive ? undefined : "button"}
      accessibilityLabel={props.cameraActive ? undefined : "Scan QR code"}
      disabled={props.cameraActive}
      onPress={props.onScanPress}
      className={cn(
        "overflow-hidden rounded-[26px] border-continuous",
        light ? "bg-white" : "bg-black",
      )}
      style={{ height: SCAN_CARD_HEIGHT }}
    >
      <Svg accessibilityElementsHidden height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <RadialGradient id="pairing-scan-backdrop" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={light ? "#f4f4f5" : "#2e2e2e"} />
            <Stop offset="100%" stopColor={light ? "#d9d9dc" : "#0e0e0e"} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#pairing-scan-backdrop)" height="100%" width="100%" />
      </Svg>

      {props.cameraActive ? (
        <>
          <CameraView
            active
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={props.onScan}
            style={StyleSheet.absoluteFill}
          />
          <FrostedCutout
            cutoutTop={SCAN_RETICLE_TOP}
            cutoutWidth={SCAN_RETICLE_SIZE}
            cutoutHeight={SCAN_RETICLE_SIZE}
            cutoutRadius={SCAN_RETICLE_RADIUS}
            appearance={light ? "light" : "dark"}
          />
        </>
      ) : null}

      <View
        pointerEvents="none"
        className="absolute inset-x-0 items-center gap-3.5"
        style={{ top: SCAN_RETICLE_TOP }}
      >
        <View
          className={cn(
            "items-center justify-center gap-2 border-continuous border-[3px]",
            light ? "border-black/70" : "border-white/80",
          )}
          style={{
            borderRadius: SCAN_RETICLE_RADIUS,
            height: SCAN_RETICLE_SIZE,
            width: SCAN_RETICLE_SIZE,
          }}
        >
          {props.cameraActive ? null : (
            <>
              <SymbolView
                name="qrcode.viewfinder"
                size={44}
                tintColorClassName={light ? "accent-black/60" : "accent-white/70"}
                type="monochrome"
                weight="light"
              />
              <Text
                className={cn("font-t3-medium text-sm", light ? "text-black/70" : "text-white/80")}
              >
                Tap to scan
              </Text>
            </>
          )}
        </View>
        <Text className={cn("text-center text-sm", light ? "text-black/70" : "text-white/80")}>
          {/* fork: brand */}
          Scan the QR code shown on your computer
        </Text>
      </View>
    </Pressable>
  );
}

function T3ConnectSection() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const { connectedEnvironments, onSetEnvironmentEnabled, onRemoveEnvironmentPress } =
    useRemoteConnections();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });

  return (
    <View collapsable={false} className="gap-2">
      <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
        {/* fork: fleet-connections */}
        Or find computers with Loom Connect
      </Text>
      {isSignedIn ? (
        <CloudEnvironmentRows
          connectedCloudEnvironments={connectedCloudEnvironments}
          onSetEnvironmentEnabled={onSetEnvironmentEnabled}
          onRemoveEnvironment={onRemoveEnvironmentPress}
          showHeader={false}
        />
      ) : (
        <ListRow
          label="Sign in to Loom Connect" // fork: brand
          description="Sign in with the account you use on your computer."
          disabled={!isLoaded}
          onPress={() => navigation.navigate("SettingsAuth")}
        />
      )}
    </View>
  );
}

function PairingInputRow({
  label,
  ...inputProps
}: Omit<AppTextInputProps, "accessibilityLabel" | "className"> & {
  readonly label: string;
}) {
  return (
    // fork: fleet-connections
    <View collapsable={false} className="min-h-13 flex-row items-center gap-3 px-4 py-3">
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="w-20 text-base leading-[23px] text-foreground-muted"
      >
        {label}
      </Text>
      <AppTextInput
        {...inputProps}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-0 flex-1 rounded-none border-0 bg-transparent p-0 text-base leading-[23px]"
      />
    </View>
  );
}
