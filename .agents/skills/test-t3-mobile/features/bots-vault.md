# Native bot and Vault outcomes

Follow the [bot journey](../../test-t3-app/features/bots.md) and
[Vault journey](../../test-t3-app/features/vault.md) for shared invariants. On native,
enter through the computer's SettingsEnvironmentDetailRouteScreen, scheduled-task
settings and thread actions. Verify typed permission errors, pending approvals,
run outcomes, failure/retry guidance and navigation back to the correct environment.

Use synthetic Vault data and owned bot fixtures. No secret value belongs in a
screenshot, clipboard dump or chat. Check denied/allowed/revoked/version-rotation
states through the same real service path. Missing native UI for a desktop-only
capability must be reported as a surface limit, not simulated through a web panel.

Evidence includes OS/client fingerprint, host/environment, action/result and reverse
state. Finish with device-specific cleanup from test-t3-mobile, retaining evidence.
