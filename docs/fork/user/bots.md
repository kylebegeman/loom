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
- **Runs in.** A fresh scratch folder, the project checkout, or a new worktree. Leave the project
  empty to choose one each time you run the bot.
- **Time limit and Runs at once.** A run that passes its time limit is stopped and marked
  **Timed out**, keeping what it had written. Extra runs wait in a queue.
- **Available in.** Limit the bot to one project, or leave it available everywhere.

Editing a bot changes later runs only. Each run records the version it used.

## Running a bot

Select a bot and choose **Run**. The form asks for each input and, when the bot does not name a
project, which project to run in. The run appears under **Runs** with its status. **Show reply**
shows the bot's final answer, and **Open thread** shows the whole conversation. Queued and
running runs can be cancelled.

Bot runs stay out of the thread list and do not send completion notifications. **All runs** on
the Bots page lists every bot's recent runs.

## Agents

Agents can list, define and run bots with the `loom_bots_*` tools, and prefer a matching bot over
briefing a new thread. An agent cannot give a bot broader permissions than its own thread has.

## Archiving and deleting

**Archive** hides a bot from the palette and from agents and stops new runs; **Restore** brings
it back. **Delete** removes the bot for good once none of its runs is queued or running. Its
past runs stay listed.
