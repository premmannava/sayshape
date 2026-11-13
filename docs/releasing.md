# Releasing to npm

Two packages come out of this repository, always with the same version:

| Package | From | What people run |
|---|---|---|
| `sayshape` | the repository root (`dist/`) | `npm install sayshape` |
| `sayshape-mcp` | `mcp/` (`mcp/dist/`) | `npx -y sayshape-mcp` |

`.github/workflows/publish.yml` publishes them. It never runs for pull requests, it publishes only after someone approves the `npm-release` environment, and it uses npm trusted publishing, so no npm token is stored in the repository and every release carries provenance.

## Checking the packages

```bash
npm run build && npm --prefix mcp run build
npm run verify:pack                         # local tarballs, installed outside the repository
npm run verify:pack -- --registry next      # what npm serves for a tag or version
```

`scripts/verify-pack.mjs` installs each package into a clean temporary project and checks it there: what the package holds (no credentials, no build-machine paths), all five entry points, a card, a chart, a state change, an emit: action reaching the host, the map, scenes staying opt-in, the declarations under bundler, node16 and nodenext resolution, a minimal Vite app painting in Chromium, and for the MCP server its bin, `--help`, a protocol-only stdout, the handshake and tools through a real MCP client, valid and invalid specs, the docs tool, the view resource, themes, `--scene`, `--data`, `--http`, and the page `show_interface` gives text-only clients and the engine version it loads, the plain-script build (`dist/sayshape.global.js` and `dist/sayshape-map.global.js`) painting in Chromium, and the browser end-to-end scripts in `mcp/scripts` pointed at the installed copy. CI runs it on Node 20, 22 and 24. `--no-browser` skips the Chromium parts; `--keep` keeps the temporary projects.

## A normal release

1. Bump `version` in both `package.json` and `mcp/package.json` to the same new version, merge to `main`, and wait for CI to pass on `main`.
2. Tag that commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow checks that the tag matches both versions, that the commit is on `main` and passed CI, and that neither version is on npm yet. It builds, runs `verify:pack`, and packs the tarballs (their SHA-256 sums are in the run summary).
4. Approve the `npm-release` deployment. It publishes exactly those tarballs to the `next` dist-tag.
5. It then installs both from npm into clean projects and runs `verify:pack -- --registry <version>`.
6. When that passes, run the workflow by hand (Actions → Publish to npm → Run workflow) with the version and **promote** ticked. It checks the version from npm once more and, after approval, moves `latest` to it.

### The hosted server

The public MCP server (`deploy/cloud-run/Dockerfile`, behind the Worker in `deploy/cloudflare`) installs an exact `sayshape-mcp` version from npm, so it can only be built once that version is published. Its Cloud Build trigger is set to manual for that reason: a push deploys nothing.

Before step 1, change the version in `deploy/cloud-run/Dockerfile` along with the others. After step 6, in the Google Cloud console open Cloud Build → Triggers and press **Run** on the `sayshape` trigger (branch `main`). Then check what the server reports:

```bash
curl -s -X POST https://mcp.sayshape.workers.dev/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' | grep -o '"version":"[^"]*"'
```

Chat apps keep the tool description they read when the connector was added, so reconnect the connector to see a new one.

### The engine version the text-only page loads

`show_interface` gives chat apps that can't draw MCP Apps views an HTML page that loads `sayshape@<version>/dist/sayshape.global.js` from jsDelivr. The version is `PAGE_ENGINE_VERSION` in `mcp/src/fallback.ts`, pinned exactly, and it is **not** the version being released: some chat apps only let a page load a package version from a CDN once it has been public for two weeks, so a page pointing at a release published the same day would fail right when people install it.

At each release, before step 1: set `PAGE_ENGINE_VERSION` to the newest `sayshape` version that has been on npm for at least 14 days (`npm view sayshape time`), never later than the version being released. If none is old enough yet, leave it. `verify:pack -- --registry <version>` checks that the pinned version is on npm with `dist/sayshape.global.js` and says how old it is. The first version with that file is 0.1.1, so until 0.1.1 has been out for two weeks the page works in browsers (once 0.1.1 is published) but not in chat apps with that rule.

The trade-off: the page can draw with an engine one release older than the server that checked the spec, so an element added in the newest release may not draw on the page yet.

If one package publishes and the other fails, don't unpublish: fix the cause, bump the version for both and release again. npm never accepts the same version twice.

## One-time setup

### GitHub

Settings → Environments → **New environment** `npm-release`:

- Required reviewers: the maintainers allowed to release.
- Deployment branches and tags: **Selected**, add the tag rule `v*.*.*` and the branch `main` (the promote run starts from `main`).

### The first release (bootstrap)

npm only lets you set up a trusted publisher for a package that already exists, so the first version of each package needs another way in. Pick one:

**A. From your own machine** (simplest; this one version has no provenance):

```bash
npm login                                   # an npm account with 2FA turned on
npm ci && npm ci --prefix mcp
npm run build && npm --prefix mcp run build
npm run verify:pack
npm pack && (cd mcp && npm pack --pack-destination ..)
npm publish sayshape-0.1.0.tgz --tag next --access public
npm publish sayshape-mcp-0.1.0.tgz --tag next --access public
```

**B. From the workflow with a short-lived token** (the first version gets provenance and is built from the tagged commit):

1. On npmjs.com → Access Tokens → Generate New Token → **Granular Access Token**: read and write, all packages (the new names don't exist yet), the shortest expiry, and bypass 2FA (a workflow can't answer a 2FA prompt).
2. Add it as a secret named `NPM_BOOTSTRAP_TOKEN` on the `npm-release` environment, not the repository, so only approved release runs can read it.
3. Push the `v0.1.0` tag and approve the run.
4. Straight after: delete the `NPM_BOOTSTRAP_TOKEN` secret and revoke the token on npmjs.com.

Either way, npm makes the very first version of a new package `latest` as well as `next`, because a package must have a `latest`. That's why the website only mentions npm after the registry checks pass.

### Trusted publishing (once both packages exist)

For each package, on npmjs.com → the package → Settings → **Trusted Publisher** → GitHub Actions: owner `premmannava`, repository `sayshape`, workflow `publish.yml`, environment `npm-release`. Or from a terminal (npm 11.15+, an account with 2FA):

```bash
npm trust github sayshape --file publish.yml --repo premmannava/sayshape --env npm-release --allow-publish
npm trust github sayshape-mcp --file publish.yml --repo premmannava/sayshape --env npm-release --allow-publish
```

Then, once a release has gone through it, set Settings → Publishing access → **Require two-factor authentication and disallow tokens** on both packages. Trusted publishing still works; tokens no longer can.

The workflow publishes with Node 24 and npm 11.21 or later: trusted publishing needs npm 11.5.1+ on Node 22.14+, and moving a dist-tag through it needs npm 11.21+. `repository.url` in both `package.json` files must stay `git+https://github.com/premmannava/sayshape.git`, or npm refuses the publish.

## Node versions

- `sayshape` (the library) works in browsers and in Node 18 or later (`sayshape/testing`, `sayshape/model`).
- `sayshape-mcp` needs Node 20 or later. `--data` uses Node's built-in SQLite and needs **Node 22.13 or later**; on older Node it stops with a message saying so. Node 20 is past its end of life, so the docs recommend Node 22 or 24.
