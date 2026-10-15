import styles from "./workspace.module.css";
import { useState } from "react";
import type { ScadParameter } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { SectionHead } from "./controls";
import { OperationStatus } from "./OperationStatus";
import { linkNudges, type LinkJob, type Linking } from "./useParameterLinks";
import { MAX_LINKED_PARAMETERS } from "./viewer/linking";

const faces = (count: number) => `${count} face${count === 1 ? "" : "s"}`;

/**
 * Customize tab section: analyzes which faces each number parameter moves, by rendering it one
 * step either side, and highlights a parameter's faces. The point menu then lists the parameters
 * that move the face under it.
 */
export function LinkedFaces({
  parameters,
  values,
  linking,
  job,
  error,
  ready,
  focus,
  onFocus,
  onAnalyze,
  onCancel,
}: {
  /** The parameters a step can move, in source order. */
  parameters: readonly ScadParameter[];
  /** The values of the part on screen, which the analysis renders around. */
  values: Readonly<Record<string, string>>;
  /** The finished analysis for these values, if any. */
  linking: Linking | null;
  job: LinkJob | null;
  error: string | null;
  /** The part on screen matches the values, so an analysis can start. */
  ready: boolean;
  focus: string | null;
  onFocus: (name: string | null) => void;
  onAnalyze: (names: readonly string[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<readonly string[] | null>(null);
  if (!parameters.length) return null;
  const names = parameters.map((parameter) => parameter.name),
    selected = (chosen ?? names)
      .filter((name) => names.includes(name))
      .slice(0, MAX_LINKED_PARAMETERS),
    renders =
      1 +
      parameters
        .filter((parameter) => selected.includes(parameter.name))
        .reduce((sum, parameter) => sum + linkNudges(parameter, values).length, 0);
  return (
    <section className={styles["model-links"]}>
      <SectionHead title="Linked faces" />
      <div className={styles["model-links-body"]}>
        {names.length > MAX_LINKED_PARAMETERS && (
          <div
            className={styles["model-link-choice"]}
            role="group"
            aria-label={`Parameters to analyze, up to ${MAX_LINKED_PARAMETERS}`}
          >
            {names.map((name) => {
              const on = selected.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={styles["model-link-chip"]}
                  aria-pressed={on}
                  disabled={!on && selected.length >= MAX_LINKED_PARAMETERS}
                  onClick={() =>
                    setChosen(on ? selected.filter((item) => item !== name) : [...selected, name])
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
        <div className={styles["model-links-actions"]}>
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || !selected.length || job !== null}
            onClick={() => onAnalyze(selected)}
          >
            {linking ? "Analyze again" : "Analyze parameters"}
          </Button>
          {job && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel analysis
            </Button>
          )}
        </div>
        {job && (
          <OperationStatus
            label="Analyzing parameters"
            detail={`Rendering ${job.done} of ${job.total}`}
            completed={job.done}
            total={job.total}
          />
        )}
        {error && (
          <p role="alert" className={styles["model-link-error"]}>
            {error}
          </p>
        )}
        {linking ? (
          <ul className={styles["model-link-list"]} aria-label="Linked faces">
            {linking.parameters.map((result) => {
              const moved = result.status === "linked" ? result.rates.size : 0;
              return (
                <li key={result.name}>
                  <button
                    type="button"
                    className={styles["model-link-row"]}
                    aria-pressed={focus === result.name}
                    aria-label={`Show faces ${result.name} moves`}
                    disabled={!moved}
                    onClick={() => onFocus(focus === result.name ? null : result.name)}
                  >
                    <span className="font-mono">{result.name}</span>
                    <small>
                      {result.status === "changes-shape"
                        ? "Changes shape"
                        : result.status === "failed"
                          ? result.error
                          : moved
                            ? `Moves ${faces(moved)}`
                            : "Moves no face"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          !job && (
            <p className={styles["model-link-note"]}>
              {ready
                ? `Renders each parameter one step up and down (${renders} renders) to find the faces it moves. Then right-click a face to see what moves it.`
                : "Analysis starts from the part on screen. Wait for the preview to finish rendering."}
            </p>
          )
        )}
      </div>
    </section>
  );
}
