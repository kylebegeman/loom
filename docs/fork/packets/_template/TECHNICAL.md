# Lxx technical design

How the packet works. Cite upstream code as `path:line`, verified against the current tree.

## Overview

The shape of the solution in a short paragraph and, if it helps, a small diagram.

## Contracts

Schemas and RPC methods in `packages/contracts/src/fork/<slug>.ts`: tags (`loom.<slug>.*`),
payload, success, error (always including `EnvironmentAuthorizationError`), streaming or not,
and the scope each method needs.

## Server

Services in `apps/server/src/fork/<slug>/`, what they depend on from upstream, background
work (reactors started with `forkParked`), and error handling.

## Storage

Tables (`fork_<slug>_*`), columns, indexes, migrations (per-packet ids from 1), files under
`<stateDir>/fork/<slug>/`, retention and cleanup of orphans.

## Clients

Shared atoms in `packages/client-runtime/src/fork/<slug>.ts`; web components in
`apps/web/src/fork/<slug>/`; desktop-only parts; mobile parts if any. How the UI is gated on
`capabilities.loomFeatures`.

## Agent-facing tools

MCP tools (`loom_<slug>_*`), their gating, and why agents need them. "None" if none.

## Performance

Payload sizes over the WebSocket, subscription scope, render cost, anything that could
repaint continuously.

## Alternatives considered

Options rejected and why, especially any that would have needed more upstream seams.
