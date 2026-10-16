import { useState } from "react";
import type { EnvironmentId, ProjectScript } from "@t3tools/contracts";
import {
  LIBRARY_PROFILE_LIMITS,
  LIBRARY_TOOL_CATALOG,
  type LibraryBriefSuggestionMode,
  type LibraryComputer,
  type LibraryProject,
  type LibraryProjectProfileInput,
  type LibraryRequiredTool,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  compactLibraryProfile,
  LIBRARY_BRIEF_SUGGESTION_CHOICES,
  libraryBriefSuggestionChoice,
  libraryBriefSuggestionChoiceLabel,
  libraryBriefSuggestionDraftValue,
  libraryProfileComputerIds,
  libraryProfileProblem,
  libraryProfileScriptSources,
  librarySecretNameFromInput,
  libraryToolLabel,
  libraryToolsWithVersion,
  libraryToolText,
  type LibraryProfileDraft,
} from "@t3tools/client-runtime/fork";
import { ChevronDownIcon, KeyRoundIcon, XIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Switch } from "~/components/ui/switch";
import { Toggle } from "~/components/ui/toggle";
import { useProjects } from "~/state/entities";
import { LibraryDialog, LibraryErrorNotice, LibraryPanel } from "./LibraryControls";

/**
 * How work on this project gets going on any computer: its scripts, the tools it needs, the
 * secrets each computer must provide by name, and where it prefers to run.
 */
export function ProjectProfile({
  project,
  copies,
  computers,
  canEdit,
  keepsBriefSuggestions,
  busy,
  error,
  hostLabel,
  onEdit,
  onSave,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryComputer[];
  readonly canEdit: boolean;
  /** The Library advertises `library-brief-suggestions`, so it saves the setting. */
  readonly keepsBriefSuggestions: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  /** Called as the editor opens, so an earlier failed save does not show in it. */
  readonly onEdit: () => void;
  readonly onSave: (profile: LibraryProjectProfileInput | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const profile = project.profile;
  const rows = profile
    ? [
        profile.scripts?.length
          ? ["Scripts", profile.scripts.map((script) => script.name).join(", ")]
          : null,
        profile.requiredTools?.length
          ? ["Needs", profile.requiredTools.map(libraryToolText).join(", ")]
          : null,
        profile.secretNames?.length ? ["Secrets", profile.secretNames.join(", ")] : null,
        profile.preferredEnvironmentIds?.length
          ? ["Runs on", profile.preferredEnvironmentIds.map(hostLabel).join(", ")]
          : null,
        profile.defaultModelSelection ? ["Model", profile.defaultModelSelection.model] : null,
        profile.allowMini ? ["Mini", "Can run its jobs"] : null,
        keepsBriefSuggestions && libraryBriefSuggestionChoice(profile.briefSuggestions) !== "off"
          ? ["Brief", `${libraryBriefSuggestionChoiceLabel(profile.briefSuggestions)} suggestions`]
          : null,
      ].filter((row) => row !== null)
    : [];
  return (
    <LibraryPanel
      title="Setup"
      action={
        canEdit ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onEdit();
              setEditing(true);
            }}
          >
            {rows.length ? "Edit" : "Set up"}
          </Button>
        ) : null
      }
    >
      {rows.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border px-3.5 py-3 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground">
          Scripts, required tools and secret names that every computer working on this project
          should have.
        </p>
      )}
      {editing ? (
        <ProfileDialog
          project={project}
          copies={copies}
          computers={computers}
          keepsBriefSuggestions={keepsBriefSuggestions}
          hostLabel={hostLabel}
          busy={busy}
          error={error}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            if (await onSave(next)) setEditing(false);
          }}
        />
      ) : null}
    </LibraryPanel>
  );
}

