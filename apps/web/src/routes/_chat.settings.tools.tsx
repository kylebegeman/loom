import { createFileRoute } from "@tanstack/react-router";
import { ToolsSettingsPage } from "../fork/settings/pages";

export const Route = createFileRoute("/_chat/settings/tools")({
  component: ToolsSettingsPage,
});
