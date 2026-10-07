import type { ParameterHistory } from "./parameterHistory";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "~/components/ui/menu";
import { Undo2Icon, Redo2Icon, HistoryIcon } from "lucide-react";
import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";
import { useId, useState, type CSSProperties } from "react";
import {
  ChevronDownIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { ScadParameter, ScadParameters } from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  parameterLabel,
  parameterValues,
  stringParameterValue,
  vectorParameterValue,
} from "./params";
import { ModelTool } from "./WorkspaceTools";

function ParameterField({
  parameter,
  value,
  baseline,
  onChange,
}: {
  parameter: ScadParameter;
  value: string;
  baseline: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const label = parameterLabel(parameter.name);
  const vector = parameter.kind === "vector" ? vectorParameterValue(value) : null;
  const number = (
    inputId: string,
    inputLabel: string,
    current: number,
    commit: (value: number) => void,
  ) => (
    <NumberField
      id={inputId}
      value={current}
      min={parameter.range?.min}
      max={parameter.range?.max}
      step={parameter.range?.step ?? 1}
      size="sm"
      onValueChange={(next) => {
        if (next !== null && Number.isFinite(next)) commit(next);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldInput aria-label={inputLabel} />
      </NumberFieldGroup>
    </NumberField>
  );
  return (
    <div className={styles["model-parameter-field"]}>
      <div className={styles["model-parameter-label"]}>
        <label htmlFor={id}>{label}</label>
        {value !== baseline && (
          <ModelTool label={`Reset ${label}`} onClick={() => onChange(baseline)}>
            <RotateCcwIcon />
          </ModelTool>
        )}
      </div>
      {parameter.description && (
        <p className={styles["model-parameter-description"]}>{parameter.description}</p>
      )}
      {parameter.options?.length ? (
        <Select
          value={value}
          onValueChange={(next) => {
            if (next !== null) onChange(next);
          }}
          items={parameter.options}
        >
          <SelectTrigger id={id} size="sm" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {parameter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : parameter.kind === "boolean" ? (
        <Switch
          id={id}
          size="sm"
          aria-label={label}
          checked={value === "true"}
          onCheckedChange={(next) => onChange(String(next))}
        />
      ) : parameter.kind === "number" ? (
        <>
          <div className={parameter.range ? styles["model-parameter-range"] : undefined}>
            {parameter.range && (
              <input
                type="range"
                style={
                  {
                    "--model-range-fill": `${Math.max(0, Math.min(100, ((Number(value) - parameter.range.min) / (parameter.range.max - parameter.range.min || 1)) * 100))}%`,
                  } as CSSProperties
                }
                aria-label={`${label} slider`}
                min={parameter.range.min}
                max={parameter.range.max}
                step={parameter.range.step ?? "any"}
                value={Number(value)}
                onChange={(event) => onChange(event.target.value)}
              />
            )}
            {number(id, label, Number(value), (next) => onChange(String(next)))}
          </div>
          {parameter.range && (
            <div className={styles["model-range-bounds"]}>
              <span>{parameter.range.min}</span>
              <span>{parameter.range.max}</span>
            </div>
          )}
        </>
      ) : vector ? (
        <div className={styles["model-vector"]}>
          {vector.map((coordinate, index) => {
            const axis = vector.length === 3 ? ["X", "Y", "Z"][index] : String(index + 1);
            const axisId = index === 0 ? id : `${id}-${index}`;
            return (
              <div key={axis}>
                <label htmlFor={axisId}>{axis}</label>
                {number(axisId, `${label} ${axis}`, coordinate, (next) => {
                  const updated = [...vector];
                  updated[index] = next;
                  onChange(JSON.stringify(updated));
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <Input
          id={id}
          aria-label={label}
          size="sm"
          value={parameter.kind === "string" ? stringParameterValue(value) : value}
          onChange={(event) =>
            onChange(
              parameter.kind === "string" ? JSON.stringify(event.target.value) : event.target.value,
            )
          }
        />
      )}
    </div>
  );
}
function ParameterGroup({
  name,
  parameters,
  current,
  baseline,
  onChange,
  searching,
}: {
  name: string;
  searching: boolean;
  parameters: readonly ScadParameter[];
  current: Record<string, string>;
  baseline: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <details
      className={styles["model-parameter-group"]}
      open={searching || expanded}
      onToggle={(event) => {
        if (!searching) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <ChevronDownIcon />
        {name}
        <span>{parameters.length}</span>
      </summary>
      {parameters.map((parameter) => (
        <ParameterField
          key={parameter.name}
          parameter={parameter}
          value={current[parameter.name]!}
          baseline={baseline[parameter.name]!}
          onChange={(value) => onChange(parameter.name, value)}
        />
      ))}
    </details>
  );
}
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
  const [saveOpen, setSaveOpen] = useState(false),
    [saveName, setSaveName] = useState(""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState<string | null>(null);
  const current = parameterValues(data.parameters, values);
  const baseline = parameterValues(data.parameters, setName ? (data.setValues[setName] ?? {}) : {});
  const changed = data.parameters.filter(
    (parameter) => current[parameter.name] !== baseline[parameter.name],
  ).length;
  const groups = new Map<string, ScadParameter[]>();
  for (const parameter of data.parameters) {
    if (
      search &&
      !`${parameter.name} ${parameterLabel(parameter.name)} ${parameter.description ?? ""} ${parameter.group}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      continue;
    const group = parameter.group || "General";
    groups.set(group, [...(groups.get(group) ?? []), parameter]);
  }
  const trimmedName = saveName.trim();
  const replacing = data.sets.includes(trimmedName);
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
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-1">
          <ModelTool
            label="Undo parameter edit"
            disabled={history.cursor === 0}
            onClick={() => onHistory(history.cursor - 1)}
          >
            <Undo2Icon />
          </ModelTool>
          <ModelTool
            label="Redo parameter edit"
            disabled={history.cursor === history.entries.length - 1}
            onClick={() => onHistory(history.cursor + 1)}
          >
            <Redo2Icon />
          </ModelTool>
        </div>
        <Menu>
          <MenuTrigger
            render={<button className={styles["model-tool"]} aria-label="Parameter history" />}
          >
            <HistoryIcon /> History
          </MenuTrigger>
          <MenuPopup align="end">
            {history.entries.map((entry, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- History entries retain their position until the bounded log truncates.
              <MenuItem key={index} onClick={() => onHistory(index)}>
                {index === history.cursor ? "Current: " : ""}
                {entry.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
      <div className={styles["model-parameter-presets"]}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">Parameter set</span>
          <ModelTool
            label="Save parameter set"
            onClick={() => {
              setSaveName(setName ?? "");
              setSaveError(null);
              setSaveOpen(true);
            }}
          >
            <SaveIcon />
          </ModelTool>
        </div>
        <Select
          value={setName ?? ""}
          onValueChange={(next) => onSet(next || null)}
          items={[
            { value: "", label: "Source defaults" },
            ...data.sets.map((name) => ({ value: name, label: name })),
          ]}
        >
          <SelectTrigger size="sm" aria-label="Parameter set">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Source defaults</SelectItem>
            {data.sets.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{changed ? `${changed} modified` : "No changes to this set"}</span>
          {changed > 0 && (
            <Button size="micro" variant="ghost" onClick={() => onSet(setName)}>
              Reset changes
            </Button>
          )}
        </div>
      </div>
      {data.parameters.length > 5 && (
        <div className={styles["model-parameter-search"]}>
          <Input
            type="search"
            size="sm"
            aria-label="Find parameter"
            placeholder="Find parameter..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}
      <div className={styles["model-inspector-scroll"]}>
        {data.parameters.length === 0 ? (
          <div className={styles["model-empty"]}>
            <SlidersHorizontalIcon />
            <strong>No customizer parameters</strong>
            <p>Add customizer variables to the SCAD source to edit them here.</p>
          </div>
        ) : groups.size === 0 ? (
          <div className={styles["model-empty"]}>
            <SearchIcon />
            <strong>No matching parameters</strong>
            <Button size="sm" variant="ghost" onClick={() => setSearch("")}>
              Clear search
            </Button>
          </div>
        ) : (
          [...groups].map(([name, parameters]) => (
            <ParameterGroup
              key={name}
              name={name}
              searching={search.trim().length > 0}
              parameters={parameters}
              current={current}
              baseline={baseline}
              onChange={onChange}
            />
          ))
        )}
        {data.parameters.length > 0 && (
          <div className="p-3">
            <Button size="sm" variant="ghost-muted" onClick={onReset}>
              <RotateCcwIcon />
              Restore source defaults
            </Button>
          </div>
        )}
      </div>
      <div className={styles["model-parameter-footer"]}>
        <label className={styles["model-preview-switch"]}>
          <span>
            Auto preview<small>Render parameter changes as you edit</small>
          </span>
          <Switch size="sm" checked={automatic} onCheckedChange={onAutomatic} />
        </label>
        {!automatic && (
          <Button size="sm" disabled={!hasUnapplied} onClick={onApply}>
            Apply changes
          </Button>
        )}
        <p role="status">
          {pending
            ? "Rendering your changes..."
            : hasUnapplied
              ? automatic
                ? "Updating preview..."
                : "Changes are ready to apply."
              : "Preview is up to date."}
        </p>
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
              <DialogDescription>
                Keep these values in{" "}
                {path
                  .replace(/\.scad$/i, ".json")
                  .split("/")
                  .at(-1)}{" "}
                for later.
              </DialogDescription>
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
