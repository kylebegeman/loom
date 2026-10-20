import { ArrowDownUpIcon, CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useDeferredValue, useEffect, useId, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "~/components/ui/number-field";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ChmodView } from "./ChmodView";
import { DiffToolView } from "./DiffToolView";
import { RegexView } from "./RegexView";
import { runUtilityTool } from "./registry";
import { cryptoRandom, localTimeZone } from "./runtime";
import { useUtilitiesStore, type UtilityDraft } from "./store";
import {
  booleanOption,
  defaultOptions,
  numberOption,
  stringOption,
  type UtilityOption,
  type UtilityOptionValues,
  type UtilityOutputField,
  type UtilityResult,
  type UtilityRunInput,
  type UtilityTool,
} from "./types";
import { UrlEditor } from "./UrlEditor";

/** Above this many UTF-16 units a keystroke waits for a pause before the tool runs again. */
const LARGE_INPUT_CHARS = 64 * 1024;
const LARGE_INPUT_DEBOUNCE_MS = 120;
/** A select with this many choices or fewer shows them all as a segmented control. */
const SEGMENTED_MAX_CHOICES = 3;

const initialDraft = (tool: UtilityTool): UtilityDraft => ({
  text: tool.defaultText?.() ?? "",
  second: "",
  options: defaultOptions(tool.options),
});

const runInput = (draft: UtilityDraft): UtilityRunInput => ({
  text: draft.text,
  second: draft.second,
  options: draft.options,
  random: cryptoRandom,
  now: Date.now,
  timeZone: localTimeZone(),
});

const sameOptions = (a: UtilityOptionValues, b: UtilityOptionValues) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
};

/**
 * Typing stays immediate; the tool runs on a deferred copy, and on a debounced one for large
 * inputs so a 1 MiB paste is not transformed on every keystroke.
 */
function useSettledDraft(draft: UtilityDraft): UtilityDraft {
  const large = draft.text.length + draft.second.length > LARGE_INPUT_CHARS;
  const [debounced, setDebounced] = useState(draft);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), large ? LARGE_INPUT_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [draft, large]);
  return useDeferredValue(large ? debounced : draft);
}

