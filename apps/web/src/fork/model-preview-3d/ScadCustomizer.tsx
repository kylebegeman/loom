import styles from "./workspace.module.css";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ScadParameters, ScadRenderResult } from "@t3tools/contracts/fork";
import { models, modelUrl, runModelCommand } from "./state";
import { useParameterHistory } from "./useParameterHistory";
import { parameterValues } from "./params";
import type { ParameterState } from "./parameterHistory";
import { Parameters } from "./Parameters";
import { OperationStatus } from "./OperationStatus";
import { useParameterPreview } from "./useParameterPreview";
const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type ScadSession = {
  data: ScadParameters;
  values: Readonly<Record<string, string>>;
  applied: Readonly<Record<string, string>>;
  appliedRevision: string | null;
  setName: string | null;
  automatic: boolean;
  hasUnapplied: boolean;
  historyCursor: number;
  historyLabels: readonly string[];
  moveHistory: (index: number) => void;
  chooseSet: (name: string | null) => void;
  setAutomatic: (enabled: boolean) => void;
  apply: () => void;
  saveSet: (name: string, values: Readonly<Record<string, string>>) => Promise<void>;
  promote: (values: Readonly<Record<string, string>>, name: string) => void;
};
export function ScadFile({
  threadRef,
  path,
  revision,
  pending,
  onSession,
  onMesh,
  onResult,
  onPending,
  onRefreshing,
  onError,
}: {
  onSession: (session: ScadSession) => void;
  onRefreshing: (refreshing: boolean) => void;
  threadRef: ScopedThreadRef;
  path: string;
  revision: number;
  pending: boolean;
  onMesh: (url: string, format: "stl" | "3mf", revision: string) => void;
  onResult: (result: ScadRenderResult) => void;
  onPending: (pending: boolean) => void;
  onError: (error: string) => void;
}) {
  const canRender = useAtomValue(models.render.permissionAtom(threadRef.environmentId));
  const [data, setData] = useState<ScadParameters | null>(null);
  const [finishedRevision, setFinishedRevision] = useState<number | null>(null);
  const refreshing = finishedRevision !== revision;
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{
    values: Readonly<Record<string, string>>;
    revision: string;
  } | null>(null);
  const onRendered = useCallback(
    (values: Readonly<Record<string, string>>, meshRevision: string) => {
      setRendered((previous) =>
        previous?.revision === meshRevision ? previous : { values, revision: meshRevision },
      );
    },
    [],
  );
  const [automatic, setAutomatic] = useState(true);
  const initial = useMemo<ParameterState>(
    () => ({ overrides: { ...data?.lastUsed }, setName: data?.lastUsedSet ?? null }),
    [data],
  );
  const history = useParameterHistory(
    `${threadRef.environmentId}:${threadRef.threadId}:${path}`,
    data?.sourceRevision ?? null,
    initial,
  );
  const { overrides, setName } = history.current;
  const ready = data !== null && loadedRevision === revision;
  const current = history.current;
  const preview = useParameterPreview(current, ready, automatic, data?.sourceRevision ?? null);
  const record = history.record;
  const promote = useCallback(
    (values: Readonly<Record<string, string>>, name: string) =>
      record({ overrides: values, setName: null }, `Use ${name}`),
    [record],
  );
  const saveSet = useCallback(
    async (name: string, values: Readonly<Record<string, string>>) => {
      const saved = await runModelCommand(models.saveSet, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, name, values },
      });
      setData(saved);
    },
    [threadRef.environmentId, threadRef.threadId, path],
  );
  const appliedValues = useMemo(
    () =>
      data
        ? parameterValues(data.parameters, {
            ...(preview.applied.setName ? data.setValues[preview.applied.setName] : {}),
            ...preview.applied.overrides,
          })
        : {},
    [data, preview.applied],
  );
  const session = useMemo(
    () =>
      data
        ? {
            data,
            values: parameterValues(data.parameters, {
              ...(setName ? data.setValues[setName] : {}),
              ...overrides,
            }),
            applied: rendered?.values ?? {},
            appliedRevision: rendered?.revision ?? null,
            setName,
            automatic,
            hasUnapplied: preview.hasUnapplied,
            historyCursor: history.history.cursor,
            historyLabels: history.history.entries.map((entry) => entry.label),
            moveHistory: history.move,
            chooseSet: (name: string | null) =>
              record({ setName: name, overrides: {} }, name ? `Set: ${name}` : "Source defaults"),
            setAutomatic,
            apply: preview.apply,
            promote,
            saveSet,
          }
        : null,
    [
      data,
      overrides,
      setName,
      rendered,
      promote,
      saveSet,
      automatic,
      preview.hasUnapplied,
      preview.apply,
      history.history,
      history.move,
      record,
    ],
  );
  useEffect(() => {
    if (session) onSession(session);
  }, [session, onSession]);
  useEffect(() => {
    let active = true;
    onRefreshing(true);
    void runModelCommand(models.parameters, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, path },
    })
      .then((parameters) => {
        if (active) {
          setData(parameters);
          setLoadedRevision(revision);
        }
      })
      .catch((error) => {
        if (active) {
          onError(failureMessage(error));
          onPending(false);
        }
      })
      .finally(() => {
        if (active) {
          onRefreshing(false);
          setFinishedRevision(revision);
        }
      });
    return () => {
      active = false;
    };
  }, [
    path,
    threadRef.environmentId,
    threadRef.threadId,
    revision,
    onError,
    onRefreshing,
    onPending,
  ]);
  const save = async (name: string) => {
    if (!data) return;

    const values = Object.fromEntries(
      data.parameters.map((parameter) => [
        parameter.name,
        overrides[parameter.name] ??
          (setName ? data.setValues[setName]?.[parameter.name] : undefined) ??
          parameter.defaultValue,
      ]),
    );
    const saved = await runModelCommand(models.saveSet, {
      environmentId: threadRef.environmentId,
      input: { file: { threadId: threadRef.threadId, path }, name, values },
    });
    setData(saved);
    history.record({ setName: name, overrides: {} }, `Saved set: ${name}`);
  };
  return (
    <fieldset disabled={!canRender} className={styles["model-customizer"]}>
      {!canRender && (
        <p role="status">This connection requires permission to render and edit OpenSCAD models.</p>
      )}
      {refreshing && (
        <OperationStatus
          label="Refreshing model parameters"
          detail="Reading source and saved sets from the environment."
        />
      )}
      {data ? (
        <Parameters
          data={data}
          history={history.history}
          onHistory={history.move}
          path={path}
          automatic={automatic}
          pending={pending || refreshing}
          hasUnapplied={preview.hasUnapplied}
          onAutomatic={setAutomatic}
          onApply={preview.apply}
          values={{ ...(setName ? data.setValues[setName] : {}), ...overrides }}
          setName={setName}
          onChange={(name, value) =>
            history.record(
              { setName, overrides: { ...overrides, [name]: value } },
              `${name}: ${value}`,
              name,
            )
          }
          onSet={(name) => {
            history.record(
              { setName: name, overrides: {} },
              name ? `Set: ${name}` : "Source defaults",
            );
          }}
          onReset={() => {
            history.record({ setName: null, overrides: {} }, "Source defaults");
          }}
          onSave={save}
        />
      ) : (
        <div className={styles["model-empty"]}>
          <p>Loading parameters...</p>
        </div>
      )}
      {ready && canRender && (
        <ScadRender
          key={JSON.stringify([loadedRevision, preview.applied])}
          threadRef={threadRef}
          path={path}
          revision={loadedRevision ?? revision}
          values={appliedValues}
          onRendered={onRendered}
          overrides={preview.applied.overrides}
          setName={preview.applied.setName}
          onMesh={onMesh}
          onResult={onResult}
          onPending={onPending}
          onError={onError}
        />
      )}
    </fieldset>
  );
}
function ScadRender({
  threadRef,
  path,
  revision,
  overrides,
  values,
  onRendered,
  setName,
  onMesh,
  onResult,
  onPending,
  onError,
}: {
  threadRef: ScopedThreadRef;
  path: string;
  revision: number;
  overrides: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  onRendered: (values: Readonly<Record<string, string>>, revision: string) => void;
  setName: string | null;
  onMesh: (url: string, format: "stl" | "3mf", revision: string) => void;
  onResult: (result: ScadRenderResult) => void;
  onPending: (pending: boolean) => void;
  onError: (error: string) => void;
}) {
  const [submittedValues] = useState(values);
  const result = useAtomValue(
    models.renderResult({
      environmentId: threadRef.environmentId,
      input: {
        file: { threadId: threadRef.threadId, path },
        overrides,
        parameterSet: setName,
        revision,
      },
    }),
  );
  useEffect(() => {
    onPending(result.waiting || result._tag === "Initial");
    if (result.waiting) return;
    if (result._tag === "Failure") onError(failureMessage(Cause.squash(result.cause)));
    if (result._tag === "Success") {
      onResult(result.value);
      if (result.value.mesh && result.value.meshFormat) {
        onRendered(submittedValues, result.value.mesh.revision);
        onMesh(
          modelUrl(threadRef.environmentId, result.value.mesh.relativeUrl),
          result.value.meshFormat,
          result.value.mesh.revision,
        );
      }
    }
  }, [
    result,
    submittedValues,
    onRendered,
    onPending,
    onError,
    onResult,
    onMesh,
    threadRef.environmentId,
  ]);
  return null;
}
