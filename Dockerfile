# ---------------------------------------------------------------------------
# TEAL LeadConnect — the browser application, served by nginx.
#
# There is no build stage because there is nothing to build: the app is HTML,
# CSS and ES modules that browsers run directly, and the one dependency is
# already vendored. So this is a copy into an nginx image, and the image is a
# few megabytes rather than a few hundred.
#
# The database and the authentication server are Supabase's; this container
# serves the files and terminates nothing. It holds no secrets — the anon key
# it writes into config.json is a public credential, and row-level security is
# what protects the data.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

# Drop the default site so it cannot shadow ours.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY deploy/nginx.conf /etc/nginx/conf.d/leadconnect.conf
COPY deploy/docker-entrypoint.sh /docker-entrypoint.d/40-leadconnect-config.sh
RUN chmod +x /docker-entrypoint.d/40-leadconnect-config.sh

WORKDIR /usr/share/nginx/html

COPY index.html manifest.json sw.js ./
COPY config.example.json ./
COPY assets/ ./assets/
COPY css/    ./css/
COPY js/     ./js/
COPY data/   ./data/
COPY vendor/ ./vendor/

# nginx's own entrypoint runs everything in /docker-entrypoint.d before
# starting, which is where config.json gets written from the environment.
EXPOSE 80

# Fails while nginx is not answering, so an orchestrator restarts it rather
# than leaving a dead container in the rotation.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
