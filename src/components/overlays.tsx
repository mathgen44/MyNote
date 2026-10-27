// Boîtes de dialogue (saisie, confirmation) et menu contextuel, pilotés par
// des fonctions impératives qui renvoient des promesses.

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

// --- Dialogues ---------------------------------------------------------------

interface DialogRequest {
  title: string;
  message?: string;
  input?: { value: string; placeholder?: string };
  confirmLabel: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
}
let showDialog: (req: DialogRequest | null) => void = () => {};

export function askText(title: string, value = "", placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => showDialog({ title, input: { value, placeholder }, confirmLabel: "OK", resolve }));
}

export function confirmAction(title: string, message: string, confirmLabel = "Supprimer"): Promise<boolean> {
  return new Promise((resolve) =>
    showDialog({ title, message, confirmLabel, danger: true, resolve: (v) => resolve(v !== null) }),
  );
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  showDialog = (r) => {
    setReq(r);
    setValue(r?.input?.value ?? "");
  };
  if (!req) return null;
  const close = (result: string | null) => {
    setReq(null);
    req.resolve(result);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => close(null)}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          close(req.input ? value : "");
        }}
      >
        <h3>{req.title}</h3>
        {req.message && <p>{req.message}</p>}
        {req.input && (
          <input
            autoFocus
            value={value}
            placeholder={req.input.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Escape" && close(null)}
          />
        )}
        <div className="modal-actions">
          <button type="button" onClick={() => close(null)}>
            Annuler
          </button>
          <button type="submit" className={req.danger ? "danger" : "primary"} autoFocus={!req.input}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Menu contextuel -----------------------------------------------------------

export type MenuItem =
  | { label: string; action: () => void; danger?: boolean; disabled?: boolean }
  | { colors: string[]; current?: string; pick: (color: string) => void }
  | "separator";

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}
let showMenu: (state: MenuState | null) => void = () => {};

export function openMenu(e: ReactMouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  showMenu({ x: e.clientX, y: e.clientY, items });
}

/** Ouvre le menu à une position de la fenêtre (hors événement React). */
export function openMenuAt(x: number, y: number, items: MenuItem[]) {
  showMenu({ x, y, items });
}

export function MenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  showMenu = setMenu;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  // Garde le menu dans la fenêtre.
  useEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${window.innerHeight - r.height - 8}px`;
  }, [menu]);

  if (!menu) return null;
  return (
    <div ref={ref} className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((item, i) => {
        if (item === "separator") return <hr key={i} />;
        if ("colors" in item)
          return (
            <div key={i} className="color-row">
              {item.colors.map((c) => (
                <button
                  key={c}
                  className={"swatch" + (c === item.current ? " current" : "")}
                  style={{ background: c }}
                  onClick={() => {
                    setMenu(null);
                    item.pick(c);
                  }}
                />
              ))}
            </div>
          );
        return (
          <button
            key={i}
            disabled={item.disabled}
            className={item.danger ? "danger" : ""}
            onClick={() => {
              setMenu(null);
              item.action();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
