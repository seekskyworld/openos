import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./theme";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

if (window.openosDesktop?.platform === "darwin") {
  document.documentElement.classList.add("desktop-platform-darwin");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
