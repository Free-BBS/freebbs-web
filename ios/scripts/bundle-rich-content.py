#!/usr/bin/env python3
"""Bundle the website's audited Markdown engine and licensed dependencies offline."""
from pathlib import Path
import base64
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'ios/FreeBBS/Resources/RichContent.html'
web = (ROOT / 'public/app.js').read_text()
def section(start, end):
    if web.count(start) != 1 or web.count(end) != 1:
        raise SystemExit('Markdown source anchors changed; review the extraction before bundling.')
    return web[web.index(start):web.index(end)]
engine = section('function escapeHtml(value)', 'function getCopySuccessMessage(format)')
engine += section('function protectMarkdownMath(markdown, placeholderPrefix)', 'function shouldWaitForMaxReply(contentMarkdown)')
engine += section('function normalizeCodeLanguageName(language)', 'function normalizeRunnableCodeLanguage(code)')
engine = engine.replace('window.location.href', '(window.FreeBBSOrigin || window.location.href)')
scripts = [
    ROOT / 'node_modules/marked/lib/marked.umd.js',
    ROOT / 'node_modules/katex/dist/katex.min.js',
    ROOT / 'node_modules/@highlightjs/cdn-assets/highlight.min.js',
    ROOT / 'node_modules/@highlightjs/cdn-assets/languages/matlab.min.js',
]
katex = (ROOT / 'node_modules/katex/dist/katex.min.css').read_text()
def font(match):
    path = ROOT / 'node_modules/katex/dist' / match[1].strip('"\'')
    mime = 'font/woff2' if path.suffix == '.woff2' else ('font/woff' if path.suffix == '.woff' else 'font/ttf')
    return 'url(data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode() + ')'
katex = re.sub(r'url\((fonts/[^)]+)\)', font, katex)
css = katex + '\n' + (ROOT / 'node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css').read_text()
for name in ['circuit-embeds.css', 'tool-embeds.css', 'lab-results.css']:
    css += '\n' + (ROOT / 'public' / name).read_text()
css += '\n' + (ROOT / 'ios/WebSource/reader.css').read_text()
code = '\n'.join(path.read_text() for path in scripts) + '\n' + engine
for name in ['circuit-embeds.js', 'tool-embeds.js', 'lab-results.js']:
    code += '\n' + (ROOT / 'public' / name).read_text().replace('window.location.origin', '(window.FreeBBSOrigin || window.location.origin)')
code += '\n' + (ROOT / 'ios/WebSource/reader.js').read_text()
html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>' + css + '</style></head><body><article id="content" aria-label="正文"></article><script>' + code.replace('</script', '<\\/script') + '</script></body></html>\n'
licenses = '\n\n'.join((ROOT / p).read_text() for p in ['node_modules/marked/LICENSE.md', 'node_modules/katex/LICENSE', 'node_modules/@highlightjs/cdn-assets/LICENSE'])
outputs = {DEST: html, ROOT / 'ios/FreeBBS/Resources/RendererLicenses.txt': licenses}
manifest = {'source': 'public/app.js selected Markdown functions; public embed modules', 'engineSHA256': hashlib.sha256(engine.encode()).hexdigest(), 'documentSHA256': hashlib.sha256(html.encode()).hexdigest(), 'packageLockSHA256': hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest()}
outputs[ROOT / 'ios/WebSource/manifest.json'] = json.dumps(manifest, indent=2) + '\n'
for path, content in outputs.items():
    if '--check' in sys.argv:
        if not path.exists() or path.read_text() != content:
            raise SystemExit('Stale renderer asset: ' + str(path.relative_to(ROOT)))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
print('Offline renderer assets verified' if '--check' in sys.argv else 'Offline renderer assets bundled')
