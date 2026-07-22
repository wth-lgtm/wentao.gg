---
description: Build-check, commit, push, and watch the Vercel deployment through to live
---

Ship the current working changes to production and verify the deploy actually succeeded.

Vercel identifiers (do not look these up again):
- projectId: `prj_fL3T1Zvp9X1ijuYYdIisPvzPMGNM`
- teamId: `team_f7egtlPdX85WgOhuwqgioP1D`
- production domain: https://wentao.gg

Extra context from the user, if any: $ARGUMENTS

Run these steps in order. Stop and report if any step fails — do not push broken code.

1. **Survey.** `git status` and `git diff` to see what's actually changing. If the working tree is clean, check whether local `main` is behind `origin/main`; if there is genuinely nothing to ship, say so and stop.

2. **Check.** Run `npm run check` (production build — the same gate Vercel applies). If it fails, report the errors and stop; do not attempt to push. Offer to fix them.

   Note: `npm run lint` has pre-existing errors (`no-explicit-any` in `InteractiveEffects.tsx`, `set-state-in-effect` in `ThemeProvider.tsx` / `Hero.tsx`) that have never blocked a deploy. Lint is deliberately not part of the gate. Do not "fix" these as a side effect of shipping something unrelated.

3. **Changelog.** Per CLAUDE.md, update the relevant file in `/ideas` with today's date, a summary of the changes, current status, and next steps. `/ideas` is gitignored, so this is a local-only edit and never part of the commit.

4. **Commit and push.** Write a commit message describing *why* the change was made, in the style of recent commits (`git log`). If on `main`, push directly to `main` — that is this project's normal flow. The pre-push hook will re-run the check; that is expected.

5. **Watch the deploy.** Call `mcp__vercel__list_deployments` with the IDs above to find the deployment matching the commit SHA you just pushed. Poll it with `mcp__vercel__get_deployment` until `readyState` leaves `BUILDING`/`QUEUED`. Wait between polls rather than spinning.

6. **Report.**
   - On `ERROR`: call `mcp__vercel__get_deployment_build_logs` and show the actual failure. Diagnose it.
   - On `BLOCKED`: the build never started, so **there will be no build logs** — do not report "no logs" as if it were a mystery. This repo is private, so Vercel enforces "no seat, no build": the commit author must map to a GitHub account with a Vercel seat. Verify with
     `git log -1 --format='%ae'` (must be `268091676+wth-lgtm@users.noreply.github.com`, set repo-locally) and
     `gh api repos/wth-lgtm/wentao.gg/commits/<sha> --jq '.author.login'` (must be `wth-lgtm`, not null).
     If it drifted back to a personal address, re-set `git config user.email`, `git commit --amend --reset-author --no-edit`, and `git push --force-with-lease`.
   - On `READY`: call `mcp__vercel__get_runtime_errors` for the project to confirm nothing is throwing post-deploy, then report the live URL and a one-line summary of what shipped.

Be honest about the outcome. If the build failed or runtime errors appeared, lead with that — do not bury it under a success summary.
