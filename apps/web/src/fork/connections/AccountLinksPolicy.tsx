import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import { ACCOUNT_LINKS_LIBRARY_FEATURE, type AccountLinkPolicy } from "@t3tools/contracts/fork";
import { useState } from "react";
import { LinkAccessPicker } from "~/components/settings/LinkAccessPicker";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAuthority } from "../project-library/state";
import { accountLinks } from "./accountLinksState";

const TITLE = "Let agents work across your computers";

/** The owner's choice, kept on the Library, of whether agents on one computer may work on the others. */
export function AccountLinksPolicy() {
  const authority = useLibraryAuthority();
  const environmentId = authority.authorityId;
  const available =
    authority.connected &&
    authority.info.data?.features?.includes(ACCOUNT_LINKS_LIBRARY_FEATURE) === true;
  const canChange = useAtomValue(accountLinks.setPolicy.permissionAtom(environmentId));
  const policy = useEnvironmentQuery(
    available && environmentId !== null ? accountLinks.policy({ environmentId, input: {} }) : null,
  );
  const setPolicy = useAtomCommand(accountLinks.setPolicy, { reportFailure: false });
  const [saving, setSaving] = useState<AccountLinkPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!available || environmentId === null) return null;
  const shown = saving ?? policy.data;
  const save = async (next: AccountLinkPolicy) => {
    if (saving !== null) return;
    setSaving(next);
    setError(null);
    const result = await setPolicy({ environmentId, input: next });
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The change could not be saved. Try again.",
      );
    }
    policy.refresh();
    setSaving(null);
  };
  return (
    <SettingsSection title="Agents across your computers" id="library-agent-links">
      {shown === null ? (
        policy.error ? null : (
          <SettingsRow title="Loading agent access…" role="status" />
        )
      ) : (
        <>
          <SettingsRow
            title={TITLE}
            description="Agents on one of your computers can start, message and wait on threads on your others. Loom links your computers and keeps the links renewed. Turning this off removes them within a few minutes."
            control={
              <Switch
                aria-label={TITLE}
                checked={shown.enabled}
                disabled={!canChange || saving !== null}
                onCheckedChange={(enabled) => void save({ ...shown, enabled })}
              />
            }
          />
          {shown.enabled ? (
            <div className="px-4 py-3">
              <LinkAccessPicker
                value={shown.access}
                disabled={!canChange || saving !== null}
                onChange={(access) => void save({ ...shown, access })}
              />
            </div>
          ) : null}
        </>
      )}
      {error || policy.error ? (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error ?? policy.error}
        </p>
      ) : null}
    </SettingsSection>
  );
}
