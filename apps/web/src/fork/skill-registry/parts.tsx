import type { SkillRegistryTarget, SkillValidationIssue } from "@t3tools/contracts/fork";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import type { ReactNode } from "react";

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {options.find((option) => option.value === value)?.label ?? "Choose…"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}
export function TargetChoice({
  targets,
  value,
  onChange,
}: {
  targets: readonly SkillRegistryTarget[];
  value: string;
  onChange: (value: string) => void;
}) {
  const target = targets.find((candidate) => candidate.id === value);
  return (
    <div className="space-y-1">
      <Choice
        label="Install location"
        value={value}
        options={targets.map((entry) => ({ value: entry.id, label: entry.label }))}
        onChange={onChange}
      />
      {target ? (
        <p className="break-all text-xs text-muted-foreground">
          {target.path}
          {target.seenBy.length > 1
            ? ". This folder is shared. Changes apply to every account that reads it."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
export function Issues({ issues }: { issues: readonly SkillValidationIssue[] }) {
  if (issues.length === 0)
    return <p className="text-xs text-muted-foreground">Validation passed.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {issues.map((issue) => (
        <li
          key={`${issue.code}:${issue.message}`}
          className={issue.severity === "error" ? "text-destructive" : "text-warning"}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}
