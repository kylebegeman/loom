# Bots

A **bot** is a reusable job: fixed instructions with inputs, plus the model, permissions,
workspace, time limit and number of runs at once that every run uses. Running a bot fills in its
inputs and starts a thread with exactly those settings, so a review or a fix gets the same brief
whether you start it, an agent starts it, or you start it for the tenth time today.

## Opening Bots

- **Sidebar:** the bot icon in the sidebar footer, after Sites.
- **Command palette:** **Go to Bots** opens the page. **Run bot...** lists your bots; picking one
  opens its run form.

Bots live on the server you are connected to and run there. When that server is offline or runs
an older Loom, the page says so.

## Making a bot

Choose **New bot** and fill in:

- **Instructions.** Refer to an input as `{{name}}`. A placeholder that matches no input stays
  as written in the run, so a typo shows in the thread.
- **Inputs.** Each has a name, a label and a type: short text, long text, number, yes or no, or
  a choice from a list. Mark an input required or give it a default.
- **Model, Permissions and Mode.** Every run uses these, not the settings of whoever starts it.
- **Runs in.** A fresh scratch folder, the project checkout, a new worktree, or the checkout it
  is run for. Leave the project empty to choose one each time you run the bot.
- **Time limit and Runs at once.** A run that passes its time limit is stopped and marked
  **Timed out**, keeping what it had written. Extra runs wait in a queue.
