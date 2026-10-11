# L70 product

## Problem

Exploring a tscircuit design means trying values: a wider board, a different connector, another
capacitor count. Today each try is apply, wait for the preview, look, and undo. Saved variants are
named chips with no picture, so comparing three options means applying each one in turn and
remembering what the last looked like. Agents can suggest values but the user cannot see them
without changing the source.

## What the user can do

- Open Parameters and choose **Sweep**. Pick one or two parameters; for a number give from, to and
  a count, for a choice tick the options, for a switch get both. The dialog says "Makes 6
  variants" and refuses more than 8.
- Watch the candidates build one at a time: "Rendering 2 of 6" with a progress bar and
  **Cancel**. Each card fills in with a board thumbnail and a short line such as
  "38.0 x 24.0 mm, 14 parts, 1 issue".
- Switch the list between **Grid** and **Table**, and sort by name, width, height, area, parts or
  issues (plus L55's columns when present).
- Select two and choose **Compare**: side by side or overlaid, with a mode switch (Side by side,
  Overlay, A, B, Difference) and an opacity slider for Overlay, aligned on the board's real
  dimensions, with the changed parameters and stats listed.
- Choose **Use these values** on a card. The values load into the parameter list and the source
  diff opens; **Apply to source** writes it if the source has not changed since review.
- Keep favourites: every candidate is a saved variant until deleted. Rename, duplicate, render
  again and delete from the card menu.
- Ask an agent to propose variants ("try three board widths and both connector options"). They
  appear marked as proposed by the agent, unrendered, until the user renders them. An agent can
  also ask the open panel to render them, which still respects the trust setting.

## Entry points with reverse states

| Way in                                                                       | Way out or back                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Sweep** in the Variants section, or the palette "Sweep circuit parameters" | **Cancel** in the dialog                                            |
| **Render all**, **Render** on a card or selection                            | **Cancel** in the progress row                                      |
| Selecting cards                                                              | **Clear selection**                                                 |
| **Compare**                                                                  | Close button or `Escape`                                            |
| **Use these values**                                                         | **Reset** in the parameter footer                                   |
| **Apply to source**                                                          | Apply the previous values from their variant, or undo in the editor |
| Agent proposes variants                                                      | **Delete** on the card or selection                                 |
| **Grid** / **Table**                                                         | The other button                                                    |

## States

- Loading: "Reading circuit parameters" as today. Cards show "Queued" and "Rendering" during a
  batch.
- Empty: with parameters but no variants, "Save the current values as a variant, or sweep one or
  two parameters to compare designs side by side." With no declared parameters, L24's existing
  empty state.
- Error: a failed candidate shows "Build failed" on its card with **View log**; the batch
  continues with the next one. A source changed mid-batch stops the batch with "The circuit source
  changed. Render again to update the variants."
- Disabled: before circuit code is allowed, cards show saved thumbnails but render buttons are
  disabled with "Allow circuit code from the drawing to render variants." Without workspace write
  permission, **Sweep** and saving are disabled with the existing permission message. Without
  terminal permission, rendering is disabled with "Rendering variants needs terminal permission
  on this environment."
- Stale: a thumbnail made on another revision of the design shows **Out of date**. Rendering it
  again is quick when the build is still cached.
- Full: at 24 variants **Sweep** and **Save variant** are disabled with "Delete variants to add
  more."

## Surfaces and connection modes

Web and desktop share the panel. Mobile has no PCB panel. Builds always run on the environment
host, so local, remote, relay and tunnel behave the same; the client fetches each candidate's SVG
once through the existing sheet RPC and keeps only the small thumbnail in saved state.

## Decisions

- 8 candidates per sweep, 24 kept. Builds run one at a time on the host within a bounded queue.
  Real-tool timings remain unmeasured; the approved limit stays 8.
- Board SVG thumbnails, not 3D. The board drawing shows placement and size, which is what a sweep
  changes; 3D export is the slowest tscircuit output.
- Thumbnails are made in the client from the SVG the host already produced. No image library on
  the server, no new dependency.
- "Issues" counts Circuit JSON errors and warnings from the build, not KiCad DRC. That is the check
  tscircuit itself reports; calling it DRC would overstate it.
- Promotion reuses Review change and Apply to source. One write path keeps the source hash check.
- Variants stay in the Parameters tab, where they already live, rather than a new tab.
- Agents propose; they never build without the panel. Proposing writes only saved state, and
  rendering goes through the visible panel, which applies the trust gate.

## Accepted defaults

Kyle authorized implementation with 8 candidates per sweep and 24 saved variants. Agents may
ask the open panel to render through `render-variants`, subject to circuit trust and permissions.
The optional timing experiment is deferred because `tsci` is not installed. Existing host-only
PCB render tools retain their prior behavior.
