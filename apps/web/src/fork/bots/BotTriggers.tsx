import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_TRIGGER_EVENT_FIELDS,
  BOTS_TRIGGER_FIRINGS_MAX_LIMIT,
  type BotDefinition,
  type BotTrigger,
  type BotTriggerFiring,
} from "@t3tools/contracts/fork";
import {
  applyFiringChanges,
  applyTriggerChanges,
  type BotTriggerChanges,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { runTime } from "./BotRuns";
import { bots } from "./state";
import { triggerSummary } from "./triggerDraft";

const FIRINGS_PAGE = Math.min(20, BOTS_TRIGGER_FIRINGS_MAX_LIMIT);

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

function WebhookAddress({
  environmentId,
  trigger,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly canOperate: boolean;
}) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "webhook URL" });
  const rotate = useAtomCommand(bots.rotateTriggerToken, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = trigger.webhook;
  if (endpoint === undefined) return null;
  const { address, copyable, note } = webhookAddress(endpoint, httpBaseUrl);
  const rotateAddress = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Rotate this address? The current one stops working.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const result = await rotate({ environmentId, input: { triggerId: trigger.id } });
    setBusy(false);
    if (result._tag === "Failure")
      setError(errorText(squashAtomCommandFailure(result), "Could not rotate the address."));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label={`${trigger.name} address`}
          value={address}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!copyable}
          onClick={() => copyToClipboard(address, undefined)}
        >
          <CopyIcon />
          {isCopied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canOperate}
          onClick={() => void rotateAddress()}
        >
          Rotate
        </Button>
      </div>
      {note !== null ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {trigger.event.kind === "merge-conflict" ? (
        <p className="text-xs text-muted-foreground">
          Set LOOM_BOTS_CONFLICT_HOOK to this address before running the fork integrate script.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FiringList({ firings }: { readonly firings: ReadonlyArray<BotTriggerFiring> }) {
  if (firings.length === 0)
    return <p className="text-sm text-muted-foreground">This trigger has not fired yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {firings.map((firing) => (
        <li key={firing.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs text-muted-foreground">{runTime(firing.firedAt)}</span>
          <span className="min-w-0 truncate">{firing.eventSummary}</span>
          <Badge variant={firing.outcome === "run" ? "success" : "secondary"}>
            {firing.outcome === "run" ? "Ran" : "Skipped"}
          </Badge>
          {firing.reason ? (
            <span className="text-xs text-muted-foreground">{firing.reason}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TriggerFirings({
  environmentId,
  trigger,
  changes,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly changes: BotTriggerChanges;
}) {
  const query = useEnvironmentQuery(
    bots.triggerFirings({ environmentId, input: { triggerId: trigger.id, limit: FIRINGS_PAGE } }),
  );
  if (query.error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {query.error}
      </p>
    );
  if (query.isPending && !query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading firings…
      </p>
    );
  const firings = applyFiringChanges(query.data?.firings ?? [], changes, trigger.id);
  return (
    <>
      <FiringList firings={firings} />
      {query.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">Showing the {FIRINGS_PAGE} most recent.</p>
      ) : null}
    </>
  );
}

/** A sample event as JSON, with every field the event offers. */
const sampleFields = (trigger: BotTrigger) =>
  JSON.stringify(
    trigger.event.kind === "webhook"
      ? Object.fromEntries(
          Object.values(trigger.mapping).flatMap((entry) =>
            "field" in entry ? [[entry.field, ""]] : [],
          ),
        )
      : Object.fromEntries(
          BOT_TRIGGER_EVENT_FIELDS[trigger.event.kind].map((field) => [field, ""]),
        ),
    null,
    2,
  );

const parseSample = (text: string): Record<string, string | number | boolean> | string => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return "Enter a JSON object of field values.";
    const entries = Object.entries(parsed);
    if (!entries.every(([, value]) => ["string", "number", "boolean"].includes(typeof value)))
      return "Field values are text, numbers or true and false.";
    return Object.fromEntries(entries) as Record<string, string | number | boolean>;
  } catch {
    return "Enter a JSON object of field values.";
  }
};

function TestFiring({
  environmentId,
  trigger,
  canOperate,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly canOperate: boolean;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(() => sampleFields(trigger));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<BotTriggerFiring | null>(null);
  const test = useAtomCommand(bots.testTrigger, { reportFailure: false });
  const fire = async () => {
    const fields = parseSample(text);
    if (typeof fields === "string") {
      setError(fields);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await test({ environmentId, input: { triggerId: trigger.id, fields } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setFiring(result.value);
    } catch (cause) {
      setError(errorText(cause, "Could not fire the trigger."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm">
        Fire once with these event fields, past the trigger&apos;s filters and limits. This starts a
        real run.
      </p>
      <Textarea
        rows={6}
        aria-label="Sample event fields"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !canOperate} onClick={() => void fire()}>
          {busy ? "Firing…" : "Fire"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {firing ? <FiringList firings={[firing]} /> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TriggerRow({
  environmentId,
  trigger,
  bot,
  showBot,
  changes,
  canOperate,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly bot: BotDefinition | undefined;
  readonly showBot: boolean;
  readonly changes: BotTriggerChanges;
  readonly canOperate: boolean;
  readonly onEdit: () => void;
}) {
  const projects = useProjects();
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? "a removed project";
  const [showFirings, setShowFirings] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setEnabled = useAtomCommand(bots.setTriggerEnabled, { reportFailure: false });
  const repin = useAtomCommand(bots.repinTrigger, { reportFailure: false });
  const remove = useAtomCommand(bots.deleteTrigger, { reportFailure: false });

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (enabled: boolean) =>
    act(async () => {
      const result = await setEnabled({ environmentId, input: { triggerId: trigger.id, enabled } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  const repinToCurrent = () =>
    act(async () => {
      const result = await repin({ environmentId, input: { triggerId: trigger.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  const deleteTrigger = () =>
    act(async () => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete ${trigger.name}? Its firing history is deleted with it.`,
      );
      if (!confirmed) return;
      const result = await remove({ environmentId, input: { triggerId: trigger.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });

  const outdated =
    bot !== undefined && !trigger.followLatest && bot.version !== trigger.pinnedVersion;
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{trigger.name}</span>
            {trigger.enabled ? null : <Badge variant="secondary">Off</Badge>}
            {showBot ? (
              <span className="text-xs text-muted-foreground">{bot?.name ?? "Deleted bot"}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {triggerSummary(trigger.event, projectTitle)}
          </p>
          <p className="text-xs text-muted-foreground">
            {trigger.lastFiredAt ? `Last ran ${runTime(trigger.lastFiredAt)}` : "Has not run yet"}
            {trigger.nextFireAt ? `, next ${runTime(trigger.nextFireAt)}` : ""}
            {`. At most ${trigger.dailyLimit} a day`}
            {trigger.cooldownMinutes > 0 ? `, ${trigger.cooldownMinutes} minutes apart.` : "."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            aria-label={trigger.enabled ? `Turn off ${trigger.name}` : `Turn on ${trigger.name}`}
            checked={trigger.enabled}
            disabled={busy || !canOperate}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
          <Button
            size="xs"
            variant="ghost"
            disabled={!canOperate || bot === undefined}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!canOperate}
            onClick={() => setTesting((current) => !current)}
          >
            Test
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowFirings((current) => !current)}
            aria-expanded={showFirings}
          >
            Firings
          </Button>
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy || !canOperate}
            onClick={() => void deleteTrigger()}
          >
            Delete
          </Button>
        </div>
      </div>
      {outdated ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>
            Runs version {trigger.pinnedVersion}; {bot.name} is now version {bot.version}.
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={busy || !canOperate}
            onClick={() => void repinToCurrent()}
          >
            Use version {bot.version}
          </Button>
        </div>
      ) : null}
      <WebhookAddress environmentId={environmentId} trigger={trigger} canOperate={canOperate} />
      {testing ? (
        <TestFiring
          environmentId={environmentId}
          trigger={trigger}
          canOperate={canOperate}
          onClose={() => setTesting(false)}
        />
      ) : null}
      {showFirings ? (
        <TriggerFirings environmentId={environmentId} trigger={trigger} changes={changes} />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The triggers of one bot, or of every bot when none is selected. */
export function BotTriggers({
  environmentId,
  allBots,
  selected,
  changes,
  connected,
  canOperate,
  onNew,
  onEdit,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly selected: BotDefinition | null;
  readonly changes: BotTriggerChanges;
  readonly connected: boolean;
  readonly canOperate: boolean;
  readonly onNew: (bot: BotDefinition) => void;
  readonly onEdit: (trigger: BotTrigger) => void;
}) {
  const query = useEnvironmentQuery(
    environmentId
      ? bots.listTriggers({
          environmentId,
          input: selected === null ? {} : { botId: selected.id },
        })
      : null,
  );
  // Changes missed while disconnected never arrive, so a reconnect refetches the list.
  const refresh = query.refresh;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
  const triggers = applyTriggerChanges(query.data?.triggers ?? [], changes, selected?.id);
  const botOf = (botId: string) => allBots.find((bot) => bot.id === botId);
  return (
    <section className="space-y-3" aria-label="Triggers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{selected ? "Triggers" : "All triggers"}</h3>
        <div className="flex gap-2">
          {selected ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canOperate || selected.archivedAt !== null}
              onClick={() => onNew(selected)}
            >
              New trigger
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            disabled={!connected || query.isPending}
            onClick={query.refresh}
          >
            Refresh
          </Button>
        </div>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : query.isPending && !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading triggers…
        </p>
      ) : triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {selected
            ? `Nothing starts ${selected.name} on its own yet. Add a trigger to run it when checks fail, a pull request opens, a webhook arrives or on a schedule.`
            : "No bot has a trigger yet. Choose a bot to add one."}
        </p>
      ) : environmentId ? (
        <ul className="grid gap-2">
          {triggers.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              environmentId={environmentId}
              trigger={trigger}
              bot={botOf(trigger.botId)}
              showBot={selected === null}
              changes={changes}
              canOperate={canOperate && connected}
              onEdit={() => onEdit(trigger)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
