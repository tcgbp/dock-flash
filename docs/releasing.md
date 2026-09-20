# dock-flash — publishing and repository sync

The release procedure. `AGENTS.md` keeps only the three rules that must never be got wrong,
because this is a PROCEDURE: you need it when cutting a release, not while writing code.

---


**Gitee is authoritative; GitHub is a mirror of it.**

| Repository | Role | How it receives commits |
|---|---|---|
| `gitee.com/lenin.guo/dock-flash` | **Authoritative** | `git push` — the only remote configured (`origin`) |
| `github.com/tcgbp/dock-flash` | Mirror | `.github/workflows/sync-from-gitee.yml` |

**Always commit and push to Gitee.** No `github` remote is configured locally, deliberately: github.com is **intermittently** unreachable from the maintainer machine (TCP 443 resets, or 21 s timeouts, no proxy available), so a dual-push succeeds unpredictably — one repository can take the commit while the other rejects it — and the two then sit silently divergent until the mirror runs. The intermittency is the problem, not a permanent block; see the measured asymmetry below.

GitHub is updated by `.github/workflows/sync-from-gitee.yml`, which runs on GitHub's own runners (hourly, plus `workflow_dispatch`). It needs no local machine and no stored secret, because both repositories are public and the built-in `GITHUB_TOKEN` performs the push. Trigger it from the Actions tab — or from the command line, which is the route that still works while the maintainer machine cannot reach `github.com` at all.

**The blocking is host-specific, not total.** Measured in one sitting: eight consecutive `git push` attempts to `github.com:443` failed (connection resets, or 21 s connect timeouts), while `api.github.com` answered `HTTP 200` in 0.55 s at the same moment. So `git` is not the tool to reach for when the mirror looks stale — the API is. No new token is needed: the credential Git Credential Manager already holds for `github.com` carries the `workflow` scope (`gist, repo, workflow`).

```sh
tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $tok" \
  https://api.github.com/repos/tcgbp/dock-flash/actions/workflows/sync-from-gitee.yml/dispatches \
  -d '{"ref":"master"}'
```

`204` means the run is queued, and it settles in well under a minute. Verify through the API too, because `git ls-remote` needs the blocked host: compare `commit.tree.sha` from `/repos/tcgbp/dock-flash/commits/master` against the local `git rev-parse master^{tree}`. Matching **tree** hashes prove the two repositories hold identical content; identical *commit* hashes already imply that, so the tree comparison is what settles the question when the hashes differ — after a commit is re-created through the Git Data API, for instance, where the same tree gets a new sha. Keep the token in a shell variable for the single call, as above: never echo it, and never let it reach a log or a file.

Gitee's built-in **仓库镜像管理** push mirror was tried first and **never delivered a single commit**; it is not the mechanism in use. Do not re-enable it — a second, unverified mirror racing the workflow is how the two repositories drift apart again.

Two details of that workflow must not be "simplified":

- It uses explicit refspecs (`refs/heads/*:refs/heads/*`), **not** `git push --mirror`. `--mirror` deletes refs the source lacks, which would delete the workflow file itself from the default branch and silently stop every future scheduled run. Trade-off: branches and tags deleted on Gitee are not deleted on GitHub.
- The workflow file is committed **to Gitee as well**, for the same reason: after a mirror push GitHub's default branch is exactly Gitee's tree, so anything living only on GitHub is wiped.

GitHub disables scheduled workflows after roughly 60 days without repository activity — if the mirror looks stale, check the Actions tab first.
