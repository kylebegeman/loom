# L86 seams

No upstream files or seam markers are added. Fork-owned access contracts/RPC, scope maps,
service construction, capability registry, MCP toolkit, shared commands and web/mobile access
settings are extended through existing registries. The notification observation service uses an explicit transport stub at production construction;
tests supply only the transport boundary. Memory outcomes are returned through an optional inbox
field and shared web/mobile wording. Current approval-context labels also use an optional inbox
field and existing metadata services; shared presentation supplies ID fallback and accessible
action context. A scoped access-service retention worker
uses the existing ForkLayer lifecycle; no orchestration/resumption effect is introduced.

Requests and timed grants share the existing encrypted access-policy CAS. The internal operation
journal uses the independent version-1 record at
`environments/<environment-sha256>/profiles/_operations/approval-journal-v1`, covered by the
existing documented profiles-subtree read/create/update rights. ForkLayer supplies the existing
store/access services; construction does not read or write the journal. No public RPC/MCP/CLI,
new policy capability, mount, dependency, SQL migration or Library service change is added. No provider
adapter, desktop password dialog or orchestration event is changed. Automatic workload
resumption and external notifications remain outside this milestone.

Source baseline `b0cfe6a63f`; required focused registration and seam checks are recorded in
TESTING.md. There are no additional FORK.md or seam-manifest rows for fork-owned files.
