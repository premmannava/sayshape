import { useState } from "react";
import { darkTheme, lightTheme } from "sayshape";
import { SayShape } from "sayshape/react";

const START = `state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
  button "Book it" variant=primary on=emit:book
`;

export function App() {
  const [spec, setSpec] = useState(START);
  const [dark, setDark] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24, fontFamily: "system-ui, sans-serif", background: dark ? "#111" : "#fff", color: dark ? "#eee" : "#111", minHeight: "100vh", boxSizing: "border-box" }}>
      <div>
        <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong>Spec</strong>
          <span>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
          </span>
        </label>
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          spellCheck={false}
          style={{ width: "100%", height: 360, font: "13px/1.5 ui-monospace, monospace", boxSizing: "border-box" }}
        />
        <pre style={{ fontSize: 12 }}>{log.join("\n") || "Actions show up here."}</pre>
      </div>
      <div>
        <SayShape
          spec={spec}
          theme={dark ? darkTheme : lightTheme}
          onAction={(e) => setLog((l) => [...l.slice(-4), `action ${e.name}`])}
        />
      </div>
    </div>
  );
}
