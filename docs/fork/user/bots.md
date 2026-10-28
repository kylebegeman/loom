# Bots

A **bot** is a reusable job: fixed instructions with inputs, plus the model, permissions,
workspace, time limit and number of runs at once that every run uses. Running a bot fills in its
inputs and starts a thread with exactly those settings, so a review or a fix gets the same brief
whether you start it, an agent starts it, or you start it for the tenth time today.

## Opening Bots

- **Web and desktop:** the bot icon in the sidebar footer, after Sites. A dot on it means runs
  need you.
- **Command palette:** **Go to Bots** opens the page, and **Bot runs that need you**, **Bot
  pipelines** and **Bot triggers** open those views. **Open bot...**, **Edit bot...**, **Run
  bot...** and **Open pipeline...** list your bots or pipelines and open the one you pick.

On web and desktop, the Bots page has four tabs:

- **Bots** shows every bot as **Cards** or a **List**. Search by name, description or input, and
  use **Archived** to see archived bots. The **Display** menu sorts the bots and sets **Usage
  over**, the window for every usage figure on the page.
- **Runs** lists runs. **All runs** is every bot's recent runs, **Needs you** is the runs waiting
  on a person, and **Batches** is the runs started on many items. See [Runs](#runs) and [Needs
  you](#needs-you).
- **Pipelines** and **Triggers** list every pipeline and trigger, with **New pipeline** and **New
  trigger**.

Open a bot for its own page. **Overview** holds its brief, inputs and settings, with its
**Triggers**, **Pipelines**, **Usage** and **Sharing** beside them. **Runs** lists only its runs,
and **Versions** its saved versions. The page header has **Run**, **Run on many** and **Edit**;
its more menu has **Add trigger**, **Copy link**, **Archive** and **Delete**.

**Computers** at the top of the page opens a sheet for running bots across your computers; see
[Bots on your other computers](#bots-on-your-other-computers).

On mobile, open **Bots** above the thread list or in **Settings > Agents > Bots**. Choose the
computer that owns your bots. Open a bot to edit or run it; its management actions include
versions and replay, triggers, batches, usage, sharing and local Vault bindings. The Bots tools
menu also opens pipelines and the inbox. A thread's menu offers **Run bot** and **Create bot
from thread**, keeping that thread's checkout as the run context.

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
A starter you delete is not added again; restore it from **Starters you removed** on the **Bots**
tab.

## Running a bot

Open a bot and choose **Run**. The form asks for each input and, when the bot does not name a
project, which project to run in. A bot that runs in the checkout it is run for also asks which
checkout: the project root or the worktree of one of the project's threads.

Bot runs stay out of the thread list and do not send completion or failure notifications. A run
that stops to ask for an approval or an answer does notify you.

## Runs

**Runs** lists runs newest first, with what is running now at the top. **Filters** narrows the
list to one verdict or one bot; the filters stay in the page's address, so a narrowed list can be
shared or reloaded.

Select a run to open it in a side panel: its status and verdict, its inputs, findings, reply and
details such as model, tokens, duration and what started it. **Open thread** shows the whole
conversation, **Cancel run** stops one that is queued or running, and **Run again** opens the run
form with the same inputs. Mark a finished run **Good** or **Bad** under **Feedback**; see
[Versions and replay](#versions-and-replay). The more menu has **Copy link** and **Copy run ID**.

## Running a bot on many items

**Run on many** runs one bot once per item. Choose where the items come from: pasted lines (one
item per line), tracked files matching a pattern such as `apps/web/src/**/*.tsx`, the files with
merge conflicts in a checkout, open pull requests, or a search of file names or contents. Pick
which input each item fills; the other inputs are shared by every item. The form shows how many
items it found and the first of them before anything starts. A batch holds at most 200 items.

The items run within the bot's **Runs at once** limit, using the bot as it was saved when the
batch started. Open the batch from **Runs > Batches** to see one square per item, colored by
outcome; select a square to open that item's run. **Cancel batch** stops the items that have not
started. Once a batch ends, **Retry N failed** reruns only the items that failed, timed out or
were marked Fail. Its menu can include the items that need attention, or use a version saved since
the batch started. Each item runs at most five times. **Report** collects every outcome in one
Markdown summary you can **Copy**.

Batches also appear in the command palette under **Run bot on many...**, and agents can start
one with a list of inputs.

## Verdicts

A bot whose **Reply** is set to Verdict ends every completed run with one of **Pass**, **Fail**
or **Needs attention**, a short summary and a list of findings, each with an optional file and
line. Loom asks the bot for this format, so its instructions only need to say what counts as a
pass or a failure.

The verdict shows next to the run's status. A run's side panel lists its findings, each with its
file and line, followed by the raw reply. **Filters** in **Runs** shows only runs with one verdict.

A reply Loom cannot read as a verdict is marked **Needs attention** and shows the raw reply in
full, so nothing the bot said is lost. Runs that fail, time out or are cancelled have no verdict.
Agents get the verdict with the run's reply, and a result posted to a thread leads with it.

## Needs you

**Runs > Needs you** collects the runs that need a person, grouped as **Waiting on you**, **Failed
or timed out**, **Undecided** (a verdict of **Needs attention**) and **Stopped pipelines**. The
same runs lead the **Bots** tab and each bot's page, and a dot on the Bots icon in the sidebar
footer says there are some.

- A run that stops to ask for an approval or an answer is **Waiting on you**, because nobody would
  see the question otherwise. **Answer** opens its thread.
- A failed run names how its provider failed when it said, such as **Usage limit** or
  **Connection dropped**, and its error gives the provider's reason.
- A run an agent started that posted its result back to that agent's thread is **Handled by the
  calling agent**: the agent already has the outcome. The group stays folded at the bottom and
  does not count toward the sidebar dot. **Dismiss N** clears it.
- **Retry** runs the bot again with the same inputs. **Retry on another model…** in a run's side
  panel does the same on a model you choose for that one retry; the bot keeps its own model. A
  retried run leaves Needs you, and a run from a batch hands its place in the batch to the retry.
- **Dismiss N** on a group clears every run in it once you have dealt with them, and **Dismiss
  from Needs you** in a run's side panel clears one. **Show dismissed** lists cleared runs, where
  **Restore** puts one back.
- **Continue in a thread**, in a run's side panel, copies the run into an ordinary thread in your
  sidebar, so you can carry on the conversation yourself. **Open continued thread** then goes
  back to it.

Agents read this queue, retry and dismiss runs with `loom_bots_inbox`, `loom_bots_retry` and
`loom_bots_dismiss`.

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
changes before saving. Nothing is saved until you choose **Create bot**. An input's description is
shown as a hint under its field when the bot runs.

When you open three threads with the same request in two weeks, differing only in files, numbers or
quoted values, **Suggested bots** on the **Bots** tab offers to make it a bot. **Create** opens the
same draft; dismissing hides the suggestion, which comes back once if you keep opening that kind of
thread. Choose **Dismissed** to find hidden ones and **Restore** one. Agents draft a bot with
`loom_bots_draft_from_thread` and read suggestions with `loom_bots_suggestions`.

## Usage and budgets

The top of the Bots page sums up bot runs and tokens over a window: the past 24 hours, 7 days, 30
days or 90 days. Choose the window under **Usage over** in the **Display** menu, or in the
**Usage** panel on a bot's page; both set the same window. Sort the **Bots** tab by **Most tokens** to
see which bots cost the most. A bot's **Usage** panel shows its runs, outcomes, how often it passed
(or, for bots without verdicts, completed), its duration and tokens, and the same numbers per
model, which helps when deciding whether **Retry on another model…** is worth it. Some providers
do not report every token, so figures marked "at least" are lower bounds. The Usage page shows a
short Bots section with bot tokens for the shown window and the top bots.

In the bot editor, **Runs per 24 hours** and **Tokens per 24 hours** set an optional budget;
leave a field empty for no limit. A bot's **Usage** panel shows how much of it the last 24 hours
used. The window is rolling, so it never resets all at once. A run
that would pass a limit is refused with how long to wait, and a batch pauses and continues on its
own when the window allows. Runs already in progress are never stopped, so the token limit can be
passed by the runs that were in flight when it was reached. Agents read the same numbers with
`loom_bots_usage`.

## Triggers

A trigger runs a bot when something happens. Choose **New trigger** on the **Triggers** tab,
**Add trigger** in a bot's more menu, or run **New bot trigger...** from the command palette. A
bot's own triggers are listed in its **Triggers** panel, and the **Triggers** tab filters every
trigger by kind and by whether it is on or **Paused**. Pick what starts it:

- **Pull request checks fail**: a linked pull request's checks turn failing, and again for each
  new failing commit.
- **Pull request opens**: the first time Loom sees a linked pull request open.
- **Thread settles**: a thread in the chosen project settles. Bot runs never start it.
- **Webhook request**: any service posts to the trigger's address.
- **Schedule**: every few minutes, or at a local time of day on chosen weekdays.

Pull request triggers can be narrowed to a project, a repository and a branch pattern such as
`release/*`. Loom notices a watched pull request within a few minutes; one nobody watches can be
noticed up to 15 minutes late. A trigger never fires for an event from before it was saved.

Under **Inputs**, map each of the bot's inputs to a field of the event, a fixed value or its
default. Every required input needs one. For a webhook, name fields as `body.pull_request.number`,
`headers.x-github-event` or `query.ref`.

Each trigger fires once per event, however often Loom sees it, and respects its **Limits**: **Time
between runs, at least** and **Runs a day, at most**. The bot's budget still applies. A firing that
is held back becomes a skipped run in Needs you with the reason, and **Firings** on the trigger
lists recent firings with the run each one started.

**Version** chooses which version of the bot a trigger starts: the version it was saved with,
**Latest**, or **Stable** (the latest while none is marked). A trigger
pinned to an older version keeps running it; choose **Use version N** on the trigger to move it to
the current one.

**What it runs** chooses whether a trigger runs the bot or a pipeline that starts with it; the
inputs then map to the pipeline's. A pipeline trigger runs the pipeline's own steps and versions.
This choice is fixed once the trigger is saved. Deleting a
pipeline deletes its triggers.

**Fire once**, under **Test firing** on a trigger, fires it once with event fields you enter. It
skips the filters and limits, and starts a real run.

### Webhooks

After saving a webhook trigger, its address is shown on the trigger with
**Copy**; only people who can run bots see it. To start a bot from GitHub, add a webhook in the
repository's settings, paste the address as the payload URL, choose `application/json`, and set a
secret. In the trigger's editor, turn on **Check a signature** with the header
`x-hub-signature-256`, prefix `sha256=` and the same secret. A delivery that GitHub, GitLab,
Linear or a Standard Webhooks sender resends fires once; a service that sends no delivery id fires
on every request. **New address** replaces the address; the old one stops working.

Refused deliveries show **Last delivery refused** on the trigger, with the reason and count.
Repeated refusals within one minute share a history entry. Loom keeps no request body or secret
in these entries. Saved merge-conflict triggers show **Retired** and can be deleted; they cannot
be enabled or fired.

## Versions and replay

Every save keeps the bot as a numbered version, and every run records the version it used. Open a
bot and choose the **Versions** tab to see each version, who saved it, what it changed, and how
its runs went. **Compare vN with** picks another version and shows the brief as a diff and every
other changed field side by side. **Restore as vN…** saves an old version again as a new one, so
nothing in the history is lost. Version numbers never repeat, even after a bot is deleted and made
again.

**Mark as stable** flags the version you trust. Triggers set to the stable version run it while you
keep editing; without one, they run the latest.

Mark a finished run **Good** or **Bad** in its side panel. In the editor, **Suggest an edit** asks the
bot's model to change the brief so later runs avoid what the Bad runs got wrong, keeping what the
Good runs got right. It needs at least one Bad run, takes up to three minutes, and fills the
editor without saving.

To check an edit before saving it, choose **Try on past runs** in the editor, or **Try on past
runs…** on a version in **Versions**. Pick up to 20 finished runs (rated runs come first) and Loom
runs each one's inputs again, then shows the new result beside the original: **Better** or
**Worse** when a verdict changed between passing and failing, **Same** or **Changed** otherwise.
Replays count toward the bot's budget, and the whole replay must fit in it before it starts.
Replay runs appear in the run list marked as replays but never reach Needs you. **Cancel replay** stops runs in
flight and skips the rest.

## Pipelines

A pipeline runs bots one after another and passes what each found to the next, such as review,
fix, verify. Choose **New pipeline** on the **Pipelines** tab; the builder opens as its own page.
Give it inputs as you would a bot, then **Add a step**. Each step runs one bot and fills that
bot's inputs from templates:

- `{{input.target}}`: a pipeline input.
- `{{steps.review.summary}}`, `{{steps.review.findings}}`, `{{steps.review.verdict}}` and
  `{{steps.review.result}}`: what an earlier step returned.
- `{{item}}`: the item a step runs on when it runs once per item.
- `{{round}}`: the current round of a loop, starting at 1.

The editor checks the pipeline as you type and marks each problem on its step. Warnings, such as
a step that edits in its own worktree and so will not see an earlier step's changes, do not block
saving.

Under a step's **Runs**, choose **Once per item** to run it as a batch, once per finding of an
earlier step or once per line of a text input. Under **When it ends**, for a step whose bot
returns a verdict, **If it fails** and **If it needs attention** choose **Stop the pipeline**,
**Carry on**, or **Go back to a step** for another round, at most 5 rounds. **If its run errors**
chooses the same for a run that fails or times out. A step can pin a version of its bot and run
on another model than the bot's own.

**Run** asks for the pipeline's inputs and, when a step needs one, a project. The run view shows
each step as it goes, with its verdict, links to its run or batch, and a report once the pipeline
ends. A step held back by its bot's budget waits until the budget allows it. **Cancel run** stops
the run in flight. A pipeline that stopped or failed shows under **Stopped pipelines** in Needs
you with **Open pipeline run**; **Resume** runs the stopped step again without repeating earlier
steps. At most 5 pipelines run at once. Pipelines keep running across server restarts.

Run **Run pipeline...** from the command palette to start one from anywhere. Loom adds a
**Review, fix, verify** starter pipeline, with a **Fixer** bot, when the starter reviewer and
verifier bots exist.

## Bots on your other computers

When this computer is connected to a Library that supports shared bots, a bot can be shared once
and run on any of your computers. Open the bot and choose **Share** in its **Sharing** panel.
Every computer connected to the same Library gets a copy within a few minutes, marked **In the
Library**, and edits on any computer reach the others. A bot scoped to a
project needs that project in the Library first. **Stop sharing** leaves every computer its copy
as an ordinary bot, and deleting a shared bot on one computer removes only that computer's copy.

A computer runs bots for the others only after you allow it. On that computer, choose
**Computers** at the top of the Bots page, turn on **Run bots for other computers**, and choose
the **Highest permissions** their runs may use. A run that asks for more is refused. Turning the
switch off refuses new runs and those still waiting to start; runs already going finish. The same
sheet lists your computers, your shared bots and recent remote runs, and **Sync now** fetches
changes from the Library at once instead of waiting.

**Run**, **Run on many** and each pipeline step then offer **Run on**: this computer, one of your
other computers, or **Best available**, the ready computer with the most free slots. Each
computer shows whether it is ready, and why not: offline, remote runs off, the bot's model not
set up there, or the bot's project or Vault items missing. In a batch, each item picks its own
computer. A run on another computer appears on both: here as **Ran on** that computer, there as
**Asked for by** this one, and **Open thread** opens the thread where it ran. A remote run uses
the shared version of the bot, not a version pinned on this computer, and works in that
computer's own copy of the project rather than in one of this computer's checkouts.

Secrets never leave a computer. A bot that needs one declares a **Vault slot** in its editor, such
as an npm token it may use. Each computer binds that slot to one of its own Vault items under
**Credentials on this computer** in the bot's **Sharing** panel, and a run is refused until the slot is bound. A computer that runs the bot
on a model of its own keeps that choice when it saves; the others keep the shared model.

## Agents

Agents can list, define and run bots with the `loom_bots_*` tools, and prefer a matching bot over
briefing a new thread. An agent cannot give a bot broader permissions than its own thread has.
An agent that starts a run without waiting for it can ask to be told when it ends; the result
then arrives in its thread like a finished delegated task. A bot run cannot start another bot,
change a bot or pipeline, or start or schedule other threads.
Agents list and save triggers with `loom_bots_triggers`, `loom_bots_save_trigger` and
`loom_bots_set_trigger_enabled`. An agent can only turn on a trigger whose bot, at the version the
trigger runs, or whose every pipeline step fits within its own permissions and the permissions of
whoever saved the trigger, and a bot run cannot save or turn on triggers.
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

## Engineering workflows

When the starter Reviewer and Verifier exist, Loom also offers Engineering review,
Intake and reproduce, Upstream compatibility, and Performance regression review
pipelines. These use your saved bot versions and the existing run history, budget,
pause and cancellation controls. Your edits and deleted starters stay yours.

Create a trigger from a pipeline to make it recurring. The suggested weekly schedule
starts disabled, with one run per day and a twelve-hour cooldown. Choose the exact
execution project, complete the inputs, review permissions and limits, then enable it.
Schedules run on the selected computer while its Loom server is running.

Intake uses a signed webhook and fixed target, Library project, component and project
revision. Send a stable delivery ID and a JSON report with `libraryProjectId`,
`componentId`, `projectRevision`, `reportId`, `source` and `report`. Map `source` and
`report` from the body. Reports outside the fixed scope are refused; retries with the
same source/report ID are deduplicated. It triages ownership and evidence, then
reproduces a confirmed issue. A separate authorized task owns any fix or publication.

Performance review needs comparable baseline and candidate artifacts with at least
five observations per scenario. Missing work, errors or incomparable samples need
attention. It does not manufacture a passing benchmark. Upstream compatibility
reviews exact source refs and ownership boundaries; the nightly integration remains
the only unattended merge workflow.

For hosted intake, see [Connect Grok Bot](grok-bot.md).
