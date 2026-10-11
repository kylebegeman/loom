import { useId, useRef, useState } from "react";
import type {
  AssemblyCheckReport,
  AssemblyOperation,
  AssemblyPairResult,
  AssemblyPart,
  AssemblyReadResult,
  ScadParameters,
  ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { AssemblyPartsSection } from "./AssemblyPartsSection";
import { AssemblyFitSection } from "./AssemblyFitSection";
import styles from "./AssemblyInspector.module.css";
import {
  AssemblyWorkspaceInspector,
  type AssemblyWorkspaceControl,
  type AssemblyInspectorTab,
} from "./AssemblyWorkspace";

export type AssemblyInspectorProps = {
  workspace?: AssemblyWorkspaceControl;
  size?: readonly [number, number, number];
  settings?: ModelPreviewSettings;
  environmentId?: EnvironmentId;
  snapshot: AssemblyReadResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  errors: Readonly<Record<string, string>>;
  onApply: (operations: readonly AssemblyOperation[]) => Promise<void>;
  onUndo: () => Promise<void>;
  canUndo: boolean;
  canCheck?: boolean;
  canAlign?: boolean;
  busy: boolean;
  readOnly: boolean;
  report: AssemblyCheckReport | null;
  checking: boolean;
  stale: boolean;
  onCheck: () => void;
  onCancelCheck: () => void;
  explode: number;
  onExplode: (value: number) => void;
  isolatedId: string | null;
  onIsolate: (id: string | null) => void;
  onFocusPair: (pair: AssemblyPairResult) => void;
  onPreview: (part: AssemblyPart | null) => void;
  loadParameters?: (part: AssemblyPart) => Promise<ScadParameters>;
  onOpenPart?: (part: AssemblyPart) => void;
  partStats?: Readonly<Record<string, { triangles: number | null; loading: boolean }>>;
};

export function AssemblyInspector(props: AssemblyInspectorProps) {
  const [localTab, setLocalTab] = useState<AssemblyInspectorTab>("parts");
  const tabs: readonly AssemblyInspectorTab[] = props.workspace
    ? ["parts", "fit", "markup", "views"]
    : ["parts", "fit"];
  const tab = props.workspace?.inspectorTab ?? localTab;
  const setTab = props.workspace?.setInspectorTab ?? setLocalTab;
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  const saving = useRef(false);
  const busy = pending || props.busy;
  const apply = async (operations: readonly AssemblyOperation[]) => {
    if (props.readOnly || busy || saving.current) return;
    saving.current = true;
    setPending(true);
    setMessage(null);
    try {
      await props.onApply(operations);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.onPreview(null);
      saving.current = false;
      setPending(false);
    }
  };
  const undo = async () => {
    setPending(true);
    setMessage(null);
    try {
      await props.onUndo();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <aside className={styles.inspector} aria-label="Assembly inspector">
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Assembly sections"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.indexOf(tab);
          const next =
            event.key === "Home"
              ? tabs[0]!
              : event.key === "End"
                ? tabs.at(-1)!
                : tabs[(index + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length]!;
          setTab(next);
          event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
        }}
      >
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${id}-${name}`}
            aria-controls={`${id}-${name}-panel`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            data-tab={name}
            className={styles.tab}
            onClick={() => setTab(name)}
          >
            {{ parts: "Parts", fit: "Fit", markup: "Markup", views: "Views" }[name]}
          </button>
        ))}
        <div className="flex-1" />
        <Button
          variant="ghost-muted"
          size="xs"
          disabled={!props.canUndo || props.readOnly || busy}
          onClick={() => void undo()}
        >
          Undo
        </Button>
      </div>
      <div className={styles.body}>
        {props.readOnly && (
          <p className="px-3 py-2 text-xs text-muted-foreground">This assembly is read-only.</p>
        )}
        {message && (
          <p role="alert" className="px-3 py-2 text-xs text-warning">
            {message}
          </p>
        )}
        <div
          role="tabpanel"
          id={`${id}-parts-panel`}
          aria-labelledby={`${id}-parts`}
          hidden={tab !== "parts"}
        >
          <AssemblyPartsSection {...props} busy={busy} onApply={apply} />
        </div>
        <div
          role="tabpanel"
          id={`${id}-fit-panel`}
          aria-labelledby={`${id}-fit`}
          hidden={tab !== "fit"}
        >
          <AssemblyFitSection {...props} busy={busy} onApply={apply} />
        </div>
        {props.workspace &&
          (["markup", "views"] as const).map((name) => (
            <div
              key={name}
              role="tabpanel"
              id={`${id}-${name}-panel`}
              aria-labelledby={`${id}-${name}`}
              hidden={tab !== name}
            >
              <AssemblyWorkspaceInspector
                workspace={props.workspace!}
                tab={name}
                active={tab === name}
              />
            </div>
          ))}
      </div>
      <div className={styles.footer}>
        {props.isolatedId && (
          <div className={styles.row}>
            <p className={styles.note}>
              Isolated:{" "}
              {props.snapshot.assembly.parts.find((part) => part.id === props.isolatedId)?.name}
            </p>
            <Button variant="outline" size="xs" onClick={() => props.onIsolate(null)}>
              Show all
            </Button>
          </div>
        )}
        <label className={styles.explode}>
          <span>Explode</span>
          <input
            aria-label="Explode assembly"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={props.explode}
            onChange={(event) => props.onExplode(Number(event.target.value))}
          />
          <output>{Math.round(props.explode * 100)}%</output>
        </label>
        {props.explode > 0 && (
          <p className={styles.note}>Collapse the exploded view to measure or annotate.</p>
        )}
      </div>
    </aside>
  );
}
