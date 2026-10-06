#!/usr/bin/env python3
"""Point a companion plugin's `repository`/`homepage` at its OWN GitHub repo.

Why it matters beyond tidiness: the dsh-market registry resolves an entry's npm mapping by matching
the PUBLISHED package's own `repository` against the listed repository. `dsh-flash-proxy` shipped
`git+https://github.com/tcgbp/dock-flash.git` — a copy/paste from the extraction — so its npm page
linked to dock-flash and the market would map it to dock-flash's entry; the three monitors had no
`repository` at all, leaving the mapping absent. Either way the value is published metadata, so the
fix only takes effect on the next publish.

The anchor is the `files` array, not `keywords`: these manifests do not all carry `keywords`
(the three monitors do not), but they all carry `files`.

usage: _fixrepo.py <package-name>        # run with cwd = that repository
"""
import io
import json
import re
import sys

name = sys.argv[1]
gh = 'https://github.com/tcgbp/' + name
path = 'package.json'
src = io.open(path, encoding='utf-8', newline='').read()
term = '\r\n' if '\r\n' in src else '\n'
notes = []
text = src.replace(term, '\n')          # normalise while editing, restore at the end

# ── drop whatever is there now ────────────────────────────────────────────────
text, n_repo = re.subn(r'^  "repository": \{.*?^  \},\n', '', text, flags=re.S | re.M)
text, n_home = re.subn(r'^  "homepage": "[^"]*",\n', '', text, flags=re.M)
if n_repo:
    notes.append('replaced repository')
if n_home:
    notes.append('replaced homepage')

# ── insert immediately after the files array, matching dock-flash's field order ─
# The array is one line in the monitors and five in dsh-flash-proxy, so match its
# value generically: `[` … the first `]` … the rest of that line. Anchoring on a
# line that merely ENDS in `],` is what put it inside `dsh.client.inject` once.
m = re.search(r'^  "files": \[[^\]]*\][^\n]*\n', text, re.M)
if not m:
    print('  !! no `files` array to anchor on', file=sys.stderr)
    sys.exit(1)

block = ('  "repository": {\n'
         '    "type": "git",\n'
         '    "url": "git+%s.git"\n'
         '  },\n'
         '  "homepage": "%s#readme",\n' % (gh, gh))
text = text[:m.end()] + block + text[m.end():]

src = text.replace('\n', term)
io.open(path, 'w', encoding='utf-8', newline='').write(src)

d = json.loads(io.open(path, encoding='utf-8').read())
if d['repository']['url'] != 'git+%s.git' % gh or d.get('homepage') != gh + '#readme':
    print('  !! written value is wrong', file=sys.stderr)
    sys.exit(1)
print('  %-22s %-22s repository=%s' % (name, ', '.join(notes) or 'added',
                                       d['repository']['url']))
