import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  createGitHubHostSetupAtoms,
  GITHUB_DEVICE_APPROVAL_URL,
  githubSetupIsActive,
  githubSetupMessage,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const github = createGitHubHostSetupAtoms(connectionAtomRuntime);
/** Host setup is independent of the saved API token and always targets one named environment. */
export function GitHubHostSetupSettings({
  environmentId,
  label,
  onReady,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly onReady: () => void;
}) {
  const allowed = useAtomValue(github.start.permissionAtom(environmentId));
  const query = useEnvironmentQuery(allowed ? github.state({ environmentId, input: {} }) : null);
  const start = useAtomCommand(github.start, { reportFailure: false });
  const cancel = useAtomCommand(github.cancel, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const state = query.data;
  const active = githubSetupIsActive(state);
  const readySeen = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the host finishes setup on its own, so no handler here sees it
  useEffect(() => {
    if (state?.phase === "ready" && state.requestId !== readySeen.current) {
      readySeen.current = state.requestId;
      onReady();
    }
  }, [state, onReady]);
  async function act(action: "start" | "cancel") {
    if (pendingRef.current || !allowed || !state || query.error) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    // The async wrapper sends a synchronous throw from the command call to the same catch.
    await (async () => {
      const result = await (action === "start" ? start : cancel)({
        environmentId,
        input: {
          requestId: action === "start" ? randomUUID() : state.requestId!,
        },
      });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error ? failure.message : "GitHub setup could not finish. Try again.",
        );
      }
    })()
      .catch(() => setError("GitHub setup could not finish. Try again."))
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  }
  return (
    <SettingsSection
      id={searchableSetting("github-host-setup").id}
      title={`GitHub access · ${label}`}
    >
      <div className="grid gap-3 px-4 py-3">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {!allowed
            ? "Terminal operation permission is required to prepare GitHub access on this host."
            : !state && !query.error
              ? "Loading GitHub setup…"
              : githubSetupMessage(state)}
        </p>
        {state?.deviceCode && allowed && !query.error && (
          <div className="grid gap-3">
            <code
              className="select-all text-lg font-semibold tracking-widest"
              aria-label={`GitHub approval code ${state.deviceCode}`}
            >
              {state.deviceCode}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void writeTextToClipboard(state.deviceCode!).catch(() =>
                    setError("Could not copy the code. Select it and copy manually."),
                  );
                }}
              >
                Copy code
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void ensureLocalApi()
                    .shell.openExternal(GITHUB_DEVICE_APPROVAL_URL)
                    .catch(() =>
                      setError(
                        "Could not open GitHub. Open https://github.com/login/device in your browser.",
                      ),
                    );
                }}
              >
                Open GitHub
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only approve if GitHub shows the same code. Closing Settings keeps setup running on
              this host.
            </p>
          </div>
        )}
        {(error || query.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? query.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || pending || !state || query.error !== null}
            onClick={() => {
              void act(active ? "cancel" : "start");
            }}
          >
            {pending
              ? "Please wait…"
              : active
                ? "Cancel setup"
                : state?.phase === "ready"
                  ? "Check GitHub access"
                  : state?.phase === "error" || state?.phase === "cancelled"
                    ? "Retry setup"
                    : "Set up GitHub"}
          </Button>
          {query.error && allowed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                query.refresh();
              }}
            >
              Reconnect
            </Button>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
