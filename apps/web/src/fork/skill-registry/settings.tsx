import { lazy, Suspense } from "react";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useSkillsSupported } from "./state";
const SkillManager = lazy(() => import("./SkillManager"));
function EnvironmentSkills({
  environmentId,
}: {
  environmentId: import("@t3tools/contracts").EnvironmentId;
}) {
  const supported = useSkillsSupported(environmentId);
  return supported ? (
    <div className="flex h-[min(75vh,900px)] min-h-96 flex-col overflow-hidden rounded-lg border border-border">
      <Suspense fallback={<p className="p-4 text-sm">Loading Skills…</p>}>
        <SkillManager environmentId={environmentId} />
      </Suspense>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">
      This computer needs a Loom server with Skills support.
    </p>
  );
}
export function SkillsSettingsSection() {
  const { environment } = useSettingsScope();
  return environment ? (
    <EnvironmentSkills key={environment.environmentId} environmentId={environment.environmentId} />
  ) : (
    <p className="text-sm text-muted-foreground">Connect a computer to manage its skills.</p>
  );
}
