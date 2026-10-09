import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "./auth";
import { api } from "./api";
import { Field, ErrorMessage, Modal } from "./ui";
export function Account() {
  const { user, setUser, logout } = useAuth(),
    navigate = useNavigate();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState(null);
  async function profile(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await api("/account", {
        method: "PATCH",
        body: { name: new FormData(e.currentTarget).get("name") },
      });
      setUser(r.user);
      setNotice("Profile updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function password(e) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setError("");
    setNotice("");
    if (f.get("newPassword") !== f.get("confirmPassword")) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/account/password", {
        method: "PUT",
        body: {
          password: f.get("password"),
          newPassword: f.get("newPassword"),
        },
      });
      form.reset();
      setNotice("Password changed. All other sessions have been signed out.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="console-content">
      <div className="page-title">
        <div>
          <div className="eyebrow">ACCOUNT SETTINGS</div>
          <h1>A workspace that’s yours.</h1>
          <p>Manage your profile and keep your account secure.</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {notice && (
        <p role="status" className="success-message">
          {notice}
        </p>
      )}
      <div className="account-grid">
        <section className="settings-card">
          <h2>Profile</h2>
          <p>Your identity on this Open IoT instance.</p>
          <form onSubmit={profile}>
            <Field
              label="Full name"
              name="name"
              defaultValue={user.name}
              required
              maxLength={80}
            />
            <Field
              label="Email address"
              value={user.email}
              readOnly
              hint="Email changes require verification and are not available in this milestone."
            />
            <p className="text-xs text-muted mb-5">
              Member since {new Date(user.createdAt).toLocaleDateString()}
            </p>
            <button className="btn btn-sm" disabled={busy}>
              Save profile
            </button>
          </form>
        </section>
        <section className="settings-card">
          <h2>Change password</h2>
          <p>Changing your password signs out other sessions.</p>
          <form onSubmit={password}>
            <Field
              label="Current password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Field
              label="New password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
              hint="At least 12 characters; maximum 72 UTF-8 bytes."
            />
            <Field
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
            <button className="btn btn-sm" disabled={busy}>
              <ShieldCheck size={16} />
              Update password
            </button>
          </form>
        </section>
      </div>
      <section className="settings-card mt-6">
        <div className="settings-action">
          <div>
            <h2>Session control</h2>
            <p>Sign out of every browser, including this one.</p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAction("logout")}
          >
            <LogOut size={16} />
            Sign out everywhere
          </button>
        </div>
      </section>
      <section className="settings-card danger-zone mt-6">
        <div className="settings-action">
          <div>
            <h2>Delete account</h2>
            <p>
              Permanently delete your account, devices, and active sessions.
            </p>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setAction("delete")}
          >
            <Trash2 size={16} />
            Delete account
          </button>
        </div>
      </section>
      {action && (
        <AccountAction
          action={action}
          onClose={() => setAction(null)}
          onSubmit={async (password) => {
            if (action === "logout") await logout(true);
            else {
              await api("/account", { method: "DELETE", body: { password } });
              setUser(null);
            }
            navigate("/login", { replace: true });
          }}
        />
      )}
    </main>
  );
}
function AccountAction({ action, onClose, onSubmit }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={
        action === "delete"
          ? "Permanently delete account?"
          : "Sign out everywhere?"
      }
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(new FormData(e.currentTarget).get("password"));
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <ErrorMessage message={error} />
        <p className="text-muted mb-6">
          {action === "delete"
            ? "All your devices and credentials will be removed. This cannot be undone. Confirm your password to continue."
            : "All active browser sessions will end. You can sign in again with your password."}
        </p>
        {action === "delete" && (
          <Field
            label="Current password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${action === "delete" ? "btn-danger" : ""}`}
            disabled={busy}
          >
            {busy
              ? "Working…"
              : action === "delete"
                ? "Delete my account"
                : "Sign out everywhere"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
