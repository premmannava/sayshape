# Rich text inside `text`

## What it's for

Longer answers that need a little emphasis: a policy summary with the key figure in bold, a step that names a command, a sentence that links to the full document. It is a prop on `text`, not a new element.

## Syntax

```
text "Claims under **$5,000** are paid *automatically*." rich=true
text "Run `npm ci`, then open the playground." rich=true
text "See [the claims policy](https://northwind.example/claims) for the details." rich=true
```

Supported: `**bold**`, `*italic*`, `***both***`, `` `code` ``, `[words](https://…)`, and a backslash before a marker to show it as itself (`\*`).

## Decisions

- **A prop, `rich=true`, not always on.** Existing specs can hold asterisks and backticks that mean themselves ("5 * 3", a product code); turning formatting on for every text would change them. A text without `rich=true` that looks formatted (it has `**bold**`, `` `code` `` or `[a](https://…)`) gets a warning saying to add `rich=true`.
- **One paragraph per line** (rule 3: no multi-line values). Lists stay separate lines (`list-item`, or `text` lines).
- **Markers that nothing closes stay as written**, so a line cut short while streaming, or an asterisk used as a symbol, never swallows the rest; Markdown's rule that a marker sits right against a word (`*word*`, not `* word *`) keeps "5 * 3 * 2" plain.
- **Links behave like `link`: SayShape never opens anything.** Only `https://` addresses become links; pressing one runs `emit:link` with the address, so the host decides (as with `link`'s `on=`). Anything else shows its words, not pressable.
- **Markers come from the spec's own words, never from values.** The markers are read before `{…}` values are filled in, and values go in as plain words, so data from state or what a person types can never become a link or formatting. A link's words and address can still come from values (`[{d.title}]({d.url})`); the address must be https once filled in. A `*` inside a `{…}` is never a marker.
- A single `*` between two letters or digits (`3*4`, `2*x`) is arithmetic, never a marker. Backslash escapes work inside formatting too (`*a \* b*`). With `***`, whichever of `**` and `*` closes further out is the outer one.
- **Wrapping across styles**: words are measured each in its own font (bold, italic, mono for code), and lines break only at spaces, so a word whose style changes partway ("**pre**release", or the full stop after a link) is never split. A word longer than the line breaks by letters, as `wrapText` does.
- At most `MAX_RUNS` (400) styled stretches and `MAX_RICH_CHARS` (4,000) characters read for markers per paragraph; past either, the rest is plain. This keeps reading a long paragraph quick on every layout.
- Addresses are checked only for `https://` and no spaces. Lookalike letters or hidden characters in an address are for the host to check before opening it, as with any link it's sent.

## Accessibility and Copy text

Text without links is named by its plain words. Text with links is its stretches of words and its links in reading order (`text`, `link`, `text`…), with no name of its own, so a screen reader reads the whole sentence, never the addresses, and can reach and press each link. Each link is one Tab stop even when it wraps over two lines; focused, every piece of it is outlined. Copy text gets the plain words with each link's address in brackets (the new `copyText` in semantics): `Pay within 30 days; see the terms (https://northwind.example/terms).`

## Left out of version 1

Headings, lists and quotes inside a line, underline and strikethrough markers, links to anything but https, nested links, and colours.
