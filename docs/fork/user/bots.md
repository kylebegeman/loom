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

## Agents

Agents can list, define and run bots with the `loom_bots_*` tools, and prefer a matching bot over
briefing a new thread. An agent cannot give a bot broader permissions than its own thread has.
An agent that starts a run without waiting for it can ask to be told when it ends; the result
then arrives in its thread like a finished delegated task. A bot run cannot start another bot.

## Archiving and deleting

**Archive** hides a bot from the palette and from agents and stops new runs; **Restore** brings
it back. **Delete** removes the bot for good once none of its runs is queued or running. Its
past runs stay listed.
