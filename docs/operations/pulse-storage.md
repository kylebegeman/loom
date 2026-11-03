# Pulse storage upgrades and recovery

Shared Pulse definitions and retained mutation replies live in the Library authority's
SQLite database. A consistent backup of that database includes workspace revisions,
deleted-workspace revision counters, retry receipts and the definition snapshots those
receipts reference. Pulse needs no separate object-directory backup after migration.
The Library backup manifest reports these records under `apiWorkspaces`.

On startup, the authority imports each registered project's previous catalog from
`<stateDir>/fork/library-api-workspaces`. Imports validate catalog revisions and the
content hashes of retained replies, then commit each project's catalog and snapshots
in one transaction. A failed import preserves the files and rolls back its database
writes. The startup error identifies the failure; the authority must complete the
import before serving shared Pulse operations. Execution computers do not import
these catalogs.

Original files remain as pre-upgrade recovery copies. Once a project's database
catalog exists, Loom never imports its old files again, including when every shared
workspace has since been removed. Restoring a post-migration database onto another
authority therefore does not require these files and cannot resurrect their older
workspace definitions.

For an upgrade rollback, retain a consistent pre-upgrade database backup together
with its matching legacy catalog directory. Restore the pair with Loom stopped.
An older binary reads only the legacy files and cannot see later database-only Pulse
changes. Do not alternate old and new versions against the same state or treat the
retained files as a current backup. Keep using post-migration database backups to
preserve changes made after the upgrade.
