# Claude Code repository rules

Read `COLLABORATION.md` before changing or deploying this repository.

- Fetch `origin` before starting work.
- Work on a `claude/<task>` branch created from current `origin/main`; do not develop directly on `main`.
- Use a separate Git worktree when Codex or another developer has an active worktree.
- Preserve unrelated uncommitted changes. Never reset, overwrite, or include them in a feature commit.
- Commit and push completed work. A local deployment is not a durable handoff.
- Merge through a pull request, then deploy only from a clean `main` that exactly matches `origin/main`.
- Do not bypass `scripts/preflight-deploy.mjs`.

## UI rules

- **Fields are one solid colour, edge to edge.** An input and its box must be the same shade — never nest an input of one tone inside a box of another, and never put a tinted chip or button inside a field. Single-element inputs already get the app's field fill. For a field made of several parts (icon + input + button), put `field-box` on the wrapper: it owns the single fill and makes the inputs inside transparent. (A bare `bg-transparent` on an input does not work — the global input rule outranks Tailwind utilities.)
- Keep to the existing colour tokens (cream, ink, gold, `surface-*`); don't introduce new colours.
