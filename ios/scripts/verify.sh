#!/usr/bin/env bash
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$IOS_ROOT"
: "${IOS_SIMULATOR_ID:?Set IOS_SIMULATOR_ID to an available iPhone simulator UUID}"
IOS_DERIVED_DATA="${IOS_DERIVED_DATA:-/tmp/freebbs-ios-derived}"
IOS_RESULT_NAME="${IOS_RESULT_NAME:-Verification-$(date +%Y%m%d-%H%M%S)}"
python3 scripts/generate-project.py
mkdir -p artifacts
xcodebuild -project FreeBBS.xcodeproj -scheme FreeBBS \
  -destination "platform=iOS Simulator,id=$IOS_SIMULATOR_ID" \
  -derivedDataPath "$IOS_DERIVED_DATA" -resultBundlePath "artifacts/$IOS_RESULT_NAME.xcresult" \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 180 \
  -maximum-test-execution-time-allowance 240 CODE_SIGNING_ALLOWED=NO test
xcodebuild -project FreeBBS.xcodeproj -scheme FreeBBS -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$IOS_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO build
