import { useMemo, useState } from "react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Linking, ScrollView, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { SITE_HEALTH_STATES, siteHealth, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRow } from "../../components/ui/ListRow";
import { Sheet } from "../../components/ui/Sheet";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { LibraryNotice, LibraryPage } from "../library/LibraryPage";
import { library, useLibraryAuthority } from "../library/libraryState";
import { sites } from "./state";
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";
import { SiteDetail } from "./SiteDetail";
import { SiteServiceGroup, siteHost } from "./SiteHealth";
import { SiteTrafficSkeleton } from "./SiteTraffic";
import { useSiteCheckClock } from "./use-site-check-clock";

export function SitesRouteScreen({ route }: StaticScreenProps<{ siteId?: string } | undefined>) {
  const authority = useLibraryAuthority();
  return <SitesScreen key={authority.environmentId} authority={authority} route={route} />;
}

function SitesScreen({
  route,
  authority,
}: StaticScreenProps<{ siteId?: string } | undefined> & {
  authority: ReturnType<typeof useLibraryAuthority>;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const authorityConfirmed =
    authority.info.data?.isAuthority === true &&
    authority.info.data.environmentId === authority.environmentId;
  const query = useEnvironmentQuery(
    authority.environmentId && authorityConfirmed && supported && authority.canRead
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  const selected = snapshot?.sites.find((site) => site.id === route.params?.siteId);
  const analytics = useEnvironmentQuery(
    authority.environmentId && supported && authority.canRead && selected
      ? sites.analytics({ environmentId: authority.environmentId, input: { siteId: selected.id } })
      : null,
  );
  const manages = supportsLoomFeature(config?.environment.capabilities, SITES_MANAGEMENT_FEATURE);
  const allowed = useAtomValue(sites.saveSite.permissionAtom(authority.environmentId));
  const canManage = Boolean(
    manages && query.data?.managementConfigured && allowed && authority.connected,
  );
  const projects = useEnvironmentQuery(
    authority.environmentId && authorityConfirmed && authority.canRead
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const { colors } = useControlTheme();
  const [editing, setEditing] = useState<SiteEditTarget | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runChecks = useAtomCommand(sites.runChecks, { reportFailure: false });
  const refresh = () => {
    query.refresh();
    analytics.refresh();
  };
  const run = async () => {
    if (!authority.environmentId || !canManage || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await runChecks({ environmentId: authority.environmentId, input: {} });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run checks.");
    } finally {
      setRunning(false);
    }
  };
  const open = (url: string) => {
    setError(null);
    void Linking.openURL(url).catch(() => setError("Could not open your browser. Try again."));
  };
  const openSite = (siteId: string) => navigation.dispatch(StackActions.push("Sites", { siteId }));
  return (
    <LibraryPage
      title={selected?.name ?? (route.params?.siteId ? "Website" : "Websites")}
      menus={[
        {
          title: "Website actions",
          icon: "ellipsis",
          separateBackground: true,
          items: [
            {
              id: "refresh",
              title: "Refresh",
              icon: "arrow.clockwise",
              disabled: !authority.connected || !supported || query.isPending,
              onPress: refresh,
            },
            ...(selected && canManage
              ? [
                  {
                    id: "edit",
                    title: "Edit website",
                    icon: "pencil",
                    onPress: () => setEditing({ kind: "site", row: selected }),
                  },
                ]
              : []),
            ...(canManage
              ? [
                  {
                    id: "register",
                    title: "Register website",
                    icon: "plus",
                    disabled: !snapshot,
                    onPress: () => setEditing({ kind: "site" }),
                  },
                ]
              : []),
            {
              id: "services",
              title: canManage ? "Manage services" : "Services",
              icon: "server.rack",
              disabled: !snapshot,
              onPress: () => setServicesOpen(true),
            },
            ...(canManage
              ? [
                  {
                    id: "run",
                    title: running ? "Running checks…" : "Run all checks",
                    icon: "play",
                    disabled: running,
                    onPress: () => void run(),
                  },
                ]
              : []),
          ],
        },
      ]}
    >
      {!authority.loaded ? (
        <View accessibilityLabel="Loading websites" className="items-center p-5">
          <AppActivityIndicator />
        </View>
      ) : !authority.environmentId ? (
        <EmptyState
          variant="plain"
          title="Choose your Library first"
          detail="Websites live on your Library server. Choose it, then come back to view them."
          actionLabel="Choose Library server"
          onAction={() => navigation.navigate("LibrarySettings")}
        />
      ) : authority.connected && !authority.canRead ? (
        <EmptyState
          variant="plain"
          title="Website access unavailable"
          detail="This connection does not have permission to read your Library."
        />
      ) : authority.connected && config === null ? (
        <View accessibilityLabel="Loading Library capabilities" className="items-center p-5">
          <AppActivityIndicator />
        </View>
      ) : authority.connected && !supported ? (
        <EmptyState
          variant="plain"
          title="Websites need a newer Library server"
          detail={`Update ${authority.label} to view your websites here.`}
        />
      ) : authority.connected && !authority.info.data ? (
        authority.info.error ? (
          <LibraryNotice error={authority.info.error} onRetry={authority.info.refresh} />
        ) : (
          <View accessibilityLabel="Loading Library" className="items-center p-5">
            <AppActivityIndicator />
          </View>
        )
      ) : authority.connected && !authorityConfirmed ? (
        <EmptyState
          variant="plain"
          title="Choose your Library server"
          detail="This computer runs your work. Connect your Library to view linked websites."
          actionLabel="Connect Library"
          onAction={() => navigation.navigate("LibrarySettings")}
        />
      ) : query.data?.configured === false ? (
        <EmptyState
          variant="plain"
          title="Website monitoring is not connected"
          detail="Connect website monitoring in Loom on your computer to see your websites here."
        />
      ) : (
        <>
          {!authority.connected ? (
            <LibraryNotice
              detail={`Library offline. Reconnect ${authority.label} to refresh your websites.`}
            />
          ) : null}
          {error ? <LibraryNotice error={error} /> : null}
          {query.error ? (
            <View className="gap-1">
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {query.error}
              </Text>
              <Button label="Try again" tone="text" onPress={query.refresh} />
            </View>
          ) : null}
          {snapshot ? (
            selected ? (
              <SiteDetail
                key={selected.id}
                site={selected}
                snapshot={snapshot}
                now={now}
                color={colors["--color-primary"]}
                projects={projectsById}
                analytics={analytics}
                canManage={canManage}
                onEdit={setEditing}
                onVisit={open}
                onOpenProject={(projectId) => navigation.navigate("LibraryProject", { projectId })}
              />
            ) : route.params?.siteId ? (
              <EmptyState
                variant="plain"
                title="Website unavailable"
                detail="This website is no longer in the selected Library."
                actionLabel="View websites"
                onAction={() => navigation.dispatch(StackActions.replace("Sites"))}
              />
            ) : snapshot.sites.length ? (
              <>
                <Text className="text-sm text-foreground-muted">
                  Choose a website to review its monitoring and traffic.
                </Text>
                <SettingsSection>
                  {snapshot.sites.map((site) => (
                    <ListRow
                      key={site.id}
                      label={site.name}
                      description={siteHost(site.url)}
                      detail={SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state].label}
                      onPress={() => openSite(site.id)}
                    />
                  ))}
                </SettingsSection>
              </>
            ) : (
              <EmptyState
                variant="plain"
                title="Register your first website"
                detail="Link a website to monitor its availability and see its traffic."
                action={
                  <Button
                    label="Register website"
                    tone="primary"
                    disabled={!canManage}
                    onPress={() => setEditing({ kind: "site" })}
                  />
                }
              />
            )
          ) : authority.connected && !query.error ? (
            <SiteTrafficSkeleton />
          ) : null}
        </>
      )}
      {snapshot && servicesOpen ? (
        <Sheet title="Services" onClose={() => setServicesOpen(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-5 p-5"
          >
            <Text className="text-sm text-foreground-muted">
              Services are the websites and APIs your monitoring checks watch. One service can
              support several websites.
            </Text>
            {canManage ? (
              <Button
                label="Register service"
                icon="plus"
                disabled={!canManage}
                onPress={() => setEditing({ kind: "service" })}
              />
            ) : null}
            <SettingsSection>
              {snapshot.services.map((service, index) => (
                <SiteServiceGroup
                  key={service.id}
                  service={service}
                  separated={index > 0}
                  checks={snapshot.checks.filter((check) => check.service_id === service.id)}
                  staleAfterSeconds={snapshot.staleAfterSeconds}
                  now={now}
                  canManage={canManage}
                  usedBy={
                    <Text className="text-sm text-foreground-muted">
                      {snapshot.sites
                        .filter((site) => site.serviceIds.includes(service.id))
                        .map((site) => site.name)
                        .join(", ") || "Not linked to a website"}
                    </Text>
                  }
                  onEditService={() => setEditing({ kind: "service", row: service })}
                  onAddCheck={() => setEditing({ kind: "check", serviceId: service.id })}
                  onEditCheck={(check) => setEditing({ kind: "check", row: check })}
                />
              ))}
            </SettingsSection>
            {!snapshot.services.length ? (
              <Text textRole="body" className="text-foreground-muted">
                No monitoring services are registered yet.
              </Text>
            ) : null}
          </ScrollView>
        </Sheet>
      ) : null}
      {snapshot && authority.environmentId && editing ? (
        <SiteEditor
          key={`${editing.kind}:${editing.row?.id ?? "new"}`}
          target={editing}
          snapshot={snapshot}
          environmentId={authority.environmentId}
          connected={canManage}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing.kind === "site" && selected?.id !== id) openSite(id);
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </LibraryPage>
  );
}
