import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import {
  ActivityIcon,
  AudioWaveformIcon,
  DownloadIcon,
  GaugeIcon,
  PlayIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import type {
  PcbSimulationResult,
  PcbSimulationSetup,
  PcbWorkspace,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { OperationStatus } from "./OperationStatus";
import {
  Chip,
  EmptyState,
  errorText,
  Field,
  Footer,
  Log,
  Notice,
  Scroll,
  Section,
  Segmented,
} from "./InspectorKit";
import { formatEng, parseEng } from "./units";
import { Plot, type PlotTrace } from "./Plot";
import k from "./inspector.module.css";

const idleSimulation = Atom.make(AsyncResult.initial<PcbSimulationResult, never>());
export const defaultSimulation = (): PcbSimulationSetup => ({
  id: randomUUID(),
  name: "Circuit response",
  analysis: "tran",
  probes: [],
  step: 0.00001,
  stop: 0.01,
  startFrequency: 10,
  stopFrequency: 100000,
  points: 200,
  netlistPath: "",
  sweep: null,
});
type Analysis = PcbSimulationSetup["analysis"];
const ANALYSES = [
  { id: "op", label: "Operating point", detail: "DC voltages and currents", icon: GaugeIcon },
  { id: "tran", label: "Transient", detail: "Signals over time", icon: ActivityIcon },
  { id: "ac", label: "AC sweep", detail: "Frequency response", icon: AudioWaveformIcon },
] as const;
const MAX_PROBES = 24,
  MAX_SWEEP = 12;
/** Theme hues first so traces follow light and dark mode, then fixed hues for larger plots. */
const PALETTE = [
  "var(--primary)",
  "var(--warning)",
  "var(--success)",
  "var(--destructive)",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

export function SimulationEditor({
  threadRef,
  designId,
  data,
  canSave,
  onSave,
  onRemove,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  data: PcbWorkspace;
  canSave: boolean;
  onSave: (setup: PcbSimulationSetup) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const [setup, setSetup] = useState(defaultSimulation),
    [result, setResult] = useState<{ value: PcbSimulationResult; analysis: Analysis } | null>(null),
    [job, setJob] = useState<{ setup: PcbSimulationSetup; revision: string } | null>(null),
    [error, setError] = useState<string | null>(null),
    [sweepValues, setSweepValues] = useState(""),
    [saving, setSaving] = useState(false);
  const canRun = useAtomValue(pcb.simulate.permissionAtom(threadRef.environmentId));
  if (job && !canRun) setJob(null);
  const response = useAtomValue(
    job && canRun
      ? pcb.simulate.resultAtom({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, designId, ...job },
        })
      : idleSimulation,
  );
  const busy = job !== null && (response.waiting || response._tag === "Initial");
  const completed = asyncValue(response);
  if (job && !response.waiting && response._tag !== "Initial") {
    if (completed) setResult({ value: completed, analysis: job.setup.analysis });
    setError(asyncError(response));
    setJob(null);
  }
  const update = (change: Partial<PcbSimulationSetup>) => setSetup((s) => ({ ...s, ...change }));
  /** Validates the sweep text, which stays free text until the setup is used. */
  const currentSetup = (): PcbSimulationSetup => {
    const parameter = setup.sweep?.parameter.trim() ?? "";
    if (!parameter) return { ...setup, sweep: null };
    const values = sweepValues.split(",").map((v) => parseEng(v));
    if (!sweepValues.trim() || values.some((v) => v === null))
      throw new Error("Enter comma-separated sweep values, such as 1k, 10k, 100k.");
    if (values.length > MAX_SWEEP) throw new Error(`A sweep can have up to ${MAX_SWEEP} values.`);
    return { ...setup, sweep: { parameter, values: values as number[] } };
  };
  const load = (saved: PcbSimulationSetup) => {
    setSetup(saved);
    setSweepValues(
      saved.sweep?.values.map((v) => formatEng(v, "", 4).replace(" ", "")).join(", ") ?? "",
    );
    setError(null);
  };
  const run = () => {
    if (busy || !canRun) return;
    setError(null);
    try {
      const current = currentSetup();
      setSetup(current);
      setJob({ setup: current, revision: randomUUID() });
    } catch (e) {
      setError(errorText(e, "Simulation failed."));
    }
  };
  const save = () => {
    try {
      const current = currentSetup();
      setSaving(true);
      void onSave(current)
        .then(() => setError(null))
        .catch((e) => setError(errorText(e, "The setup could not be saved.")))
        .finally(() => setSaving(false));
    } catch (e) {
      setError(errorText(e, "Invalid setup."));
    }
  };
  const savedIds = new Set(data.simulations.map((s) => s.id));
  return (
    <>
      <Scroll>
        {data.simulations.length > 0 && (
          <Section title="Saved setups" count={data.simulations.length}>
            <div className={k.chips}>
              {data.simulations.map((saved) => (
                <Chip
                  key={saved.id}
                  pressed={saved.id === setup.id}
                  onClick={() => load(saved)}
                  onRemove={() =>
                    void onRemove(saved.id).catch((e) =>
                      setError(errorText(e, "The setup could not be removed.")),
                    )
                  }
                  removeLabel={`Remove setup ${saved.name}`}
                  disabled={busy || !canSave}
                >
                  {saved.name}
                </Chip>
              ))}
            </div>
          </Section>
        )}
        <Section title="Analysis">
          <div className={k.optionCards} role="radiogroup" aria-label="Analysis">
            {ANALYSES.map(({ id, label, detail, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={setup.analysis === id}
                className={k.optionCard}
                onClick={() => update({ analysis: id })}
              >
                <Icon aria-hidden="true" />
                <strong>{label}</strong>
                <small>{detail}</small>
              </button>
            ))}
          </div>
          {setup.analysis === "tran" && (
            <div className={k.fieldRow}>
              <Field label="Time step">
                <EngInput
                  label="Time step"
                  unit="s"
                  value={setup.step}
                  onChange={(step) => update({ step })}
                />
              </Field>
              <Field label="Stop time">
                <EngInput
                  label="Stop time"
                  unit="s"
                  value={setup.stop}
                  onChange={(stop) => update({ stop })}
                />
              </Field>
            </div>
          )}
          {setup.analysis === "ac" && (
            <>
              <div className={k.fieldRow}>
                <Field label="Start">
                  <EngInput
                    label="Start frequency"
                    unit="Hz"
                    value={setup.startFrequency}
                    onChange={(startFrequency) => update({ startFrequency })}
                  />
                </Field>
                <Field label="Stop">
                  <EngInput
                    label="Stop frequency"
                    unit="Hz"
                    value={setup.stopFrequency}
                    onChange={(stopFrequency) => update({ stopFrequency })}
                  />
                </Field>
              </div>
              <Field label="Samples" hint="Points across the sweep, from 2 to 10,000.">
                <Input
                  size="sm"
                  font="mono"
                  type="number"
                  aria-label="Samples"
                  min={2}
                  max={10000}
                  value={setup.points}
                  onChange={(e) => update({ points: Math.round(Number(e.target.value)) })}
                />
              </Field>
            </>
          )}
          {setup.analysis === "op" && (
            <p className={k.hint}>Solves the DC bias point. Capacitors open, inductors short.</p>
          )}
        </Section>
        <Section title="Probes" count={setup.probes.length || "All signals"}>
          <ProbeInput probes={setup.probes} onChange={(probes) => update({ probes })} />
        </Section>
        <details className={k.disclosure}>
          <summary>Netlist and sweep</summary>
          <div className={k.disclosureBody}>
            <Field
              label="SPICE netlist"
              hint="Workspace-relative. Leave empty to use the design's exported models."
            >
              <Input
                size="sm"
                font="mono"
                aria-label="SPICE netlist path"
                placeholder="circuit.cir"
                value={setup.netlistPath}
                onChange={(e) => update({ netlistPath: e.target.value })}
              />
            </Field>
            <div className={k.fieldRow}>
              <Field label="Sweep parameter">
                <Input
                  size="sm"
                  font="mono"
                  aria-label="Sweep parameter"
                  placeholder="Rload"
                  value={setup.sweep?.parameter ?? ""}
                  onChange={(e) =>
                    update({
                      sweep: { parameter: e.target.value, values: setup.sweep?.values ?? [] },
                    })
                  }
                />
              </Field>
              <Field label="Values">
                <Input
                  size="sm"
                  font="mono"
                  aria-label="Sweep values"
                  placeholder="1k, 10k, 100k"
                  value={sweepValues}
                  onChange={(e) => setSweepValues(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </details>
        {!canRun && (
          <Notice tone="warning">Simulation needs terminal permission on this environment.</Notice>
        )}
        {busy && (
          <OperationStatus
            label="Simulating circuit"
            detail="Solving the electrical response and collecting probe values."
            onCancel={() => {
              setJob(null);
              setError(null);
            }}
          />
        )}
        {error && (
          <p role="alert" className={k.error}>
            {error}
          </p>
        )}
        {result ? (
          <SimulationResult result={result.value} analysis={result.analysis} />
        ) : (
          !busy && (
            <EmptyState icon={<ActivityIcon />} title="Ready to simulate">
              Runs ngspice on this environment. Parts need SPICE models and the circuit needs a
              ground reference.
            </EmptyState>
          )
        )}
      </Scroll>
      <Footer>
        <Input
          size="sm"
          aria-label="Setup name"
          placeholder="Setup name"
          value={setup.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || saving || !canSave || !setup.name.trim()}
          onClick={save}
        >
          <SaveIcon />
          {savedIds.has(setup.id) ? "Update" : "Save"}
        </Button>
        <Button size="sm" disabled={busy || !canRun} onClick={run}>
          <PlayIcon />
          Run
        </Button>
      </Footer>
    </>
  );
}

/** Text entry in engineering notation; the value commits only while it parses. */
function EngInput({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const parsed = text === null ? value : parseEng(text);
  return (
    <Input
      size="sm"
      font="mono"
      aria-label={label}
      aria-invalid={parsed === null || parsed <= 0 || undefined}
      value={text ?? formatEng(value, unit, 4)}
      onFocus={() => setText(formatEng(value, unit, 4))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        const next = parseEng(e.target.value);
        if (next !== null && next > 0) onChange(next);
      }}
    />
  );
}

function ProbeInput({
  probes,
  onChange,
}: {
  probes: readonly string[];
  onChange: (probes: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = raw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !probes.includes(p));
    if (next.length) onChange([...probes, ...next].slice(0, MAX_PROBES));
    setText("");
  };
  return (
    <div className={k.tokenField}>
      {probes.map((probe) => (
        <span key={probe} className={k.token}>
          <span className={k.mono}>{probe}</span>
          <button
            type="button"
            aria-label={`Remove probe ${probe}`}
            onClick={() => onChange(probes.filter((p) => p !== probe))}
          >
            <XIcon />
          </button>
        </span>
      ))}
      <input
        aria-label="Add probe"
        placeholder={probes.length ? "Add another" : "v(out), i(v1)… or leave empty for all"}
        value={text}
        disabled={probes.length >= MAX_PROBES}
        onChange={(e) =>
          e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value)
        }
        onBlur={() => text.trim() && add(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && probes.length) onChange(probes.slice(0, -1));
        }}
      />
    </div>
  );
}

function SimulationResult({
  result,
  analysis,
}: {
  result: PcbSimulationResult;
  analysis: Analysis;
}) {
  const [runIndex, setRunIndex] = useState(0),
    [response, setResponse] = useState<"magnitude" | "db" | "phase">("magnitude"),
    [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const run = result.runs[Math.min(runIndex, result.runs.length - 1)];
  const exportCsv = () => {
    const rows = result.runs.flatMap((run) => [
      JSON.stringify(run.label),
      [
        analysis === "ac" ? "frequency (Hz)" : analysis === "tran" ? "time (s)" : "sample",
        ...run.series.flatMap((s) =>
          s.imaginary
            ? [
                `${s.name} real`,
                `${s.name} imaginary`,
                `${s.name} magnitude`,
                `${s.name} phase (deg)`,
              ]
            : [s.name],
        ),
      ]
        .map((s) => JSON.stringify(s))
        .join(","),
      ...run.x.map((x, i) =>
        [
          x,
          ...run.series.flatMap((s) =>
            s.imaginary
              ? [
                  s.values[i],
                  s.imaginary[i],
                  Math.hypot(s.values[i] ?? 0, s.imaginary[i] ?? 0),
                  (Math.atan2(s.imaginary[i] ?? 0, s.values[i] ?? 0) * 180) / Math.PI,
                ]
              : [s.values[i]],
          ),
        ].join(","),
      ),
    ]);
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulation.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const ok = result.outcome === "ok";
  const colors = new Map(run?.series.map((s, i) => [s.name, PALETTE[i % PALETTE.length]!]) ?? []);
  const plotted = (s: NonNullable<typeof run>["series"][number]): PlotTrace => ({
    name: s.name,
    color: colors.get(s.name)!,
    values: s.values.map((v, i) => {
      if (!s.imaginary || analysis !== "ac") return v;
      const im = s.imaginary[i] ?? 0;
      if (response === "phase") return (Math.atan2(im, v) * 180) / Math.PI;
      const magnitude = Math.hypot(v, im);
      return response === "db" ? 20 * Math.log10(Math.max(magnitude, 1e-30)) : magnitude;
    }),
  });
  const unitOf = (unit: string) =>
    analysis === "ac" && response === "phase"
      ? "°"
      : analysis === "ac" && response === "db"
        ? "dB"
        : unit;
  const units = [...new Set(run?.series.map((s) => unitOf(s.unit)) ?? [])];
  return (
    <Section
      title="Result"
      count={new Date(result.ranAt).toLocaleTimeString()}
      action={
        <Button size="xs" variant="ghost" onClick={exportCsv} disabled={!result.runs.length}>
          <DownloadIcon />
          CSV
        </Button>
      }
    >
      <div className={k.resultHead}>
        <Badge variant={ok ? "success" : "error"}>
          {ok ? "Solved" : result.outcome === "timed-out" ? "Timed out" : "Failed"}
        </Badge>
        <span>
          {result.runs.length} run{result.runs.length === 1 ? "" : "s"}
        </span>
        <span className={k.mono}>netlist {result.netlistHash.slice(0, 8)}</span>
      </div>
      {result.runs.length > 1 && (
        <div className={k.chips} role="group" aria-label="Sweep run">
          {result.runs.map((r, i) => (
            <Chip key={r.label} pressed={i === runIndex} onClick={() => setRunIndex(i)}>
              {r.label}
            </Chip>
          ))}
        </div>
      )}
      {run &&
        (analysis === "op" ? (
          <div className={k.readings}>
            {run.series.map((s) => (
              <div key={s.name} className={k.reading}>
                <span className={k.mono}>{s.name}</span>
                <strong className={k.mono}>
                  {formatEng(s.values[0] ?? Number.NaN, s.unit, 4)}
                </strong>
              </div>
            ))}
          </div>
        ) : run.series.length ? (
          <>
            {analysis === "ac" && run.series.some((s) => s.imaginary) && (
              <Segmented
                label="Response"
                value={response}
                onChange={setResponse}
                options={[
                  { value: "magnitude", label: "Magnitude" },
                  { value: "db", label: "dB" },
                  { value: "phase", label: "Phase" },
                ]}
              />
            )}
            <div className={k.legend}>
              {run.series.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className={k.legendItem}
                  aria-pressed={!hidden.has(s.name)}
                  onClick={() => {
                    const next = new Set(hidden);
                    if (!next.delete(s.name)) next.add(s.name);
                    setHidden(next);
                  }}
                >
                  <span style={{ background: colors.get(s.name) }} aria-hidden="true" />
                  {s.name}
                </button>
              ))}
            </div>
            {units.map((unit) => (
              <Plot
                key={unit}
                x={run.x}
                xUnit={analysis === "ac" ? "Hz" : "s"}
                yUnit={unit}
                log={analysis === "ac"}
                traces={run.series
                  .filter((s) => unitOf(s.unit) === unit && !hidden.has(s.name))
                  .map(plotted)}
              />
            ))}
          </>
        ) : (
          <EmptyState icon={<ActivityIcon />} title="No matching probes">
            Clear the probe list or enter a signal name that ngspice reports, such as v(out).
          </EmptyState>
        ))}
      {result.log && <Log title="Simulation log" text={result.log} open={!ok} />}
    </Section>
  );
}
