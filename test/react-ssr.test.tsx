// Server rendering runs no effects, so no engine (and no canvas context) is ever made.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SayShape } from "../src/react";

describe("<SayShape> on the server", () => {
  it("renders an empty canvas holder and never creates an engine", () => {
    const html = renderToString(<SayShape spec={`text "hi"`} className="ui" />);
    expect(html).toContain("<canvas");
    expect(html).toContain('class="ui"');
  });
});
