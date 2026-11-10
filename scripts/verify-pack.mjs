// Checks the two npm packages the way someone who never cloned this
// repository gets them: installed into clean projects outside it.
//
//   node scripts/verify-pack.mjs                 pack dist/ and mcp/dist/ (build both first)
//   node scripts/verify-pack.mjs --registry next install sayshape@next and sayshape-mcp@next from npm
//   options: --only lib|mcp   --no-browser   --keep (leave the temporary projects)
//
// The library: what the package holds, imports of all five entry points in
// Node, a card, a chart with data, a state change through a control, an emit:
// action reaching the host, the map, scenes staying opt-in, the declarations
// under both bundler and node16 resolution, and a minimal Vite app that
// bundles and paints in Chromium.
//
// The MCP server: what the package holds, its bin and shebang, --help, stdout
// carrying only protocol messages, the handshake and tools through a real MCP
// client, valid and invalid specs, the docs tool, the UI resource, themes,
// scenes only with --scene, --data, --mcp-result, --http, and then the browser
// end-to-end checks in mcp/scripts run against the installed copy.
//
// Exits 1 if anything fails, and keeps the temporary projects to look at.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const registryTag = option("--registry");
const only = option("--only");
const browserChecks = !flag("--no-browser");
const keep = flag("--keep");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const rootPkg = json(join(repo, "package.json"));
const mcpPkg = json(join(repo, "mcp/package.json"));

const work = mkdtempSync(join(tmpdir(), "sayshape-verify-"));
if (work.startsWith(repo)) throw new Error("the temporary folder is inside the repository");

let failures = 0;
let passes = 0;
function check(ok, what, detail) {
  if (ok) {
    passes++;
    console.log(`  ✓ ${what}`);
  } else {
    failures++;
    console.log(`  ✗ ${what}${detail ? `\n      ${String(detail).split("\n").join("\n      ")}` : ""}`);
  }
  return ok;
}
function section(title) {
  console.log(`\n${title}`);
}

