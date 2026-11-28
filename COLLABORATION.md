# Claude Code and Codex workflow

GitHub `origin/main` is the single source of truth. A feature is not finished or safe merely because it was deployed from a local folder; it must be committed, pushed, reviewed, and merged.

## Start each task

Use a separate branch and preferably a separate worktree for each assistant:

```bash
git fetch origin
git worktree add ../peebee-claude-<task> -b claude/<task> origin/main
git worktree add ../peebee-codex-<task> -b codex/<task> origin/main
```

Never let Claude Code and Codex edit the same worktree. Never start new work directly on `main`.

## Finish each task

1. Run the checks relevant to the changed apps.
2. Commit all files belonging to the feature.
3. Push the feature branch.
4. Merge it into `main` through a pull request.
5. Update local `main` from `origin/main`.
6. Confirm the deploy. Merging to `main` starts the "Deploy to Cloudflare" workflow (`.github/workflows/deploy.yml`), which builds and deploys every app the merge changed (all apps when shared code changed) to production. Check that run in GitHub Actions; a green run means it is live.

To redeploy without a new merge, run the same workflow by hand (Actions → "Deploy to Cloudflare" → Run workflow on `main`, choosing apps or `all`). Deploying from a local machine is a last resort: on Windows the build needs the Visual C++ runtime and symlink rights (Administrator or Developer Mode), which is why the workflow is the normal route.

The app deploy scripts run `scripts/preflight-deploy.mjs`. Deployment stops when the branch is not `main`, files are uncommitted, or local `main` differs from `origin/main`.

## Switching assistants mid-feature

Before moving from one assistant to the other, commit and push the incomplete work to its feature branch. Tell the next assistant the branch name and ask it to continue from that branch. Do not copy the work into another checkout and do not deploy it as an uncommitted working tree.

If another worktree already contains unrelated uncommitted files, leave them in place and create a new worktree from the correct branch.
