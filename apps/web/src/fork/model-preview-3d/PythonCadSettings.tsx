import { useState } from "react";
import type { PythonCadInfo } from "@t3tools/contracts/fork";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { OperationStatus } from "./OperationStatus";

/** Host setup is explicit and governed by the environment's terminal permission. */
export function PythonCadSettings({
  info,
  pythonPath,
  canSetup,
  onPathChange,
  onSetup,
}: {
  info: PythonCadInfo | undefined;
  pythonPath: string | null;
  canSetup: boolean;
  onPathChange: (value: string | null) => void;
  onSetup: (action: "install" | "remove") => Promise<PythonCadInfo>;
}) {
  const [busy, setBusy] = useState<"install" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const setup = async (action: "install" | "remove") => {
    setBusy(action);
    setMessage(null);
    setFailed(false);
    try {
      const result = await onSetup(action);
      setMessage(
        result.state === "ready"
          ? `Python CAD ready with build123d ${result.build123dVersion}.`
          : action === "remove"
            ? "Managed Python CAD removed."
            : (result.detail ?? "Python CAD setup finished."),
      );
    } catch (cause) {
      setFailed(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SettingsRow
        title="Python CAD interpreter"
        description="Leave blank to use Loom's managed environment. Python models use the .b3d.py file extension and a model() function."
      >
        <div className="flex flex-col gap-2 pb-2">
          <Input
            aria-label="Python CAD interpreter"
            value={pythonPath ?? ""}
            onChange={(event) => onPathChange(event.target.value || null)}
          />
          <p className="text-sm text-muted-foreground">
            {!info
              ? "Update this environment's Loom server to use Python CAD."
              : info.state === "ready"
                ? `Python ${info.pythonVersion}, build123d ${info.build123dVersion}`
                : (info.detail ?? "Python CAD is not set up on this host.")}
          </p>
          {info && !pythonPath && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canSetup || !info.uv || busy !== null || info.state === "setting-up"}
                onClick={() => void setup("install")}
              >
                {info.state === "ready" ? "Update Python CAD" : "Set up Python CAD"}
              </Button>
              {info.path && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSetup || busy !== null}
                  onClick={() => void setup("remove")}
                >
                  Remove
                </Button>
              )}
            </div>
          )}
          {info && !info.uv && !pythonPath && (
            <details>
              <summary className="text-sm">Manual setup commands</summary>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {info.installCommands.join("\n")}
              </pre>
              <a
                href="https://docs.astral.sh/uv/getting-started/installation/"
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                Install uv
              </a>
            </details>
          )}
          {!canSetup && info && (
            <p className="text-sm text-muted-foreground">
              Terminal permission is required to set up or run Python CAD.
            </p>
          )}
          {busy && (
            <OperationStatus
              label={busy === "install" ? "Setting up Python CAD" : "Removing Python CAD"}
            />
          )}
          {message && (
            <p role={failed ? "alert" : "status"} className="text-sm">
              {message}
            </p>
          )}
        </div>
      </SettingsRow>
    </>
  );
}
