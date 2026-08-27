# The single-file build

`dist/leadconnect.html` is the whole application in one file — styles,
screens, reference data and artwork. Upload it to any web server, or open it
straight from a disk. Nothing to install, no Node or Docker on the server, and
no build step at the far end.

It is the same application as the multi-file build, generated from the same
source. The screens, the scoring, the roles and the keyboard paths are
identical, because they are the same code.

---

## Where your data goes

Open the file in a text editor. The first thing in the script is this:

```js
/* ========================= CONFIG — EDIT THIS ============================ */
window.TEAL_CONFIG = {
  supabaseUrl:     "",
  supabaseAnonKey: "",
  mode: "auto",
  environmentLabel: ""
};
```

That block is the only part meant to be edited, and it decides everything:

| | **Left blank** | **Filled in** |
| --- | --- | --- |
| Data lives | In that browser, on that device | In your Supabase database |
| Shared between devices | No | Yes |
| Shared between people | No | Yes |
| Sign-in | Pick a name from a list | Email and password |
| Setup needed | None | A Supabase project, about ten minutes |

**Blank is fine for a demo, and wrong for an exhibition.** With it blank, two
people at one stand are keeping two separate books that never combine, and
clearing site data erases the lot. Nothing is uploaded, so nothing is backed
up.

To store data properly, put your Supabase project URL and **anon** key in those
two fields. Both are on your Supabase dashboard under Project Settings → API.
Setting the project up is [BACKEND.md](BACKEND.md) — the migrations and the
seed script are the same whichever build you serve.

> **Use the anon key, never the service_role key.** The anon key is a public
> credential and is meant to be readable; the database's row-level security is
> what protects the data. The service_role key bypasses that protection
> entirely, and this file is downloaded by every browser that opens the page.

## Putting it on a server

Copy the file. That is the whole deployment.

```sh
scp dist/leadconnect.html user@yourserver:/var/www/html/index.html
```

It works on shared hosting, an S3 bucket, an intranet IIS box, a network
drive, SharePoint, or GitHub Pages. Two things worth knowing:

- **Serve it over HTTPS** if you have filled in the Supabase fields. Browsers
  block requests from an insecure page to a secure one, so sign-in fails on
  plain HTTP.
- **It also runs with no server at all.** Double-click it, or put it on a USB
  stick. That works because the reference data is carried inside the file
  rather than fetched. Data still saves to that browser.

## Rebuilding it

```sh
npm install --no-save esbuild        # not committed; only needed to build
node tools/build-single-file.js
```

Options:

```sh
# Bake the Supabase details in, instead of editing the file afterwards
node tools/build-single-file.js --supabase-url https://xxx.supabase.co --supabase-key eyJ...

# Device-only build: drops the Supabase client entirely, 351 KB instead of 563 KB
node tools/build-single-file.js --local
```

Then check it:

```sh
node tools/verify-single-file.js
```

32 checks. The one it cares most about is that the page makes **exactly one
network request — itself**. A file that quietly failed to get inlined does not
break the build; it breaks on your server, where the missing request 404s and a
screen renders empty. It also loads the file over `file://` with no server at
all, and captures a lead through the real form to confirm it saves and survives
a reload.

`dist/leadconnect.html` is generated. Do not edit it except for the config
block — change the source and rebuild, or the next build discards your edits.

## What you give up

Worth knowing before you choose this over the multi-file build:

- **No offline shell.** The multi-file build registers a service worker so the
  app opens with no connection. There is no second file to register here. Once
  the page is loaded it keeps working offline — captures still queue and sync —
  but a cold start needs to reach the server.
- **Every visitor downloads the whole file.** 563 KB, or about 150 KB gzipped
  if your server compresses, and none of it is cached in pieces. The multi-file
  build only re-fetches what changed.
- **No content security policy.** That is set by response headers, which need a
  server you configure — `deploy/nginx.conf` in the multi-file build does it.
  On shared hosting you generally cannot.
- **Updating means replacing the file**, and anything a person has captured but
  not yet synced lives in their browser, not in the file. Have people sync
  before you swap it.

If you control the server, the multi-file build in [DEPLOY.md](DEPLOY.md) is
the better deployment. If you do not — shared hosting, an intranet, a laptop at
a stand — this one exists because that is a real situation.
