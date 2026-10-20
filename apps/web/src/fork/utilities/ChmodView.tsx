import { Checkbox } from "~/components/ui/checkbox";
import { formatChmodOctal, parseChmod } from "./tools/chmod";

const CLASSES = [
  { label: "Owner", shift: 6 },
  { label: "Group", shift: 3 },
  { label: "Others", shift: 0 },
] as const;

const PERMISSIONS = [
  { label: "Read", bit: 4 },
  { label: "Write", bit: 2 },
  { label: "Execute", bit: 1 },
] as const;

const SPECIAL_BITS = [
  { label: "setuid", bit: 0o4000 },
  { label: "setgid", bit: 0o2000 },
  { label: "sticky", bit: 0o1000 },
] as const;

/**
 * The read, write and execute grid. Each click writes the octal form back into the input, so
 * the input stays the one source of truth. Invalid input shows an empty grid.
 */
export function ChmodView({
  text,
  onChange,
}: {
  readonly text: string;
  readonly onChange: (text: string) => void;
}) {
  const parsed = parseChmod(text);
  const mode = "mode" in parsed ? parsed.mode : 0;
  const toggle = (bit: number, on: boolean) =>
    onChange(formatChmodOctal(on ? mode | bit : mode & ~bit));

  return (
    <div className="flex flex-col gap-2">
      <table className="w-fit text-sm">
        <thead>
          <tr>
            <th className="pe-3" />
            {PERMISSIONS.map((permission) => (
              <th
                key={permission.label}
                className="px-2 pb-1 font-normal text-muted-foreground text-xs"
              >
                {permission.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CLASSES.map((entry) => (
            <tr key={entry.label}>
              <th scope="row" className="pe-3 text-start font-normal">
                {entry.label}
              </th>
              {PERMISSIONS.map((permission) => {
                const bit = permission.bit << entry.shift;
                return (
                  <td key={permission.label} className="px-2 py-1 text-center">
                    <Checkbox
                      aria-label={`${entry.label} ${permission.label.toLowerCase()}`}
                      checked={(mode & bit) !== 0}
                      onCheckedChange={(checked) => toggle(bit, checked === true)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 text-sm">
        {SPECIAL_BITS.map((special) => (
          <label key={special.label} className="inline-flex items-center gap-2">
            <Checkbox
              checked={(mode & special.bit) !== 0}
              onCheckedChange={(checked) => toggle(special.bit, checked === true)}
            />
            {special.label}
          </label>
        ))}
      </div>
    </div>
  );
}
