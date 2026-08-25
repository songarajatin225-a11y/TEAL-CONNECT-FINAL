#!/bin/sh
# ---------------------------------------------------------------------------
# Write config.json from the environment, before nginx starts.
#
# The app has no build step, so there is no compile-time substitution: it reads
# its configuration at runtime. That is what lets one image run against
# staging and production without being rebuilt, and it is why this file exists
# rather than a baked-in constant.
#
# Run by nginx's own entrypoint, which executes everything in
# /docker-entrypoint.d in order before handing over to the server.
# ---------------------------------------------------------------------------
set -eu

# Generated files go to a tmpfs, not into the image's document root: the
# container runs with a read-only filesystem, and configuration regenerated on
# every start has no business being written into an immutable image anyway.
# nginx serves config.json from here by alias.
GENERATED=/run/leadconnect
mkdir -p "$GENERATED"
TARGET="$GENERATED/config.json"

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
APP_MODE="${APP_MODE:-auto}"
ENVIRONMENT_LABEL="${ENVIRONMENT_LABEL:-}"

# A service-role key here would be published to every visitor: it is in a file
# the browser downloads. Refuse to start rather than serve it even once — by
# the time anyone notices, it has been handed out.
case "$SUPABASE_ANON_KEY" in
  *service_role*)
    echo "FATAL: SUPABASE_ANON_KEY looks like a service_role key." >&2
    echo "       That key bypasses row-level security and this file is public." >&2
    echo "       Use the anon / publishable key instead." >&2
    exit 1 ;;
esac

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "leadconnect: no SUPABASE_URL/SUPABASE_ANON_KEY set — starting in demo mode." >&2
  echo "             Nothing will be saved to a server. See DEPLOY.md." >&2
fi

# Escape anything that would break out of a JSON string. The values come from
# the operator's environment, but a stray quote should produce a clear failure
# rather than a config.json the app cannot parse.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > "$TARGET" <<JSON
{
  "_comment": "Generated at container start from the environment. Edits here are lost on restart.",
  "supabaseUrl": "$(esc "$SUPABASE_URL")",
  "supabaseAnonKey": "$(esc "$SUPABASE_ANON_KEY")",
  "mode": "$(esc "$APP_MODE")",
  "environmentLabel": "$(esc "$ENVIRONMENT_LABEL")"
}
JSON

# The content security policy has to name the Supabase origin explicitly:
# connect-src cannot be widened at runtime from inside the page.
CSP_CONNECT="'self'"
if [ -n "$SUPABASE_URL" ]; then
  # Include the websocket origin as well, so Supabase realtime keeps working
  # if this app ever subscribes to changes.
  WS_ORIGIN=$(printf '%s' "$SUPABASE_URL" | sed -e 's|^http://|ws://|' -e 's|^https://|wss://|')
  CSP_CONNECT="'self' $SUPABASE_URL $WS_ORIGIN"
fi

# Deliberately not under conf.d/: nginx auto-includes that directory at http
# level, and `set` is only valid inside a server or location block. This is
# included explicitly from the server block in leadconnect.conf.
cat > "$GENERATED/csp.conf" <<CONF
# Generated at container start. connect-src names the configured Supabase
# project; everything else is locked to this origin.
set \$leadconnect_csp "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src ${CSP_CONNECT}";
CONF

echo "leadconnect: config.json written (mode=${APP_MODE}, project=${SUPABASE_URL:-none})"
