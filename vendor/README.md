# vendor/

Third-party code, committed rather than installed.

The application has no build step and no `node_modules`: `index.html` loads ES
modules straight from disk. Supabase's client is the one dependency it needs at
runtime, so it is bundled once and checked in. Nothing here is edited by hand.

## supabase-js.esm.js

| | |
| --- | --- |
| Package | `@supabase/supabase-js` |
| Version | 2.112.4 |
| Format | ES module, browser target `es2022`, minified |
| Exports | `createClient` |
| Size | ~211 KB (~50 KB over the wire once gzipped by nginx) |

The published `dist/index.mjs` cannot be loaded directly by a browser — it
imports bare specifiers such as `@supabase/postgrest-js`, which need either a
bundler or an import map. The UMD build would work in a `<script>` tag but
attaches itself to `window`. Bundling it to a self-contained ES module is what
lets `js/api.js` pull it in with an ordinary dynamic `import()`, which in turn
is what keeps it off the critical path: nothing here is downloaded until the
app knows it has a Supabase project configured.

It is served from your own origin, so the content security policy in
`deploy/nginx.conf` does not have to allow a CDN, and the service worker can
cache it like any other asset.

### Regenerating

To move to a newer release:

```sh
tools/vendor-supabase.sh 2.112.4     # or any published version
```

Requires network access to the npm registry. The script downloads the package,
bundles it with esbuild, writes the result here, and prints the version to
record in this table. Commit the regenerated file and update the version above.
