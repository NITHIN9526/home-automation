import { Routines } from "./Routines";
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
              <Route path="groups" element={<Routines kind="groups" />} />
              <Route path="scenes" element={<Routines kind="scenes" />} />
              <Route path="rules" element={<Routines kind="rules" />} />
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
