/**
 * A Vue composable that owns one SayShape instance for a component: created in
 * the browser after mount (optionally only once it scrolls near the
 * viewport), kept in step with the site theme, and destroyed with every
 * listener removed when the component unmounts.
 */
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue";
import { createSayShape, sayShapeModules, watchSiteTheme, type CreateOptions, type SayShape, type SayShapeModules } from "./runtime";

export interface UseSayShapeOptions extends CreateOptions {
  /** Create the instance only when this element comes near the viewport. */
  lazy?: Ref<HTMLElement | null>;
  /** Follow the site's light/dark switch (default true). Return false while something else sets the theme. */
  followSiteTheme?: () => boolean;
}

type Setup = (sayshape: SayShape, mods: SayShapeModules) => void | (() => void);

export function useSayShape(canvas: Ref<HTMLCanvasElement | null>, setup: Setup, opts: UseSayShapeOptions = {}) {
  const sayshape = shallowRef<SayShape | null>(null);
  const failed = shallowRef<string | null>(null);
  const cleanups: Array<() => void> = [];
  let alive = true;
  let observer: IntersectionObserver | null = null;

  async function start() {
    const el = canvas.value;
    if (!el || sayshape.value) return;
    try {
      const [instance, mods] = await Promise.all([createSayShape(el, opts), sayShapeModules()]);
      if (!alive) { instance.destroy(); return; }
      sayshape.value = instance;
      cleanups.push(watchSiteTheme(instance, { light: mods.lightTheme, dark: mods.darkTheme }, opts.followSiteTheme));
      const undo = setup(instance, mods);
      if (undo) cleanups.push(undo);
    } catch (e) {
      failed.value = e instanceof Error ? e.message : String(e);
    }
  }

  onMounted(() => {
    const target = opts.lazy?.value;
    if (target && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          void start();
        }
      }, { rootMargin: "400px 0px" });
      observer.observe(target);
    } else void start();
  });

  onBeforeUnmount(() => {
    alive = false;
    observer?.disconnect();
    cleanups.splice(0).forEach((f) => f());
    sayshape.value?.destroy();
    sayshape.value = null;
  });

  return { sayshape, failed };
}
