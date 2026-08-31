import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import { PwaRegistry } from "@/components/shared/pwa-registry";
import { initSentry } from "@/lib/sentry";
import "./index.css";
import "./lib/native";

initSentry();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <PwaRegistry />
    <App />
  </HelmetProvider>
);
