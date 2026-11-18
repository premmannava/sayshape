/**
 * sayshape/vue: SayShape as a Vue 3 component (vue >= 3.3, an optional peer dependency).
 *
 *   <SayShape :spec="spec" theme="auto" @action="onAction" />
 *
 * Plain defineComponent and h(): no .vue file and no compiler in the build.
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch, type PropType } from "vue";
import type { ComponentDef, SayShape } from "../index";
import { createSession, type ForwardedPayloads, type SayShapeWrapperOptions, type Session, type ThemeInput } from "../element/sync";

export type { ThemeInput, SayShapeWrapperOptions } from "../element/sync";

export const SayShapeComponent = defineComponent({
  name: "SayShape",
  props: {
    /** The spec text. */
    spec: { type: String, default: "" },
    /** Treat spec as text that is still growing: only the new characters are pushed. */
    streaming: { type: Boolean, default: false },
    /** "auto", "light", "dark" or a Theme object. */
    theme: { type: [String, Object] as PropType<ThemeInput>, default: undefined },
    /** Engine options. Read once, when the component mounts: changing it needs a remount (a new `key`). */
    options: { type: Object as PropType<SayShapeWrapperOptions>, default: undefined },
    /** Components to register. Read once, when the component mounts. Default: the core components. */
    components: { type: Array as PropType<ComponentDef[]>, default: undefined },
    /** Start from the spec's own initial state whenever spec changes, instead of keeping it. */
    resetStateOnChange: { type: Boolean, default: false },
  },
  emits: {
    action: (_payload: ForwardedPayloads["action"]) => true,
    change: (_payload: ForwardedPayloads["change"]) => true,
    diagnostics: (_payload: ForwardedPayloads["diagnostics"]) => true,
    navigate: (_payload: ForwardedPayloads["navigate"]) => true,
    notify: (_payload: ForwardedPayloads["notify"]) => true,
    render: (_payload: ForwardedPayloads["render"]) => true,
  },
  setup(props, { emit, expose }) {
    const canvas = ref<HTMLCanvasElement | null>(null);
    let session: Session | null = null;

    // Vue wraps what it holds in proxies; the engine wants the plain objects.
    const current = () => ({
      spec: props.spec,
      streaming: props.streaming,
      theme: props.theme === undefined ? undefined : toRaw(props.theme),
      resetStateOnChange: props.resetStateOnChange,
    });

    onMounted(() => {
      if (!canvas.value) return;
      session = createSession(
        canvas.value,
        {
          options: props.options && toRaw(props.options),
          components: props.components && toRaw(props.components),
          emit: (name, payload) => (emit as (n: string, p: unknown) => void)(name, payload),
        },
        current(),
      );
    });
    watch(
      () => [props.spec, props.streaming, props.theme, props.resetStateOnChange],
      () => session?.update(current()),
    );
    onBeforeUnmount(() => {
      session?.destroy();
      session = null;
    });

    // With defineComponent and setup() there is no defineExpose: expose() from the setup context is the same thing.
    expose({
      /** The engine, once mounted (null before that). */
      get engine(): SayShape | null {
        return session?.engine ?? null;
      },
    });

    return () => h("div", { style: { position: "relative", width: "100%" } }, [h("canvas", { ref: canvas, style: { display: "block" } })]);
  },
});

export { SayShapeComponent as SayShape };
export default SayShapeComponent;
