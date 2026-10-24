import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { OVERHANG_ANGLE, type ModelPreviewSettings } from "@t3tools/contracts/fork";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { models, runModelCommand } from "./state";

/** Previews the angle locally; pointer/key release commits one environment setting. */
export function useOverhangAngleSetting(
  environmentId: EnvironmentId,
  settings: ModelPreviewSettings,
  getSettings: () => ModelPreviewSettings,
) {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const [pending, setPending] = useState<number | null>(null);
  if (pending === settings.overhangAngleDegrees) setPending(null);
  const angle = pending ?? settings.overhangAngleDegrees;
  const latest = useRef({ angle, getSettings });
  // The settings atom can lag a successful RPC; unrelated local renders must not undo its ack.
  const savedAngle = useRef(settings.overhangAngleDegrees);
  useLayoutEffect(() => {
    savedAngle.current = settings.overhangAngleDegrees;
  }, [settings.overhangAngleDegrees]);
  const version = useRef(0);
  const saving = useRef<{ angle: number; operation: Promise<void> } | null>(null);
  useLayoutEffect(() => {
    latest.current = { angle, getSettings };
  });
  const setAngle = useCallback(
    (value: number) => {
      if (!canSave || !Number.isFinite(value)) return;
      const next = Math.max(
        OVERHANG_ANGLE.minimum,
        Math.min(OVERHANG_ANGLE.maximum, Math.round(value)),
      );
      if (next === latest.current.angle) return;
      version.current++;
      latest.current.angle = next;
      setPending(next);
    },
    [canSave],
  );
  const commit = useCallback(async () => {
    if (!canSave) return;
    const next = latest.current.angle;
    if (saving.current?.angle === next) return saving.current.operation;
    if (next === savedAngle.current && !saving.current) return;
    const ownVersion = version.current;
    const operation = runModelCommand(models.updateSettings, {
      environmentId,
      input: { ...latest.current.getSettings(), overhangAngleDegrees: next },
    })
      .then((saved) => {
        savedAngle.current = saved.overhangAngleDegrees;
        appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
      })
      .catch((cause: unknown) => {
        if (version.current === ownVersion) {
          latest.current.angle = savedAngle.current;
          setPending(savedAngle.current);
        }
        toastManager.add({
          type: "error",
          title: "Overhang angle not changed",
          description: cause instanceof Error ? cause.message : "The setting could not be saved.",
        });
      });
    saving.current = { angle: next, operation };
    await operation.finally(() => {
      if (saving.current?.operation === operation) saving.current = null;
    });
  }, [canSave, environmentId]);
  return useMemo(() => ({ angle, canSave, setAngle, commit }), [angle, canSave, setAngle, commit]);
}
