/**
 * Passwords stay in the interface. Whatever a password field holds is left
 * out of everything SayShape hands to a host or a model about the person's
 * input: the state that goes with an emit:, and records or lists an emit:
 * sends. A spec can still send one on purpose by naming it as the whole
 * emitted value (emit:login:{pw}); that is deliberate and discouraged.
 *
 * The rule works on values, not names: every text an `input kind=password`
 * holds (on any screen, in any each copy or if block, whatever its bind= path
 * is called) is replaced wherever it appears. The engine also remembers what
 * password fields held whenever an action ran, so a password copied into
 * other state and then cleared (add:tries:{pw};set:pw:'') stays hidden. A
 * password of MIN_INSIDE characters or more is also hidden inside longer
 * text ("S3cret!" → "[hidden]!"); a shorter one only where it's the whole
 * value, so a 2-letter password doesn't hide every word it appears in. Text
 * that happens to equal a password is hidden too: privacy wins over fidelity.
 */
import { eachInstances, scopeOf, bare } from "./each";
import { evaluate, type Scope } from "./expr";
import { isList, isRecord, makeList, makeRecord } from "./data";
import type { SayShapeNode, Value } from "./types";

/** What a hidden password reads as. */
export const HIDDEN = "[hidden]";

/** Passwords at least this long are also hidden inside longer text. */
export const MIN_INSIDE = 4;

/** At most this many remembered passwords per engine; the oldest go first. */
export const MAX_REMEMBERED = 50;

/** `text` with every secret in it replaced by HIDDEN: whole values always, and long enough secrets inside longer text. */
export function hideInText(text: string, secrets: ReadonlySet<string>): string {
  if (!secrets.size) return text;
  if (secrets.has(text)) return HIDDEN;
  let out = text;
  // Longest first, so a secret that contains another is replaced whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= MIN_INSIDE && out.includes(secret)) out = out.split(secret).join(HIDDEN);
  }
  return out;
}

function isPasswordField(node: SayShapeNode, scope: Scope): boolean {
  if (node.type !== "input") return false;
  const kind = node.props.kind;
  if (kind === undefined) return false;
  if (kind.trim() === "password") return true;
  // kind={…}: whatever it works out to now.
  if (!kind.includes("{")) return false;
  const r = evaluate(bare(kind), scope);
  return r.ok && r.value === "password";
}

/** The texts every password field in the spec holds right now (empty ones aren't secrets). */
export function secretValues(root: SayShapeNode | null, scope: Scope): Set<string> {
  const out = new Set<string>();
  const walk = (node: SayShapeNode, base: Scope): void => {
    const own = scopeOf(node, base);
    if (isPasswordField(node, own) && node.props.bind !== undefined) {
      const r = evaluate(bare(node.props.bind), own);
      if (r.ok && typeof r.value === "string" && r.value !== "") out.add(r.value);
    }
    if (node.type === "each") {
      for (const copy of eachInstances(node, own)) walk(copy, own);
      return;
    }
    for (const c of node.children) walk(c, own);
  };
  if (root) walk(root, scope);
  return out;
}

/** `value` with every secret text replaced by HIDDEN, at any depth. Unchanged values come back as they were. */
export function hideSecrets(value: Value, secrets: ReadonlySet<string>): Value {
  if (!secrets.size) return value;
  if (typeof value === "string") return hideInText(value, secrets);
  if (isList(value)) {
    let changed = false;
    const items = value.map((v) => { const h = hideSecrets(v, secrets); if (h !== v) changed = true; return h; });
    return changed ? makeList(items) : value;
  }
  if (isRecord(value)) {
    let changed = false;
    const entries = Object.keys(value).map((k): [string, Value] => {
      const v = value[k] as Value;
      const h = hideSecrets(v, secrets);
      if (h !== v) changed = true;
      return [k, h];
    });
    return changed ? makeRecord(entries) : value;
  }
  return value;
}

/** A state snapshot with every secret text replaced by HIDDEN. */
export function hideSecretsIn(state: Record<string, Value>, secrets: ReadonlySet<string>): Record<string, Value> {
  if (!secrets.size) return state;
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(state)) out[k] = hideSecrets(v, secrets);
  return out;
}

/**
 * What an emit: sends: a text value as written (the spec named it on
 * purpose, emit:login:{pw}); passwords inside a record or list hidden.
 */
export function emittedValue(value: Value | undefined, secrets: ReadonlySet<string>): Value | undefined {
  if (value === undefined || typeof value === "string") return value;
  return hideSecrets(value, secrets);
}
