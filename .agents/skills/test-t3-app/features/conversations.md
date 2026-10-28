# New conversation and workspace handoff

Start from the sidebar New chat picker, command palette and project context. A ready
preset stays in the initiating picker while preparing; Right Arrow exposes options.
No project becomes selected only after a successful launch. Inject a recoverable launch
failure in isolated fixtures and prove Start over retains a usable picker. Check 390px
width and keyboard focus, then close or cancel and reopen.

For an existing single-repository Library conversation, use its supported worktree
handoff. Verify the thread's project/component/copy binding and metadata move with it,
history remains attached, and status distinguishes a copy root from an attached worktree.
Cancel before and after preparation commit; the original or committed binding must be
restored appropriately. Use WorktreeMcpService and libraryWorktreeHandoff source/tests
as the protocol anchor, rather than moving a checkout manually.

Evidence: initiating state, contextual progress, final workspace/history and both
cancellation outcomes. Save source/build identity and fixture IDs outside the worktree.
