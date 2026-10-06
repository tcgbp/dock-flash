#!/usr/bin/env python3
"""Validate a dsh-market submission entry against the registry's own rules.

Mirrors scripts/lib/entries.mjs::validateEntries (read 2026-10-06): only these keys,
filename == slugFor(url), category in CAT_IDS, description.en present and single-line,
tarball https on GitHub release hosting ending .tgz/.tar.gz.

usage: _marketcheck.py <file.yml> [...]
"""
import io
import os
import re
import sys

CAT_IDS = {'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory',
           'tools', 'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow',
           'git', 'notify', 'dev', 'security', 'remote', 'market', 'fun'}
ALLOWED = {'url', 'name', 'category', 'description', 'tarball'}


def slug_for(url):
    m = re.match(r'^https?://github\.com/([^/]+)/([^/#]+?)(?:\.git)?/?$', url.strip())
    if not m:
        return None
    return '%s__%s.yml' % (m.group(1), m.group(2))


def check(path):
    problems = []
    text = io.open(path, encoding='utf-8').read()
    lines = text.splitlines()

    keys = re.findall(r'^([A-Za-z_][A-Za-z0-9_]*):', text, re.M)
    unknown = set(keys) - ALLOWED
    missing = ALLOWED - set(keys)
    if unknown:
        problems.append('unknown keys: %s' % sorted(unknown))
    if missing:
        problems.append('missing keys: %s' % sorted(missing))

    url = re.search(r'^url:\s*(\S+)', text, re.M)
    url = url.group(1) if url else ''
    if slug_for(url) != os.path.basename(path):
        problems.append('filename != slugFor(url) (%s vs %s)' % (os.path.basename(path), slug_for(url)))

    cat = re.search(r'^category:\s*(\S+)', text, re.M)
    cat = cat.group(1) if cat else ''
    if cat not in CAT_IDS:
        problems.append('category %r not in CAT_IDS' % cat)

    en = re.search(r"^\s+en:\s*(.+)$", text, re.M)
    if not en:
        problems.append('description.en missing')
    elif en.group(1).strip() in ('|', '>', '|-', '>-'):
        problems.append('description.en is a block scalar, must be one line')

    tb = re.search(r'^tarball:\s*(\S+)', text, re.M)
    tb = tb.group(1) if tb else ''
    if not re.match(r'^https://github\.com/.+/releases/.+\.(tgz|tar\.gz)$', tb):
        problems.append('tarball %r is not an https GitHub release .tgz' % tb)
    if tb and url and not tb.startswith(url + '/releases/'):
        problems.append('tarball is not on the entry\'s OWN repo (name-squatting guard)')

    return problems


def main():
    bad = 0
    for path in sys.argv[1:]:
        problems = check(path)
        status = 'OK' if not problems else 'PROBLEMS'
        print('  %-34s %s' % (os.path.basename(path), status))
        for p in problems:
            print('      - %s' % p)
        bad += bool(problems)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
