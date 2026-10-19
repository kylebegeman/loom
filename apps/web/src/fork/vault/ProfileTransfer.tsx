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
export function VaultRequirementImport({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (p: VaultProfileDefinition) => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(false);
  return (
    <details>
      <summary>Import portable requirements</summary>
      <div className="flex flex-col gap-2 py-2">
        <p className="text-sm">
          Paste a Loom requirements declaration. Keys and repositories stay local. Imported
          requirements start unbound; review them before saving.
        </p>
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
        {error ? (
          <p role="alert">
            Use a version 1 Loom requirements declaration with unique names and SSH or Git kinds.
            Remove all local bindings and extra fields.
          </p>
        ) : null}
        <Button
          size="sm"
          disabled={disabled || !text.trim()}
          onClick={() => {
            const declaration = readVaultProfileRequirements(text);
            if (!declaration) {
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
      </div>
    </details>
  );
}
export function VaultRequirementExport({ profile }: { profile: VaultProfileDefinition }) {
  const [notice, setNotice] = useState<string | null>(null);
  const text = JSON.stringify(vaultProfileRequirements(profile), null, 2);
  return (
    <details>
      <summary>Export requirements for {profile.label}</summary>
      <div className="flex flex-col gap-2 py-2">
        <p className="text-sm">
          Includes the label, names and operation kinds only. Keys, repositories, grants and
          defaults remain on this computer. Check labels before sharing.
        </p>
        <Textarea aria-label={`Requirements for ${profile.label}`} value={text} readOnly />
        <Button
          size="sm"
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
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </details>
  );
}
