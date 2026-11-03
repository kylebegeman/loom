import { useState } from "react";
import { PlusIcon, Trash2Icon, FileUpIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { randomUUID } from "~/lib/utils";
import { LabSelect } from "./HttpLabParts";
import { draftText } from "./apiRequestDraft";

export default function MultipartFields({
  rows,
  files,
  disabled,
  onChange,
  onFilesChange,
  onRemoveField,
}: {
  rows: readonly Record<string, unknown>[];
  files: Readonly<Record<number, readonly File[]>>;
  disabled: boolean;
  onChange: (rows: readonly Record<string, unknown>[]) => void;
  onFilesChange: (index: number, files: readonly File[]) => void;
  onRemoveField: (index: number) => void;
}) {
  const [keys, setKeys] = useState(() => rows.map(() => randomUUID()));
  const update = (index: number, patch: Record<string, unknown>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Text and files in one request</p>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || rows.length >= 1000}
          onClick={() => {
            setKeys([...keys, randomUUID()]);
            onChange([...rows, { key: "", value: "", isFile: false, active: true }]);
          }}
        >
          <PlusIcon />
          Add field
        </Button>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row, index) => (
          <div key={keys[index]} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                aria-label={`Enable multipart field ${index + 1}`}
                checked={row.active !== false}
                disabled={disabled}
                onCheckedChange={(active) => update(index, { active: active === true })}
              />
              <div className="min-w-0 flex-1 basis-28">
                <Input
                  aria-label={`Multipart field ${index + 1} name`}
                  value={draftText(row.key)}
                  placeholder="Field name"
                  disabled={disabled}
                  onChange={(event) => update(index, { key: event.target.value })}
                />
              </div>
              <div className="w-24">
                <LabSelect
                  label={`Multipart field ${index + 1} type`}
                  compact
                  value={row.isFile === true ? "file" : "text"}
                  options={[
                    { value: "text", label: "Text" },
                    { value: "file", label: "File" },
                  ]}
                  disabled={disabled}
                  onChange={(kind) => {
                    onFilesChange(index, []);
                    update(index, {
                      isFile: kind === "file",
                      value: kind === "file" ? [null] : "",
                    });
                  }}
                />
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove multipart field ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  setKeys(keys.filter((_, i) => i !== index));
                  onRemoveField(index);
                  onChange(rows.filter((_, i) => i !== index));
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            {row.isFile === true ? (
              <div className="space-y-2 pl-6">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
                  <span className="flex items-center gap-2">
                    <FileUpIcon className="size-3.5" />
                    Choose files
                  </span>
                  <input
                    type="file"
                    multiple
                    aria-label={`Files for multipart field ${index + 1}`}
                    className="sr-only"
                    disabled={disabled || row.active === false}
                    onChange={(event) => {
                      onFilesChange(index, Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                </label>
                {files[index]?.length ? (
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <ul className="min-w-0 space-y-1 text-xs">
                      {files[index]!.map((file) => (
                        <li
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                          className="break-all"
                        >
                          {file.name}{" "}
                          <span className="text-muted-foreground">
                            ({file.size.toLocaleString()} bytes)
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => onFilesChange(index, [])}
                    >
                      Clear files
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Select files before sending. Imported exports do not contain file bytes.
                  </p>
                )}
              </div>
            ) : (
              <div className="pl-6">
                <Input
                  aria-label={`Multipart field ${index + 1} value`}
                  value={draftText(row.value)}
                  placeholder="Value or <<variable>>"
                  disabled={disabled || row.active === false}
                  onChange={(event) => update(index, { value: event.target.value })}
                />
              </div>
            )}
            <div className="pl-6">
              <Input
                aria-label={`Multipart field ${index + 1} content type`}
                value={draftText(row.contentType)}
                placeholder={
                  row.isFile === true ? "Content type (automatic)" : "Content type (optional)"
                }
                disabled={disabled || row.active === false}
                onChange={(event) => update(index, { contentType: event.target.value })}
              />
            </div>
          </div>
        ))}
        {!rows.length ? (
          <p className="p-5 text-center text-xs text-muted-foreground">
            Add a text field or file to build this form.
          </p>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        128 KiB for the complete request, including field headers. Up to 32 files. Selections stay
        in this editor; upload bodies are omitted from saved history.
      </p>
    </div>
  );
}
