import { createFileRoute } from "@tanstack/react-router";
import { VaultSettingsPage } from "../fork/settings/pages";

export const Route = createFileRoute("/_chat/settings/vault")({
  component: VaultSettingsPage,
});
