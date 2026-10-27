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
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
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
import {
  setPendingConnectionError,
  useRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { SymbolView } from "../../components/ui/AppSymbol";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { CloudEnvironmentRows } from "./CloudEnvironmentRows";
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
  const {
    connectionPairingUrl,
    onChangeConnectionPairingUrl,
    onConnectPress,
    pairingConnectionError,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const routeName = useRoute().name;
  const params = route.params ?? {};
  // Dev-only prefill prevents production links from supplying an attacker-chosen host and token.
  const routePairingUrl = __DEV__ ? (params.pairingUrl?.trim() ?? "") : "";
  const shouldAutoConnect =
    __DEV__ &&
    routePairingUrl.length > 0 &&
    (params.autoConnect === "1" || params.autoConnect === "true");
  const insets = useSafeAreaInsets();
  const [hostInput, setHostInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const screenFocused = useIsFocused();
  // fork: fleet-connections
  const scannerLockedRef = useRef(false);
  const [scannerRequested, setScannerRequested] = useState(false);
  // A good scan parks the camera so it can't re-read the code over later edits.
  const [scanComplete, setScanComplete] = useState(false);
  const attemptedAutoConnectRef = useRef<string | null>(null);

  // fork: fleet-connections
  const connectDisabled =
    isSubmitting || hostInput.trim().length === 0 || codeInput.trim().length === 0;

  useEffect(() => {
    const { host, code } = parsePairingUrl(connectionPairingUrl);
    // oxlint-disable-next-line react/set-state-in-effect -- A new pairing URL reseeds the editable host and code fields.
    setHostInput(host);
    setCodeInput(code);
  }, [connectionPairingUrl]);

  useEffect(() => {
    if (routePairingUrl.length === 0) {
      return;
    }

    const { host, code } = parsePairingUrl(routePairingUrl);
    // oxlint-disable-next-line react/set-state-in-effect -- A pairing URL from the route reseeds the editable host and code fields.
    setHostInput(host);
    setCodeInput(code);
  }, [routePairingUrl]);

  useEffect(() => {
    if (pairingConnectionError) {
      // oxlint-disable-next-line react/set-state-in-effect -- A pairing failure reported by the connection runtime ends the submit.
      setIsSubmitting(false);
    }
  }, [pairingConnectionError]);

  const handleHostChange = (value: string) => {
    // fork: fleet-connections
    const parsed = parsePairingUrl(value);
    setHostInput(parsed.code ? parsed.host : value);
    if (parsed.code) {
      setCodeInput(parsed.code);
      setScanComplete(true);
    }
    setScannerRequested(false);
    setPendingConnectionError(null);
  };

  const handleCodeChange = (value: string) => {
    setCodeInput(value);
    setScannerRequested(false); // fork: fleet-connections
    setPendingConnectionError(null);
  };

  useEffect(() => () => setPendingConnectionError(null), []);

  const handleScanPress = async () => {
    if (isSubmitting) return; // fork: fleet-connections
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
    if (scannerLockedRef.current || isSubmitting) {
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
      setPendingConnectionError(null); // fork: fleet-connections
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

  const connectAndClose = async (pairingUrl: string) => {
    setIsSubmitting(true);
    onChangeConnectionPairingUrl(pairingUrl);
    // fork: directory-computers
    const result = await onConnectPress(
      pairingUrl,
      pairingFormChecks(params).expectedEnvironmentId,
    );
    setIsSubmitting(false);
    void Haptics.notificationAsync(
      AsyncResult.isSuccess(result)
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
    if (AsyncResult.isSuccess(result)) {
      // Replacing with Home would nest it inside any sheet below; return to the opener.
      if (!navigation.canGoBack()) {
        navigation.dispatch(StackActions.replace("Library")); // fork: library
      } else {
        // Added from the Settings list, the new environment shows on Environments.
        leaveSettingsPage(navigation, workspaceHasColumns(), "SettingsEnvironments");
      }
    }
  };

  const handleSubmit = async () => {
    await connectAndClose(buildPairingUrl(hostInput, codeInput));
  };

  useEffect(() => {
    if (!shouldAutoConnect || attemptedAutoConnectRef.current === routePairingUrl) {
      return;
    }

    attemptedAutoConnectRef.current = routePairingUrl;
    void connectAndClose(routePairingUrl);
  }, [connectAndClose, routePairingUrl, shouldAutoConnect]);

  const cameraActive =
    scannerRequested &&
    cameraPermission?.granted === true &&
    screenFocused &&
    !scanComplete &&
    !isSubmitting;

  // fork: fleet-connections - The title distinguishes a computer from another address for it.
  return (
    <SettingsScreen
      formSheet={routeName === "ConnectionsNew"}
      title={params.routeFor ? "Add connection address" : "Connect computer"} // fork: fleet-connections
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
            {params.routeFor
              ? "Open Connections settings on this same computer to add another way to reach it."
              : "Open Connections settings in Loom on your computer to get a pairing code."}
          </Text>
          {scanComplete ? (
            <Button
              label="Scan another code"
              icon="qrcode.viewfinder"
              tone="text"
              disabled={isSubmitting}
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
                editable={!isSubmitting} // fork: fleet-connections
                onChangeText={handleHostChange}
              />
              <View className="ml-4 border-t border-border-subtle" />
              <PairingInputRow
                label="Code"
                placeholder="Pairing code"
                returnKeyType="go"
                value={codeInput}
                editable={!isSubmitting} // fork: fleet-connections
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
          {pairingFormChecks(params).offersIdentity ? (
            <View className="gap-2 px-4">
              <Text className="text-sm text-foreground-muted">
                If this computer has Identity configured, use its address to sign in without a
                pairing code.
              </Text>
              <Button
                label="Sign in with Identity"
                tone="text"
                disabled={isSubmitting}
                onPress={() =>
                  navigation.navigate("IdentitySignIn", {
                    ...(hostInput.trim() ? { address: hostInput.trim() } : {}),
                    ...(params.routeFor ? { environmentId: params.routeFor } : {}),
                  })
                }
              />
            </View>
          ) : null}
          <Button
            label={params.routeFor ? "Add connection address" : "Connect computer"}
            tone="primary"
            fullWidth
            loading={isSubmitting}
            disabled={connectDisabled}
            onPress={() => void handleSubmit()}
          />

          {hasCloudPublicConfig() && !params.routeFor ? <T3ConnectSection /> : null}
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
