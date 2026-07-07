import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// In production the frontend and API are on separate domains.
// VITE_API_URL is injected at build time by Render (or any CI/CD).
// Only call setBaseUrl when the value is a non-empty string so that an
// unset or empty env var never overrides the default relative-URL behaviour
// (which the Vite dev-server proxy relies on).
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
