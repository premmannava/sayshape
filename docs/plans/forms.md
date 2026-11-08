# Several lines, and saying what's wrong

Roadmap item 5 from the overnight run: "multi-line text input with simple form validation (required, email, number)". It is kept minimal, as props on the existing `input` rather than a new element.

```
input "Email" bind=email kind=email required=true
input "Seats" bind=seats kind=number
input "Password" bind=pw kind=password error="{len(pw) < 8 ? 'At least 8 characters' : ''}"
input "Note" bind=note lines=4 placeholder="Anything we should know?"
```

## Several lines: `lines=`

`lines=` sets how many rows the field shows, from 2 to 12 (`MAX_INPUT_LINES`).
- **Size.** The field is that many rows tall.
- **Drawing.** The canvas draws the value wrapped by words, from the top. Typed new lines start new rows. When there are more rows than fit, the last one is cut with an ellipsis.
- **Typing.** The editor host opens a `<textarea>` instead of an `<input>` (`EditorSpec.lines`, `lineHeight`), with the same font and line height, so the text doesn't jump.
- **Keys.** Enter starts a new line; `on=` then runs only from a button.
- **Length.** `max=` defaults to 2,000 characters here (500 for one line).

State literals have no `\n` escape (specs are one line per element), so multi-line values come from typing or from the host.

## Saying what's wrong

Once a field has been typed in and left (only passing through with Tab says nothing), the engine's `endEdit` marks it `touched` in its view state, with a stamp of the value it was left with (`valueStamp`). The message shows only while the value is still that one, so a form cleared after sending, or a value set by the host, starts afresh, and the message goes as the person types again. Its layout reads that, so a message takes room under the field and pushes what follows down. Nothing shows before the person has used the field.

The checks run in this order (`fieldProblem`):
1. `kind=number` left showing nothing because the text typed wasn't a number. The engine never writes such text, so it records it (`unparsed`). Message: "Enter a number, like 12 or 3.5". When an earlier number is still shown (typing "12x" keeps 12), there's no message.
2. An empty field with `required=` true. Message: "Required".
3. `kind=email` with a value that isn't shaped like an email. Message: "Enter an email like name@example.com".
4. The field's own `error=`, an expression the model writes, shown while it isn't empty.

The field is outlined in the theme's `bad` color, with the message wrapped under it in `bad`. Screen readers get `aria-required`, `aria-invalid` and the message as the field's description.

## Also

- **One line only for some kinds.** `lines=` works only on a text field. Email, number, password and search stay one line, so a password stays hidden while typed. `lines=` on them is a warning, and so is `on=` on a field of several lines.
- **While typing,** the text box gets the field's `aria-required`, `aria-invalid` and message (`EditorSpec.required`, `problem`). The textarea's scrollbar is hidden, so its text wraps as the canvas draws it.

## Tests

`test/forms.test.ts` covers:
- each check, and nothing shown before the field is left;
- room made under the field;
- the accessibility tree;
- wrapping at 240 px;
- `lines=` height, Enter, drawing and the ellipsis;
- limits;
- streaming.

## Left out

- A form element that checks every field at once on submit, and an expression to ask whether a field is valid. A model holds a button back with `disabled={…}` today.
- Patterns, length rules and number ranges beyond `error=` and `max=`.
- A field growing as it fills.
