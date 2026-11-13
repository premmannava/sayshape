import { defineConfig, type DefaultTheme, type HeadConfig } from "vitepress";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../../src/component";
import { sayShapeLivePlugin } from "./markdown";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sayShapeGrammar = JSON.parse(readFileSync(here("./sayshape.tmLanguage.json"), "utf8"));

const REPO = "https://github.com/premmannava/sayshape";
// The site's path on GitHub Pages: the repository's name. Change SITE_BASE if the repository is renamed.
const BASE = process.env.SITE_BASE ?? "/sayshape/";
const SITE_URL = `https://premmannava.github.io${BASE}`;
const TITLE = "SayShape";
const DESCRIPTION = "A UI language for AI models to write, and a canvas engine that renders it: parser, layout, painting, state and input of its own.";


/** A page's own address, written the way the sitemap writes it: an index page as its folder, any other as .html. */
const pageUrl = (relativePath: string) =>
  SITE_URL + relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, ".html");

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

const docsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Getting started",
    items: [
      { text: "What SayShape is", link: "/docs/" },
      { text: "Local setup", link: "/docs/getting-started/setup" },
      { text: "Your first interface", link: "/docs/getting-started/first-interface" },
      { text: "From spec to pixels", link: "/docs/getting-started/pipeline" },
    ],
  },
  {
    text: "Language",
    items: [
      { text: "Elements and nesting", link: "/docs/language/elements" },
      { text: "State", link: "/docs/language/state" },
      { text: "Bindings", link: "/docs/language/bindings" },
      { text: "Expressions and functions", link: "/docs/language/expressions" },
      { text: "Derived values", link: "/docs/language/derived" },
      { text: "Lists and iteration", link: "/docs/language/lists" },
      { text: "Conditional visibility", link: "/docs/language/conditions" },
      { text: "Actions and navigation", link: "/docs/language/actions" },
      { text: "Validation and diagnostics", link: "/docs/language/diagnostics" },
    ],
  },
  {
    text: "Elements",
    items: [
      { text: "Atlas: all elements, live", link: "/docs/elements/" },
      { text: "Reference overview", link: "/docs/components/" },
      ...CATEGORIES.map((c) => ({ text: `${cap(c)} reference`, link: `/docs/components/${c}` })),
    ],
  },
  {
    text: "Integration",
    items: [
      { text: "Embedding SayShape", link: "/docs/integration/embedding" },
      { text: "Host data and events", link: "/docs/integration/host-data" },
      { text: "Loading, success and failure", link: "/docs/integration/states" },
      { text: "Themes", link: "/docs/integration/themes" },
      { text: "Images", link: "/docs/integration/images" },
      { text: "Connecting a model", link: "/docs/integration/model" },
      { text: "In Claude, ChatGPT and other chat apps", link: "/docs/integration/mcp" },
      { text: "The model guide", link: "/docs/integration/model-guide" },
      { text: "Streaming, validation and repair", link: "/docs/integration/streaming" },
    ],
  },
  {
    text: "Architecture",
    items: [
      { text: "How the engine works", link: "/docs/architecture/" },
      { text: "The expression boundary", link: "/docs/architecture/security" },
      { text: "Accessibility", link: "/docs/architecture/accessibility" },
      { text: "Status and limits", link: "/docs/architecture/limitations" },
    ],
  },
  {
    text: "Contributing",
    items: [
      { text: "Development", link: "/docs/contributing/" },
      { text: "Adding a component", link: "/docs/contributing/components" },
      { text: "Publishing this site", link: "/docs/contributing/website" },
    ],
  },
];

export default defineConfig({
  base: BASE as `/${string}/`,
  lang: "en-US",
  title: TITLE,
  titleTemplate: ":title · SayShape",
  description: DESCRIPTION,
  // Pages are emitted as .html files, which GitHub Pages serves for direct visits and refreshes.
  cleanUrls: false,
  srcExclude: ["README.md", "**/node_modules/**"],
  appearance: true,
  sitemap: { hostname: SITE_URL },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${BASE}favicon.svg` }],
    ["meta", { name: "theme-color", content: "#F9F7F2" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: TITLE }],
    // og:title, og:description and og:url are per page, from transformHead below.
    ["meta", { property: "og:image", content: `${SITE_URL}og.png` }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],
  // A shared link previews with the page's own title, description and address, the same title and
  // description its <title> and meta description use, so the landing page's preview reads "Let your
  // AI show, not tell". The 404 page has no address of its own: GitHub Pages serves it at whatever
  // missing address was asked for, so it gets no og:url rather than one that points somewhere else.
  transformHead: ({ title, description, pageData }) => [
    ["meta", { property: "og:title", content: title }],
    ["meta", { property: "og:description", content: description || DESCRIPTION }],
    ...(pageData.isNotFound ? [] : [["meta", { property: "og:url", content: pageUrl(pageData.relativePath) }] as HeadConfig]),
  ],
  themeConfig: {
    siteTitle: "SayShape",
    nav: [
      { text: "Chat", link: "/chat", activeMatch: "^/chat" },
      { text: "Playground", link: "/playground", activeMatch: "^/playground" },
      { text: "Examples", link: "/examples/", activeMatch: "^/examples" },
      { text: "Compare", link: "/compare", activeMatch: "^/compare" },
      // Elements (the atlas and reference) and Status (limits) live in the docs sidebar.
      { text: "Docs", link: "/docs/", activeMatch: "^/docs/(?!integration/mcp)" },
      // Setting it up in the AI you already use: the same page the homepage's "Set up SayShape" opens.
      { text: "Get started", link: "/docs/integration/mcp", activeMatch: "^/docs/integration/mcp" },
    ],
    socialLinks: [{ icon: "github", link: REPO, ariaLabel: "SayShape on GitHub" }],
    sidebar: { "/docs/": docsSidebar },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    editLink: { pattern: `${REPO}/edit/main/site/:path`, text: "Suggest a change to this page" },
    footer: {
      message: `SayShape v0.1 is an early prototype under the MIT License. <a href="${BASE}docs/architecture/limitations.html">Status</a> · <a href="${BASE}privacy.html">Privacy</a> · <a href="${REPO}">GitHub</a>`,
    },
  },
  markdown: {
    languages: [sayShapeGrammar],
    theme: { light: "github-light", dark: "github-dark" },
    config(md) {
      md.use(sayShapeLivePlugin);
    },
  },
  // A2UI's renderer is made of custom elements (a2ui-surface and the basic catalog's), drawn by the compare page.
  vue: { template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("a2ui-") } } },
  vite: {
    resolve: {
      alias: { "@sayshape": here("../../src") },
    },
    server: { fs: { allow: [here("../.."), here("..")] } },
    // The playground's appearance helpers live next to the development playground and are reused here.
    build: { chunkSizeWarningLimit: 900 },
  },
});
