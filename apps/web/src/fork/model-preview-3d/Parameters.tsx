import styles from "./workspace.module.css";
import { useState } from "react";
import {
  ChevronRightIcon,
  ChevronsUpDownIcon,
  HistoryIcon,
  PlusIcon,
  Redo2Icon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type { ScadParameter, ScadParameters } from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
} from "~/components/ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import type { ParameterHistory } from "./parameterHistory";
import { OperationStatus } from "./OperationStatus";
import { parameterLabel, parameterValues } from "./params";
import { Chip, EmptyNote, ParameterRow, Tip } from "./controls";

const HISTORY_SHOWN = 12;
const SEARCH_THRESHOLD = 5;

function ago(time: number, now: number) {
  if (!time) return "";
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

/** Render state shown in the Customize footer. */
function PreviewStatus({
  pending,
  automatic,
  hasUnapplied,
}: {
  pending: boolean;
  automatic: boolean;
  hasUnapplied: boolean;
}) {
  const [tone, text] = pending
    ? (["busy", "Rendering preview"] as const)
    : hasUnapplied
      ? automatic
        ? (["busy", "Preview updates when you stop editing"] as const)
        : (["warning", "Changes not applied"] as const)
      : (["ready", "Up to date"] as const);
  return (
    <span className={styles["model-preview-status"]} role="status">
      <span className={styles["model-state-dot"]} data-tone={tone} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function ParameterGroup({
  name,
  parameters,
  current,
  baseline,
  open,
  onToggle,
  onChange,
}: {
  name: string | null;
  parameters: readonly ScadParameter[];
  current: Record<string, string>;
  baseline: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onChange: (name: string, value: string) => void;
}) {
  const changed = parameters.filter((p) => current[p.name] !== baseline[p.name]).length;
  return (
    <section className={styles["model-param-group"]}>
      {name !== null && (
        <button
          type="button"
          className={styles["model-param-group-head"]}
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronRightIcon />
          <span>{name}</span>
          <small>{changed ? `${changed} of ${parameters.length} changed` : ""}</small>
        </button>
      )}
      {open &&
        parameters.map((parameter) => (
          <ParameterRow
            key={parameter.name}
            parameter={parameter}
            value={current[parameter.name]!}
            baseline={baseline[parameter.name]!}
            onChange={(value) => onChange(parameter.name, value)}
          />
        ))}
    </section>
  );
}

/** Customize tab: parameter set, history, searchable grouped parameters and preview controls. */
export function Parameters({
  history,
  onHistory,
  data,
  values,
  setName,
  path,
  automatic,
  pending,
  hasUnapplied,
  onAutomatic,
  onApply,
  onChange,
  onSet,
  onSave,
  onReset,
}: {
  history: ParameterHistory;
  onHistory: (cursor: number) => void;
  data: ScadParameters;
  values: Readonly<Record<string, string>>;
  setName: string | null;
  path: string;
  automatic: boolean;
  pending: boolean;
  hasUnapplied: boolean;
  onAutomatic: (value: boolean) => void;
  onApply: () => void;
  onChange: (name: string, value: string) => void;
  onSet: (name: string | null) => void;
  onSave: (name: string) => Promise<void>;
  onReset: () => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [saveOpen, setSaveOpen] = useState(false),
    [saveName, setSaveName] = useState(""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState<string | null>(null),
    [historyTime, setHistoryTime] = useState(0);
  const current = parameterValues(data.parameters, values);
  const baseline = parameterValues(data.parameters, setName ? (data.setValues[setName] ?? {}) : {});
  const changed = data.parameters.filter(
    (parameter) => current[parameter.name] !== baseline[parameter.name],
  ).length;
  const query = search.trim().toLowerCase();
  const groups = new Map<string, ScadParameter[]>();
  for (const parameter of data.parameters) {
    if (
      query &&
      !`${parameter.name} ${parameterLabel(parameter.name)} ${parameter.description ?? ""} ${parameter.group}`
        .toLowerCase()
        .includes(query)
    )
      continue;
    groups.set(parameter.group, [...(groups.get(parameter.group) ?? []), parameter]);
  }
  // A file without customizer groups reads as one plain list.
  const headed = groups.size > 1 || !groups.has("");
  const sidecar = path
    .replace(/\.scad$/i, ".json")
    .split("/")
    .at(-1);
  const trimmedName = saveName.trim();
  const replacing = data.sets.includes(trimmedName);
  const openSave = (name: string) => {
    setSaveName(name);
    setSaveError(null);
    setSaveOpen(true);
  };
  const save = async () => {
    if (!trimmedName || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(trimmedName);
      setSaveOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const shownHistory = history.entries
    .map((entry, index) => ({ entry, index }))
    .slice(-HISTORY_SHOWN)
    .toReversed();
  return (
    <>
      <div className={styles["model-customize-head"]}>
        <Menu>
          <MenuTrigger
            render={<button type="button" className={styles["model-set-button"]} />}
            aria-label="Parameter set"
          >
            <span className={styles["model-set-name"]}>{setName ?? "Source defaults"}</span>
            {changed > 0 && <Chip tone="primary">{changed} changed</Chip>}
            <ChevronsUpDownIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuGroup>
              <MenuGroupLabel>Parameter sets</MenuGroupLabel>
              <MenuRadioGroup
                value={setName ?? ""}
                onValueChange={(next: string) => onSet(next || null)}
              >
                <MenuRadioItem value="">Source defaults</MenuRadioItem>
                {data.sets.map((name) => (
                  <MenuRadioItem key={name} value={name}>
                    {name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onClick={() => openSave("")}>
              <PlusIcon />
              Save as new set
            </MenuItem>
            {setName && (
              <MenuItem disabled={!changed} onClick={() => openSave(setName)}>
                <SaveIcon />
                Update “{setName}”
              </MenuItem>
            )}
            <MenuItem disabled={!changed} onClick={() => onSet(setName)}>
              <RotateCcwIcon />
              {setName ? "Reset to set values" : "Reset changes"}
            </MenuItem>
            <MenuItem disabled={!setName && !changed} onClick={onReset}>
              <RotateCcwIcon />
              Restore source defaults
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Tip label="Undo" kbd="⌘Z">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Undo parameter edit"
            disabled={history.cursor === 0}
            onClick={() => onHistory(history.cursor - 1)}
          >
            <Undo2Icon />
          </Button>
        </Tip>
        <Tip label="Redo" kbd="⇧⌘Z">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Redo parameter edit"
            disabled={history.cursor >= history.entries.length - 1}
            onClick={() => onHistory(history.cursor + 1)}
          >
            <Redo2Icon />
          </Button>
        </Tip>
        <Menu onOpenChange={(open) => open && setHistoryTime(Date.now())}>
          <MenuTrigger
            render={<Button variant="ghost-muted" size="icon-sm" aria-label="Parameter history" />}
          >
            <HistoryIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>History</MenuGroupLabel>
              <MenuRadioGroup
                value={history.cursor}
                onValueChange={(next: number) => onHistory(next)}
              >
                {shownHistory.map(({ entry, index }) => (
                  <MenuRadioItem key={`${index}:${entry.time}`} value={index}>
                    <span className="min-w-0 truncate">{entry.label}</span>
                    <MenuShortcut>{ago(entry.time, historyTime)}</MenuShortcut>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
      {data.parameters.length > SEARCH_THRESHOLD && (
        <div className={styles["model-search"]}>
          <SearchIcon />
          <Input
            size="sm"
            aria-label="Search parameters"
            placeholder="Search parameters"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                setSearch("");
              }
            }}
          />
          {search && (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <XIcon />
            </Button>
          )}
        </div>
      )}
      <div className={styles["model-inspector-scroll"]}>
        {data.parameters.length === 0 ? (
          <EmptyNote>Add customizer variables to the SCAD source to edit them here.</EmptyNote>
        ) : groups.size === 0 ? (
          <EmptyNote>
            No parameters match “{search.trim()}”.
            <Button variant="outline" size="xs" onClick={() => setSearch("")}>
              Clear search
            </Button>
          </EmptyNote>
        ) : (
          [...groups].map(([group, parameters]) => (
            <ParameterGroup
              key={group}
              name={headed ? group || "General" : null}
              parameters={parameters}
              current={current}
              baseline={baseline}
              open={!headed || !!query || !collapsed[group]}
              onToggle={() => setCollapsed((state) => ({ ...state, [group]: !state[group] }))}
              onChange={onChange}
            />
          ))
        )}
      </div>
      <div className={styles["model-inspector-foot"]}>
        <PreviewStatus pending={pending} automatic={automatic} hasUnapplied={hasUnapplied} />
        <div className="flex-1" />
        <Tip label="Render after every change">
          <label className={styles["model-live"]}>
            Live
            <Switch
              size="sm"
              aria-label="Live preview"
              checked={automatic}
              onCheckedChange={onAutomatic}
            />
          </label>
        </Tip>
        {!automatic && (
          <Button size="xs" disabled={!hasUnapplied || pending} onClick={onApply}>
            Apply
          </Button>
        )}
      </div>
      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (!saving) setSaveOpen(open);
        }}
      >
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogHeader>
              <DialogTitle>Save parameter set</DialogTitle>
              <DialogDescription>Keep these values in {sidecar} for later.</DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <label className="flex flex-col gap-2 text-sm">
                Set name
                <Input
                  autoFocus
                  value={saveName}
                  maxLength={100}
                  placeholder="e.g. Wide bracket"
                  disabled={saving}
                  onChange={(event) => setSaveName(event.target.value)}
                />
              </label>
              {replacing && (
                <p className="text-sm text-muted-foreground">
                  This replaces “{trimmedName}”. Other saved sets are preserved.
                </p>
              )}
              {saving && (
                <OperationStatus
                  label="Saving parameter set"
                  detail="Updating the sidecar without replacing unrelated sets."
                />
              )}
              {saveError && (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {saveError}
                </p>
              )}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!trimmedName || saving}>
                {saving ? "Saving..." : replacing ? "Replace set" : "Save set"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
