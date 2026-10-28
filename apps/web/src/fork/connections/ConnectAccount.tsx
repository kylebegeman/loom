import { useAuth, useClerk, useUser } from "@clerk/react";
import { ArrowUpRightIcon, LogInIcon } from "lucide-react";
import { resolveCloudPublicConfig } from "~/cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "~/components/clerk/useT3ConnectAuthPrompt";
import { useT3ConnectAccountPage } from "~/components/clerk/T3ConnectAccountPages";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { resolveCurrentConnectAuthSurface } from "./connectAuthSurface";
import { Alert, useAction } from "~/fork/apple-build-tooling/parts";

/** The account entry point belongs beside the computers it discovers. */
export function ConnectAccount() {
  const surface = resolveCurrentConnectAuthSurface(resolveCloudPublicConfig());
  switch (surface.kind) {
    case "available":
      return <ConfiguredConnectAccount />;
    case "unsupported-origin":
      return <LocalBrowserConnectAccount hostedAppUrl={surface.hostedAppUrl} />;
    case "invalid-config":
      return (
        <SettingsRow
          title="T3 Connect"
          description="Account connections need configuration for this app. You can continue using directly paired computers."
        />
      );
    case "disabled":
      return null;
  }
}

function LocalBrowserConnectAccount({ hostedAppUrl }: { readonly hostedAppUrl: string | null }) {
  return (
    <SettingsRow
      title="T3 Connect"
      description={
        hostedAppUrl
          ? "This browser address supports direct computer connections. For account sign-in and shared computer discovery, use Loom desktop, Loom on iOS, or the hosted app."
          : "This browser address supports direct computer connections. For account sign-in and shared computer discovery, use Loom desktop or Loom on iOS."
      }
      control={
        hostedAppUrl ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={hostedAppUrl} target="_blank" rel="noopener noreferrer" />}
          >
            Open hosted app
            <ArrowUpRightIcon aria-hidden />
          </Button>
        ) : undefined
      }
    />
  );
}

function ConfiguredConnectAccount() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const account = useT3ConnectAccountPage();
  const action = useAction();
  return (
    <>
      <SettingsRow
        title="T3 Connect"
        description={
          !isLoaded
            ? "Loading your account..."
            : isSignedIn
              ? `Signed in${user?.primaryEmailAddress?.emailAddress ? ` as ${user.primaryEmailAddress.emailAddress}` : ""}. Linked computers are available on your other signed-in devices.`
              : "Sign in to discover computers linked to your account on all your devices."
        }
        control={
          !isLoaded ? (
            <span role="status" className="text-xs text-muted-foreground">
              Loading...
            </span>
          ) : isSignedIn ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="xs"
                variant="outline"
                disabled={!account.open || action.busy}
                onClick={() => account.open?.()}
              >
                Manage account
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={action.busy}
                onClick={() =>
                  void action.act(async () => {
                    await signOut();
                  })
                }
              >
                {action.busy ? "Signing out..." : "Sign out"}
              </Button>
            </div>
          ) : (
            <Button size="xs" variant="outline" onClick={openAuthPrompt}>
              <LogInIcon aria-hidden />
              Sign in
            </Button>
          )
        }
      />
      {action.error ? <Alert>{action.error}</Alert> : null}
      {account.portals}
    </>
  );
}
