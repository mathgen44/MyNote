import { useState } from "react";
import { loadAppearance, saveAppearance } from "../lib/appearance";
import type { Accent, Appearance } from "../lib/appearance";

const ACCENTS: { value: Accent; label: string; color: string }[] = [
  { value: "teal", label: "Sarcelle", color: "#0e7490" },
  { value: "blue", label: "Bleu", color: "#1d4ed8" },
  { value: "violet", label: "Violet", color: "#6d28d9" },
  { value: "green", label: "Vert", color: "#15803d" },
  { value: "orange", label: "Orange", color: "#c2410c" },
  { value: "rose", label: "Rose", color: "#be185d" },
  { value: "graphite", label: "Graphite", color: "#374151" },
];

/** Groupe de boutons dont un seul est actif. */
function Choice<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map(([value, label]) => (
        <button key={value} className={value === props.value ? "active" : ""} onClick={() => props.onChange(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function AppearanceSettings() {
  const [a, setA] = useState(loadAppearance);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };

  return (
    <div className="appearance">
      <div className="setting">
        <span>Thème</span>
        <Choice value={a.theme} onChange={(theme) => set({ theme })} options={[["system", "Système"], ["light", "Clair"], ["dark", "Sombre"]]} />
      </div>
      <div className="setting">
        <span>Couleur</span>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button
              key={c.value}
              className={"swatch" + (a.accent === c.value ? " active" : "")}
              style={{ background: c.color }}
              title={c.label}
              aria-label={c.label}
              onClick={() => set({ accent: c.value })}
            />
          ))}
        </div>
      </div>
      <div className="setting">
        <span>Police des notes</span>
        <Choice value={a.font} onChange={(font) => set({ font })} options={[["sans", "Sans serif"], ["serif", "Serif"], ["mono", "Chasse fixe"]]} />
      </div>
      <div className="setting">
        <span>Taille du texte</span>
        <Choice value={a.size} onChange={(size) => set({ size })} options={[["s", "Petite"], ["m", "Normale"], ["l", "Grande"], ["xl", "Très grande"]]} />
      </div>
      <div className="setting">
        <span>Fond des pages libres</span>
        <Choice
          value={a.canvasBg}
          onChange={(canvasBg) => set({ canvasBg })}
          options={[["none", "Uni"], ["dots", "Points"], ["lines", "Lignes"], ["grid", "Quadrillage"]]}
        />
      </div>
      <p className="hint">Ces réglages ne concernent que cet ordinateur.</p>
    </div>
  );
}
