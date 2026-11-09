import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import type { Theme } from "vitepress";
// The engine draws with Instrument Sans and IBM Plex Mono (src/theme.ts); the site uses the same faces,
// self-hosted, so the shell and the canvas match and no font is fetched from a third party.
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
// Inter is the Studio theme's face, offered in the playground's style picker.
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "./style.css";
import SayShapeLive from "./components/SayShapeLive.vue";
import Landing from "./components/Landing.vue";
import Gallery from "./components/Gallery.vue";
import Playground from "./components/Playground.vue";
import EngineDiagram from "./components/EngineDiagram.vue";
import Atlas from "./components/Atlas.vue";
import ElementPage from "./components/ElementPage.vue";
import Ask from "./components/Ask.vue";
import Compare from "./components/Compare.vue";

export default {
  extends: DefaultTheme,
  // "Ask the docs" sits in the nav on every page, before the menu links.
  Layout: () => h(DefaultTheme.Layout, null, { "nav-bar-content-before": () => h(Ask) }),
  enhanceApp({ app }) {
    app.component("SayShapeLive", SayShapeLive);
    app.component("Landing", Landing);
    app.component("Gallery", Gallery);
    app.component("Playground", Playground);
    app.component("EngineDiagram", EngineDiagram);
    app.component("Atlas", Atlas);
    app.component("ElementPage", ElementPage);
    app.component("Compare", Compare);
  },
} satisfies Theme;