/** Runs a command; returns { status, stdout, stderr }. */
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function newProject(name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `verify-${name}`, private: true, type: "module" }, null, 2));
  return dir;
}
function install(dir, specs) {
  const r = run(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", ...specs], { cwd: dir });
  if (!check(r.status === 0, `npm install ${specs.map((s) => (s.endsWith(".tgz") ? relative(work, s) : s)).join(" ")}`, r.stderr.trim())) {
    throw new Error("install failed");
  }
}
function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      // Dependencies npm nests under the package aren't part of it.
      if (statSync(p).isDirectory()) {
        if (name !== "node_modules") walk(p);
      }
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

// Things that must never be published: keys and tokens, and paths from the machine that built it.
const SECRETS = [
  [/sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{24,}/, "an API key (sk-…)"],
  [/nvapi-[A-Za-z0-9_-]{20,}/, "an NVIDIA API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/\bnpm_[A-Za-z0-9]{30,}/, "an npm token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];
function checkContents(dir, label, allowed) {
  const list = files(dir);
  const extra = list.filter((f) => !allowed.some((a) => (a instanceof RegExp ? a.test(f) : a === f)));
  check(extra.length === 0, `${label} holds only what users need (${list.length} files)`, extra.slice(0, 20).join("\n"));
  for (const need of ["package.json", "README.md", "LICENSE"]) check(list.includes(need), `${label} includes ${need}`);
  check(/^MIT License/.test(readFileSync(join(dir, "LICENSE"), "utf8")) && json(join(dir, "package.json")).license === "MIT", `${label} is MIT licensed`);
  const found = [];
  for (const f of list) {
    if ([".woff2", ".png"].includes(extname(f))) continue;
    const text = readFileSync(join(dir, f), "utf8");
    for (const [re, what] of SECRETS) if (re.test(text)) found.push(`${f}: ${what}`);
    if (text.includes(repo)) found.push(`${f}: the build machine's path ${repo}`);
  }
  check(found.length === 0, `${label} has no credentials or build-machine paths`, found.join("\n"));
}

function expectedVersion(name, localVersion) {
  if (!registryTag) return localVersion;
  const r = run(npm, ["view", `${name}@${registryTag}`, "version"]);
  return r.stdout.trim().split("\n").pop()?.replace(/^.*'(.+)'$/, "$1");
}

function packLocal(dir, label) {
  mkdirSync(join(work, "tarballs"), { recursive: true });
  const r = run(npm, ["pack", "--json", "--pack-destination", join(work, "tarballs")], { cwd: dir });
  if (r.status !== 0) throw new Error(`npm pack ${label} failed:\n${r.stderr}`);
  return join(work, "tarballs", JSON.parse(r.stdout)[0].filename);
}

function freePort() {
  return new Promise((done) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

async function loadPlaywright() {
  if (!browserChecks) return null;
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    return browser;
  } catch (e) {
    check(false, "Chromium is available for the browser checks (npx playwright install chromium, or pass --no-browser)", e.message.split("\n")[0]);
    return null;
  }
}

// ─── The library ────────────────────────────────────────────────────────────

const RUNTIME = `
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SayShape, coreComponents, parse, Registry } from "sayshape";
import { render } from "sayshape/testing";
import { mapComponents } from "sayshape/map";
import { sceneComponents } from "sayshape/scene";
import * as model from "sayshape/model";

const results = [];
const check = (ok, what, detail) => results.push({ ok: !!ok, what, detail: ok ? undefined : detail });
const errors = (ui) => ui.diagnostics.filter((d) => d.severity === "error");
const example = (list, name) => list.find((c) => c.type === name)?.example;

for (const entry of ["sayshape", "sayshape/map", "sayshape/scene", "sayshape/testing", "sayshape/model"]) {
  const at = realpathSync(fileURLToPath(import.meta.resolve(entry)));
  check(at.startsWith(realpathSync(process.cwd())), entry + " resolves inside this project's node_modules", at);
}
check(typeof SayShape === "function" && coreComponents.length > 40, "imports SayShape and coreComponents (" + coreComponents.length + " components)");
check(parse('card\\n  text "Hi"', new Registry(coreComponents)).diagnostics.length === 0, "parse() and Registry work");
check(Object.keys(model).length > 0, "sayshape/model exports " + Object.keys(model).length + " names");

let ui = render('card\\n  text "Hello from npm" style=title');
check(errors(ui).length === 0 && ui.isShown({ text: "Hello from npm" }) && ui.drawOps.length > 0, "renders a simple card", JSON.stringify(ui.diagnostics));

ui = render(example(coreComponents, "chart"));
check(errors(ui).length === 0 && ui.find({ type: "chart" }).box && ui.drawOps.length > 20, "renders a chart with data", JSON.stringify(ui.diagnostics));

ui = render('state n=1\\ncard\\n  text "Count is {n}"\\n  button "Add one" on=inc:n');
ui.press({ type: "button", text: "Add one" });
check(ui.state.n === 2 && ui.isShown({ text: "Count is 2" }), "a button changes state and the screen follows", JSON.stringify(ui.state));

ui = render('state hikers=3\\nbutton "Plan this trip" on=emit:plan_trip:{hikers}');
const heard = [];
ui.sayshape.on("action", (a) => heard.push(a));
ui.press({ type: "button", text: "Plan this trip" });
check(heard.length === 1 && heard[0].name === "plan_trip" && heard[0].value === 3, "the host receives an emit: action with its value", JSON.stringify(heard.map(({ name, value }) => ({ name, value }))));

ui = render(example(mapComponents, "map"), { components: [...coreComponents, ...mapComponents] });
check(errors(ui).length === 0 && ui.find({ type: "map" }).box, "renders a map from sayshape/map", JSON.stringify(ui.diagnostics));

const scene = example(sceneComponents, "scene");
check(errors(render(scene)).length > 0, "scenes stay off unless the host registers them");
ui = render(scene, { components: [...coreComponents, ...sceneComponents] });
check(errors(ui).length === 0 && ui.find({ type: "scene" }).box, "renders a scene once sayshape/scene is registered", JSON.stringify(ui.diagnostics));

console.log(JSON.stringify(results));
`;

const TYPES = `
import { SayShape, coreComponents, parse, Registry, type SayShapeOptions, type SayShapeEvents } from "sayshape";
import { mapComponents } from "sayshape/map";
import { sceneComponents } from "sayshape/scene";
import { render, type Rendered } from "sayshape/testing";
import * as model from "sayshape/model";

const options: SayShapeOptions = { components: [...coreComponents, ...mapComponents, ...sceneComponents] };
const onAction = (a: SayShapeEvents["action"]): string => a.name;
const ui: Rendered = render('text "Hi"');
const lines: number[] = parse('text "Hi"', new Registry(coreComponents)).diagnostics.map((d) => d.line);
export const used = [SayShape, options, onAction, ui, lines, model];
`;

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>SayShape consumer</title></head>
<body style="margin:0;background:#fff"><div id="app" style="width:480px"><canvas></canvas></div><script type="module" src="./main.ts"></script></body></html>`;

const APP_MAIN = `
import { SayShape, coreComponents } from "sayshape";
const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const ui = new SayShape(canvas, { components: coreComponents, width: 480 });
const heard: string[] = [];
ui.on("action", (a) => heard.push(a.name));
ui.on("render", () => { (window as any).painted = true; });
ui.setSpec('state n=2\\ncard\\n  text "Bundled with Vite" style=title\\n  chart "Sales" kind=bar items=[{m: "Jan", v: 3}, {m: "Feb", v: 5}] x=m y=v\\n  button "Send" on=emit:sent');
(window as any).heard = heard;
`;

async function verifyLibrary(browser) {
  section(`Library: ${registryTag ? `sayshape@${registryTag} from npm` : "sayshape from a local tarball"}`);
  const spec = registryTag ? `sayshape@${registryTag}` : packLocal(repo, "sayshape");
  const want = expectedVersion("sayshape", rootPkg.version);
  const dir = newProject("library");
  const tsVersion = rootPkg.devDependencies.typescript;
  const viteVersion = rootPkg.devDependencies.vite;
  install(dir, [spec, `typescript@${tsVersion}`, `vite@${viteVersion}`]);
  const pkgDir = join(dir, "node_modules/sayshape");
  const installed = json(join(pkgDir, "package.json"));
  check(installed.version === want, `installed version is ${want}`, `got ${installed.version}`);
  check(!installed.dependencies || Object.keys(installed.dependencies).length === 0, "has no runtime dependencies");
  checkContents(pkgDir, "the package", ["package.json", "README.md", "LICENSE", /^dist\/[\w.-]+\.js(\.map)?$/, /^dist\/types\/.+\.d\.ts$/]);
  for (const [sub, target] of Object.entries(installed.exports)) {
    check(existsSync(join(pkgDir, target.import)) && existsSync(join(pkgDir, target.types)), `exports "${sub}" points at real files`);
  }

  writeFileSync(join(dir, "runtime.mjs"), RUNTIME);
  const r = run(process.execPath, ["runtime.mjs"], { cwd: dir });
  let results = [];
  try {
    results = JSON.parse(r.stdout.trim().split("\n").pop() ?? "[]");
  } catch {
    check(false, "the Node checks ran", r.stderr || r.stdout);
  }
  for (const x of results) check(x.ok, x.what, x.detail);

  writeFileSync(join(dir, "types.ts"), TYPES);
  const tsc = join(dir, "node_modules/typescript/bin/tsc");
  for (const [resolution, mod] of [["bundler", "esnext"], ["node16", "node16"], ["nodenext", "nodenext"]]) {
    const t = run(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "es2022", "--lib", "es2022,dom", "--module", mod, "--moduleResolution", resolution, "types.ts"], { cwd: dir });
    check(t.status === 0, `TypeScript ${tsVersion} compiles against the declarations (moduleResolution ${resolution}, skipLibCheck off)`, (t.stdout + t.stderr).trim().split("\n").slice(0, 8).join("\n"));
  }

  const app = join(dir, "app");
  mkdirSync(app);
  writeFileSync(join(app, "index.html"), APP_HTML);
  writeFileSync(join(app, "main.ts"), APP_MAIN);
  const v = run(process.execPath, [join(dir, "node_modules/vite/bin/vite.js"), "build", "app", "--outDir", "dist", "--logLevel", "error"], { cwd: dir });
  const built = join(app, "dist");
  check(v.status === 0 && existsSync(join(built, "index.html")), `a minimal Vite ${viteVersion} app bundles it`, (v.stdout + v.stderr).trim());
  if (browser && v.status === 0) await checkAppInBrowser(browser, built);
}

async function checkAppInBrowser(browser, root) {
  const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!path.startsWith(root) || !existsSync(path)) return res.writeHead(404).end();
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(path)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(readFileSync(path));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const page = await browser.newPage({ viewport: { width: 520, height: 700 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.painted === true, null, { timeout: 15000 });
    // The first frames fade the content in, so count once the picture stops changing.
    const measure = () => page.evaluate(() => {
      const c = document.querySelector("canvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200)) n++;
      return { n, w: c.width, h: c.height };
    });
    let inked = await measure();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const next = await measure();
      const settled = next.n === inked.n && next.h === inked.h;
      inked = next;
      if (settled && inked.n > 500) break;
    }
    check(inked.n > 500 && inked.h > 100, `the bundled app paints in Chromium (${inked.w}×${inked.h}, ${inked.n} inked pixels)`);
    await page.locator("canvas").focus();
    for (let i = 0; i < 8 && (await page.evaluate(() => window.heard.length)) === 0; i++) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
    }
    check((await page.evaluate(() => window.heard)).includes("sent"), "pressing its button from the keyboard sends an action to the host");
    check(errors.length === 0, "no errors in the page", errors.join("\n"));
  } catch (e) {
    check(false, "the bundled app runs in Chromium", e.message);
  } finally {
    await page.close();
    server.close();
  }
}

// ─── The MCP server ─────────────────────────────────────────────────────────

async function verifyMcp(browser) {
  section(`MCP server: ${registryTag ? `sayshape-mcp@${registryTag} from npm` : "sayshape-mcp from a local tarball"}`);
  const spec = registryTag ? `sayshape-mcp@${registryTag}` : packLocal(join(repo, "mcp"), "sayshape-mcp");
  const want = expectedVersion("sayshape-mcp", mcpPkg.version);
  const dir = newProject("mcp");
  install(dir, [spec, `@modelcontextprotocol/sdk@${mcpPkg.dependencies["@modelcontextprotocol/sdk"]}`]);
  const pkgDir = join(dir, "node_modules/sayshape-mcp");
  const installed = json(join(pkgDir, "package.json"));
  check(installed.version === want, `installed version is ${want}`, `got ${installed.version}`);
  checkContents(pkgDir, "the package", ["package.json", "README.md", "LICENSE", "dist/server.js", "dist/ui.html"]);
  check(readFileSync(join(pkgDir, "dist/server.js"), "utf8").startsWith("#!/usr/bin/env node\n"), "server.js starts with the Node shebang");
  for (const dep of Object.keys(installed.dependencies ?? {})) check(existsSync(join(dir, "node_modules", dep, "package.json")), `runtime dependency ${dep} was installed with it`);
  const bin = join(dir, "node_modules/.bin", process.platform === "win32" ? "sayshape-mcp.cmd" : "sayshape-mcp");
  check(existsSync(bin), "npm linked the sayshape-mcp command");

  const help = run(npx, ["--no-install", "sayshape-mcp", "--help"], { cwd: dir });
  check(help.status === 0 && help.stdout === "" && /Usage: sayshape-mcp/.test(help.stderr), "npx sayshape-mcp --help prints usage to stderr, nothing to stdout", help.stdout + help.stderr);
  if (registryTag) {
    const empty = newProject("npx");
    const n = run(npx, ["-y", `sayshape-mcp@${registryTag}`, "--help"], { cwd: empty });
    check(n.status === 0 && /Usage: sayshape-mcp/.test(n.stderr), `npx -y sayshape-mcp@${registryTag} runs from an empty folder`, n.stdout + n.stderr);
  }

  await checkStdoutIsProtocol(join(pkgDir, "dist/server.js"));

  const { Client } = await import(join(dir, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"));
  const { StdioClientTransport } = await import(join(dir, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"));
  const { StreamableHTTPClientTransport } = await import(join(dir, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js"));
  const connect = async (flags) => {
    const client = new Client({ name: "sayshape-verify", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(pkgDir, "dist/server.js"), ...flags], cwd: dir, stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", (d) => (stderr += d));
    await client.connect(transport);
    return { client, stderr: () => stderr };
  };
  const text = (r) => (r.content ?? []).map((c) => c.text ?? "").join("\n");

  // Default settings.
  const { client, stderr } = await connect([]);
  try {
    const server = client.getServerVersion();
    check(server?.name === "sayshape" && server?.version === want, `initialize handshake completes (server ${server?.name} ${server?.version})`);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    check(tools.includes("show_interface") && tools.includes("sayshape_docs"), `exposes show_interface and sayshape_docs (${tools.join(", ")})`);
    check(!tools.includes("query_data"), "has no data tools without --data");

    const good = await client.callTool({ name: "show_interface", arguments: { spec: 'state n=1\ncard\n  text "From the npm package" style=title\n  button "Add" on=inc:n' } });
    check(!good.isError && good.structuredContent?.errors === 0 && good.structuredContent?.toFix === 0, "show_interface accepts a valid spec", JSON.stringify(good.structuredContent));
    const bad = await client.callTool({ name: "show_interface", arguments: { spec: 'card\n  txet "Typo"\n  button "Go" on=nope:x' } });
    check(bad.structuredContent?.toFix >= 1 && /line 2/i.test(text(bad)) && /txet/.test(text(bad)), "an invalid spec gets line-numbered problems to fix", text(bad).slice(0, 400));
    const docs = await client.callTool({ name: "sayshape_docs", arguments: { elements: ["chart", "stepper"] } });
    check(!docs.isError && /chart/.test(text(docs)) && /stepper/.test(text(docs)), "sayshape_docs returns the docs for the elements asked for");
    const scene = await client.callTool({ name: "show_interface", arguments: { spec: 'scene "Dot" w=200 h=100\n  circle x=100 y=50 r=20 fill="#E63946"' } });
    check(scene.structuredContent?.toFix >= 1, "scenes are refused without --scene");

    const resources = (await client.listResources()).resources;
    const uri = resources.find((r) => r.uri.startsWith("ui://"))?.uri;
    const ui = uri ? (await client.readResource({ uri })).contents[0] : undefined;
    const html = ui?.text ?? "";
    check(!!uri && /html/.test(ui?.mimeType ?? ""), `serves the view as an HTML resource (${uri}, ${ui?.mimeType})`);
    check(html.length > 100_000 && /<script>/.test(html) && /data:font\/woff2;base64/.test(html), `the view is self-contained: script and fonts inlined (${(html.length / 1024).toFixed(0)} KB)`);
    check(!/\b(src|href)=["']https?:/i.test(html), "the view loads nothing from another origin");
    check(/<meta name="sayshape-view" content="[^"]*theme=teal/.test(html), "the default theme is teal");
    check(stderr().trim() === "", "a normal run writes nothing to stderr", stderr());
  } finally {
    await client.close();
  }

  // Studio theme, theme picker and scenes.
  const studio = await connect(["--theme", "studio", "--theme-picker", "--scene"]);
  try {
    const uri = (await studio.client.listResources()).resources[0].uri;
    const html = (await studio.client.readResource({ uri })).contents[0].text;
    const meta = html.match(/<meta name="sayshape-view" content="([^"]*)"/)?.[1] ?? "";
    check(/theme=studio/.test(meta) && /picker=1/.test(meta) && /scene=1/.test(meta), `--theme studio --theme-picker --scene reach the view (${meta})`);
    const scene = await studio.client.callTool({ name: "show_interface", arguments: { spec: 'scene "Dot" w=200 h=100\n  circle x=100 y=50 r=20 fill="#E63946"' } });
    check(scene.structuredContent?.toFix === 0, "with --scene, a scene is accepted", text(scene).slice(0, 300));
  } finally {
    await studio.client.close();
  }

  // --data (Node's built-in SQLite, Node 22.13 or later).
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 13)) {
    const { createRequire } = await import("node:module");
    // Quiet Node's "SQLite is experimental" warning; the server does the same.
    const emitWarning = process.emitWarning;
    process.emitWarning = () => {};
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
    process.emitWarning = emitWarning;
    const dbPath = join(dir, "shop.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE sales (month TEXT, revenue INTEGER); INSERT INTO sales VALUES ('Jan', 120), ('Feb', 180), ('Mar', 150);");
    db.close();
    const data = await connect(["--data", dbPath]);
    try {
      const tools = (await data.client.listTools()).tools.map((t) => t.name);
      check(tools.includes("describe_data") && tools.includes("query_data"), "--data adds the data tools");
      const described = await data.client.callTool({ name: "describe_data", arguments: {} });
      check(/sales/.test(text(described)) && /revenue/.test(text(described)), "describe_data lists the tables and columns");
      const q = await data.client.callTool({ name: "query_data", arguments: { sql: "SELECT month, revenue FROM sales ORDER BY revenue DESC" } });
      check(!q.isError && /3 rows/.test(text(q)), "query_data runs a read-only query", text(q).slice(0, 300));
      const w = await data.client.callTool({ name: "query_data", arguments: { sql: "DELETE FROM sales" } });
      check(w.isError || /read-only|only SELECT|SELECT/i.test(text(w)), "query_data refuses writes");
      check(/reading .*shop\.db/.test(data.stderr()), "its notes go to stderr");
    } finally {
      await data.client.close();
    }
  } else {
    const r = run(process.execPath, [join(pkgDir, "dist/server.js"), "--data", join(dir, "missing.db")], { cwd: dir, timeout: 15000 });
    check(r.status !== 0 && /Node\.js 22\.13/.test(r.stderr) && r.stdout === "", `on Node ${process.versions.node}, --data stops with a clear message that it needs Node 22.13+`, r.stderr.trim());
  }

  // --http.
  const port = await freePort();
  const http = spawn(process.execPath, [join(pkgDir, "dist/server.js"), "--http", String(port)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let httpErr = "";
  http.stderr.on("data", (d) => (httpErr += d));
  try {
    for (let i = 0; i < 100 && !httpErr.includes(`:${port}/mcp`); i++) await new Promise((r) => setTimeout(r, 100));
    const client = new Client({ name: "sayshape-verify-http", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    check(tools.includes("show_interface"), `--http serves MCP on http://127.0.0.1:${port}/mcp`);
    await client.close();
  } catch (e) {
    check(false, "--http serves MCP", `${e.message}\n${httpErr}`);
  } finally {
    http.kill();
  }

  // The existing end-to-end checks, pointed at the installed copy.
  const e2e = [["e2e-import.mjs", "--mcp-result import (no browser)", false], ["e2e.mjs", "the view in a sandboxed iframe: handshake, streaming, themes, an emit: action back to the chat", true], ["e2e-data.mjs", "--data from the model's query to the rows in the view", true]];
  for (const [script, what, needsBrowser] of e2e) {
    if (needsBrowser && !browser) {
      console.log(`  - skipped ${script} (no browser)`);
      continue;
    }
    if (script === "e2e-data.mjs" && !(major > 22 || (major === 22 && minor >= 13))) continue;
    if (!existsSync(join(repo, "mcp/node_modules/@playwright/test"))) {
      check(false, `mcp/scripts/${script} needs the repository's mcp dependencies (npm ci --prefix mcp)`);
      continue;
    }
    const r = run(process.execPath, [join(repo, "mcp/scripts", script)], { cwd: join(repo, "mcp"), env: { ...process.env, SAYSHAPE_MCP_DIST: join(pkgDir, "dist") } });
    check(r.status === 0, `installed copy passes mcp/scripts/${script}: ${what}`, (r.stdout + r.stderr).trim().split("\n").slice(-12).join("\n"));
  }
}

/** Starts the server, sends initialize and tools/list by hand, and checks every stdout line is a JSON-RPC message. */
async function checkStdoutIsProtocol(serverJs) {
  const child = spawn(process.execPath, [serverJs], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  for (let i = 0; i < 100 && out.split("\n").filter(Boolean).length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  child.kill();
  const lines = out.split("\n").filter(Boolean);
  const bad = lines.filter((l) => {
    try {
      return JSON.parse(l).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });
  check(lines.length >= 2 && bad.length === 0, `stdout carries only JSON-RPC messages (${lines.length} lines)`, bad.slice(0, 3).join("\n") || out.slice(0, 300));
}

// ─── Run ────────────────────────────────────────────────────────────────────

console.log(`SayShape package check on Node ${process.versions.node}, in ${work}`);
if (!registryTag) {
  for (const [dir, need] of [[repo, "dist/sayshape.js"], [join(repo, "mcp"), "dist/server.js"]]) {
    if (!existsSync(join(dir, need))) throw new Error(`${relative(repo, join(dir, need))} is missing: build first (npm run build, npm --prefix mcp run build)`);
  }
}
const browser = await loadPlaywright();
try {
  if (only !== "mcp") await verifyLibrary(browser).catch((e) => check(false, "library checks ran to the end", e.stack));
  if (only !== "lib") await verifyMcp(browser).catch((e) => check(false, "MCP checks ran to the end", e.stack));
} finally {
  await browser?.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures === 0 && !keep) rmSync(work, { recursive: true, force: true });
else console.log(`Temporary projects kept in ${work}`);
process.exit(failures ? 1 : 0);
