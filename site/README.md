# zach

zach's biolink page, live at https://haunted.ong (www.haunted.ong and zachxbt.boo serve the same thing). It's built on the layout of [zolowhos/zolo](https://github.com/zolowhos/zolo): three full-screen sections that snap as you scroll, over a slowly flowing grey "damascus" WebGL background.

1. **Profile.** Avatar, name and glowing link icons.
2. **About me.** Bio, a profile chip that links to GitHub, a rolling clock in the visitor's local time, and optional skill pills.
3. **Projects.** Cards that open on click, plus "view more".

`/projects/` lists every project, and `/projects/#<id>` opens one.

Plain HTML, CSS and JS: classic script tags, no framework, no build step, no npm dependencies.

```
site/
  index.html           profile, about, projects
  projects/index.html  all projects, one at a time at #id
  config.js            all content
  css/styles.css
  js/shared.js         element builder and icons
  js/app.js            home page: sections, clock, cards, background
  js/projects.js       /projects/
  assets/              pfp.webp, projects/*.jpg, Rubik-Regular.ttf (SIL OFL)
  screenshots/         review captures (not deployed)
```

## Run it locally

```bash
python3 -m http.server 5173 --directory site
```

Then open http://localhost:5173/. Paths are root-relative (`/css/…`), so serve `site/` as the root.

## Edit it

Everything visible lives in `config.js`:

- Name, handle, bio and avatar.
- `links`: the glowing icons, which can be `github`, `globe` or `x`. The first link is also where the profile chip points.
- `skills`: the pills under the about cards. Leave the list empty to hide them.
- `projects.items`: newest first. Each project has a title, a photo in `assets/projects/`, chips, a one-line summary, a longer body and link buttons. The home page shows the first `projects.featured` of them. Each `id` becomes its link (`/projects/#zach`), so don't change an id once it's published.

## Deploy

The site is a Cloudflare Worker serving `site/` as static assets: Worker `zachxbt-boo`, config in `wrangler.jsonc` at the repo root. `site/.assetsignore` keeps `README.md`, `screenshots/` and `.claude/` out of the upload. To redeploy after editing, run from the repo root:

```bash
nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#nodejs_22 --command npx --yes wrangler@4 deploy
```

- Domains: haunted.ong, www.haunted.ong and zachxbt.boo. These are custom domains, so Cloudflare manages the DNS records and certificates. `admin.haunted.ong` belongs to the `haunted-ong-mirror` Worker and isn't touched.
- The old "haunted" profile is still deployed as `haunted-ong-mirror`, and a copy of its page is in `backups/haunted-ong-2026-11-08/`.

## Source

The code is on GitHub at [whozach/zach](https://github.com/whozach/zach). The local repo commits and pushes as whozach whichever `gh` account is active: it has a per-repo credential helper that asks `gh` for whozach's token. Push with plain `git push`.

## Motion

- **Background.** The damascus shader flows slowly. It stays near-black on the first screen and lightens toward grey as you scroll.
- **Sections.** Each one drops in as it scrolls into view, in browsers with scroll-driven animations.
- **Clock.** The digits roll.

Nothing follows the mouse. Reduced motion stops all of it.

## Changes from the zolo source

- **Removed:** the music player, the crypto-address copy buttons, the subscriber badge, the Discord presence lookup (japi.rest) and the offsets page (proxy.cors.dev). No third-party calls.
- **Monotone:** the green online dot and the coloured skill icons are gone.
