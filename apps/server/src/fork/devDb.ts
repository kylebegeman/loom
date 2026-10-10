/**
 * Loom tables whose rows name the live install's own resources: lane images, ports and
 * leases, run folders, evidence files and graph folders. `migrate-dev-db` leaves them empty,
 * because a dev server reconciling copied rows would stop, clean or delete those real
 * resources.
 */
export const FORK_LIVE_RESOURCE_TABLES: ReadonlyArray<string> = [
  "fork_project_lifecycle_lanes",
  "fork_apple_build_tooling_runs",
  "fork_device_qa_runs",
  "fork_device_qa_evidence",
  "fork_code_graph_projects",
];
