#!/usr/bin/env python3
"""Bundle the game into one self-contained page.

Writes three things from the same source, so they can never drift:
  dist/foldspacer.html  the artifact fragment (no <html> wrapper; the host supplies one)
  dist/FoldSpacer.html  a standalone document, for download or opening locally
  docs/index.html       the same standalone document, which is what GitHub Pages serves

docs/ is the published site. The repo root's index.html is the DEV page — it loads the
separate .js files and has no intro card, no brake or boost button and a different
touchbar, so it must never be what a visitor gets.
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js = ''.join(open(os.path.join(ROOT, f)).read() + '\n' for f in ['parse.js', 'ss.js', 'rail.js', 'cartoon.js', 'gl.js', 'folds.js', 'music.js', 'game.js'])
tpl = open(os.path.join(ROOT, 'tools', 'bundle_template.html')).read()
page = tpl.replace('/*__GAME__*/', js)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'foldspacer.html'), 'w').write(page)
# standalone: full document for download / local use (the artifact version is a fragment wrapped by the host)
standalone = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
              '<style>html,body{margin:0;height:100%;background:#050812;font:14px system-ui,sans-serif;color-scheme:dark}</style>\n'
              + page.split('\n', 1)[0] + '\n</head>\n<body>\n' + page.split('\n', 1)[1] + '\n</body>\n</html>\n')
open(os.path.join(ROOT, 'dist', 'FoldSpacer.html'), 'w').write(standalone)
os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
open(os.path.join(ROOT, 'docs', 'index.html'), 'w').write(standalone)
print(len(page), 'bytes (artifact fragment),', len(standalone), 'bytes (standalone + docs/index.html)')
