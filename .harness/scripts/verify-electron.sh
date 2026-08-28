#!/usr/bin/env bash

set -euo pipefail

if [ ! -f package.json ]; then
  printf '%s\n' 'Electron verification cannot run: package.json is missing. Land the workspace manifest first, then rerun bash .harness/scripts/verify-electron.sh.'
  exit 1
fi

if [ ! -x node_modules/.bin/tsc ]; then
  printf '%s\n' 'Electron verification cannot run: dependencies are not installed. Run npm install, then rerun bash .harness/scripts/verify-electron.sh.'
  exit 1
fi

npm run format:check
npm run typecheck
npm test