function ProfileDialog({
  project,
  copies,
  computers,
  keepsBriefSuggestions,
  hostLabel,
  busy,
  error,
  onClose,
  onSave,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryComputer[];
  readonly keepsBriefSuggestions: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (profile: LibraryProjectProfileInput | null) => Promise<void>;
}) {
  // Tools a newer catalog added stay in the draft, so saving from here keeps them.
  const [draft, setDraft] = useState<LibraryProfileDraft>(() => ({ ...project.profile }));
  const [problem, setProblem] = useState<string | null>(null);
  const patch = (change: LibraryProfileDraft) => {
    setProblem(null);
    setDraft((current) => ({ ...current, ...change }));
  };
  const save = () => {
    const profile = compactLibraryProfile(draft);
    const invalid = profile ? libraryProfileProblem(profile, project.profile) : null;
    if (invalid) {
      setProblem(invalid);
      return;
    }
    void onSave(profile);
  };
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Project setup"
      description="Saved with the brief, so every conversation and computer sees the same setup."
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving..." : "Save setup"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ScriptsField
          scripts={draft.scripts ?? []}
          copies={copies}
          hostLabel={hostLabel}
          onChange={(scripts) => patch({ scripts })}
        />
        <ToolsField
          tools={draft.requiredTools ?? []}
          onChange={(requiredTools) => patch({ requiredTools })}
        />
        <SecretNamesField
          names={draft.secretNames ?? []}
          onChange={(secretNames) => patch({ secretNames })}
        />
        <ComputersField
          computers={computers}
          selected={draft.preferredEnvironmentIds ?? []}
          hostLabel={hostLabel}
          onChange={(preferredEnvironmentIds) => patch({ preferredEnvironmentIds })}
        />
        {draft.defaultModelSelection ? (
          <section className="space-y-2">
            <p className="text-sm font-medium">Default model</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{draft.defaultModelSelection.model}</Badge>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => patch({ defaultModelSelection: undefined })}
              >
                Remove
              </Button>
            </div>
          </section>
        ) : null}
        <label className="flex items-start justify-between gap-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Let Mini run its jobs</span>
            <span className="block text-xs text-muted-foreground">
              Builds and tests for this project can be sent to a Mini worker.
            </span>
          </span>
          <Switch
            checked={draft.allowMini === true}
            onCheckedChange={(allowMini) => patch({ allowMini })}
          />
        </label>
        {keepsBriefSuggestions ? (
          <BriefSuggestionsField
            mode={draft.briefSuggestions}
            onChange={(briefSuggestions) => patch({ briefSuggestions })}
          />
        ) : null}
        <LibraryErrorNotice error={problem ?? error} />
      </div>
    </LibraryDialog>
  );
}

/**
 * Whether a conversation that settles asks its agent for brief updates. The agent only proposes;
 * a person still accepts each change on the project page.
 */
