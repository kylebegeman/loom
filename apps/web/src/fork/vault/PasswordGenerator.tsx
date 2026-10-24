import { useCallback, useEffect, useId, useState } from "react";
import {
  generateVaultPassword,
  VAULT_PASSWORD_CHARACTER_SETS,
  VAULT_PASSWORD_DEFAULTS,
  VAULT_PASSWORD_MIN_LENGTH,
  VAULT_PASSWORD_MAX_LENGTH,
  type VaultPasswordOptions,
} from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cryptoRandom } from "../utilities/runtime";
import { onOpenVaultPasswordGenerator, openVaultPasswordGenerator } from "./password-navigation";

export function VaultPasswordSettingsSection() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Generate passwords on this device, including while disconnected. Nothing is saved
        automatically.
      </p>
      <Button variant="outline" size="sm" onClick={openVaultPasswordGenerator}>
        Generate password
      </Button>
    </div>
  );
}

export function VaultPasswordGeneratorHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenVaultPasswordGenerator(() => setOpen(true)), []);
  if (!open) return null;
  return <PasswordGenerator onClose={() => setOpen(false)} />;
}

function PasswordGenerator({ onClose }: { readonly onClose: () => void }) {
  const fieldId = useId();
  const [options, setOptions] = useState<VaultPasswordOptions>({ ...VAULT_PASSWORD_DEFAULTS });
  const [length, setLength] = useState(String(VAULT_PASSWORD_DEFAULTS.length));
  const [password, setPassword] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = useCallback(() => {
    setPassword(null);
    setVisible(false);
    setCopied(false);
    setError(null);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", clear);
    };
  }, [clear]);
  const update = (patch: Partial<VaultPasswordOptions>) => {
    clear();
    setOptions((previous) => ({ ...previous, ...patch }));
  };
  const generate = () => {
    clear();
    try {
      setPassword(
        generateVaultPassword({ ...options, length: Number(length) }, cryptoRandom).value,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password generation failed. Try again.");
    }
  };
  const copy = async () => {
    if (password === null || copying) return;
    setCopying(true);
    setError(null);
    await writeTextToClipboard(password, "password")
      .then((written) => {
        if (!written) throw new Error("Copy failed.");
        setCopied(true);
      })
      .catch(() => {
        setError("The password could not be copied. Reveal it to copy manually, or try again.");
      })
      .finally(() => setCopying(false));
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Generate a password</DialogTitle>
          <DialogDescription>
            Generated on this device. Copy it when ready; closing or leaving this window clears the
            view.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-144 flex-col gap-4 overflow-y-auto px-6 pb-5">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${fieldId}-length`}>Length</label>
            <Input
              id={`${fieldId}-length`}
              type="number"
              inputMode="numeric"
              min={VAULT_PASSWORD_MIN_LENGTH}
              max={VAULT_PASSWORD_MAX_LENGTH}
              step={1}
              value={length}
              disabled={copying}
              onChange={(event) => {
                clear();
                setLength(event.target.value);
              }}
            />
          </div>
          <fieldset className="flex flex-col gap-2" disabled={copying}>
            <legend className="mb-2 text-sm">Characters</legend>
            {VAULT_PASSWORD_CHARACTER_SETS.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={options[id]}
                  disabled={copying}
                  onCheckedChange={(checked) => update({ [id]: checked })}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={options.excludeLookAlikes}
                disabled={copying}
                onCheckedChange={(checked) => update({ excludeLookAlikes: checked })}
              />
              Exclude look-alikes (0 O o 1 l I |)
            </label>
          </fieldset>
          <Button disabled={copying} onClick={generate}>
            {password === null ? "Generate password" : "Regenerate"}
          </Button>
          {password !== null && (
            <div className="flex flex-col gap-3">
              <label htmlFor={`${fieldId}-password`}>Generated password</label>
              <Input
                id={`${fieldId}-password`}
                value={password}
                type={visible ? "text" : "password"}
                autoComplete="off"
                readOnly
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={copying}
                  onClick={() => setVisible((previous) => !previous)}
                >
                  {visible ? "Hide" : "Reveal"}
                </Button>
                <Button variant="outline" size="sm" disabled={copying} onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy password"}
                </Button>
                <Button variant="ghost" size="sm" disabled={copying} onClick={clear}>
                  Clear password
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Copy uses your system clipboard. Clearing this view does not clear the clipboard.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {password !== null && copied && (
            <p role="status" className="text-sm text-muted-foreground">
              Password copied.
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