export function ToolView({ tool }: { readonly tool: UtilityTool }) {
  const stored = useUtilitiesStore((state) => state.drafts[tool.id]);
  const generated = useUtilitiesStore((state) => state.generated[tool.id]);
  const [fallback] = useState(() => initialDraft(tool));
  const draft = stored ?? fallback;
  const settled = useSettledDraft(draft);
  const inputId = useId();
  const secondId = useId();

  const update = (patch: Partial<UtilityDraft>) => {
    const utilities = useUtilitiesStore.getState();
    utilities.setDraft(tool.id, { ...(utilities.drafts[tool.id] ?? fallback), ...patch });
  };
  const setOption = (id: string, value: string | number | boolean) =>
    update({ options: { ...draft.options, [id]: value } });

  const hasInput = settled.text !== "" || settled.second !== "";
  const result = tool.run && hasInput ? runUtilityTool(tool, "run", runInput(settled)) : null;
  const swapValue = result?.kind === "ok" ? result.fields[0]?.value : undefined;
  const generatedStale = generated !== undefined && !sameOptions(generated.options, draft.options);

  const loadExample = () => {
    if (!tool.example) return;
    update({
      text: tool.example.text,
      second: tool.example.second ?? "",
      options: { ...defaultOptions(tool.options), ...tool.example.options },
    });
  };
  const swap = () => {
    if (!tool.swap || swapValue === undefined) return;
    update({ text: swapValue, options: tool.swap(draft.options) });
  };
  const generate = () => {
    const next = runUtilityTool(tool, "generate", runInput(draft));
    if (next)
      useUtilitiesStore.getState().setGenerated(tool.id, { result: next, options: draft.options });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <h2 data-utility-heading tabIndex={-1} className="font-medium text-sm outline-none">
        {tool.label}
      </h2>
      {tool.options.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {tool.options.map((option) => (
            <OptionControl
              key={option.id}
              option={option}
              values={draft.options}
              onChange={(value) => setOption(option.id, value)}
            />
          ))}
        </div>
      )}
      {tool.id === "chmod" && <ChmodView text={draft.text} onChange={(text) => update({ text })} />}
      {tool.input !== "none" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={inputId}>{tool.inputLabel ?? "Input"}</Label>
            {/* Textarea takes no font classes; it inherits monospace from here. */}
            <div className="font-mono">
              <Textarea
                id={inputId}
                value={draft.text}
                placeholder={tool.placeholder}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => update({ text: event.target.value })}
              />
            </div>
          </div>
          {tool.input === "two" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={secondId}>{tool.secondInputLabel ?? "Second input"}</Label>
              <div className="font-mono">
                <Textarea
                  id={secondId}
                  value={draft.second}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => update({ second: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {tool.generate && (
          <Button size="sm" onClick={generate}>
            {generated ? <RefreshCwIcon /> : null}
            {generated ? "Regenerate" : "Generate"}
          </Button>
        )}
        {tool.example && tool.input !== "none" && (
          <Button size="sm" variant="outline" onClick={loadExample}>
            Example
          </Button>
        )}
        {tool.swap && (
          <Button
            size="sm"
            variant="outline"
            disabled={swapValue === undefined}
            onClick={swap}
            title="Use the output as the input and reverse the direction"
          >
            <ArrowDownUpIcon />
            Swap
          </Button>
        )}
      </div>
      {result ? (
        <ResultView result={result} />
      ) : (
        !generated && <p className="text-muted-foreground text-sm">{tool.description}</p>
      )}
      {result?.kind === "ok" && tool.id === "regex" && (
        <RegexView
          pattern={settled.text}
          flags={stringOption(settled.options, "flags", "g")}
          text={settled.second}
        />
      )}
      {result?.kind === "ok" && tool.id === "diff" && (
        <DiffToolView
          original={settled.text}
          changed={settled.second}
          view={stringOption(settled.options, "view", "unified") === "split" ? "split" : "unified"}
          ignoreWhitespace={booleanOption(settled.options, "ignoreWhitespace", false)}
        />
      )}
      {/* Not gated on the result: an edit can leave the URL invalid until the next keystroke. */}
      {tool.id === "url-parse" && draft.text !== "" && (
        <UrlEditor text={draft.text} onChange={(text) => update({ text })} />
      )}
      {generated && (
        <div className="flex flex-col gap-2">
          {generatedStale && (
            <p className="text-muted-foreground text-xs">
              Options changed. Regenerate to apply them.
            </p>
          )}
          <ResultView result={generated.result} />
        </div>
      )}
    </div>
  );
}

function OptionControl({
  option,
  values,
  onChange,
}: {
  readonly option: UtilityOption;
  readonly values: UtilityOptionValues;
  readonly onChange: (value: string | number | boolean) => void;
}) {
  const id = useId();
  switch (option.kind) {
    case "select": {
      const value = stringOption(values, option.id, option.defaultValue);
      if (option.choices.length <= SEGMENTED_MAX_CHOICES)
        return (
          <div className="flex flex-col gap-1">
            <span id={id} className="text-muted-foreground text-xs">
              {option.label}
            </span>
            <ToggleGroup
              aria-labelledby={id}
              value={[value]}
              onValueChange={(next) => {
                const chosen = option.choices.find((choice) => choice.value === next[0]);
                if (chosen) onChange(chosen.value);
              }}
            >
              {option.choices.map((choice) => (
                <Toggle key={choice.value} value={choice.value}>
                  {choice.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
        );
      return (
        <div className="flex min-w-36 flex-col gap-1">
          <span id={id} className="text-muted-foreground text-xs">
            {option.label}
          </span>
          <Select
            value={value}
            items={option.choices}
            onValueChange={(next) => {
              const chosen = option.choices.find((choice) => choice.value === next);
              if (chosen) onChange(chosen.value);
            }}
          >
            <SelectTrigger size="sm" aria-labelledby={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {option.choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      );
    }
    case "toggle":
      return (
        <Label className="h-8">
          <Switch
            size="sm"
            checked={booleanOption(values, option.id, option.defaultValue)}
            onCheckedChange={(checked) => onChange(checked)}
          />
          {option.label}
        </Label>
      );
    case "number":
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-muted-foreground text-xs">
            {option.label}
          </label>
          <NumberField
            id={id}
            size="sm"
            className="w-28"
            value={numberOption(values, option.id, option.defaultValue)}
            min={option.min}
            max={option.max}
            step={1}
            onValueChange={(next) => {
              if (next !== null && Number.isFinite(next)) onChange(next);
            }}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
        </div>
      );
    case "text":
      return (
        <div className="flex min-w-36 flex-1 flex-col gap-1">
          <label htmlFor={id} className="text-muted-foreground text-xs">
            {option.label}
          </label>
          <Input
            id={id}
            size="sm"
            value={stringOption(values, option.id, option.defaultValue)}
            placeholder={option.placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
  }
}

export function ResultView({ result }: { readonly result: UtilityResult }) {
  if (result.kind === "error")
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.message}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {result.warnings?.map((warning) => (
        <p key={warning} className="text-muted-foreground text-xs">
          {warning}
        </p>
      ))}
      {result.fields.map((field, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Labels can repeat; a tool's fields keep their order.
        <OutputFieldRow key={`${index}:${field.label}`} field={field} />
      ))}
    </div>
  );
}

function OutputFieldRow({ field }: { readonly field: UtilityOutputField }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: field.label });
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{field.label}</span>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Copy ${field.label}`}
          onClick={() => copyToClipboard(field.value)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
          {isCopied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">
        {field.color && (
          <span
            aria-hidden
            className="mt-0.5 size-4 shrink-0 rounded-sm border"
            style={{ backgroundColor: field.color }}
          />
        )}
        <pre
          className={cn(
            "max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap wrap-anywhere text-sm",
            field.monospace ? "font-mono" : "font-sans",
          )}
        >
          {field.value}
        </pre>
      </div>
    </div>
  );
}
