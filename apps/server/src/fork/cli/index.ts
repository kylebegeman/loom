import { sitesCommand } from "../sites/cli.ts";
import { loomLibraryMigrationCommand } from "../../../scripts/loom-library-migrate.ts";
import { loomLibraryBackupCommand } from "../../../scripts/loom-library-backup.ts";
import { pcbCommand } from "../pcb-preview/cli.ts";
import { modelCommand } from "../model-preview-3d/cli.ts";
export const FORK_CLI_COMMANDS = [
  sitesCommand,
  pcbCommand,
  modelCommand,
  loomLibraryMigrationCommand,
  loomLibraryBackupCommand,
] as const;
