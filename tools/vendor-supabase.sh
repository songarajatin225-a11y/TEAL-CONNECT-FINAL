#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Re-bundle @supabase/supabase-js into vendor/supabase-js.esm.js.
#
#   tools/vendor-supabase.sh [version]     # default: latest 2.x
#
# The application ships no node_modules, so the client is bundled once here and
# committed. Everything this script downloads goes to a temporary directory
# that is removed on exit — nothing is installed into the repository.
# ---------------------------------------------------------------------------
set -euo pipefail

VERSION="${1:-2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/supabase-js.esm.js"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> installing @supabase/supabase-js@$VERSION and esbuild"
cd "$WORK"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund esbuild "@supabase/supabase-js@$VERSION" >/dev/null

RESOLVED="$(node -p "require('$WORK/node_modules/@supabase/supabase-js/package.json').version")"

echo "==> bundling $RESOLVED as a browser ES module"
echo 'export { createClient } from "@supabase/supabase-js";' > entry.js
./node_modules/.bin/esbuild entry.js \
  --bundle --format=esm --platform=browser --target=es2022 \
  --minify --legal-comments=none \
  --define:process.env.NODE_ENV='"production"' \
  --outfile="$OUT"

echo "==> verifying the bundle has no unresolved imports"
if grep -qE '\bfrom"[^"./][^"]*"' "$OUT"; then
  echo "FAILED: bundle still contains bare imports; it will not load in a browser" >&2
  exit 1
fi

echo "==> verifying it loads"
node --input-type=module -e "
  import { createClient } from '$OUT';
  const c = createClient('https://example.supabase.co', 'key');
  if (typeof c.from !== 'function' || typeof c.auth.signInWithPassword !== 'function') {
    throw new Error('bundle loaded but the client looks wrong');
  }
"

echo
echo "vendored @supabase/supabase-js@$RESOLVED -> vendor/supabase-js.esm.js"
echo "($(du -h "$OUT" | cut -f1)). Update the version table in vendor/README.md."
