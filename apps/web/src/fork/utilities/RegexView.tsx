import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { createRegexRunner, REGEX_TIMEOUT_MS, type RegexRunner } from "./regexRunner";
import RegexWorker from "./regexWorker?worker";
import type { RegexMatch } from "./tools/regexMatch";

const MATCH_DEBOUNCE_MS = 150;
// Fast patterns finish well inside this, so the label only shows for real waits.
const PENDING_LABEL_DELAY_MS = 200;
const VISIBLE_MATCH_ROWS = 200;

interface RegexRequest {
  readonly pattern: string;
  readonly flags: string;
  readonly text: string;
}

type Shown =
  | {
      readonly kind: "matches";
      readonly matches: ReadonlyArray<RegexMatch>;
      readonly truncated: boolean;
    }
  | { readonly kind: "message"; readonly message: string };

const sameRequest = (a: RegexRequest | null, b: RegexRequest) =>
  a !== null && a.pattern === b.pattern && a.flags === b.flags && a.text === b.text;

/**
 * Matches in a worker so a catastrophic pattern cannot freeze the app. The last finished
 * outcome stays on screen, with the text it was matched against, until the next one lands.
 */
export function RegexView({ pattern, flags, text }: RegexRequest) {
  const runner = useRef<RegexRunner | null>(null);
  const [shown, setShown] = useState<{ request: RegexRequest; value: Shown } | null>(null);
  const [slow, setSlow] = useState<RegexRequest | null>(null);
  const [showAll, setShowAll] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the regex web worker runner on mount and disposes it on unmount
  useEffect(() => {
    const created = createRegexRunner(() => new RegexWorker(), REGEX_TIMEOUT_MS);
    runner.current = created;
    return () => {
      created.dispose();
      if (runner.current === created) runner.current = null;
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces pattern runs through the regex web worker and cancels stale ones
  useEffect(() => {
    if (pattern === "") return;
    const request = { pattern, flags, text };
    let current = true;
    const pending = setTimeout(() => setSlow(request), PENDING_LABEL_DELAY_MS);
    const debounce = setTimeout(() => {
      const active = runner.current;
      if (!active) return;
      void active.run(request).then((outcome) => {
        if (!current || outcome.kind === "cancelled") return;
        clearTimeout(pending);
        const value: Shown =
          outcome.kind === "timeout"
            ? {
                kind: "message",
                message:
                  "Matching stopped after 1 second. The pattern may backtrack catastrophically on this text.",
              }
            : outcome.kind === "error"
              ? { kind: "message", message: outcome.message }
              : outcome.result.kind === "error"
                ? { kind: "message", message: outcome.result.message }
                : {
                    kind: "matches",
                    matches: outcome.result.matches,
                    truncated: outcome.result.truncated,
                  };
        setShown({ request, value });
      });
    }, MATCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(pending);
      clearTimeout(debounce);
    };
  }, [pattern, flags, text]);

  if (pattern === "") return null;
  const request = { pattern, flags, text };
  const isCurrent = shown !== null && sameRequest(shown.request, request);
  const pendingLabel = !isCurrent && sameRequest(slow, request);

  return (
    <section className="flex flex-col gap-2" aria-label="Matches" aria-busy={pendingLabel}>
      {pendingLabel ? <p className="text-muted-foreground text-xs">Matching...</p> : null}
      {shown?.value.kind === "message" ? (
        <p role="alert" className="text-destructive text-sm">
          {shown.value.message}
        </p>
      ) : null}
      {shown?.value.kind === "matches" ? (
        <MatchList
          text={shown.request.text}
          matches={shown.value.matches}
          truncated={shown.value.truncated}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
        />
      ) : null}
    </section>
  );
}

function matchCountLabel(count: number, truncated: boolean) {
  if (truncated) return `Showing the first ${count.toLocaleString()} matches`;
  if (count === 0) return "No matches";
  return count === 1 ? "1 match" : `${count.toLocaleString()} matches`;
}

function MatchList({
  text,
  matches,
  truncated,
  showAll,
  onShowAll,
}: {
  readonly text: string;
  readonly matches: ReadonlyArray<RegexMatch>;
  readonly truncated: boolean;
  readonly showAll: boolean;
  readonly onShowAll: () => void;
}) {
  const rows = showAll ? matches : matches.slice(0, VISIBLE_MATCH_ROWS);
  const groupCount = matches.reduce((most, match) => Math.max(most, match.groups.length), 0);
  return (
    <>
      <p className="text-sm">{matchCountLabel(matches.length, truncated)}</p>
      {matches.length > 0 ? (
        <>
          <HighlightedText text={text} matches={matches} />
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-start font-normal">#</th>
                  <th className="px-2 py-1 text-start font-normal">Index</th>
                  <th className="px-2 py-1 text-start font-normal">Match</th>
                  {groupCount > 0 ? (
                    <th className="px-2 py-1 text-start font-normal">Groups</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((match, row) => (
                  // Each match starts after the previous one ends, so the index is unique.
                  <tr key={match.index} className="border-t">
                    <td className="px-2 py-1 align-top text-muted-foreground">{row + 1}</td>
                    <td className="px-2 py-1 align-top">{match.index}</td>
                    <td className="px-2 py-1 align-top whitespace-pre-wrap wrap-anywhere">
                      {match.value}
                    </td>
                    {groupCount > 0 ? (
                      <td className="px-2 py-1 align-top whitespace-pre-wrap wrap-anywhere">
                        <MatchGroups match={match} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length < matches.length ? (
            <Button size="xs" variant="outline" className="self-start" onClick={onShowAll}>
              Show all {matches.length.toLocaleString()}
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function MatchGroups({ match }: { readonly match: RegexMatch }) {
  const groups = [
    ...match.groups.map((value, index) => ({ label: String(index + 1), value })),
    ...Object.entries(match.named).map(([label, value]) => ({ label, value })),
  ];
  return (
    <span className="flex flex-col">
      {groups.map((group) => (
        <span key={group.label}>
          <span className="text-muted-foreground">{group.label}: </span>
          {group.value === undefined ? (
            <span className="text-muted-foreground">unmatched</span>
          ) : (
            group.value
          )}
        </span>
      ))}
    </span>
  );
}

/** The test text with each non-empty match marked. Matches arrive in order and never overlap. */
function HighlightedText({
  text,
  matches,
}: {
  readonly text: string;
  readonly matches: ReadonlyArray<RegexMatch>;
}) {
  const parts: Array<{ readonly start: number; readonly value: string; readonly hit: boolean }> =
    [];
  let at = 0;
  for (const match of matches) {
    if (match.end === match.index || match.index < at) continue;
    if (match.index > at) parts.push({ start: at, value: text.slice(at, match.index), hit: false });
    parts.push({ start: match.index, value: match.value, hit: true });
    at = match.end;
  }
  if (at < text.length) parts.push({ start: at, value: text.slice(at), hit: false });
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-muted/50 p-2 font-mono text-sm">
      {parts.map((part) =>
        part.hit ? (
          <mark key={part.start} className="rounded-xs bg-primary/20 text-foreground">
            {part.value}
          </mark>
        ) : (
          <span key={part.start}>{part.value}</span>
        ),
      )}
    </pre>
  );
}
