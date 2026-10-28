# L21 constraints

Provider catalogs remain authoritative for effective availability. Bounded filesystem
scans add provenance and real paths, including shared roots. Never infer that a folder
is visible to an agent merely because it is a writable install target. Probe failures
are reported per account.

Claude enablement reuses native settings precedence and rejects malformed or lenient
JSON instead of rewriting it. Codex writes through skills/config/write in the selected
account's effective home. Other providers remain read-only. This avoids a Loom-only
filter that an agent could bypass.

Git sources are bare HTTPS repositories pinned to a commit. Blob reads preserve binary
files and modes without checkout filters, hooks, submodules or source execution. A
selected folder must be copied completely; unsupported entries fail the operation.
Installs stage beside their destination. Replacement, metadata and rollback are
serialized, with recovery paths retained when restoration cannot be completed safely.

Update review tokens bind the source revision and current complete-directory hash.
Explicit replacement of local edits still requires a fresh review. Lab writes use the
opened file's hash. Removal preserves a verified complete copy in trash, including
across filesystems. Registry metadata lives under the environment's state directory,
without a database migration.

Fetch workers belong to the service scope so a closed RPC request does not interrupt a
fetch. Reusing its request ID with different inputs is a conflict. Mutations use the
existing environment RPC permission system; clients cannot choose arbitrary server
paths. No account homes are written during automated verification.
