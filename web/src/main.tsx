/**
 * @author Jemilin Beulah, Tang Chee Seng
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { App } from "@/app/App";

// Self-hosted rather than fetched from a CDN: no third-party origin at runtime, which keeps
// the strict CSP simple and means the app renders identically offline.
/* 
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
*/

// Chee Seng - Font was changed from IBM Plex Sans to Lexend. 
// This is due to Lexend's explicit design feature to reduce visual stress and reading fluency under difficult conditions
// IBM Plex Mono kept for machine-readable identifiers
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@fontsource/lexend/700.css";


import "@/design/global.css";
import "@/design/pill.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
