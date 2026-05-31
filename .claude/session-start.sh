#!/usr/bin/env bash
# SessionStart hook for TaskApp.
# Prints a short briefing that Claude Code injects as additionalContext
# at session start. Keep it tight — every line costs tokens on every
# session and tends to ossify. When an item ships, edit this file.

set -euo pipefail

cd /home/user/TaskApp 2>/dev/null || exit 0

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
HEAD_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")
DIRTY=""
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  DIRTY=" (dirty)"
fi

cat <<EOF
# TaskApp session briefing

## Git state
- Branch: \`${CURRENT_BRANCH}\` @ \`${HEAD_SHA}\`${DIRTY}
- If on \`main\`, fetch + pull before starting work (stale-base PRs are
  the #1 cause of duplicate work — see PR #211 post-mortem).

## Ship-loop reminder (durable rule from CLAUDE.md)
For any task that produces a code change:
  commit → push → open a **non-draft** PR → let CI run →
  if all required checks go green, squash-merge →
  delete the branch (local + remote) → move to the next task.
If there is no next task, prompt the operator.
Don't pause for permission between steps unless something fails or is
architecturally ambiguous. Don't open PRs as drafts. Don't merge on red.

## Remaining M-sized ROADMAP candidates (as of 2026-05-31)
Tonight's XS/S queue is cleared (PRs #212–216 shipped). Next batch is
all M-sized refactors — pick one explicitly with the operator:

1. **Error contract types** — shared \`ApiError\` shape; centralize the
   ~12 ad-hoc \`e.response.data.detail\` walks in \`mobile/lib/apiErrors.ts\`.
2. **\`models.py\` split** — 600 LOC → \`backend/app/models/{auth,task,
   routine,session,exercise,reminder}.py\`. No behavior change.
3. **\`task_routes.py\` hydration consolidation** — fix the ~50 remaining
   N+1 candidates via helpers in \`backend/app/hydrate.py\` (mirrors the
   788a5b9 cleanup pattern).
4. **Optimistic Zustand updates** — toggle / reorder / edit go
   optimistic-with-rollback in the task + routine stores.
5. **Tasks export** — \`/tasks/export\` JSON endpoint mirroring the
   Workouts export pattern.
EOF
