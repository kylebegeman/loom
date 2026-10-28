import { createFileRoute } from "@tanstack/react-router";
import { ProjectStoragePage } from "../fork/project-home/ProjectStoragePage";

export const Route = createFileRoute("/_chat/settings/project-files")({
  component: ProjectStoragePage,
});
