import { useState } from "react";
import { randomUUID } from "~/lib/utils";
import {
  readVaultProfileRequirements,
  vaultProfileFromRequirements,
  vaultProfileRequirements,
  type VaultProfileDefinition,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
} from "../settings/parts";
export function VaultRequirementImport({
  disabled,
  supportsGitHub,
  onImport,
}: {
  disabled: boolean;
  supportsGitHub: boolean;
  onImport: (p: VaultProfileDefinition) => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <LoomSettingsDetails title="Import portable requirements">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Paste a Loom requirements declaration. Keys, connections and repositories stay local.
          Imported requirements start unbound; review them before saving.
        </p>
        <LoomSettingsField label="Portable requirements">
          <Textarea
            aria-label="Portable Vault requirements"
            value={text}
            maxLength={16384}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              setError(false);
            }}
          />
        </LoomSettingsField>
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            disabled={disabled || !text.trim()}
            onClick={() => {
              const declaration = readVaultProfileRequirements(text);
              if (
                !declaration ||
                (!supportsGitHub && declaration.requirements.some((r) => r.kind === "github"))
              ) {
                setError(true);
                return;
              }
              onImport(vaultProfileFromRequirements(declaration, randomUUID().replaceAll("-", "")));
              setText("");
              setError(false);
            }}
          >
            Review imported requirements
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
      {error ? (
        <LoomSettingsNotice role="alert">
          Use a Loom declaration with unique SSH, Git or GitHub names. GitHub requires version 2 and
          a server with GitHub profile support. Remove all local bindings and extra fields.
        </LoomSettingsNotice>
      ) : null}
    </div>
  );
}
export function VaultRequirementExport({ profile }: { profile: VaultProfileDefinition }) {
  const [notice, setNotice] = useState<string | null>(null);
  const text = JSON.stringify(vaultProfileRequirements(profile), null, 2);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <LoomSettingsDetails
        title={<span className="wrap-anywhere">Export requirements for {profile.label}</span>}
      >
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Includes the label, names and operation kinds only. Keys, connections, repositories,
          grants and defaults remain on this computer. Check labels before sharing.
        </p>
        <LoomSettingsField label="Portable requirements">
          <Textarea aria-label={`Requirements for ${profile.label}`} value={text} readOnly />
        </LoomSettingsField>
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => setNotice("Requirements copied."),
                () => setNotice("Copy unavailable. Select and copy the declaration above."),
              )
            }
          >
            Copy requirements
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
    </div>
  );
}