function BriefSuggestionsField({
  mode,
  onChange,
}: {
  readonly mode: LibraryBriefSuggestionMode | undefined;
  readonly onChange: (mode: LibraryBriefSuggestionMode | undefined) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <p id="brief-suggestions-label" className="text-sm font-medium">
          Suggest brief updates when a conversation settles
        </p>
        <p className="text-xs text-muted-foreground">
          Runs with the conversation's model on the computer where it settled.
        </p>
      </div>
      <RadioGroup
        aria-labelledby="brief-suggestions-label"
        value={libraryBriefSuggestionChoice(mode)}
        onValueChange={(value) => {
          const choice = LIBRARY_BRIEF_SUGGESTION_CHOICES.find((entry) => entry.value === value);
          if (choice) onChange(libraryBriefSuggestionDraftValue(choice.value));
        }}
      >
        {LIBRARY_BRIEF_SUGGESTION_CHOICES.map((choice) => (
          <label key={choice.value} className="flex items-start gap-2.5">
            <Radio value={choice.value} />
            <span className="space-y-0.5">
              <span className="block text-sm">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">{choice.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </section>
  );
}

/** Scripts come from a copy's local project, where people already write and run them. */
function ScriptsField({
  scripts,
  copies,
  hostLabel,
  onChange,
}: {
  readonly scripts: readonly ProjectScript[];
  readonly copies: readonly LibraryWorkingCopy[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onChange: (scripts: readonly ProjectScript[]) => void;
}) {
  const sources = libraryProfileScriptSources(copies, useProjects());
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Scripts</p>
        <Menu>
          <MenuTrigger disabled={!sources.length} render={<Button size="xs" variant="outline" />}>
            Use this copy's scripts
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end">
            {sources.map((source) => (
              <MenuItem
                key={`${source.environmentId}:${source.projectId}`}
                onClick={() => onChange(source.scripts)}
              >
                {source.title} on {hostLabel(source.environmentId)} ({source.scripts.length})
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
      {scripts.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {scripts.map((script) => (
            <li key={script.id} className="flex items-center gap-3 py-2 ps-3 pe-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{script.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{script.command}</p>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${script.name}`}
                onClick={() => onChange(scripts.filter((entry) => entry.id !== script.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {sources.length
            ? "Bring in the scripts a copy already uses."
            : "Scripts appear here once a copy on a connected computer has some."}
        </p>
      )}
    </section>
  );
}

/** A fixed catalog: each computer checks these tools itself and never runs a saved command. */
function ToolsField({
  tools,
  onChange,
}: {
  readonly tools: readonly LibraryRequiredTool[];
  readonly onChange: (tools: readonly LibraryRequiredTool[]) => void;
}) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Required tools</p>
      <div className="flex flex-wrap gap-1.5">
        {LIBRARY_TOOL_CATALOG.map((tool) => (
          <Toggle
            key={tool.id}
            size="xs"
            shape="pill"
            variant="outline"
            pressed={tools.some((entry) => entry.id === tool.id)}
            onPressedChange={(pressed) =>
              onChange(
                pressed
                  ? [...tools, { id: tool.id }]
                  : tools.filter((entry) => entry.id !== tool.id),
              )
            }
          >
            {tool.label}
          </Toggle>
        ))}
      </div>
      {tools.length ? (
        <ul className="grid gap-2 pt-1 sm:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.id} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-xs">{libraryToolLabel(tool.id)}</span>
              <Input
                size="sm"
                aria-label={`Minimum ${libraryToolLabel(tool.id)} version`}
                placeholder="Any version"
                maxLength={32}
                value={tool.minimumVersion ?? ""}
                onChange={(event) =>
                  onChange(libraryToolsWithVersion(tools, tool.id, event.target.value))
                }
              />
              {LIBRARY_TOOL_CATALOG.some((entry) => entry.id === tool.id) ? null : (
                // Only catalog tools have a toggle above, so others are removed here.
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${tool.id}`}
                  onClick={() => onChange(tools.filter((entry) => entry.id !== tool.id))}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Names only. Each computer supplies the values, so none ever reach the Library. */
function SecretNamesField({
  names,
  onChange,
}: {
  readonly names: readonly string[];
  readonly onChange: (names: readonly string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const name = librarySecretNameFromInput(value);
    if (!name) {
      setInvalid(true);
      return;
    }
    if (!names.includes(name)) onChange([...names, name]);
    setValue("");
  };
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Secret names</p>
      {names.length ? (
        <div className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <Badge key={name} variant="outline">
              <KeyRoundIcon aria-hidden />
              {name}
              <Button
                size="icon-tiny"
                variant="ghost-muted"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(names.filter((entry) => entry !== name))}
              >
                <XIcon aria-hidden />
              </Button>
            </Badge>
          ))}
        </div>
      ) : null}
      {names.length < LIBRARY_PROFILE_LIMITS.secretNames ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            size="sm"
            aria-label="Secret name"
            aria-invalid={invalid || undefined}
            placeholder="GITHUB_TOKEN"
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              setInvalid(false);
              setValue(event.target.value);
            }}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!value.trim()}>
            Add
          </Button>
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {invalid
          ? "Use a variable name like GITHUB_TOKEN. Never paste the value here."
          : "Each computer provides the value from its own environment."}
      </p>
    </section>
  );
}

function ComputersField({
  computers,
  selected,
  hostLabel,
  onChange,
}: {
  readonly computers: readonly LibraryComputer[];
  readonly selected: readonly EnvironmentId[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onChange: (selected: readonly EnvironmentId[]) => void;
}) {
  const ids = libraryProfileComputerIds(computers, selected);
  if (!ids.length) return null;
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Preferred computers</p>
      <ul className="space-y-1.5">
        {ids.map((id) => {
          const checked = selected.includes(id);
          return (
            <li key={id}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={
                    !checked && selected.length >= LIBRARY_PROFILE_LIMITS.preferredEnvironmentIds
                  }
                  onCheckedChange={(next) =>
                    onChange(next ? [...selected, id] : selected.filter((entry) => entry !== id))
                  }
                />
                {hostLabel(id)}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
