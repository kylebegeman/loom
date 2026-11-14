import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const AccountLinksMigrations: ForkMigrationSet = {
  slug: "account-links",
  migrations: [
    [
      1,
      "Links",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // On the Library: the owner's policy for the whole account.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_account_links_policy (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`;
        // A peer link here is an account link while its linked_at matches the one recorded.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_account_links_outbound (environment_id TEXT PRIMARY KEY, linked_at TEXT NOT NULL)`;
        // The peer-link sessions this computer issued to the account's other computers.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_account_links_inbound (environment_id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, access TEXT NOT NULL, expires_at TEXT NOT NULL, issued_at TEXT NOT NULL)`;
      }),
    ],
  ],
};
