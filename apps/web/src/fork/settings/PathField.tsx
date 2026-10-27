import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useOptionalSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { LibraryFolderPalette } from "~/fork/project-library/LibraryFolderPalette";
import { LibraryPaletteDialog } from "~/fork/project-library/LibraryPalette";
import { cn } from "~/lib/utils";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { pathFieldBrowseStart, pathWithinRoot, type PathFieldKind } from "./pathFieldLogic";

interface PathFieldProps {
  /** The computer to browse. Null when the setting spans several computers. */
  readonly environmentId: EnvironmentId | null;
  readonly value: string;
  /** Shown muted while unset. Without it the setting is required and cannot be cleared. */
  readonly defaultLabel?: string | undefined;
  readonly kind: PathFieldKind;
  readonly label: string;
  /** Receives the chosen path, or "" when cleared. */
  readonly onChange: (next: string) => void;
  readonly mixed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Stores a path relative to this folder and refuses one outside it. */
  readonly rootPath?: string | undefined;
  /** Where browsing starts while the setting is unset. */
  readonly startPath?: string | undefined;
  readonly className?: string | undefined;
}

export function PathField({
  environmentId,
  value,
  defaultLabel,
  kind,
  label,
  onChange,
  mixed = false,
  disabled = false,
  rootPath,
  startPath,
  className,
}: PathFieldProps) {
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const computer = useEnvironment(environmentId);
  const noun = kind === "file" ? "file" : "folder";
  const close = () => {
    setBrowsing(false);
    setError(null);
  };
  const choose = (path: string) => {
    const next = rootPath === undefined ? path : pathWithinRoot(rootPath, path);
    if (next === null) {
      setError(`Choose a file inside ${rootPath}.`);
      return;
    }
    close();
    if (next !== value) onChange(next);
  };
  const choiceButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`Choose ${label}`}
      disabled={disabled || environmentId === null}
      onClick={() => setBrowsing(true)}
    >
      Choose
    </Button>
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-1.5", className)}
    >
      <span
        className={cn(
          "min-w-0 flex-1 text-sm wrap-anywhere",
          (mixed || !value) && "text-muted-foreground",
        )}
      >
        {mixed ? "Different on each computer" : value || defaultLabel || "Not set"}
      </span>
      {environmentId === null && !disabled ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            {choiceButton}
          </TooltipTrigger>
          <TooltipPopup side="top">Choose one computer above to pick its {noun}.</TooltipPopup>
        </Tooltip>
      ) : (
        choiceButton
      )}
      {defaultLabel !== undefined && (value !== "" || mixed) ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost-muted"
          aria-label={`Clear ${label}`}
          disabled={disabled}
          onClick={() => onChange("")}
        >
          <XIcon className="size-3.5" />
        </Button>
      ) : null}
      {browsing && environmentId !== null ? (
        <LibraryPaletteDialog title={`Choose ${label}`} onClose={close}>
          <LibraryFolderPalette
            environmentId={environmentId}
            computerName={computer?.label ?? "this computer"}
            initialPath={pathFieldBrowseStart({
              value: mixed ? "" : value,
              kind,
              root: rootPath,
              fallback: startPath || "~/",
            })}
            files={kind === "file"}
            onSelect={choose}
            onBack={close}
            onClose={close}
            error={error}
          />
        </LibraryPaletteDialog>
      ) : null}
    </div>
  );
}

/** A path setting on a settings page, browsing the one computer the page targets. */
export function ScopedPathField(props: Omit<PathFieldProps, "environmentId">) {
  const context = useOptionalSettingsScope();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const computers = context
    ? [...new Set(context.targets.map((target) => target.environmentId))]
    : [primaryEnvironmentId];
  return <PathField {...props} environmentId={computers.length === 1 ? computers[0]! : null} />;
}
