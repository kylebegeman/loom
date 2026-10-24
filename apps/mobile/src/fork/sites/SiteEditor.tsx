import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { library } from "../library/libraryState";
import { sites } from "./state";
const decodeSaveSiteRequest = Schema.decodeUnknownSync(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownSync(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownSync(SaveSiteCheckRequest);
export type SiteEditTarget =
  | { kind: "site"; row?: SitesSnapshot["sites"][number] }
  | { kind: "service"; row?: SitesSnapshot["services"][number] }
  | { kind: "check"; row?: SitesSnapshot["checks"][number]; serviceId?: string };

/** The ID a new entry would get from its name; the person can still change it before saving. */
function idFromName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** The scheme and host of a URL, or nothing while it is still being typed. */
function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
export function SiteEditor({
  target,
  snapshot,
  environmentId,
  connected,
  onSaved,
  onClose,
}: {
  target: SiteEditTarget;
  snapshot: SitesSnapshot;
  environmentId: EnvironmentId;
  connected: boolean;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const row = target.row;
  const [id, setId] = useState(row?.id ?? "");
  // A new entry's ID follows its name until someone types an ID of their own.
  const [idEdited, setIdEdited] = useState(Boolean(row));
  const [name, setName] = useState(row?.name ?? "");
  const [url, setUrl] = useState(row?.url ?? "");
  const [active, setActive] = useState(row ? Boolean(row.active) : true);
  const [origins, setOrigins] = useState(
    target.kind === "site" ? (target.row?.origins.join("\n") ?? "") : "",
  );
  const [projectIds, setProjects] = useState<readonly string[]>(
    target.kind === "site" ? (target.row?.projectIds ?? []) : [],
  );
  const [serviceIds, setServices] = useState<readonly string[]>(
    target.kind === "site" ? (target.row?.serviceIds ?? []) : [],
  );
  const [kind, setKind] = useState(
    target.kind === "service" ? (target.row?.kind ?? "website") : "website",
  );
  const [serviceId, setServiceId] = useState(
    target.kind === "check"
      ? (target.row?.service_id ?? target.serviceId ?? snapshot.services[0]?.id ?? "")
      : "",
  );
  const [status, setStatus] = useState(
    target.kind === "check" ? String(target.row?.expected_status ?? 200) : "200",
  );
  const [content, setContent] = useState(
    target.kind === "check" ? (target.row?.content ?? "") : "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(sites.saveSite.permissionAtom(environmentId));
  const catalog = useEnvironmentQuery(
    library.projects({ environmentId, input: { includeArchived: true } }),
  );
  const saveSite = useAtomCommand(sites.saveSite, { reportFailure: false });
  const saveService = useAtomCommand(sites.saveService, { reportFailure: false });
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const toggle = (values: readonly string[], value: string) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  const changeName = (next: string) => {
    setName(next);
    if (!idEdited) setId(idFromName(next));
  };
  // The site's own origin must be among its analytics origins; keep it there as the URL changes.
  const changeUrl = (next: string) => {
    if (target.kind === "site") {
      const before = originOf(url);
      const after = originOf(next);
      const lines = origins.split(/\r?\n/).filter((line) => line.trim() && line.trim() !== before);
      setOrigins(
        (after ? [after, ...lines.filter((line) => line.trim() !== after)] : lines).join("\n"),
      );
    }
    setUrl(next);
  };
  const submit = async () => {
    if (busy || !allowed || !connected) return;
    setError(null);
    setBusy(true);
    try {
      const base = { id, name, url, active };
      const result =
        target.kind === "site"
          ? await saveSite({
              environmentId,
              input: decodeSaveSiteRequest({
                ...base,
                origins: origins
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean),
                projectIds,
                serviceIds,
              }),
            })
          : target.kind === "service"
            ? await saveService({
                environmentId,
                input: decodeSaveSiteServiceRequest({ ...base, kind }),
              })
            : await saveCheck({
                environmentId,
                input: decodeSaveSiteCheckRequest({
                  ...base,
                  service_id: serviceId,
                  expected_status: Number(status),
                  content,
                }),
              });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved(id);
    } catch (cause) {
      setError(
        Schema.isSchemaError(cause)
          ? "Check the required fields, HTTPS URLs, and project selection."
          : cause instanceof Error
            ? cause.message
            : "Could not save. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`${row ? "Edit" : "Register"} ${target.kind}`}
      dismissible={!busy}
      onClose={onClose}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <View className="gap-4 p-4">
          <Text className="text-lg font-t3-semibold">
            {row ? "Edit" : "Register"} {target.kind}
          </Text>
          <Text>Pause entries to preserve their identity and history.</Text>
          <TextInput
            accessibilityLabel="Name"
            placeholder="Name"
            maxLength={120}
            editable={!busy}
            value={name}
            onChangeText={changeName}
          />
          <TextInput
            accessibilityLabel="Stable ID"
            placeholder="stable-id"
            maxLength={64}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!row && !busy}
            value={id}
            onChangeText={(next) => {
              setIdEdited(true);
              setId(next);
            }}
          />
          <TextInput
            accessibilityLabel={target.kind === "check" ? "Check URL" : "HTTPS origin"}
            placeholder="https://example.com"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            value={url}
            onChangeText={changeUrl}
          />
          {target.kind === "site" ? (
            <>
              <Text>Analytics origins, one per line, including the site's origin</Text>
              <TextInput
                accessibilityLabel="Analytics origins"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                value={origins}
                onChangeText={setOrigins}
              />
              <Text className="font-t3-semibold">Projects (at least one)</Text>
              {catalog.isPending ? <Text>Loading projects…</Text> : null}
              {catalog.error ? <Text accessibilityRole="alert">{catalog.error}</Text> : null}
              {catalog.data?.map((project) => (
                <Button
                  key={project.id}
                  label={`${projectIds.includes(project.id) ? "Selected: " : ""}${project.title}${project.archived ? " (archived)" : ""}`}
                  disabled={busy}
                  tone={projectIds.includes(project.id) ? "primary" : "secondary"}
                  onPress={() => setProjects(toggle(projectIds, project.id))}
                />
              ))}
              {!catalog.isPending && !catalog.data?.length ? (
                <Text>Create a project in Projects before registering a site.</Text>
              ) : null}
              {projectIds
                .filter((id) => !catalog.data?.some((p) => p.id === id))
                .map((id) => (
                  <Button
                    key={id}
                    label={`Remove unavailable project: ${id}`}
                    disabled={busy}
                    onPress={() => setProjects(toggle(projectIds, id))}
                  />
                ))}
              <Text className="font-t3-semibold">Services this site uses</Text>
              {snapshot.services.map((service) => (
                <Button
                  key={service.id}
                  label={`${serviceIds.includes(service.id) ? "Selected: " : ""}${service.name}`}
                  disabled={busy}
                  tone={serviceIds.includes(service.id) ? "primary" : "secondary"}
                  onPress={() => setServices(toggle(serviceIds, service.id))}
                />
              ))}
            </>
          ) : target.kind === "service" ? (
            <View className="flex-row flex-wrap gap-2">
              {(["website", "api", "redirect"] as const).map((value) => (
                <Button
                  key={value}
                  label={`${kind === value ? "Selected: " : ""}${value}`}
                  disabled={busy}
                  tone={kind === value ? "primary" : "secondary"}
                  onPress={() => setKind(value)}
                />
              ))}
            </View>
          ) : (
            <>
              <Text className="font-t3-semibold">Service</Text>
              {snapshot.services.map((service) => (
                <Button
                  key={service.id}
                  label={`${serviceId === service.id ? "Selected: " : ""}${service.name}`}
                  disabled={busy}
                  tone={serviceId === service.id ? "primary" : "secondary"}
                  onPress={() => setServiceId(service.id)}
                />
              ))}
              <TextInput
                accessibilityLabel="Expected HTTP status"
                placeholder="200"
                keyboardType="number-pad"
                editable={!busy}
                value={status}
                onChangeText={setStatus}
              />
              <TextInput
                accessibilityLabel="Expected response text (optional)"
                placeholder="Expected response text (optional)"
                maxLength={120}
                editable={!busy}
                value={content}
                onChangeText={setContent}
              />
              <Text>The URL must use the service's origin. Redirects are not followed.</Text>
            </>
          )}
          <View className="flex-row items-center justify-between">
            <Text>Active</Text>
            <Switch
              accessibilityLabel="Active"
              value={active}
              disabled={busy}
              onValueChange={setActive}
            />
          </View>
          {error ? <Text accessibilityRole="alert">{error}</Text> : null}
          <View className="flex-row flex-wrap gap-2">
            <Button label="Cancel" disabled={busy} onPress={onClose} />
            <Button
              label={busy ? "Saving…" : "Save changes"}
              tone="primary"
              disabled={
                busy || !connected || !allowed || (target.kind === "site" && !projectIds.length)
              }
              onPress={() => void submit()}
            />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}
