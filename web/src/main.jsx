import { Builder } from "./Builder";
import { Automations } from "./Automations";
import "./milestone4.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AuthProvider, Protected } from "./auth";
import { Landing } from "./Landing";
import { AuthPage } from "./AuthPages";
import { Workspace, Devices } from "./Dashboard";
import { DeviceControl } from "./DeviceControl";
import { Account } from "./Account";
import { Docs } from "./Docs";
import "./style.css";
// Support UUID generation on trusted local-network HTTP pages.
if (typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = function () {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  };
}
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/docs" element={<Docs />} />
          <Route element={<Protected />}>
            <Route path="/dashboard" element={<Workspace />}>
              <Route index element={<Devices />} />
              <Route path="devices/:id" element={<DeviceControl />} />
              <Route path="account" element={<Account />} />
              <Route path="builder" element={<Builder />} />
              <Route path="automations" element={<Automations />} />
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <main className="screen-message">
                <h1>Page not found</h1>
                <Link className="btn mt-6" to="/">
                  Back to home
                </Link>
              </main>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")).render(<App />);
