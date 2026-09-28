# Claude Code repository rules

Read `COLLABORATION.md` before changing or deploying this repository.

- Fetch `origin` before starting work.
- Work on a `claude/<task>` branch created from current `origin/main`; do not develop directly on `main`.
- Use a separate Git worktree when Codex or another developer has an active worktree.
- Preserve unrelated uncommitted changes. Never reset, overwrite, or include them in a feature commit.
- Commit and push completed work. A local deployment is not a durable handoff.
- Merge through a pull request, then deploy only from a clean `main` that exactly matches `origin/main`.
- Do not bypass `scripts/preflight-deploy.mjs`.