- **Available in.** Limit the bot to one project, or leave it available everywhere.
- **Reply.** Text keeps the bot's own words. Verdict asks for a structured answer; see
  [Verdicts](#verdicts).

Editing a bot changes later runs only. Each run records the version it used.

## Starter bots

Loom adds three ready-made bots the first time it starts with Bots:

- **Merge conflict resolver** resolves one conflicted file and stages it, without committing.
  It runs in the checkout it is run for: the thread of the agent that starts it, or the checkout
  you pick when you run it yourself.
- **Reviewer** reviews a path, branch, commit range or pull request through one lens:
  correctness, surfaces or fidelity. It plans only and changes nothing, and answers with a
  verdict: fail with a finding per problem, or pass.
- **Verifier** runs the smallest check that proves or disproves one claim. Its verdict is pass
  when the claim holds, fail when it does not, and needs attention when the check could not
  decide.

Edit a starter like any other bot; its chip then reads **Starter, edited**. When a later Loom
ships better instructions, the chip reads **Newer starter available**. **Restore starter** in the
editor puts back the shipped instructions, inputs and settings and keeps your model and project.
A starter you delete is not added again; restore it from **Starters you removed** on the Bots
page.

## Running a bot

Select a bot and choose **Run**. The form asks for each input and, when the bot does not name a
project, which project to run in. A bot that runs in the checkout it is run for also asks which
checkout: the project root or the worktree of one of the project's threads. The run appears under **Runs** with its status. **Show reply**
shows the bot's final answer, and **Open thread** shows the whole conversation. Queued and
running runs can be cancelled.

Bot runs stay out of the thread list and do not send completion notifications. **All runs** on
the Bots page lists every bot's recent runs.

## Running a bot on many items

**Run on many** runs one bot once per item. Choose where the items come from: pasted lines (one
item per line), tracked files matching a pattern such as `apps/web/src/**/*.tsx`, the files with
merge conflicts in a checkout, open pull requests, or a search of file names or contents. Pick
which input each item fills; the other inputs are shared by every item. The form shows how many
items it found and the first of them before anything starts. A batch holds at most 200 items.

The items run within the bot's **Runs at once** limit, using the bot as it was saved when the
batch started. Open the batch under **Batches** to see one square per item, colored by outcome;
select a square to open that run's thread. **Cancel batch** stops the items that have not
started. Once a batch ends, **Retry failed** reruns only the items that failed, timed out or
were marked Fail, and a verdict bot can also retry the items that need attention. Each item runs
at most five times. **Report** collects every outcome in one Markdown summary you can copy.

Batches also appear in the command palette under **Run bot on many...**, and agents can start
one with a list of inputs.

## Verdicts

A bot whose **Reply** is set to Verdict ends every completed run with one of **Pass**, **Fail**
or **Needs attention**, a short summary and a list of findings, each with an optional file and
line. Loom asks the bot for this format, so its instructions only need to say what counts as a
pass or a failure.

The verdict shows next to the run's status. **Show findings** lists them with a copy button for
each file and line, followed by the raw reply. Use **All**, **Pass**, **Fail** and **Needs
attention** above the runs to show only runs with that verdict.

A reply Loom cannot read as a verdict is marked **Needs attention** and shows the raw reply in
full, so nothing the bot said is lost. Runs that fail, time out or are cancelled have no verdict.
Agents get the verdict with the run's reply, and a result posted to a thread leads with it.

## Inbox

The **Inbox** tab collects the runs that need you: runs that failed or timed out, and runs whose
verdict is **Needs attention**. The Bots icon in the sidebar footer shows how many there are.

- **Retry** runs the bot again with the same inputs. **Retry on another model** does the same on
  a model you choose for that one retry; the bot keeps its own model. A retried run leaves the
  inbox, and a run from a batch hands its place in the batch to the retry.
- **Dismiss** clears a run you have dealt with. **Dismiss all shown** clears the whole list at
  once. Turn on **Dismissed** to see cleared runs and **Restore** one.
- **Open as thread** copies the run into an ordinary thread in your sidebar, so you can carry on
  the conversation yourself. Opening the same run again goes back to that thread.

A run that stops to ask for an approval or an answer shows under **Waiting for you** at the top,
because nobody would see the question otherwise. **Answer** opens its thread. Agents read the
inbox, retry and dismiss runs with `loom_bots_inbox`, `loom_bots_retry` and `loom_bots_dismiss`.

## Run a bot from a thread

Type `/bot:` in a thread's composer to list the bots you can run there, next to commands and
skills. Picking one opens its form above the composer. The run uses the thread's project, and a
bot that runs in the checkout it is run for uses the thread's checkout. Turn on **Post the result
to this thread** to get the bot's reply as a message in the thread when the run ends; if an
agent is working there, it reads the result on its next turn.

While runs started from the thread are queued or running, a bot chip in the composer footer
counts them. Open it to see each run, cancel one, or open it on the Bots page. Bots are not
offered in a new thread until its first message is sent.

## Save a thread as a bot

When a thread did a job you want again, choose **Save as bot…** from the thread's menu or its
sidebar context menu, or run **Save this thread as a bot** from the command palette. The Bots page
opens a new bot filled from the thread: its first message becomes the instructions, file paths and
pull request numbers in it become inputs, and the thread's model, modes and workspace carry over.
**Refine with model** asks a model to tidy the name, description, instructions and inputs; check its
changes before saving. Nothing is saved until you choose **Save bot**. An input's description is
shown as a hint under its field when the bot runs.

When you open three threads with the same request in two weeks, differing only in files, numbers or
quoted values, the Bots page suggests making it a bot. **Create** opens the same draft; **Dismiss**
hides the suggestion, which comes back once if you keep opening that kind of thread. Find hidden
ones under **Dismissed suggestions** and choose **Restore**. Agents draft a bot with
`loom_bots_draft_from_thread` and read suggestions with `loom_bots_suggestions`.

## Usage and budgets

The **Usage** tab lists every bot that ran in the last 24 hours, 7 days or 30 days: runs, how
often it passed (or, for bots without verdicts, completed), its median duration and its share of
bot tokens. Open a bot to see its outcomes, slowest run and tokens, and the same numbers per
model, which helps when deciding whether **Retry on another model** is worth it. Some providers do
not report every token, so figures marked "at least" are lower bounds. The Usage page shows a
short Bots section under Totals with bot tokens for the shown window and the top three bots.

In the bot editor, **Runs per 24 hours** and **Tokens per 24 hours** set an optional budget;
leave a field empty for no limit. The window is rolling, so it never resets all at once. A run
that would pass a limit is refused with how long to wait, and a batch pauses and continues on its
own when the window allows. Runs already in progress are never stopped, so the token limit can be
passed by the runs that were in flight when it was reached. Agents read the same numbers with
`loom_bots_usage`.

## Triggers

A trigger runs a bot when something happens. Open a bot, choose the **Triggers** tab and **New
trigger**, or run **New bot trigger...** from the command palette. Pick what starts it:

- **Pull request checks fail**: a linked pull request's checks turn failing, and again for each
  new failing commit.
- **Pull request opens**: the first time Loom sees a linked pull request open.
- **Thread settles**: a thread in the chosen project settles. Bot runs never start it.
- **Upstream merge conflicts**: `scripts/fork/loom.sh integrate` hits conflicts. Each conflicting
  file runs as one item of a batch.
- **Webhook request**: any service posts to the trigger's address.
- **Schedule**: every few minutes, or at a local time of day on chosen weekdays.

Pull request triggers can be narrowed to a project, a repository and a branch pattern such as
`release/*`. Loom notices a watched pull request within a few minutes; one nobody watches can be
noticed up to 15 minutes late. A trigger never fires for an event from before it was saved.

Under **Inputs**, map each of the bot's inputs to a field of the event, a fixed value or its
default. Every required input needs one. For a webhook, name fields as `body.pull_request.number`,
`headers.x-github-event` or `query.ref`.

Each trigger fires once per event, however often Loom sees it, and waits out its **Cooldown** and
**Runs per day, at most** before firing again. The bot's budget still applies. A firing that is
held back becomes a skipped run in the inbox with the reason, and **Firings** on the trigger lists
recent firings with the run each one started.

**Version to run** chooses which version of the bot a trigger starts: the version it was saved
with, the latest version, or the stable version (the latest while none is marked). A trigger
pinned to an older version keeps running it; choose **Use version N** on the trigger to move it to
the current one. A merge conflict trigger runs a batch, which always uses the latest version, so
pinned to an older one its firings are skipped.

**Starts** chooses whether a trigger runs the bot or a pipeline that begins with it; the inputs
then map to the pipeline's. A pipeline trigger runs the pipeline's own steps and versions, and
cannot start from merge conflicts. This choice is fixed once the trigger is saved.

**Test** fires the trigger once with event fields you enter. It skips the filters, cooldown and
daily limit, and starts a real run.

### Webhooks

After saving a webhook or merge conflict trigger, its address is shown on the trigger with
**Copy**; only people who can run bots see it. To start a bot from GitHub, add a webhook in the
repository's settings, paste the address as the payload URL, choose `application/json`, and set a
secret. On the trigger, turn on the signature check with the header `x-hub-signature-256`,
prefix `sha256=` and the same secret. A delivery GitHub resends fires once. **Rotate** replaces
the address; the old one stops working.

For merge conflicts, set `LOOM_BOTS_CONFLICT_HOOK` to the address before running
`scripts/fork/loom.sh integrate`. The script posts the conflicting files and carries on whether or
not the post succeeds.

## Versions and replay

Every save keeps the bot as a numbered version, and every run records the version it used. Open a
bot and choose the **History** tab to see each version, who saved it, what it changed, and how its
runs went. **Compare with vN** shows the brief as a diff and every other changed field side by
side. **Restore** saves an old version again as a new one, so nothing in the history is lost.
Version numbers never repeat, even after a bot is deleted and made again.

**Mark stable** flags the version you trust. Triggers set to the stable version run it while you
keep editing; without one, they run the latest.

Mark a finished run **Good** or **Bad** on its row. In the editor, **Suggest an edit** asks the
bot's model to change the brief so later runs avoid what the Bad runs got wrong, keeping what the
Good runs got right. It needs at least one Bad run, takes up to three minutes, and fills the
editor without saving.

To check an edit before saving it, choose **Try on past runs** in the editor, or **Replay** on a
version in History. Pick up to 20 finished runs (rated runs come first) and Loom runs each one's
inputs again, then shows the new result beside the original: **Fixed** or **Broke** when a
verdict changed between passing and failing, **Same** or **Changed** otherwise. Replays count
toward the bot's budget, and the whole replay must fit in it before it starts. Replay runs appear
in the run list with a **Replay** badge but never reach the inbox. **Cancel replay** stops runs in
flight and skips the rest.

## Pipelines

A pipeline runs bots one after another and passes what each found to the next, such as review,
fix, verify. Choose the **Pipelines** tab on the Bots page and **New pipeline**. Give it inputs as
you would a bot, then add steps. Each step runs one bot and fills that bot's inputs from
templates:

- `{{input.target}}`: a pipeline input.
- `{{steps.review.summary}}`, `{{steps.review.findings}}`, `{{steps.review.verdict}}` and
  `{{steps.review.result}}`: what an earlier step returned.
- `{{item}}`: the item a step runs on when it runs once per item.
- `{{round}}`: the current round of a loop, starting at 1.

The editor checks the pipeline as you type and marks each problem on its step. Warnings, such as
a step that edits in its own worktree and so will not see an earlier step's changes, do not block
saving.

Turn on **Run once per item, as a batch** to run a step once per finding of an earlier step, or
once per line of a text input. For a step whose bot returns a verdict, **On a fail verdict** and
**On needs attention** choose whether the pipeline stops, carries on, or goes back to an earlier
step for another round, at most 5 rounds. **When the run fails or times out** chooses the same
for errors. A step can pin a version of its bot and run on another model than the bot's own.

**Run** asks for the pipeline's inputs and, when a step needs one, a project. The run view shows
each step as it goes, with its verdict, links to its run or batch, and a report once the pipeline
ends. A step held back by its bot's budget waits until the budget allows it. **Cancel pipeline**
stops the run in flight. A pipeline that stopped or failed shows one inbox item, its stopping
run, with **Open pipeline run**; **Resume** there runs the stopped step again without repeating
earlier steps. At most 5 pipelines run at once. Pipelines keep running across server restarts.

Run **Run pipeline...** from the command palette to start one from anywhere. Loom adds a
**Review, fix, verify** starter pipeline, with a **Fixer** bot, when the starter reviewer and
verifier bots exist.

## Bots on your other computers

When this computer is connected to a Library that supports shared bots, a bot can be shared once
and run on any of your computers. Select the bot and choose **Share to Library** in its
**Library** panel. Every computer connected to the same Library gets a copy within a few minutes,
marked **From the Library**, and edits on any computer reach the others. A bot scoped to a
project needs that project in the Library first. **Stop sharing** leaves every computer its copy
as an ordinary bot, and deleting a shared bot on one computer removes only that computer's copy.

A computer runs bots for the others only after you allow it. On that computer, open the
**Computers** tab on the Bots page, turn on **Run bots for other computers**, and choose the
highest permissions their runs may use. A run that asks for more is refused. **Sync shared bots**
fetches changes from the Library at once instead of waiting.

**Run**, **Run on many** and each pipeline step then offer **Run on**: this computer, one of your
other computers, or **Best available**, the ready computer with the most free slots. Each
computer shows whether it is ready, and why not: offline, remote runs off, the bot's model not
set up there, or the bot's project or Vault items missing. In a batch, each item picks its own
computer. A run on another computer appears on both: here as **Ran on** that computer, there as
**Requested by** this one, and **Open thread** opens the thread where it ran. A remote run uses
the shared version of the bot, not a version pinned on this computer, and works in that
computer's own copy of the project rather than in one of this computer's checkouts.

Secrets never leave a computer. A bot that needs one declares a **Vault slot** in its editor, such
as an npm token it may use. Each computer binds that slot to one of its own Vault items in the
bot's **Library** panel, and a run is refused until the slot is bound. A computer that runs the bot
on a model of its own keeps that choice when it saves; the others keep the shared model.

## Agents

Agents can list, define and run bots with the `loom_bots_*` tools, and prefer a matching bot over
briefing a new thread. An agent cannot give a bot broader permissions than its own thread has.
An agent that starts a run without waiting for it can ask to be told when it ends; the result
then arrives in its thread like a finished delegated task. A bot run cannot start another bot.
Agents list and save triggers with `loom_bots_triggers`, `loom_bots_save_trigger` and
`loom_bots_set_trigger_enabled`.
They read history with `loom_bots_versions`, rate runs with `loom_bots_rate_run`, and start a
replay with `loom_bots_replay`, then follow it with `loom_bots_replay_status`.
Pipelines have `loom_bots_pipelines`, `loom_bots_define_pipeline`, `loom_bots_run_pipeline`,
`loom_bots_pipeline_status`, `loom_bots_pipeline_cancel` and `loom_bots_pipeline_resume`.
Agents share a bot with `loom_bots_share`, list where it can run with `loom_bots_targets`, and
pass a `target` to `loom_bots_run` and `loom_bots_run_batch`.

## Archiving and deleting

**Archive** hides a bot from the palette and from agents and stops new runs; **Restore** brings
it back. **Delete** removes the bot for good once none of its runs is queued or running. Its
past runs stay listed.
