# L68 product

## Problem

ERC catches wiring that is illegal by pin type: two outputs fighting, an unconnected pin, a
power input with no source. It does not catch the common first-board mistakes that are legal by
pin type: an I2C bus with no pull-ups, an IC with no decoupling capacitor, a USB connector with
no ESD protection, a button on an input with no pull resistor, a reset pin left to chance, an LED
straight across a supply, a regulator fed more than it can take. Those cost a board spin.
tscircuit designs have no ERC at all in Loom (L24), so they get none of this today.

An agent editing a schematic makes the same mistakes and has no cheap way to notice them.

## What the user can do

- Open Checks and press "Run review" on a KiCad or tscircuit design.
- Read findings such as "SDA has no pull-up resistor to a supply." with a "Why" line naming the
  parts and the rule, and a "Locate" button.
- See review findings on the drawing as markers next to ERC and DRC (with L52).
- Turn a rule off for the project, or waive one finding ("Ignore here") with an optional note.
- Show waived findings again and un-waive them.
- Change a rule's parameter where one exists, such as the decoupling distance.
- Ask an agent to review the schematic; it gets the same findings and can fix them.

## Entry points

| Way in                                             | Way out                              | Way to see the state                                                   |
| -------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| "Run review" in Checks, Review card                | "Cancel" while running               | Review card status and findings; status bar "Review 3" chip            |
| Agent `loom_pcb_review`                            | Interrupting the tool call           | The result; the open panel refreshes                                   |
| "Rules" menu in the Review card: a switch per rule | The same switch                      | Switch state; a disabled rule shows "Off for this project" in the menu |
| "Ignore here" on a finding                         | "Show ignored", then "Stop ignoring" | The finding moves to the ignored list with its note                    |
| Agent `loom_pcb_check_settings` with `review`      | The same tool or the switches        | `loom_pcb_check_settings` with no arguments                            |
| "Check after each save" review box (with L58)      | Untick it                            | The status chip after a save                                           |

## States

- Never run: "Review this design for common mistakes ERC does not catch." with "Run review".
- Running: the existing check running status with "Reviewing schematic". Static text.
- Clean: "No review findings." plus "8 rules ran. 1 is off for this project." when any are off.
- Findings: grouped by rule, warnings before info. Each row: message, "Why", parts, "Locate",
  "Ignore here".
- Partial data: a notice when a rule could not use all its data, for example "Pin types are
  unavailable because the netlist export failed. Rules that need them were skipped." and the
  skipped rule ids. On tscircuit: "Some parts do not declare pin roles; rules fall back to pin
  names."
- Stale: the result is from older files; "out of date" like ERC and DRC, at half opacity.
- Error: "The review could not run." with the reason; the previous result stays.
- Disabled: no schematic in the design ("This design has no schematic to review."); a
  connection without terminal permission ("This connection needs permission to run terminal
  commands.", `ChecksView.tsx:191`) can read results but not run.
- Loading: the card renders its skeleton until `latestReview` loads.
- Truncated: "Showing the first 500 findings." (same cap as checks).

Severity words: findings are "Warning" or "Note" (info). Review never says "Error", except
`multiple-drivers` on tscircuit, where it stands in for ERC.

## Surfaces and connection modes

Web and desktop. Mobile has no PCB panel. Rules run on the environment host; remote clients see
the same results. On an upstream T3 server there is no PCB panel.

## Decisions

- Deterministic rules only, no model calls. Same input, same findings, so agents can loop on
  them and tests can pin them.
- Heuristics are honest about doubt: every rule lists its false-positive risks in TECHNICAL.md,
  and the "Why" line names what was seen.
- Rules are on by default except `connector-esd` for non-USB connectors (USB only by default).
- Waivers are per project and per design and survive edits, because a finding's id is built
  from the rule, the parts and the net, not positions.
- A separate tool and result, not a third check kind. ERC and DRC consumers decode
  `kind: "erc" | "drc"` and severities `error | warning`; adding "review" and "info" there would
  break older clients and every agent prompt that reads them.
- Checks becomes available for tscircuit, showing only Review.
- Distances (decoupling) use the board only when both parts are placed; unplaced parts skip the
  distance part of the rule.

## Decisions needed from Kyle

None blocking. Recommendations already applied:

- Separate `loom_pcb_review` tool rather than `loom_pcb_check` with `kind: "review"`, for the
  compatibility reason above.
- Default decoupling distance 5 mm from the IC power pin. Common layout guidance says "as close
  as possible"; 5 mm keeps noise low on dense boards without flagging every hand layout.
- The regulator ratings table ships small (six parts) and grows by pull request, each entry with
  a datasheet link and checked date.
