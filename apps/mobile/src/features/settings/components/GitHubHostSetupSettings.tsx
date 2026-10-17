import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId } from "@t3tools/contracts";
import {
  createGitHubHostSetupAtoms,
  GITHUB_DEVICE_APPROVAL_URL,
  githubSetupIsActive,
  githubSetupMessage,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { uuidv4 } from "../../../lib/uuid";
import { useEnvironmentServerConfig } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "./SettingsSection";

const github = createGitHubHostSetupAtoms(connectionAtomRuntime);
export function GitHubHostSetupSettings({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, "github-host-setup");
  const allowed = useAtomValue(github.start.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    supported && allowed ? github.state({ environmentId, input: {} }) : null,
  );
  const start = useAtomCommand(github.start, { reportFailure: false });
  const cancel = useAtomCommand(github.cancel, { reportFailure: false });
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = query.data;
  const active = githubSetupIsActive(state);
  async function act(action: "start" | "cancel") {
    if (pendingRef.current || !allowed || !state || query.error) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await (action === "start" ? start : cancel)({
        environmentId,
        input: {
          requestId: action === "start" ? uuidv4() : state.requestId!,
        },
      });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error ? failure.message : "GitHub setup could not finish. Try again.",
        );
      }
    } catch {
      setError("GitHub setup could not finish. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  if (!supported) return null;
  return (
    <SettingsSection title={`GitHub access · ${label}`}>
      <View className="gap-3 p-4">
        <AppText className="text-foreground-muted" accessibilityLiveRegion="polite">
          {!allowed
            ? "Terminal operation permission is required to prepare GitHub access on this host."
            : !state && !query.error
              ? "Loading GitHub setup…"
              : githubSetupMessage(state)}
        </AppText>
        {state?.deviceCode && allowed && !query.error && (
          <View className="gap-3">
            <AppText
              selectable
              className="text-xl font-t3-medium"
              accessibilityLabel={`GitHub approval code ${state.deviceCode}`}
            >
              {state.deviceCode}
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Copy code"
                onPress={() => {
                  void Clipboard.setStringAsync(state.deviceCode!).catch(() =>
                    setError("Could not copy the code. Select it and copy manually."),
                  );
                }}
              />
              <Button
                label="Open GitHub"
                tone="primary"
                onPress={() => {
                  void Linking.openURL(GITHUB_DEVICE_APPROVAL_URL).catch(() =>
                    setError(
                      "Could not open GitHub. Open https://github.com/login/device in your browser.",
                    ),
                  );
                }}
              />
            </View>
            <AppText className="text-sm text-foreground-muted">
              Only approve if GitHub shows the same code. Closing Settings keeps setup running on
              this host.
            </AppText>
          </View>
        )}
        {(error || query.error) && (
          <AppText accessibilityRole="alert" className="text-danger">
            {error ?? query.error}
          </AppText>
        )}
        <Button
          label={
            pending
              ? "Please wait…"
              : active
                ? "Cancel setup"
                : state?.phase === "ready"
                  ? "Check GitHub access"
                  : state?.phase === "error" || state?.phase === "cancelled"
                    ? "Retry setup"
                    : "Set up GitHub"
          }
          disabled={!allowed || pending || !state || query.error !== null}
          onPress={() => {
            void act(active ? "cancel" : "start");
          }}
        />
        {query.error && allowed && (
          <Button
            label="Reconnect"
            onPress={() => {
              setError(null);
              query.refresh();
            }}
          />
        )}
      </View>
    </SettingsSection>
  );
}
