import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbChangeRequest,
  PcbChangeRequestOperation,
  PcbComparison,
  PcbWorkspace,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ComparisonImages } from "./RevisionCompare";
import { changesNearAnchor, describeAnchor, requestStatus } from "./requests";
import { pcb } from "./state";
import { runModelCommand } from "../model-preview-3d/state";
import { Bar, EmptyState, Group, Scroll, Section, Segmented } from "./InspectorKit";
import k from "./inspector.module.css";
export function RequestForm({
  anchor,
  initialText = "",
  canSave,
  onSave,
  onCancel,
}: {
  anchor: string;
  initialText?: string | undefined;
  canSave: boolean;
  onSave: (title: string, text: string, add: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState(initialText),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const save = async (add: boolean) => {
    if (busy || !canSave || !title.trim() || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(title.trim(), text.trim(), add);
      onCancel();
    } catch (c) {
      setError(c instanceof Error ? c.message : "The request could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Request a change">
      <p>{anchor}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save(true);
          } else if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <label>
          Title
          <Input
            aria-label="Request title"
            autoFocus
            maxLength={120}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Change requested
          <Textarea
            aria-label="Change requested"
            maxLength={4000}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {!canSave && <p>Saving requests needs permission on this environment.</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={!canSave || busy || !title.trim() || !text.trim()}
          >
            Add to draft
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canSave || busy || !title.trim() || !text.trim()}
            onClick={() => void save(false)}
          >
            Save without adding
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
export function RequestsTab({
  data,
  ready,
  sourceHash,
  canSave,
  executionAllowed,
  threadRef,
  designId,
  onOperation,
  onDraft,
  onFocus,
  onCapture,
  form,
}: {
  data: PcbWorkspace;
  ready: boolean;
  sourceHash: string | null;
  canSave: boolean;
  executionAllowed: boolean;
  threadRef: ScopedThreadRef;
  designId: string;
  onOperation: (op: PcbChangeRequestOperation) => Promise<unknown>;
  onDraft: (ids: readonly string[]) => Promise<void>;
  onFocus: (r: PcbChangeRequest) => void;
  onCapture: (r: PcbChangeRequest) => Promise<Blob>;
  form?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (c) {
      setError(c instanceof Error ? c.message : "The request could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  const request = data.requests.find((r) => r.id === detail);
  return (
    <Scroll>
      {form}
      {error && (
        <p role="alert" className={k.error}>
          {error}
        </p>
      )}
      {!canSave && <p>Saving requests needs permission on this environment.</p>}
      {!ready ? (
        <p role="status">Reading change requests</p>
      ) : request ? (
        <RequestDetail
          key={`${request.id}:${request.status}:${request.resolvedRef ?? ""}`}
          request={request}
          sourceHash={sourceHash}
          executionAllowed={executionAllowed}
          canSave={canSave && !busy}
          threadRef={threadRef}
          designId={designId}
          onBack={() => setDetail(null)}
          onOperation={(op) => run(() => onOperation(op))}
          onDraft={() => run(() => onDraft([request.id]))}
          onFocus={() => onFocus(request)}
          onCapture={() => onCapture(request)}
        />
      ) : (
        <>
          {!!selected.length && (
            <Bar>
              <Button
                size="sm"
                disabled={!canSave || busy}
                onClick={() =>
                  void run(() =>
                    onDraft(selected.filter((id) => data.requests.some((r) => r.id === id))),
                  )
                }
              >
                Add {selected.length} to draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </Bar>
          )}
          {!data.requests.length && !form && (
            <EmptyState icon={null} title="No change requests">
              Select a part, a net or an area and press R to ask for a change. The request goes to
              the composer with a marked capture of the drawing.
            </EmptyState>
          )}
          {(["review", "open", "accepted"] as const).map((status) => {
            const group = data.requests.filter((r) => r.status === status);
            return group.length ? (
              <Group
                key={status}
                title={
                  status === "review"
                    ? "Ready for review"
                    : status === "accepted"
                      ? "Accepted"
                      : "Open"
                }
                meta={group.length}
              >
                {group.map((r) => (
                  <div key={r.id} className={k.itemRow}>
                    <input
                      type="checkbox"
                      aria-label={`Select request ${r.title}`}
                      checked={selected.includes(r.id)}
                      disabled={
                        busy || !canSave || (!selected.includes(r.id) && selected.length >= 10)
                      }
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <button
                      type="button"
                      className={k.item}
                      onClick={() => {
                        setDetail(r.id);
                        onFocus(r);
                      }}
                    >
                      <span className={k.itemText}>
                        <strong>{r.title}</strong>
                        <small>
                          {describeAnchor(r.anchor)} · {requestStatus(r, sourceHash)}
                        </small>
                      </span>
                    </button>
                  </div>
                ))}
              </Group>
            ) : null;
          })}
        </>
      )}
    </Scroll>
  );
}
function RequestDetail({
  request: r,
  sourceHash,
  canSave,
  executionAllowed,
  threadRef,
  designId,
  onBack,
  onOperation,
  onDraft,
  onFocus,
  onCapture,
}: {
  request: PcbChangeRequest;
  sourceHash: string | null;
  canSave: boolean;
  executionAllowed: boolean;
  threadRef: ScopedThreadRef;
  designId: string;
  onBack: () => void;
  onOperation: (op: PcbChangeRequestOperation) => Promise<unknown>;
  onDraft: () => Promise<unknown>;
  onFocus: () => void;
  onCapture: () => Promise<Blob>;
}) {
  const canCompare = useAtomValue(pcb.compare.permissionAtom(threadRef.environmentId));
  const [comparison, setComparison] = useState<PcbComparison | null>(null),
    [mode, setMode] = useState<"overlay" | "before" | "after" | "difference">("overlay"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [nowImage, setNowImage] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(r.title),
    [text, setText] = useState(r.request);
  const compare = async () => {
    setBusy(true);
    setError(null);
    try {
      if (r.baseRef) {
        setComparison(
          await runModelCommand(pcb.compare, {
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              designId,
              from: r.baseRef,
              to: r.status === "accepted" ? (r.resolvedRef ?? "") : "",
            },
          }),
        );
      } else {
        const { thumbnail } = await import("../model-preview-3d/viewer/captureSheet");
        setNowImage(await thumbnail(await onCapture(), 24000));
      }
    } catch (c) {
      setError(c instanceof Error ? c.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  };
  const near = comparison ? changesNearAnchor(comparison, r.anchor, r.view, r.sheet) : null;
  return (
    <>
      <Button size="xs" variant="ghost" onClick={onBack}>
        All requests
      </Button>
      <Section title={r.title}>
        <p>
          {requestStatus(r, sourceHash)} · {describeAnchor(r.anchor)}
        </p>
        <p className="whitespace-pre-wrap">{r.request}</p>
        {r.response && <p>Response: {r.response}</p>}
        <Button size="xs" variant="ghost" onClick={onFocus}>
          Show on drawing
        </Button>
        <Button size="xs" variant="ghost" disabled={!canSave} onClick={() => setEditing(!editing)}>
          {editing ? "Cancel edit" : "Edit request"}
        </Button>
        {editing && (
          <div>
            <Input
              aria-label="Edit request title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              aria-label="Edit request text"
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!canSave || !title.trim() || !text.trim()}
              onClick={() =>
                void onOperation({
                  op: "edit",
                  id: r.id,
                  title: title.trim(),
                  request: text.trim(),
                }).then(() => setEditing(false))
              }
            >
              Save request
            </Button>
          </div>
        )}
      </Section>
      <Section title="Compare with when requested">
        {!r.baseRef && r.referenceImage && (
          <figure>
            <img src={r.referenceImage} alt="When requested" />
            <figcaption>When requested</figcaption>
          </figure>
        )}
        {!r.baseRef && nowImage && (
          <figure>
            <img src={nowImage} alt="Current design" />
            <figcaption>Now</figcaption>
          </figure>
        )}
        {!executionAllowed && r.baseRef && (
          <p>Allow circuit code from the drawing to compare revisions.</p>
        )}
        {r.status === "accepted" && r.baseRef && !r.resolvedRef && (
          <p>The accepted revision could not be captured. A frozen comparison is unavailable.</p>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy ||
            (!!r.baseRef &&
              (!executionAllowed || !canCompare || (r.status === "accepted" && !r.resolvedRef)))
          }
          onClick={() => void compare()}
        >
          {busy ? "Comparing…" : r.baseRef ? "Compare" : "Capture now"}
        </Button>
        {error && <p role="alert">{error}</p>}
        {comparison && (
          <>
            {comparison.beforeSvg && comparison.afterSvg && (
              <>
                <Segmented
                  label="Comparison mode"
                  value={mode}
                  options={(["overlay", "before", "after", "difference"] as const).map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={setMode}
                />
                <ComparisonImages
                  before={comparison.beforeSvg}
                  after={comparison.afterSvg}
                  mode={mode}
                  opacity={0.5}
                />
              </>
            )}
            <Group title="Near this request">
              {near?.near.map((c) => (
                <p key={c.reference}>
                  {c.reference}: {c.detail}
                </p>
              ))}
              {!near?.near.length && <p>No structural changes near this request.</p>}
            </Group>
            <Group title="Elsewhere">
              {near?.elsewhere.map((c) => (
                <p key={c.reference}>
                  {c.reference}: {c.detail}
                </p>
              ))}
            </Group>
            {comparison.log && <pre>{comparison.log}</pre>}
          </>
        )}
      </Section>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!canSave} onClick={() => void onDraft()}>
          Add to draft
        </Button>
        {r.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave}
            onClick={() => void onOperation({ op: "status", id: r.id, status: "review" })}
          >
            Ready for review
          </Button>
        )}
        {r.status !== "accepted" && (
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => void onOperation({ op: "status", id: r.id, status: "accepted" })}
          >
            Accept
          </Button>
        )}
        {r.status !== "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave}
            onClick={() => void onOperation({ op: "status", id: r.id, status: "open" })}
          >
            {r.status === "accepted" ? "Reopen" : "Not yet"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!canSave}
          onClick={() => void onOperation({ op: "remove", id: r.id }).then(onBack)}
        >
          Delete
        </Button>
      </div>
    </>
  );
}
