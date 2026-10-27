import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { SettingsSearchItemId } from "~/components/settings/settingsSearch";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { requestLibraryConnect } from "../project-library/libraryPaletteSession";
import { readLibraryAuthorityId } from "../project-library/state";
import { chooseClientComputer, takeLibraryConnectAfterRestart } from "./clientComputer";

const RUN_AGENTS_TARGET = "local-environment" satisfies SettingsSearchItemId;
const ADD_COMPUTER_TARGET = "remote-environments" satisfies SettingsSearchItemId;

type ComputerRole = "run" | "reach";

/** The first setup step on a desktop app: run agents here, or only reach other computers. */
export function ThisComputerStep({ onRunAgents }: { readonly onRunAgents: () => void }) {
  const [role, setRole] = useState<ComputerRole>("run");
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    if (role === "run") {
      onRunAgents();
      return;
    }
    setIsRestarting(true);
    setError(null);
    try {
      await chooseClientComputer();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change this setting.");
      setIsRestarting(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        How will you use this computer?
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        You can change this later in Settings.
      </p>
      <RadioGroup
        aria-label="How this computer is used"
        className="mt-5"
        value={role}
        disabled={isRestarting}
        onValueChange={(value) => setRole(value === "reach" ? "reach" : "run")}
      >
        <RoleOption
          value="run"
          title="Run agents on this computer"
          description="Projects and agents live here, and your other devices can connect to it."
        />
        <RoleOption
          value="reach"
          title="Only reach other computers"
          description="Agents run on your other computers. Loom restarts, then asks for your Library."
        />
      </RadioGroup>
      {error ? (
        <Alert variant="error" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button autoFocus disabled={isRestarting} onClick={() => void onContinue()}>
          {isRestarting ? (
            <>
              <Spinner size="sm" />
              Restarting…
            </>
          ) : (
            <>
              {role === "reach" ? "Restart" : "Continue"}
              <ArrowRightIcon className="size-3.5" />
            </>
          )}
        </Button>
      </div>
    </>
  );
}

function RoleOption({
  value,
  title,
  description,
}: {
  readonly value: ComputerRole;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-3">
      <Radio value={value} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/** What a computer that only reaches others can do before it reaches any. */
export function ClientComputerActions() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => requestLibraryConnect("computers")}>
          Connect your Library
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/settings/connections" hash={ADD_COMPUTER_TARGET} />}
        >
          Add a computer
        </Button>
      </div>
      <Button
        size="xs"
        variant="link"
        render={<Link to="/settings/connections" hash={RUN_AGENTS_TARGET} />}
      >
        Run agents on this computer instead
      </Button>
    </div>
  );
}

/** Connects a Library once after the restart that made this computer only reach others. */
export function ClientSetupResume() {
  // oxlint-disable-next-line t3code/react-effect-budget -- Reads a one-shot intent left in storage before the app restarted.
  useEffect(() => {
    if (
      takeLibraryConnectAfterRestart() &&
      isLocalEnvironmentDisabled() &&
      readLibraryAuthorityId() === null
    ) {
      requestLibraryConnect("computers");
    }
  }, []);
  return null;
}
