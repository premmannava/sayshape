import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
// All fonts are self-hosted, so no font is fetched from a third party. The engine draws with
// Instrument Sans and IBM Plex Mono (src/theme.ts); the site's text is Inter (also the Studio
// theme's face) and its display type is Fraunces.
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/500-italic.css";
import "@fontsource/fraunces/600-italic.css";
import "./style.css";
import SayShapeLive from "./components/SayShapeLive.vue";
import Landing from "./components/Landing.vue";
import Gallery from "./components/Gallery.vue";
import ExamplesStudio from "./components/ExamplesStudio.vue";
import Playground from "./components/Playground.vue";
import EngineDiagram from "./components/EngineDiagram.vue";
import Atlas from "./components/Atlas.vue";
import ElementPage from "./components/ElementPage.vue";
import Compare from "./components/Compare.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("SayShapeLive", SayShapeLive);
    app.component("Landing", Landing);
    app.component("Gallery", Gallery);
    app.component("ExamplesStudio", ExamplesStudio);
    app.component("Playground", Playground);
    app.component("EngineDiagram", EngineDiagram);
    app.component("Atlas", Atlas);
    app.component("ElementPage", ElementPage);
    app.component("Compare", Compare);
  },
} satisfies Theme;
