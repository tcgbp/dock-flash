#!/usr/bin/env python3
"""Give ctx-mon and net-mon the real install command, and state the dock-flash floor.

Both still said `add <path-to-this-checkout>`, which is a developer instruction — the packages have
been on npm since 0.1.x, and mem-mon/proxy already document the npm form. The floor matters too: it is
what the peer range enforces, and npm refuses a mismatch outright.

usage: _fixinstall.py          (run from this repo; edits its own README + README.zh-CN.md)
"""
import io
import os
import re
import sys

SPECS = {
    'dsh-flash-ctx-mon': {
        'floor': '1.5',
        'en_marker': '`cordis.patch.yml` inserts the host row.',
        'zh_marker': '`cordis.patch.yml` 负责插入宿主行。',
    },
    'dsh-flash-net-mon': {
        'floor': '1.6',
        'en_marker': '`cordis.patch.yml` inserts the host row.',
        'zh_marker': '`cordis.patch.yml` 只插入宿主行。',
    },
}

pkg = os.path.basename(os.getcwd())
if pkg not in SPECS:
    print('  !! unexpected repository: %s' % pkg, file=sys.stderr)
    sys.exit(1)
spec = SPECS[pkg]
floor = spec['floor']

changed = []
for fname, lang in (('README.md', 'en'), ('README.zh-CN.md', 'zh')):
    if not os.path.exists(fname):
        continue
    src = io.open(fname, encoding='utf-8', newline='').read()
    term = '\r\n' if '\r\n' in src else '\n'
    text = src.replace(term, '\n')

    old = 'add <path-to-this-checkout>'
    if old not in text:
        print('  !! %s: the path spec is not there (%s)' % (fname, old), file=sys.stderr)
        sys.exit(1)
    text = text.replace(old, 'add %s' % pkg, 1)

    marker = spec['%s_marker' % lang]
    if marker not in text:
        print('  !! %s: anchor missing' % fname, file=sys.stderr)
        sys.exit(1)
    if lang == 'en':
        note = ('Requires **dock-flash \u2265 %s** \u2014 it supplies the `quickControl` and\n'
                '`dockFlashAlerts` services and the `dock-flash:ready` event, and any 2.x satisfies it.\n'
                'Restart DSH after installing.\n\n' % floor)
    else:
        note = ('\u9700\u8981 **dock-flash \u2265 %s**\uff1a\u5b83\u63d0\u4f9b `quickControl`\u3001'
                '`dockFlashAlerts` \u670d\u52a1\u4e0e `dock-flash:ready` \u4e8b\u4ef6\uff0c'
                '\u4efb\u4f55 2.x \u90fd\u6ee1\u8db3\u3002\u5b89\u88c5\u540e\u8bf7\u91cd\u542f DSH\u3002\n\n' % floor)
    text = text.replace(marker, note + marker, 1)

    io.open(fname, 'w', encoding='utf-8', newline='').write(text.replace('\n', term))
    changed.append(fname)

print('  %-22s updated: %s' % (pkg, ', '.join(changed)))
