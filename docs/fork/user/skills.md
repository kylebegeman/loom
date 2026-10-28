# Skills

Open Skills from a conversation's panel picker (K), the command palette, or
Settings > Tools. Select a project to include its skills. Each computer has its own
inventory. Web and desktop manage skills; mobile can invoke skills already available
to its provider.

The inventory shows which provider accounts see a skill, its effective availability,
folder, sharing, source revision and validation problems. Search or filter by account,
scope and state. Refresh after changing files outside Loom. A failed account probe
leaves the other accounts usable.

Claude supports project, account and all-account enablement. Codex enablement applies
to every project using that Codex home. Other providers and plugin or system skills
remain managed by their provider. Provider catalogs determine what agents can use.

## Install and update

In Sources, enter a public HTTPS git URL and optional branch, tag or commit. Fetching
lists skill folders at an exact revision; it does not run the repository's code.
Choose skills and an install location. Review scripts before invoking a skill that
contains them. Loom copies complete folders, executable modes and license notices.
Unsupported links, submodules and conflicting destinations stop the install.

Fetch the source again, then review an installed skill's update before applying it.
The review includes file changes and text diffs. Local modifications require an explicit
replacement choice; a changed folder or source invalidates an old review. Previous
folders are preserved in Loom's trash. Remove a Loom-installed or Lab-created skill
with Move to trash, and retain the reported path if you want to restore it by hand.

## Create, edit and try a skill

Use the Lab to choose a name, description, instructions and install location. Only I
can start it adds provider-supported explicit invocation metadata. The Claude slash
menu can also be hidden. Check the chosen provider's catalog to confirm availability.

Open an editable skill from the inventory or Lab. Validation runs while editing.
Save writes SKILL.md only. If someone changed the file, reload it or explicitly overwrite
with your changes. Unsaved edits stay in the Lab when switching tabs; save or reload
before changing project context.

Choose a test project and an available provider account/model, enter a sample prompt,
and select Test in new thread. Loom opens a draft containing `$skill-name` and your
prompt. Send it when ready. Start a new session after changing a skill, since running
agents may retain the earlier version.

Skill folders are installed on the selected computer. They are not synchronized to
other computers, and source installers and plugin marketplaces are not run by Loom.

## Loom workflow skills

This checkout includes a curated, MIT-licensed workflow pack with pinned source
revisions. Its `loom-workflows` catalog records provider/tool compatibility and local
dependencies. Delivery workflows such as `$full-stop` and `$full-send` require explicit
invocation. They retain the current task's permissions, requested model and ownership.
Use `$recall` for a named topic across Library history, or `$ketchup` for a read-only
catch-up with source links and actual decisions waiting on you.
