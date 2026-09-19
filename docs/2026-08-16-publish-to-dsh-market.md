# Publish dock-flash to dsh-market — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the dock-flash plugin so it appears in the dsh-market plugin browser inside DSH Web Settings.

**Architecture:** The dsh-market app reads its plugin catalog from the curated awesome-dsh-plugin registry. Getting listed requires (1) a public GitHub repository with `dsh.bundle` manifest and `dsh-plugin` topic, (2) a PR to awesome-dsh-plugin adding a YAML entry, (3) optional npm publish for better install UX. The current repo is on Gitee only and lacks several package.json fields and a `prepare` script needed for GitHub-based installs.

**Tech Stack:** DSH plugin (Cordis bundle), TypeScript (host half), vanilla JS (client half), npm, GitHub, awesome-dsh-plugin registry.

**Spec:** This plan is the spec — it documents every step needed to go from the current state (Gitee-only, missing package.json fields, no prepare script) to being listed on dsh-market.

## Global Constraints

- Package name: `dock-flash` (available on npm as of 2026-08-16)
- Current version: 0.20.0
- License: Apache-2.0
- Current remote: `https://gitee.com/lenin.guo/dock-flash.git` (Gitee)
- `dsh.bundle` manifest: already present in `package.json` ✅
- `dsh.client` manifest: already present in `package.json` ✅
- `cordis.patch.yml`: already present and valid ✅
- peerDependencies use `^4.0.1` for `@deepseek-ai/cordis` — must add explicit prerelease `||` branch per awesome-dsh-plugin contributing guide
- `files` field in package.json must include `dist`, `lib`, `cordis.patch.yml`, `README.md`
- awesome-dsh-plugin category: `ui` (UI Enhancement)
- Plugin must install cleanly via `dsh plugin --profile <name> add <source>`

---

## Current State Gap Analysis

| Requirement | Current State | Gap |
|---|---|---|
| Public GitHub repo | Gitee only | ❌ Must create GitHub mirror |
| `repository` field in package.json | Missing | ❌ Must add |
| `keywords` field in package.json | Missing | ❌ Must add (for npm discoverability) |
| `homepage` field in package.json | Missing | ❌ Must add |
| `prepare` script | Missing | ❌ Must add for GitHub source installs |
| `dsh-plugin` GitHub topic | N/A (no GitHub repo) | ❌ Must add after creating repo |
| npm publish | Not published | ⚠️ Optional but recommended |
| `screenshots.json` | Not present | ⚠️ Optional but recommended |
| peerDependencies prerelease range | `^4.0.1` only | ❌ Must add `||` branch |
| `README.md` in `files` array | Present | ✅ |
| `dsh.bundle` manifest | Present | ✅ |
| `cordis.patch.yml` | Present and valid | ✅ |
| Real working code | Yes | ✅ |
| awesome-dsh-plugin PR | Not submitted | ❌ Final step |

---

## Task 1: Add missing package.json fields

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: n/a (first task)
- Produces: A `package.json` with `repository`, `homepage`, `keywords`, `prepare` script, and corrected peerDependencies that downstream tasks rely on

**Rationale:** awesome-dsh-plugin CI reads `dsh.bundle` from the GitHub repo's `package.json`. npm requires `repository` to link the published package back to the repo. The `prepare` script is required for GitHub source installs (pnpm runs it after cloning). The peerDependencies prerelease range is required because the current `^4.0.1` silently excludes all `0.1.0-rc.*` prerelease builds of the harness.

- [ ] **Step 1: Edit package.json — add `repository`, `homepage`, `bugs`, `keywords`, `prepare`, and fix peerDependencies**

Replace the entire `package.json` content with:

```json
{
  "name": "dock-flash",
  "version": "0.20.0",
  "description": "Quick Control dock plugin — a dynamic floating shortcut panel for DSH Workbench with extensible switch registry. Works standalone or with dock-base.",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "lib",
    "cordis.patch.yml",
    "README.md"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/LeninGuo/dock-flash.git"
  },
  "homepage": "https://github.com/LeninGuo/dock-flash#readme",
  "bugs": {
    "url": "https://github.com/LeninGuo/dock-flash/issues"
  },
  "keywords": [
    "dsh",
    "dsh-plugin",
    "deepseek-harness",
    "dock",
    "workbench",
    "quick-control",
    "ui"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "dock-base"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "npm run build",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.2"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.1-0 <5.0.0-0",
    "dock-base": ">=0.1.2-0 <1.0.0-0"
  },
  "peerDependenciesMeta": {
    "dock-base": {
      "optional": true
    }
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-settings": "0.1.5-rc.1",
    "@types/node": "^22.10.0",
    "typescript": "^5.6.0"
  }
}
```

