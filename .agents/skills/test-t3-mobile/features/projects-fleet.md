# Native projects, conversations and fleet

Use the native Home/Projects entry, project New conversation, conversation actions and
Settings computer connection screens. Use the exact device launcher returned by
Device panel tools. Pair to isolated state, then check actual project/component/copy,
provider/account and conversation history against the [shared fleet journey](../../test-t3-app/features/fleet.md).

Exercise explicit computer choice, eligible-copy errors, offline/reconnect, peer
permission ceilings and remoteChild result navigation. Cancel a task and reopen its
status. Cover iOS and Android only when a real device/client was exercised; native
typechecks are useful consumer proof but not a native UI pass. Skills management has
no mobile UI; native threads still use the execution environment's provider catalog.

Anchor source: features/home/useThreadListActions.ts, features/threads/thread-list-v2-items.tsx
and fork/project-home. Prove Release checkout is offered only for an eligible landed
thread, preserves history and refuses active/unmerged work. Never use the live
operator's checkout as the fixture. Capture before/after and the retained conversation.
