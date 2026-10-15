import { createFileRoute } from "@tanstack/react-router";
import { LibraryProjectsPage } from "~/fork/project-library/LibraryProjectsPage";
export const Route = createFileRoute("/library/")({ component: LibraryProjectsPage });
