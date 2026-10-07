import { createFileRoute } from "@tanstack/react-router";
import { LoomSettingsPage } from "../fork/settings/LoomSettingsPage";
export const Route = createFileRoute("/settings/loom")({ component: LoomSettingsPage });
