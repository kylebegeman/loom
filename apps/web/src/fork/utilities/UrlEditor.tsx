import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { buildUrl, parseUrlForEditing, type EditableUrl } from "./tools/web";

type UrlPart = Exclude<keyof EditableUrl, "params">;

const PARTS: ReadonlyArray<{ readonly id: UrlPart; readonly label: string }> = [
  { id: "protocol", label: "Scheme" },
  { id: "username", label: "Username" },
  { id: "password", label: "Password" },
  { id: "hostname", label: "Host" },
  { id: "port", label: "Port" },
  { id: "pathname", label: "Path" },
  { id: "hash", label: "Fragment" },
];

/**
 * Edits the URL by part and writes the rebuilt URL back into the input. The parts stay as
 * typed while the input holds what this editor wrote, so normalization never moves the caret
 * and a momentarily invalid URL does not close the editor.
 */
export function UrlEditor({
  text,
  onChange,
}: {
  readonly text: string;
  readonly onChange: (text: string) => void;
}) {
  const [synced, setSynced] = useState(() => ({ text, parts: parseUrlForEditing(text) }));
  let parts = synced.parts;
  if (synced.text !== text) {
    // The input changed outside the editor: start again from what it now says.
    parts = parseUrlForEditing(text);
    setSynced({ text, parts });
  }
  if (!parts) return null;
  const current = parts;

  const update = (next: EditableUrl) => {
    const built = buildUrl(next);
    setSynced({ text: built, parts: next });
    onChange(built);
  };
  const setParam = (index: number, patch: Partial<EditableUrl["params"][number]>) =>
    update({
      ...current,
      params: current.params.map((param, at) => (at === index ? { ...param, ...patch } : param)),
    });

  return (
    <section className="flex flex-col gap-3" aria-label="Edit URL">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        {PARTS.map((part) => (
          <label key={part.id} className="contents">
            <span className="text-muted-foreground">{part.label}</span>
            <Input
              size="sm"
              font="mono"
              value={current[part.id]}
              onChange={(event) => update({ ...current, [part.id]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-sm">Query parameters</span>
        {current.params.map((param, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- Keys repeat and change as typed; position is the identity.
          <div key={index} className="flex items-center gap-2">
            <Input
              size="sm"
              font="mono"
              aria-label={`Parameter ${index + 1} name`}
              value={param.key}
              onChange={(event) => setParam(index, { key: event.target.value })}
            />
            <Input
              size="sm"
              font="mono"
              aria-label={`Parameter ${index + 1} value`}
              value={param.value}
              onChange={(event) => setParam(index, { value: event.target.value })}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove parameter ${index + 1}`}
              onClick={() =>
                update({ ...current, params: current.params.filter((_, at) => at !== index) })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          onClick={() =>
            update({ ...current, params: [...current.params, { key: "", value: "" }] })
          }
        >
          <PlusIcon />
          Add parameter
        </Button>
      </div>
    </section>
  );
}
