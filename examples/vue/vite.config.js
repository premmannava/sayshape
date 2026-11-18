import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// sayshape is linked from ../.. (file:), so make sure it shares this project's copy of Vue.
export default defineConfig({
  plugins: [vue()],
  resolve: { dedupe: ["vue"] },
});
