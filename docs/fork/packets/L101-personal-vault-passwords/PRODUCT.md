# L101 product

## Problem

A useful personal Vault should help create credentials before personal storage and unlock are
ready. Loom already generates passwords in web Utilities; native clients need the same policy
without a second algorithm or a network dependency.

## What the user can do

Generate a password with a selected length and character classes. Exclude ambiguous characters,
regenerate, explicitly reveal or hide the result, copy it and clear it. No value is generated on
open or option change. Option changes discard the prior result so it cannot be mistaken for the
new policy. Nothing is automatically saved, attached to chat or sent to an environment.

## Entry points and reverse actions

Web/desktop: Settings > Loom > Vault password tools, or the existing command-palette shortcut
and “Generate a Vault password”. Existing Utilities/password routes and shortcut remain usable.
No new dedicated global shortcut is assigned. Mobile: computer settings > Vault password tools.
Close and background clear the view; reveal has hide; generation has clear/regenerate. Copy is
explicit and cannot promise recall from other apps or clipboard history.

## States

Initial empty output, ready hidden output, revealed output, copying, copy success, policy error,
randomness failure and clipboard failure. All failures use safe text. Keep close available and
avoid automatic retries. Zero selected classes or invalid length must not generate a value.

## Surfaces and connection modes

The local feature works with a disconnected or unsupported server once settings is accessible.
The web bundle supplies desktop behavior. Native iOS and Android use Expo's cryptographic
source; plain HTTP web uses getRandomValues without depending on crypto.subtle. No provider,
scheduler or command-only job receives generated values. Existing Utilities is a web feature;
its values follow that tool's established lifecycle, not this dialog's background-clearing policy.

## Decisions and open questions

Use the existing generator policy: 8 to 128 characters, default 20, selectable character classes.
Use a shared pure helper with an explicit cryptographic byte-source adapter. Keep all state local.
Do not choose a personal encryption engine, new dependency or data schema in this packet.
Clipboard clearing and secure OS clipboard affordances may be evaluated separately; never
promise that clearing the UI erases external copies or JavaScript memory.
