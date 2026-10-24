import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BotIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { initialRunValues, runInputs } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import { ComposerBanner } from "~/components/chat/ComposerBanner";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ForkComposerContext } from "../../composer/registry";
import { LibraryErrorNotice } from "../../project-library/LibraryControls";
import { ParameterField } from "../BotRunForm";
import { focusFirstInputError, runInputErrors, shortDescription } from "../runForm";
import { bots, useBots } from "../state";
import { useBotRunDrawerStore } from "./drawerStore";
import { useComposerBotsAccess } from "./slashSource";

function BotRunDrawerForm({
  environmentId,
  threadId,
  bot,
  canRun,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly bot: BotDefinition;
  readonly canRun: boolean;
  readonly onClose: () => void;
}) {
  const [values, setValues] = useState(() => initialRunValues(bot));
  const [attempted, setAttempted] = useState(false);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.run, { reportFailure: false });
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const inputId = (name: string) => `${formId}-${name}`;
  const errors = runInputErrors(bot.parameters, values);
  const description = shortDescription(bot.description);

  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLElement>("input, textarea, button[role=combobox], button[type=submit]")
      ?.focus();
  }, []);

  const submit = async () => {
    if (busy || !canRun) return;
    setAttempted(true);
    if (Object.keys(errors).length > 0) {
      setError(null);
      focusFirstInputError(bot.parameters, errors, inputId);
      return;
    }
    setBusy(true);
    setError(null);
    // The async wrapper lets a throw while building the input reach the same handler.
    await (async () => {
      // The server takes the project and checkout from the calling thread.
      const result = await run({
        environmentId,
        input: {
          botId: bot.id,
          inputs: runInputs(bot, values),
          callerThreadId: threadId,
          ...(notify ? { notify: true } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onClose();
    })().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : `Could not run ${bot.name}.`);
      setBusy(false);
    });
  };

  return (
    <form
      ref={formRef}
      className="grid gap-3 pt-1 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        // Enter in a long text adds a line, so the shortcut that sends from anywhere is Mod+Enter.
        // It stops here so the composer around the drawer does not send its message too.
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }
      }}
    >
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {bot.parameters.map((parameter) => (
        <ParameterField
          key={parameter.name}
          id={inputId(parameter.name)}
          parameter={parameter}
          error={attempted ? errors[parameter.name] : null}
          value={values[parameter.name] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [parameter.name]: value }))}
        />
      ))}
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={notify} onCheckedChange={setNotify} />
        Post the result to this thread
      </label>
      <LibraryErrorNotice error={error} />
      {canRun ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          This connection cannot run bots.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" shape="pill" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" shape="pill" size="sm" disabled={busy || !canRun}>
          {busy ? "Starting…" : "Run"}
        </Button>
      </div>
    </form>
  );
}

function BotRunDrawer({
  botId,
  threadId,
  context,
  onClose,
}: {
  readonly botId: string;
  readonly threadId: ThreadId;
  readonly context: ForkComposerContext;
  readonly onClose: () => void;
}) {
  const { host, canRun } = useComposerBotsAccess(context);
  const { list, bots: definitions } = useBots();
  const bot = definitions.find((candidate) => candidate.id === botId);

  return (
    <ComposerBanner.Root
      data-bot-run-drawer="true"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <ComposerBanner.Row>
        <ComposerBanner.Icon>
          <BotIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content>
          <span className="truncate font-medium">{bot ? `Run ${bot.name}` : "Run a bot"}</span>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <ComposerBanner.Dismiss aria-label="Close" onClick={onClose} />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
      <ComposerBanner.Scroll>
        <ComposerBanner.Body>
          {bot && host.environmentId ? (
            <BotRunDrawerForm
              environmentId={host.environmentId}
              threadId={threadId}
              bot={bot}
              canRun={canRun}
              onClose={onClose}
            />
          ) : list.error && !list.data ? (
            // A failed load says nothing about the bot, so it offers a retry, not a verdict.
            <div className="pb-2">
              <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
            </div>
          ) : (
            <p role="status" className="pb-2 text-sm text-muted-foreground">
              {list.data && !bot ? "That bot no longer exists." : "Loading…"}
            </p>
          )}
        </ComposerBanner.Body>
      </ComposerBanner.Scroll>
    </ComposerBanner.Root>
  );
}

/** The run form above this thread's composer, while one is open for it. */
export function useBotRunDrawer(context: ForkComposerContext): ReactNode | null {
  const open = useBotRunDrawerStore((state) => state.open);
  const close = useBotRunDrawerStore((state) => state.close);
  const { threadRef } = context;
  if (open === null || threadRef === null || open.threadKey !== scopedThreadKey(threadRef))
    return null;
  return (
    <BotRunDrawer
      key={open.botId}
      botId={open.botId}
      threadId={threadRef.threadId}
      context={context}
      onClose={close}
    />
  );
}
