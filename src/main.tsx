import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./lib/appearance";
import { workspaceReady } from "./lib/store";
import "./lib/search";
import "./styles.css";

// On attend le chargement local de l'arborescence avant le premier rendu.
void workspaceReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
