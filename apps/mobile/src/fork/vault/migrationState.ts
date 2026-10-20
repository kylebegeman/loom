import { createVaultMigrationInventoryAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";

// Review, cancellation and verification must invalidate the receipt displayed by every migration view.
export const migrationInventory = createVaultMigrationInventoryAtoms(connectionAtomRuntime);
