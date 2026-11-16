# Touch selection: manual checklist for real phones

Emulated touch cannot start the browser's own long-press selection, so this was never seen working. Run it with touch selection on (`selectTouch: true`, or `sayshape-mcp --select-touch`) on each of: **iPhone in Safari**, **Android phone in Chrome**, **inside the Claude mobile app**. Use an interface with a paragraph, a table that selects rows (`bind=`), a card with `on=`, a button, and enough content to scroll.

- [ ] Long press on a word of plain text: the word is selected, the platform's handles and Copy menu appear.
- [ ] Drag a handle: the selection grows and shrinks over the drawn words, and the highlight sits on them.
- [ ] Copy, then paste somewhere: the words come out as selected.
- [ ] Select across a table (long press a cell, drag a handle): Copy pastes tab-separated cells, one row per line.
- [ ] Tap plain text: nothing happens. Tap it with a selection showing: the selection clears.
- [ ] Tap a card with `on=`: its action runs once (watch a counter). Tap a table row: it selects once.
- [ ] Long press on text in that card, and in a table row: the word is selected and the action does **not** run.
- [ ] Tap a button, a switch, a field and a select: they work as before.
- [ ] Swipe up and down starting on text: the page scrolls; nothing is selected.
- [ ] Swipe inside a `scroll` element starting on text: it scrolls.
- [ ] Pinch zoom starting on text works; nothing is selected or pressed.
- [ ] A dialog open: long press behind it selects nothing; long press on its text selects it.
- [ ] Screen reader on (VoiceOver or TalkBack): the layer is not read twice; the interface reads as before.
- [ ] Rotate the phone, or resize: selection and taps still line up with the words.

If all of it passes, set `TOUCH_SELECT_DEFAULT` to `true` in `src/text-layer/host.ts`.
