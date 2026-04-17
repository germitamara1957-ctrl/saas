import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { ThemeProvider } from "@/lib/theme";
import { installSafeDomPatches } from "@/lib/safeDom";

// Guard against React reconciliation crashes caused by Google Translate /
// Chrome page-translation extensions mutating text nodes in-place.
installSafeDomPatches();

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
