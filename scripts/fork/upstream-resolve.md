Resolve the merge conflict in `{{file}}`. The merge brings upstream T3 Code {{tag}}
(pingdotgg/t3code) into Loom, Kyle's additive fork of it. Several sessions run at once, one per
conflicted file, so work only on this file in the current checkout.

1. Read the conflict with `git diff -- {{file}}`, then the three sides: `git show :1:{{file}}`
   (the merge base), `git show :2:{{file}}` (Loom) and `git show :3:{{file}}` (upstream). Read
   the commits listed below with `git show <sha> -- {{file}}` until you know what each side
   meant. FORK.md and docs/fork/packets/CONVENTIONS.md explain the fork's rules.
2. Keep both sides' intent. Upstream's changes to its own code always survive. Loom's changes
   are the lines its side changed from the merge base, most of them marked `fork: <name>`.
   Reapply each one onto upstream's new code and keep its marker. Never rewrite, reformat or
   drop upstream code to make Loom's change fit.
3. When upstream moved or renamed code that Loom changed, carry Loom's change to its new home,
   in another file if need be, instead of dropping it. If upstream deleted this file, delete it
   too, after moving any Loom change that must survive to where upstream's code went.
4. When upstream now does what a Loom change did, keep upstream's version and drop Loom's
   duplicate, unless Loom's has behavior upstream's lacks. Say which in your reply.
5. Remove every conflict marker. Do not run `git add`, `commit`, `checkout`, `stash` or `merge`,
   install dependencies or run checks: once every file is resolved, the integration stages
   them and runs the fork's checks, and a separate session reviews the result.

Reply with one short paragraph per conflict: what each side did and what you kept. End with a
line that is exactly `RESOLVED`. If a conflict needs a decision only Kyle can make, leave its
markers in place and end with `UNRESOLVED: <the decision>` instead.
