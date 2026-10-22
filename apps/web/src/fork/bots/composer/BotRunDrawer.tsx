import { useEffect, useRef, useState, type ReactNode } from "react";
import { BotIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import { ComposerBanner } from "~/components/chat/ComposerBanner";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ForkComposerContext } from "../../composer/registry";
import { ParameterField } from "../BotRunForm";
import { initialRunValues, runInputs } from "@t3tools/client-runtime/fork";
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
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.run, { reportFailure: false });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLElement>("input, textarea, button[role=combobox], button[type=submit]")
      ?.focus();
  }, []);

  const submit = async () => {
    if (busy || !canRun) return;
    setBusy(true);
    setError(null);
    try {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not run ${bot.name}.`);
      setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
      className="grid gap-3 pt-1 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {bot.description ? <p className="text-xs text-muted-foreground">{bot.description}</p> : null}
      {bot.parameters.map((parameter) => (
        <ParameterField
          key={parameter.name}
          parameter={parameter}
          value={values[parameter.name] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [parameter.name]: value }))}
        />
      ))}
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={notify} onCheckedChange={setNotify} />
        Post the result to this thread
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {canRun ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          This connection cannot run bots.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !canRun}>
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
          ) : (
            <p role="status" className="pb-2 text-sm text-muted-foreground">
              {list.isPending ? "Loading…" : "That bot no longer exists."}
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
