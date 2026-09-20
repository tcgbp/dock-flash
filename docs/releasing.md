# dock-flash — publishing and repository sync

The release procedure and the repository-sync rules. `AGENTS.md` keeps only the three sync rules
that must never be got wrong, because this is a PROCEDURE: you need it when cutting a release, not
while writing code.

---

## The release runbook

Run these in order. Which number to use is the `### Which number moves` table in `AGENTS.md` —
that is a rule and stays there.

```sh
# 1. Version, in BOTH places — they are not linked and nothing checks them.
#      package.json          "version"
#      lib/client.js:53      console.log('[dock-flash] client vX.Y.Z')
#    Add the CHANGELOG.md row at the same time.

# 2. If src/index.ts changed, rebuild and commit dist/ in the same commit.
pnpm run build

# 3. Commit and push to Gitee (the authoritative remote), then mirror.
git push origin master
#    dispatch the mirror and confirm the tree hash matches — see below

# 4. Build the release artifact. `pnpm pack` writes dock-flash-<version>.tgz; the
#    GitHub Release asset must be named dock-flash.tgz, because the dsh-market
#    registry entry's tarball URL is releases/latest/download/dock-flash.tgz.
pnpm pack && mv dock-flash-<version>.tgz dock-flash.tgz

# 5. Tag and push the tag, then mirror again — the tag needs its own dispatch.
git tag -a v<version> -m "<summary>"
git push origin v<version>

# 6. Create the Release and upload the asset (see the API snippets below).
```

**The tarball is gitignored on purpose.** Both `dock-flash.tgz` and `dock-flash-<version>.tgz` are in
`.gitignore`, so it can never be committed — a stale tarball in the tree is how a release ships the
previous build, and it is reproducible from the tagged commit at any time. Nothing else needs editing
per release: the registry entry points at `releases/latest`, so it follows the newest Release on its
own.

**Always verify the release end to end**, because none of it errors loudly:

- `/repos/<owner>/<repo>/releases/latest` reports the expected tag, and lists the asset.
- Download the asset back through `api.github.com` and `cmp` it against the local build. Byte
  equality is the only proof the upload was not truncated.
- Do not try to verify by fetching `releases/latest/download/...` from the browser on the maintainer
  machine: `github.com` is intermittently unreachable there while `api.github.com` is not, so a
  connection reset says nothing about whether the asset is good.

---

## Repository sync

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

---

## Creating the Release and uploading the asset

Both go through `api.github.com` with the same credential the mirror dispatch uses. Write the JSON
body to a file and pass it with `-d @file`: an inline heredoc is easy to get subtly wrong, and the
Release is not idempotent — a malformed request fails as a 422, but a partially-applied one leaves
work to clean up.

```sh
tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')

# Create the Release. target_commitish is master; the tag must already exist on GitHub.
curl -sS -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/tcgbp/dock-flash/releases -d @release.json
#   -> note the returned "id" and "upload_url"

# Upload the asset. Content-Type must be application/gzip, and the ?name= is what
# the registry URL depends on.
curl -sS -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/gzip" --data-binary @dock-flash.tgz \
  "https://uploads.github.com/repos/tcgbp/dock-flash/releases/<id>/assets?name=dock-flash.tgz"
```

The upload response carries a `digest` (`sha256:…`) and the asset `size` — check both against the
local file. To read the bytes back, request the asset by id with
`Accept: application/octet-stream` from `api.github.com`, which avoids the blocked `github.com` host
entirely.

A `node -e` one-liner cannot write a temp file here: this shell runs Git for Windows, where `/tmp`
resolves to `C:\tmp`. Write scratch files inside the repository and delete them afterwards.

---

## Listing on dsh-market

dsh-market reads its catalog from the curated **awesome-dsh-plugin** registry, so being installable
from a Release is not the same as being listed. The entry to submit is already written and validated:

**[docs/tcgbp__dock-flash.yml](tcgbp__dock-flash.yml)**

Copy it to `data/plugins/tcgbp__dock-flash.yml` in a fork of
`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin` and open a PR. The file's own comments
record the rules the registry's validator enforces — the filename must equal `slugFor(url)`, only
`url`/`name`/`category`/`description`/`tarball` are allowed, and `tarball` must be an https GitHub
Release URL ending in `.tgz`.

**Two things about it are deliberately not fixed here:** the `tarball` line is the version-free
`releases/latest/download/` URL, so **no entry edit is needed per release**; and the repo must carry
the `dsh-plugin` topic, which it does. The registry also applies a **repo-age gate** — check the
GitHub mirror's `created_at` before submitting, because a PR from a repository younger than that
window is rejected on age rather than on content.


