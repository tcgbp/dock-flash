# dock-flash — publishing and repository sync

The release procedure and the repository-sync rules. `AGENTS.md` keeps only the three sync rules
that must never be got wrong, because this is a PROCEDURE: you need it when cutting a release, not
while writing code.

---

## The two confirmation gates — ask first, both times

**A release is never cut on the agent's own initiative.** Two gates, each one the maintainer's
decision. `AGENTS.md` carries this as a rule because a fully-verified change is still not finished
here; the detail lives here because it is procedure.

| Gate | When | What to do |
|---|---|---|
| **1. The version** | Before touching `package.json` / `CLIENT_VERSION`, or writing the `CHANGELOG.md` row | Stop. State what is ready, name the version you would choose and why (per "Which number moves" below), and wait for an answer. |
| **2. The release** | Before `pnpm pack`, the tag, the push, or the GitHub Release | Ask again. Gate 1's approval does **not** carry over. |

Three consequences worth stating outright, because each has been got wrong:

- **A clean diff is not approval.** "The work is done and every check passes" describes the tree; it
  is not a decision about the tree. The bump is a separate act with a separate owner.
- **Do not edit a version string opportunistically.** "I was in `package.json` anyway" is exactly the
  move gate 1 exists to stop. Until gate 1 is answered both files keep the **last released** version
  and no new `CHANGELOG.md` row is added.
- **Nothing is published by accident while the gates hold.** Step 1 and steps 3-6 below are the only
  things that make a release observable, and gate 2 sits in front of all of them. A rejected or
  pending proposal leaves the repository exactly as it was.

