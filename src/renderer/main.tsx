import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { BootstrapProvider } from "./api/BootstrapContext.js";
import { App } from "./app/App.js";
import { ThemeProvider } from "./design/ThemeProvider.js";
import i18n from "./i18n.js";
import "katex/dist/katex.min.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import { installBrowserCompatibility } from "./browserCompatibility.js";
import "./styles/global.css";

installBrowserCompatibility();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 }, mutations: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <BootstrapProvider><ThemeProvider><App /></ThemeProvider></BootstrapProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
