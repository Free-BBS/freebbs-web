#!/usr/bin/env python3
"""Fail visibly until deployment, policy and store review evidence are approved."""
from pathlib import Path
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
status = json.loads((root/'review/ReleaseStatus.json').read_text())
blockers = [key for key, value in status.items() if value is not True]
config = (root/'Config/App.xcconfig').read_text()
local = root/'Config/Local.xcconfig'
if local.exists(): config += '\n' + local.read_text()
def setting(name):
    values = re.findall(r'^' + re.escape(name) + r'\s*=\s*(.*?)\s*$', config, re.MULTILINE)
    return values[-1] if values else ''
privacy = setting('FREEBBS_PRIVACY_URL').replace('$()', '')
if not privacy.startswith('https://'): blockers.append('FREEBBS_PRIVACY_URL must be a public HTTPS policy URL')
if '@' not in setting('FREEBBS_SUPPORT_EMAIL'): blockers.append('FREEBBS_SUPPORT_EMAIL must be configured')
if not re.fullmatch(r'[A-Z0-9]{10}', setting('DEVELOPMENT_TEAM')): blockers.append('DEVELOPMENT_TEAM is invalid')
if setting('PRODUCT_BUNDLE_IDENTIFIER') != 'cn.free-bbs.app': blockers.append('Confirm the registered Bundle ID')
try:
    version = subprocess.check_output(['xcodebuild', '-version'], text=True).splitlines()[0]
    if not re.match(r'Xcode (2[7-9]|[3-9][0-9])', version): blockers.append('Build and test the requested iOS 27 target with Xcode 27 or later')
except (subprocess.CalledProcessError, FileNotFoundError): blockers.append('Xcode is unavailable')
if blockers:
    print('NOT READY FOR APP STORE SUBMISSION')
    for blocker in blockers: print('- ' + blocker)
    sys.exit(1)
print('Recorded release prerequisites passed. Archive validation and App Review still apply.')