Key changes:
1. **`repository`** — points to `github.com/LeninGuo/dock-flash` (will create in Task 2). If your GitHub username differs, adjust accordingly.
2. **`homepage`** / **`bugs`** — derived from the repository URL.
3. **`keywords`** — includes `dsh-plugin` for npm discoverability and `dsh` / `deepseek-harness` for search.
4. **`prepare`** — `"npm run build"` (uses `npm` rather than `pnpm` because pnpm may not be available in the user's global PATH when doing a git install; npm ships with Node). This ensures `dist/index.js` is built after a `github:` install.
5. **`peerDependencies`** — changed `^4.0.1` → `>=4.0.1-0 <5.0.0-0` for cordis and `^0.1.2` → `>=0.1.2-0 <1.0.0-0` for dock-base. The `-0` lower bound includes all prereleases on that tuple, which is what awesome-dsh-plugin contributing guide requires.

- [ ] **Step 2: Verify the build still works**

Run: `pnpm run build`

Expected: Exits 0, `dist/index.js` is regenerated without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add repository/homepage/keywords/prepare and fix peerDep ranges for publish"
```

---

## Task 2: Create GitHub repository and push

**Files:**
- No file changes (git operations only)

**Interfaces:**
- Consumes: Task 1's updated `package.json` (with `repository` pointing to GitHub)
- Produces: A public GitHub repository at `github.com/LeninGuo/dock-flash` with `dsh-plugin` topic

**Rationale:** awesome-dsh-plugin CI reads `dsh.bundle` from the GitHub repo's `package.json`. The repo must be public and have the `dsh-plugin` topic.

- [ ] **Step 1: Create the GitHub repository**

Go to https://github.com/new and create a public repository:
- **Name**: `dock-flash`
- **Description**: `Quick Control dock plugin for DSH — extensible floating shortcut panel, works standalone or with dock-base`
- **Visibility**: Public
- **Initialize**: Do NOT check "Add a README", ".gitignore", or "License" (we're pushing an existing repo)

- [ ] **Step 2: Add GitHub as a git remote**

```bash
git remote add github https://github.com/LeninGuo/dock-flash.git
```

If you prefer SSH:
```bash
git remote add github git@github.com:LeninGuo/dock-flash.git
```

- [ ] **Step 3: Push all branches to GitHub**

```bash
git push github --all
git push github --tags
```

- [ ] **Step 4: Add the `dsh-plugin` topic to the GitHub repo**

Go to https://github.com/LeninGuo/dock-flash → click the gear icon next to "About" → in the "Topics" field, type `dsh-plugin` and press Enter → Save.

This is required by awesome-dsh-plugin contributing guide.

- [ ] **Step 5: Verify the repo is accessible**

Open https://github.com/LeninGuo/dock-flash in a browser — confirm:
- The repo is public
- `dsh-plugin` topic appears in the sidebar
- `package.json` is visible with the `dsh.bundle` field
- `cordis.patch.yml` is visible

---

## Task 3: Verify plugin installs cleanly from GitHub

**Files:**
- No file changes (verification only)

**Interfaces:**
- Consumes: Task 1 + Task 2 (package.json with `prepare` + GitHub repo)
- Produces: Confirmed working install path

**Rationale:** Before submitting to awesome-dsh-plugin, we must verify that `dsh plugin add github:LeninGuo/dock-flash` actually works end-to-end. This is the exact install command dsh-market users will use.

- [ ] **Step 1: Create a test profile and install from GitHub**

```bash
dsh plugin --profile test-publish add github:LeninGuo/dock-flash
```

Expected: pnpm fetches the repo, runs `prepare` (which calls `npm run build`), and installs.

**If pnpm refuses to run `prepare`** (pnpm ≥10 requires `allowBuilds`), add to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dock-flash: true
```

Then re-run the `add` command.

- [ ] **Step 2: Verify the plugin loads**

```bash
dsh --profile test-publish --dump-config
```

Expected: Output contains a `# == dock-flash` layer with the plugin row.

Optionally boot the profile:
```bash
dsh --profile test-publish web
```

Then check the browser console for `[dock-flash] client v0.20.0` and confirm the ⚡ icon appears.

- [ ] **Step 3: Clean up test profile**

```bash
dsh plugin --profile test-publish remove dock-flash
```

Or delete the profile entirely if desired.

---

## Task 4: Prepare screenshots (optional but recommended)

**Files:**
- Create: `assets/screenshot-1.png` (and optionally more)
- Create: `screenshots.json`

**Interfaces:**
- Consumes: Task 2 (GitHub repo to push images to)
- Produces: `screenshots.json` that dsh-market reads for AppStore-style screenshots

**Rationale:** dsh-market shows plugin screenshots in its detail view. Without `screenshots.json`, it falls back to extracting images from README — which may not look ideal. Declaring screenshots gives you control over order and selection.

- [ ] **Step 1: Take screenshots of dock-flash in action**

Boot dock-flash in a profile with dock-base installed. Take 1–8 screenshots showing:
1. The Quick Control panel open in workbench mode (sidebar panel with switches)
2. The ⚡ icon in the activity bar
3. The standalone mode badge + floating panel (if possible, by testing without dock-base)

Save them as:
- `assets/screenshot-1.png`
- `assets/screenshot-2.png`
- (up to `assets/screenshot-8.png`)

**Guidelines:**
- Use 1280×720 or similar 16:9 aspect ratio
- PNG format preferred
- No watermarks or annotations — let the UI speak for itself

- [ ] **Step 2: Create `screenshots.json`**

```json
[
  "assets/screenshot-1.png",
  "assets/screenshot-2.png"
]
```

Place this file in the repository root (next to `package.json`).

- [ ] **Step 3: Commit and push**

```bash
git add assets/ screenshots.json
git commit -m "docs: add screenshots for dsh-market"
git push github master
```

---

## Task 5: Publish to npm (optional but recommended)

**Files:**
- No file changes (npm CLI operations only)

**Interfaces:**
- Consumes: Task 1 + Task 2 (complete package.json + GitHub repo)
- Produces: A published npm package `dock-flash@0.20.0`

**Rationale:** Publishing to npm gives users the best install experience — prebuilt code, no `allowBuilds` needed. The `repository` field in package.json links the npm package back to the GitHub repo, which is required for awesome-dsh-plugin to show download counts. npm publishing is optional per awesome-dsh-plugin rules, but recommended.

- [ ] **Step 1: Ensure you are logged in to npm**

```bash
npm whoami
```

If not logged in:
```bash
npm login
```

- [ ] **Step 2: Build and verify the tarball**

```bash
pnpm run build
npm pack --dry-run
```

Expected: Output lists `dist/`, `lib/`, `cordis.patch.yml`, `README.md`. Verify no unexpected files are included and no critical files are missing.

- [ ] **Step 3: Publish**

```bash
npm publish
```

If this is a scoped package or you need `--access public`, add that flag. Since `dock-flash` is unscoped, `npm publish` should work directly.

- [ ] **Step 4: Verify the published package**

```bash
npm view dock-flash
```

Expected: Shows version 0.20.0 with `repository` pointing to `github.com/LeninGuo/dock-flash`.

Wait 1–2 minutes, then verify install:
```bash
dsh plugin --profile test-npm add dock-flash
```

Expected: Installs from npm without needing `allowBuilds`.

- [ ] **Step 5: Clean up**

```bash
dsh plugin --profile test-npm remove dock-flash
```

---

## Task 6: Add GitHub Release tarball (alternative to npm, optional)

**Files:**
- No file changes (GitHub Release upload only)

**Interfaces:**
- Consumes: Task 1 (package.json with correct `files` field)
- Produces: A versioned GitHub Release with prebuilt tarball

**Rationale:** If you choose NOT to publish to npm, the awesome-dsh-plugin contributing guide strongly recommends attaching a prebuilt tarball to a GitHub Release. This lets dsh-market offer a prebuilt install command instead of forcing users to build from source. This task is unnecessary if you completed Task 5.

- [ ] **Step 1: Build and pack**

```bash
pnpm run build
npm pack
```

This produces `dock-flash-0.20.0.tgz`.

- [ ] **Step 2: Create a GitHub Release**

Go to https://github.com/LeninGuo/dock-flash/releases/new:
- **Tag**: `v0.20.0`
- **Title**: `v0.20.0`
- **Description**: Brief changelog (or just "Initial public release")
- **Attach**: `dock-flash-0.20.0.tgz` as a release asset

**Important:** Use a version-free asset name if using `latest/download/` in the tarball URL, or pin to the tag if using a versioned name. The awesome-dsh-plugin contributing guide recommends:

Option A — version-free (works with `latest/download/` forever):
- Rename `dock-flash-0.20.0.tgz` → `dock-flash.tgz` before uploading

Option B — versioned (pin to tag):
- Keep `dock-flash-0.20.0.tgz`, use tag-pinned URL

- [ ] **Step 3: Note the tarball URL for the awesome-dsh-plugin entry**

If Option A: `https://github.com/LeninGuo/dock-flash/releases/latest/download/dock-flash.tgz`
If Option B: `https://github.com/LeninGuo/dock-flash/releases/download/v0.20.0/dock-flash-0.20.0.tgz`

---

## Task 7: Submit PR to awesome-dsh-plugin

**Files:**
- Create: `data/plugins/LeninGuo__dock-flash.yml` (in the awesome-dsh-plugin fork, NOT in dock-flash itself)

**Interfaces:**
- Consumes: Task 2 (public GitHub repo), Task 4 (screenshots, optional), Task 5/6 (npm or tarball, optional)
- Produces: A PR that, when merged, causes dock-flash to appear in the dsh-market plugin browser

**Rationale:** dsh-market reads from `awesome-dsh-plugin.com/plugins.json`, which is generated from `data/plugins/*.yml` in the awesome-dsh-plugin repo. Submitting a PR with one YAML entry file is the only way to get listed.

- [ ] **Step 1: Fork awesome-dsh-plugin**

Go to https://github.com/awesome-dsh-plugin/awesome-dsh-plugin and click "Fork".

- [ ] **Step 2: Clone your fork and create a branch**

```bash
git clone https://github.com/LeninGuo/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-dock-flash
```

- [ ] **Step 3: Create the entry file**

Create `data/plugins/LeninGuo__dock-flash.yml`:

```yaml
url: https://github.com/LeninGuo/dock-flash
name: LeninGuo/dock-flash
category: ui
description:
  en: Quick Control dock panel with extensible switch registry, standalone or with dock-base.
  zh: 可扩展快捷控制面板插件，支持独立运行或搭配 dock-base 工作台。
```

**Notes on each field:**
- `url` — must match the GitHub repo URL exactly
- `name` — display text shown in the list
- `category` — `ui` (UI Enhancement), the closest match for a workbench panel plugin
- `description.en` — required; factual, no marketing superlatives; ends with a period
- `description.zh` — optional; a maintainer will add it if omitted, but providing it speeds up review

**If you attached a GitHub Release tarball (Task 6), add the `tarball` field:**

```yaml
url: https://github.com/LeninGuo/dock-flash
name: LeninGuo/dock-flash
category: ui
tarball: https://github.com/LeninGuo/dock-flash/releases/latest/download/dock-flash.tgz
description:
  en: Quick Control dock panel with extensible switch registry, standalone or with dock-base.
  zh: 可扩展快捷控制面板插件，支持独立运行或搭配 dock-base 工作台。
```

**Do NOT add an `npm:` field** — npm mapping is auto-detected from the registry; hand-written `npm:` keys are rejected by CI.

- [ ] **Step 4: (Optional) Preview locally**

```bash
npm ci
node scripts/generate-readme.mjs
```

This regenerates both READMEs. Verify your entry appears correctly. If you committed the generated READMEs, they must match the data source — but this is optional; the CI will regenerate them.

- [ ] **Step 5: Commit and push**

```bash
git add data/plugins/LeninGuo__dock-flash.yml
git commit -m "add dock-flash"
git push origin add-dock-flash
```

- [ ] **Step 6: Open the PR**

Go to https://github.com/LeninGuo/awesome-dsh-plugin/pull/new/add-dock-flash and create a pull request against `awesome-dsh-plugin/awesome-dsh-plugin:main`.

**PR title**: `add dock-flash`

**PR body** (minimal):
```
Adds dock-flash — a Quick Control dock panel with extensible switch registry for DSH Web.
Works standalone or with dock-base.
```

- [ ] **Step 7: Wait for CI and review**

CI checks (automated):
1. Entry count ≤ 3 ✅ (we're adding 1)
2. `dsh.bundle` present in GitHub repo's `package.json` ✅
3. Repo age ≥ 1 day ✅ (if you just created it, wait 24 hours)
4. `awesome-lint` and site build pass ✅

After CI passes, a maintainer will review the source code against the description. Typical turnaround is a few days. If the description is inaccurate, they'll leave a PR comment with exact fixes.

**Common reasons for rejection:**
- Description claims features that don't exist in the code
- Only `dsh.client` declared without `dsh.bundle` (not our case — we have both)
- Repo is a placeholder or README-only (not our case — real working code)
- Description contains marketing superlatives

- [ ] **Step 8: After merge — verify listing**

Within ~24 hours of merge:
1. Check https://awesome-dsh-plugin.com for dock-flash
2. Open dsh-market in DSH Web Settings → search "dock-flash" → verify it appears with correct description

---

## Task 8: Set up Gitee ↔ GitHub sync (ongoing maintenance)

**Files:**
- No file changes (git remote configuration only)

**Interfaces:**
- Consumes: Task 2 (GitHub remote)
- Produces: A dual-remote setup where pushing to Gitee also updates GitHub

**Rationale:** Your primary development remote is Gitee. To keep GitHub in sync (required for dsh-market listing to stay current), set up a push workflow that updates both remotes.

- [ ] **Step 1: Verify both remotes exist**

```bash
git remote -v
```

Expected output includes:
```
origin    https://gitee.com/lenin.guo/dock-flash.git (fetch)
origin    https://gitee.com/lenin.guo/dock-flash.git (push)
github    https://github.com/LeninGuo/dock-flash.git (fetch)
github    https://github.com/LeninGuo/dock-flash.git (push)
```

- [ ] **Step 2: Add a push-all alias (optional)**

Add to your git config or shell profile:

```bash
git config alias.push-all '!git push origin && git push github'
```

Usage: `git push-all` or `git push-all --tags`

- [ ] **Step 3: Document the workflow in AGENTS.md (optional)**

Add a note to AGENTS.md under a new "Publishing & Distribution" section:

```markdown
## Publishing & Distribution

- **Primary remote**: `origin` (Gitee: `gitee.com/lenin.guo/dock-flash`)
- **Mirror remote**: `github` (GitHub: `github.com/LeninGuo/dock-flash`)
- After version bumps, push to both: `git push origin && git push github --tags`
- npm publish: `npm publish` (after `pnpm run build`)
- awesome-dsh-plugin entry: `data/plugins/LeninGuo__dock-flash.yml`
```

---

## Summary Checklist

After completing all tasks, verify:

- [ ] `package.json` has `repository`, `homepage`, `bugs`, `keywords`, `prepare` script, and corrected peerDependencies
- [ ] GitHub repo exists at `github.com/LeninGuo/dock-flash` with `dsh-plugin` topic
- [ ] Plugin installs cleanly from GitHub (`dsh plugin add github:LeninGuo/dock-flash`)
- [ ] (Optional) Screenshots in `assets/` and `screenshots.json` committed
- [ ] (Optional) Published to npm as `dock-flash@0.20.0`
- [ ] (Optional) GitHub Release `v0.20.0` with tarball attached
- [ ] PR submitted to awesome-dsh-plugin with `data/plugins/LeninGuo__dock-flash.yml`
- [ ] (After merge) dock-flash appears in dsh-market Settings → Plugin Market
- [ ] Git push workflow keeps Gitee and GitHub in sync

## Error Recovery

| Problem | Fix |
|---|---|
| pnpm `allowBuilds` blocks `prepare` on GitHub install | Add `dock-flash: true` to profile's `pnpm-workspace.yaml` under `allowBuilds` |
| npm publish fails with 403 | Check `npm whoami`; the name may be taken — verify with `npm view dock-flash` |
| awesome-dsh-plugin CI fails on `dsh.bundle` check | Verify `package.json` on GitHub has `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` |
| awesome-dsh-plugin CI fails on repo age | Wait 24 hours after creating the GitHub repo, then re-push the PR branch |
| Maintainer says description is inaccurate | Update the `description.en` / `description.zh` in the yml file, push to the same branch |
| `prepare` script fails on GitHub install | Ensure `npm run build` works with only the dependencies declared in `package.json` (no monorepo context) |