Why two gates rather than one: **a published version cannot be recalled** (see "Never renumber a
released version"). Revision is free before the number exists and impossible after it, so the check
is placed as late as it can usefully be — one "shall I release?" asked early, before the change has
even been reviewed, would not cover the tag.

---

## The release runbook

Run these in order — **after both gates above are answered**. Which number to use is decided by
**Which number moves** below — patch for a bug fix, minor for anything additive a third party can
observe, major for anything removed or renamed.

```sh
# 0. BOTH gates answered (see above): version approved, and release authorised.
#    Do not start here without them — step 1 edits the version, and everything
#    after step 3 is observable and cannot be taken back.

# 1. Version, in BOTH places — they are not linked, so `pnpm run check:docs` asserts them.
#      package.json        "version"
#      lib/client.js       const CLIENT_VERSION — one constant, reported by the
#                          startup log and by __dockFlashOverlay()
#    Add the CHANGELOG.md row at the same time.

# 2. If src/index.ts changed, rebuild and commit dist/ in the same commit.
pnpm run build

# 3. Commit and push to Gitee (the authoritative remote), then mirror.
git push origin master
#    dispatch the mirror and confirm the tree hash matches — see below

# 4. Build the release artifact. `pnpm pack` writes dock-flash-<version>.tgz; the
#    GitHub Release asset must be named dock-flash.tgz, because the dsh-market
#    registry entry's tarball URL is releases/latest/download/dock-flash.tgz —
#    the FALLBACK target for an entry whose npm mapping is absent, not the one
#    the market normally installs.
pnpm pack && mv dock-flash-<version>.tgz dock-flash.tgz

# 5. Tag and push the tag, then mirror again — the tag needs its own dispatch.
#    The ANNOTATED tag's message may be a summary; the RELEASE TITLE may not —
#    it is the bare version, "v<version>", and nothing else. See below.
git tag -a v<version> -m "<summary>"
git push origin v<version>

# 6. Create the Release and upload the asset (see the API snippets below).

# 7. Publish to npm — also behind gate 2, and easy to get wrong in BOTH
#    directions: npm 11.16 stages a bypass-2FA publish instead of publishing it,
#    and its packument is CDN-cached. This is not "one more push".
npm publish --access public          # or --otp=<code> to publish directly
#    Then VERIFY per version and by installing, never by the exit code — see
#    "Publishing to npm" below.
```

**The Release title is the version and nothing else — `v<version>`.** Not a summary, not the commit
subject, not "v<version> — <what changed>". The narrative belongs in `CHANGELOG.md`, and GitHub renders
the tag's own message on the Release page anyway, so a descriptive title duplicates it while making the
releases list harder to scan. Every existing Release (`v1.3.1`, `v1.2.0`, `v1.1.12`) follows this, so a
descriptive one is also the thing that breaks the pattern. The `-m "<summary>"` above is the **tag's**
message, which is a different field and is allowed to say something.

`release.json` therefore carries no `name`, or `"name": "v<version>"` — never a sentence. The `name`
field is also what the registry's `releases/latest` link is read beside, so keeping it mechanical is
what makes "which version is live" answerable at a glance.

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

## Which number moves

Moved here from `AGENTS.md`, which keeps the one-line rule and points here: it is a release decision,
not something needed while writing code.

The version is **this package's own** — it says nothing about a sibling's, and nothing compares the
two (npm, pnpm, the ModuleLoader and dsh-market all treat a plugin's version as private). What
declares compatibility with dock-base is the `peerDependencies` range, not a major number, so
`dock-flash 1.x` alongside `dock-base 0.2.2` is a supported pair by construction — and the family is
uneven anyway (dock-git 0.3.4, dock-files 0.3.0, dock-images 0.1.2, dock-base 0.2.2). **Never
renumber a released version:** a published tag and Release cannot be recalled, and stepping back from
`1.x` to `0.x` is not expressible as a non-breaking change for anyone holding a range (`^1.0.0`
accepts all of 1.x; `^0.2.2` accepts only `0.2.x`).

Increment by what a third party can observe, not by how large the change felt:

| Change | Number |
|---|---|
| Bug fix, internal refactor, docs, metadata | **patch** — `1.0.15` → `1.0.16` |
| A new switch; a new field on `QuickSwitchDefinition` (as `subtitleBlock`, `visible`, `cluster` and `hideLabel` each were); a new switch type (as `log` was); a new service or event | **minor** — `1.0.15` → `1.1.0` |
| Removing or renaming a published field, switch type, or a switch id other plugins may read; changing a route's response shape | **major** — `1.0.15` → `2.0.0` |

Additive is what makes a minor safe to take: no downstream range needs rewriting for a field that did
not exist before. The rule counts what **shipped**, not what a branch contained — dropping
`clusterOpen` in 1.0.15 did not make it a major, because that field never appeared in a published
version. Note that `1.0.1`–`1.0.15` shipped features as patches (`log`, `subtitleBlock`, `visible`,
`cluster`, `hideLabel`), and `1.0.0` was declared for a packaging milestone — history squashed,
`prepare` dropped — rather than for a frozen contract: those numbers are published and stand, and
this table governs the next one.

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

## Publishing to npm

`dock-flash` is also published to **npm** under its own name, and that is a **second, independent
channel**: the GitHub Release is what the dsh-market entry's tarball URL points at, while npm is what
`npm install dock-flash` and any npm-based tooling resolve. Neither one follows the other, so a
release is not finished until npm is updated — or the skip is a deliberate decision.

Everything in this section sits **behind gate 2**. `npm publish` is as observable and as unrecallable
as the tag, so it is not a step to run "while I am here".

**npm carries only the versions actually published to it.** `dock-flash` went `1.5.2` → `1.6.1` →
`2.0.2`; `1.6.2`–`1.6.5`, `2.0.0` and `2.0.1` exist as tags and Releases but never reached npm. That
is allowed (npm does not require contiguous versions) but it means an npm user jumps straight across
whatever the missing versions contained — for `2.0.2` that included 2.0.0's extraction of the context
monitor into `dsh-flash-ctx-mon`.

### Order, and the peer range is a hard gate

**Publish `dock-flash` first, then the companions** (`dsh-flash-ctx-mon`, `dsh-flash-mem-mon`,
`dsh-flash-net-mon`, `dsh-flash-proxy`), each from its own repository.

npm 7+ resolves `peerDependencies` and **errors** when they conflict; pnpm only warns. So a companion
whose range excludes the dock-flash being published is a package nobody can install with npm, however
well it works under `dsh plugin add`. Measured, with the packed tarballs:

```
npm error code ERESOLVE
npm error Found: dock-flash@2.0.2
npm error Could not resolve dependency:
npm error peer dock-flash@">=1.5.0-0 <2.0.0-0" from dsh-flash-ctx-mon@0.1.3
```

Before publishing any companion, check that its `dock-flash` range accepts the version going out — and
spell the range with **one branch per tuple whose prereleases must resolve**
(`>=1.5.0-0 <2.0.0-0 || >=2.0.0-0 <3.0.0-0`). A single `>=1.5.0-0 <3.0.0-0` looks equivalent and is
not: semver only lets a prerelease satisfy a comparator set whose matching tuple also carries one, so
that spelling silently rejects `2.0.0-rc.1`.

### 2FA: `npm publish` now stages instead of publishing

Observed on **npm 11.16, 2026-10**, against an account with 2FA enabled and a granular token carrying
**Bypass 2FA**: a bypass token no longer publishes directly. `npm publish` **stages** the version and
defers proof-of-presence; the package appears once the 2FA approval lands. (The July 2026 changelog
said this would reach publish "targeting January 2027" — it is already the behaviour.) The symptoms,
in the order they show up:

| What you see | What it means |
|---|---|
| `npm publish` exits **0**, and the registry shows nothing yet | staged, not failed |
| Re-publishing the same version: `E409 Cannot publish over previously staged version "<v>"` | the stage exists — this is the proof |
| A **new** package briefly has `versions: ["0.0.0-stage"]` and `latest: 0.0.0-stage` | the placeholder the handshake creates (`"Temporary package placeholder for staged publishing"`, `stub: true`) |

Two ways through: pass `--otp=<code>` so proof-of-presence is satisfied immediately (a direct publish,
no staging), or publish and let it stage, then approve. **`npm stage list` cannot be relied on to find
the stage id** `npm stage approve <uuid>` needs: with the token in use it answers *"No staged packages
found"*, and `GET /-/stage` answers `{"items":[],"total":0}`, at the same moment the registry refuses a
re-publish for a staged version. The web listing is behind Cloudflare for non-browser requests.

### Verify a publish — the packument lies for a while

The abbreviated packument (`registry.npmjs.org/<pkg>`) is **CDN-cached**. Immediately after a publish,
`dist-tags.latest` and the `versions` list can still show the old state, and a brand-new package can
show nothing but `0.0.0-stage` while its real version is already being served. Do not conclude the
publish failed from that — check the version endpoint with a cache-buster:

```sh
# 200 means this exact version exists. (Write scratch files inside the repo: under
# Git for Windows /tmp is C:\tmp, and a Windows tool cannot read an MSYS /tmp path.)
curl -sS -o v.json -w '%{http_code}\n' "https://registry.npmjs.org/dock-flash/2.0.2?t=$(date +%s)"
```

A `200` proves a version exists; it does not prove the version is the one you built. Download the
published tarball and assert what the release was about — the version, the `dock-flash` peer range,
and the specific file or string that changed. And do the one check that actually settles it: install
the published versions together in an empty directory (`npm install dock-flash@<v> <companions>`),
which is the ERESOLVE scenario above.

### The sequence

`npm publish --dry-run` is the rehearsal and needs no auth — it prints the file list and the tarball
size, so a missing `README` or a stray file shows up before anything is public.

```sh
# Per package, in dependency order (dock-flash first, then each companion from its own repo):
npm publish --access public            # uses the token in ~/.npmrc
npm publish --access public --otp=123456   # when the account demands an OTP per write

# Rehearsal instead: add --dry-run, or DRY=1 to a wrapper script.
```

Run all five from one script rather than five commands: a TOTP code is valid for about 30 seconds, so
an OTP run has to publish back to back without a prompt in between, and the script should end with the
verification pass above rather than trusting five exit codes.

---


## How a user installs a plugin

Worth writing down because it decides what "being published" even means, and because two of its rules
are easy to get backwards.

**`dsh plugin --profile <p> <args…>` forwards its arguments verbatim to pnpm**, run with the profile
directory as `cwd` (`@deepseek-ai/dsh-plugin-manager`'s `operations.js`). `add` is not a DSH
subcommand, and there is no `enable`. So every form pnpm accepts works:

| Form | Example |
|---|---|
| npm name | `dsh plugin --profile web add dock-flash dsh-flash-ctx-mon` — **pnpm takes several at once** |
| name + range | `dock-flash@^2` |
| local path / `file:` / `link:` | `./dock-flash` (relative is anchored to the *invoking* cwd) |
| git | `github:tcgbp/dock-flash`, `git+https://gitee.com/lenin.guo/dock-flash.git` |
| tarball URL or path | `https://github.com/tcgbp/dock-flash/releases/latest/download/dock-flash.tgz` |

**Nothing is built, and nothing needs approving.** `dist/` is committed and **none of the five packages
declares `prepare`, `prepublish`, `prepack` or `publish`**, so an npm, tarball or `github:` install
lands the committed `dist/` as-is and pnpm asks for no `allowBuilds` entry. This is the payoff of
tracking `dist/` (see `AGENTS.md`'s Build & Install). **Adding a `prepare` script later would break the
`github:` form**: pnpm would refuse with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` until the user answered
`allowBuilds`.

**A stale `dock-flash` peer range is invisible here, and only bites npm.** The profile sets
`autoInstallPeers: false`, pnpm merely *warns* about peer conflicts, and DSH's own pre-flight only
inspects peers named `@deepseek-ai/dsh*`. So `dsh plugin add` installed a companion whose range
excluded the installed dock-flash — while `npm install` refused it outright with `ERESOLVE`. Fix the
range for npm's sake, not because this path reports it.

**`add` enables the plugin by itself.** It writes the package name into `dsh.profile.bundles` in the
profile's `package.json` (all five declare `dsh.bundle.patch`), and no `cordis.patch.yml` row is needed
for that. The **UI** path differs: its install passes `enabled: false`, so the row is added but not
selected, and the dialog's **立即启用 / Enable now** button is a second, separate step.

**Publish "restart DSH", not "it appears immediately".** The host watches the profile manifest and HMR
reloads when the ordered `dsh.profile.bundles` list changes, but that path has not been confirmed by
running an install.

**The `desktop` profile is reserved, and a normal `dsh` refuses it** — `--profile desktop` errors with
*"profile "desktop" is managed exclusively by the Electron application"*. DSH Desktop users must use
the in-app **Plugins** page (or the Desktop's own `dsh.cmd`, which passes `manageDesktopProfile`). The
Plugins page also takes an npm name directly, classifies it as `{registry, path, git, tarball}`, and has
a registry picker. **No catalog ships with DSH** — searching the whole bundle for `dsh-market` gives
zero hits; discovery is the community market.

**The one command to put in front of users:**

```sh
dsh plugin --profile <profile> add dock-flash dsh-flash-ctx-mon dsh-flash-mem-mon dsh-flash-net-mon dsh-flash-proxy
```

---

## Listing on dsh-market

dsh-market reads its catalog from the curated **awesome-dsh-plugin** registry, so being installable is
not the same as being listed. **Listing is per package** — a companion is invisible until it has its own
entry, however discoverable `dock-flash` is. *(Checked 2026-10: `data/plugins/tcgbp__dock-flash.yml`
exists in the registry; the four companions return 404.)*

**What the market actually installs is the npm name, not the Release tarball.** `dshmarket`'s
`installTargetFor()` resolves an entry in this order:

1. `entry.npm`, when the catalog carries one — **this wins**;
2. the entry's own GitHub Release `.tgz` (name-squatting guard: it must be the entry's own `owner/repo`);
3. `github:<owner>/<repo>`.

So npm is what decides which artifact users get, and the tarball URL below is the *fallback* for an
entry with no npm mapping. This corrects an earlier claim in this file. Measured on the maintainer
machine: the market's install log records `dock-flash@1.6.1`, i.e. the registry spec, while the entry
also carried the tarball URL.

**That is also why `repository` must be right in `package.json`.** The registry resolves an entry's npm
mapping by matching the **published** package's own `repository` field against the listed repository —
so a missing one leaves the mapping absent (listing still works), and a *wrong* one maps the package to
somebody else's entry. The published metadata is what counts, which means fixing it later costs a
release.

`dock-flash`'s entry is written and validated here:

**[docs/tcgbp__dock-flash.yml](tcgbp__dock-flash.yml)**

The file's own comments record the rules the registry's validator enforces — the filename must equal
`slugFor(url)`, only `url`/`name`/`category`/`description`/`tarball` are allowed, and `tarball` must be
an https GitHub Release URL ending in `.tgz`. It is deliberately the version-free
`releases/latest/download/` URL, so **no entry edit is needed per release**. To submit a new entry, copy
the file to `data/plugins/<slug>.yml` in a fork of
`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin` and open a PR; the repo must also carry the
`dsh-plugin` topic. The registry applies a **repo-age gate**, so check the GitHub mirror's `created_at`
before submitting — a PR from a repository younger than that window is rejected on age, not on content,
and the gate re-runs itself every 6 hours.


