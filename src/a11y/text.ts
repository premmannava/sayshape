/**
 * The interface as plain text, for copying: what a person would type out if
 * they retyped the screen. A canvas has no text to select, so hosts offer
 * this instead (the MCP view's Copy text button).
 *
 * It reads the accessibility tree (src/a11y/tree.ts), which already knows
 * every element's words and values as shown, in reading order:
 *
 * - headings, text, notes and stats become lines, with a blank line before
 *   each heading;
 * - fields read as "Label: value", checkboxes as [x] or [ ], switches as On
 *   or Off, and a radio group as its label and the chosen option;
 * - tables, and charts through the data table they describe themselves with,
 *   become tab-separated rows, so they paste into a spreadsheet as cells;
 * - list items start with "- ", and a tree's items are an outline, two spaces per level;
 * - buttons, links, tabs and page navigation are left out: they're controls,
 *   not content.
 *
 * A password is never in the tree's values, so it's never copied. Headless:
 * a tree in, a string out.
 */
import type { AccessibleNode } from "./semantics";

/** Roles that are controls, not content: nothing about them is worth copying. */
const SKIP = new Set(["button", "link", "navigation", "tablist", "tab", "listbox", "option", "separator"]);

export function plainText(root: AccessibleNode): string {
  const lines: string[] = [];
  const last = (): string | undefined => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i] !== "") return lines[i];
    return undefined;
  };
  /** One line, unless it repeats the line just before (a label and the control that names itself after it). */
  const line = (text: string | undefined) => {
    const t = clean(text);
    if (t && t !== last()) lines.push(t);
  };
  /**
   * "Label: value". When the label is the line just above (a control that
   * took its name from the text over it), the value goes on its own line
   * under it instead: that text is often a question or a description.
   */
  const field = (name: string | undefined, value: string | undefined) => {
    const n = clean(name);
    const v = clean(value);
    if (!n || last() === n) { line(v || n); return; }
    line(v ? `${n}: ${v}` : n);
  };
  const blank = () => { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); };

  const table = (node: AccessibleNode, caption: string | undefined) => {
    blank();
    if (caption) line(caption);
    for (const row of node.children) {
      if (row.role !== "row") { visit(row); continue; }
      // Rows a table describes only by name (no cells) still copy as one line.
      const cells = row.children.filter((c) => c.role === "cell" || c.role === "columnheader" || c.role === "rowheader" || c.role === "gridcell");
      lines.push(cells.length ? cells.map((c) => cell(c.name)).join("\t").replace(/\s+$/, "") : clean(row.name));
    }
    blank();
  };

  const visit = (node: AccessibleNode): void => {
    const role = node.role;
    if (SKIP.has(role)) return;
    if (node.copyText !== undefined) {
      if (role === "heading") blank();
      line(node.copyText);
      return;
    }
    switch (role) {
      case "heading":
        if (clean(node.name) === last()) return;
        blank();
        line(node.name);
        return;
      case "note":
        line(node.name);
        line(node.description);
        return;
      case "checkbox":
        line(`${node.checked === "mixed" ? "[-]" : node.checked ? "[x]" : "[ ]"} ${clean(node.name)}`);
        return;
      case "switch":
        field(node.name, node.checked ? "On" : "Off");
        return;
      case "radio":
        line(`${node.checked ? "(•)" : "( )"} ${clean(node.name)}`);
        return;
      case "radiogroup": {
        const chosen = node.children.filter((c) => c.role === "radio" && c.checked).map((c) => clean(c.name));
        if (node.name) field(node.name, chosen.join(", "));
        else node.children.forEach(visit);
        return;
      }
      case "combobox":
        field(node.name, node.value?.text);
        return;
      case "textbox":
      case "searchbox":
        // An empty field shows only its hint: nothing anyone typed.
        if (node.value?.text) field(node.name, node.value.text);
        return;
      case "slider":
      case "spinbutton":
        field(node.name, rangeText(node));
        return;
      case "progressbar":
      case "meter":
        // Its label already says how far along it is ("2 of 4 packed"); the raw number would only repeat it.
        if (node.name) line(node.value?.text && !node.name.includes(node.value.text) ? `${clean(node.name)}: ${clean(node.value.text)}` : node.name);
        else field(undefined, rangeText(node));
        return;
      case "region":
      case "main":
        // A card is named after its own heading, which follows.
        node.children.forEach(visit);
        return;
      case "group": {
        // A stepper: a label around - and + buttons and the number between them.
        const status = node.children.find((c) => c.role === "status");
        if (node.name && status && node.children.every((c) => c === status || c.role === "button")) {
          field(node.name, status.name);
          return;
        }
        node.children.forEach(visit);
        return;
      }
      case "img":
        if (node.name) line(`[Image: ${clean(node.name)}]`);
        return;
      case "figure": {
        // A chart describes itself with a table of its data; that table is what's worth copying.
        const data = node.children.find((c) => c.role === "table");
        if (data) {
          blank();
          line(node.name);
          if (node.description) line(node.description);
          table(data, data.name && data.name !== node.name ? data.name : undefined);
          return;
        }
        line(node.name);
        line(node.description);
        return;
      }
      case "table":
        table(node, node.name);
        return;
      case "list":
        node.children.forEach(visit);
        return;
      case "tree":
        // Its name is the title above it; the items follow as an outline.
        line(node.name);
        node.children.forEach(visit);
        return;
      case "treeitem":
        // An outline: two spaces per level below the top.
        if (clean(node.name)) lines.push(`${"  ".repeat(Math.max(0, (node.level ?? 1) - 1))}${clean(node.name)}`);
        node.children.forEach(visit);
        return;
      case "listitem":
        line(`- ${clean(node.name)}`);
        node.children.forEach(visit);
        return;
      case "code":
        blank();
        if (node.name) lines.push(...node.name.split("\n"));
        blank();
        return;
      default:
        line(node.name);
        if (node.description && role !== "status") line(node.description);
        node.children.forEach(visit);
    }
  };

  // The root is the interface itself ("Generated interface"): its name isn't content.
  root.children.forEach(visit);
  while (lines[lines.length - 1] === "") lines.pop();
  while (lines[0] === "") lines.shift();
  return lines.join("\n");
}

/** One line: no line breaks or runs of spaces inside it. */
function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** A table cell: tabs and line breaks would split it into more cells or rows when pasted. */
function cell(text: string | undefined): string {
  return clean(text);
}

/** A slider's or progress bar's value, when its name doesn't already say it. */
function rangeText(node: AccessibleNode): string | undefined {
  const name = node.name ?? "";
  const v = node.value;
  if (!v) return undefined;
  if (v.text) return name.includes(v.text) ? undefined : v.text;
  if (v.now === undefined) return undefined;
  const now = String(Math.round(v.now * 1000) / 1000);
  return name.includes(now) ? undefined : now;
}
