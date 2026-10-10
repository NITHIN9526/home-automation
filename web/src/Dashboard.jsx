import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Cpu,
  LayoutDashboard,
  UserRound,
  BookOpen,
  LogOut,
  Plus,
  RefreshCw,
  ArrowRight,
  KeyRound,
  Pencil,
  Power,
  Trash2,
  Copy,
  Download,
  Monitor,
  Radio,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Logo, Modal, Field, ErrorMessage, Status } from "./ui";
export function Workspace() {
  const { user, logout } = useAuth(),
    navigate = useNavigate();
  const [error, setError] = useState("");
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Logo />
        <span className="sidebar-label">WORKSPACE</span>
        <nav>
          <NavLink to="/dashboard" end>
            <LayoutDashboard size={18} />
            Devices
          </NavLink>
          <NavLink to="/dashboard/account">
            <UserRound size={18} />
            My account
          </NavLink>
          <Link to="/docs">
            <BookOpen size={18} />
            Getting started
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="self-hosted">
            <span className="small-dot" />
            Self-hosted instance
          </div>
          <div className="user-chip">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
            <button
              aria-label="Log out"
              className="icon-btn"
              onClick={async () => {
                try {
                  await logout();
                  navigate("/login", { replace: true });
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
          {error && <ErrorMessage message={error} />}
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-top">
          <span>
            Workspace <span className="mx-3 text-stone-300">/</span>{" "}
            <b>Open IoT</b>
          </span>
          <span className="version-pill">MILESTONE 2</span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
const typeLabels = {
  simulator: "Laptop simulator",
  esp32: "ESP32",
  esp8266: "ESP8266",
  "raspberry-pi": "Raspberry Pi",
  other: "Other device",
};
function DeviceIcon({ type }) {
  const Icon =
    type === "simulator" ? Monitor : type === "esp8266" ? Radio : Cpu;
  return (
    <span className="device-icon">
      <Icon size={21} />
    </span>
  );
}
function relative(value) {
  if (!value) return "Never connected";
  const s = Math.max(0, Math.floor((Date.now() - new Date(value)) / 1000));
  return s < 5
    ? "Just now"
    : s < 60
      ? `${s}s ago`
      : s < 3600
        ? `${Math.floor(s / 60)}m ago`
        : new Date(value).toLocaleDateString();
}
export function Devices() {
  const [data, setData] = useState({
      devices: [],
      total: 0,
      online: 0,
      disabled: 0,
    }),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState("");
  async function refresh() {
    try {
      setData(await api(`/devices?page=${page}`));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const d = await api(`/devices?page=${page}`);
        if (!stopped) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [page]);
  async function complete(message) {
    setModal(null);
    setNotice(message);
    await refresh();
  }
  return (
    <main className="console-content">
      <div className="page-title">
        <div>
          <div className="eyebrow">DEVICE MANAGEMENT</div>
          <h1>Your connected world.</h1>
          <p>One place for every device you build.</p>
        </div>
        <button className="btn" onClick={() => setModal({ kind: "create" })}>
          <Plus size={18} />
          Add device
        </button>
      </div>
      <div className="stats-grid">
        {[
          [Cpu, "Total devices", data.total, "Registered in your workspace"],
          [
            Radio,
            "Online now",
            data.online,
            "Heartbeat received in the last 30s",
          ],
          [
            ShieldCheck,
            "Access disabled",
            data.disabled,
            "Tokens cannot authenticate",
          ],
        ].map(([Icon, label, value, sub]) => (
          <div className="stat-card" key={label}>
            <div className="flex items-center justify-between">
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{String(value).padStart(2, "0")}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <ErrorMessage message={error} />
      {notice && (
        <div className="success-message" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <section className="device-panel">
        <div className="panel-head">
          <div>
            <h2>
              Device registry <span>{data.total}</span>
            </h2>
            <p>Credentials and connection status for your devices.</p>
          </div>
          <button
            className="icon-btn"
            aria-label="Refresh devices"
            onClick={refresh}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {loading ? (
          <div className="empty-state">Loading your devices…</div>
        ) : data.total === 0 ? (
          <div className="empty-state">
            <div className="empty-art">
              <Monitor size={46} strokeWidth={1.2} />
              <span>
                <Plus size={16} />
              </span>
            </div>
            <h3>Your first connection starts here.</h3>
            <p>
              No hardware? No problem. Add a laptop simulator
              <br className="hidden sm:block" /> and bring your first device
              online in minutes.
            </p>
            <button
              className="btn"
              onClick={() => setModal({ kind: "create" })}
            >
              <Plus size={17} />
              Add your first device
            </button>
            <Link to="/docs">
              Read the quick start <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="device-table">
                <thead>
                  <tr>
                    <th>DEVICE</th>
                    <th>STATUS</th>
                    <th>AUTH TOKEN</th>
                    <th>LAST SEEN</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="flex gap-3 items-center">
                          <DeviceIcon type={d.deviceType} />
                          <div>
                            <Link
                              className="device-open"
                              to={`/dashboard/devices/${d.id}`}
                              aria-label={`Open controls for ${d.name}`}
                            >
                              <b>{d.name}</b>
                            </Link>
                            <small>{typeLabels[d.deviceType]}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Status status={d.status} />
                      </td>
                      <td>
                        <button
                          className="token-preview"
                          title="Reveal or rotate token"
                          aria-label={`Manage token for ${d.name}`}
                          onClick={() => setModal({ kind: "token", device: d })}
                        >
                          <code>{d.tokenPreview}</code>
                          <KeyRound size={13} />
                        </button>
                      </td>
                      <td className="text-muted text-xs">
                        {relative(d.lastSeenAt)}
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            className="icon-btn"
                            aria-label={`Rename ${d.name}`}
                            onClick={() =>
                              setModal({ kind: "rename", device: d })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`${d.disabledAt ? "Enable" : "Disable"} ${d.name}`}
                            onClick={() =>
                              setModal({ kind: "toggle", device: d })
                            }
                          >
                            <Power size={15} />
                          </button>
                          <button
                            className="icon-btn text-red-700"
                            aria-label={`Delete ${d.name}`}
                            onClick={() =>
                              setModal({ kind: "delete", device: d })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>Page {page} · up to 20 devices per page</span>
              <div className="flex gap-2">
                <button
                  className="icon-btn"
                  aria-label="Previous page"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Next page"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <div className="simulator-banner">
        <span className="feature-icon">
          <Monitor size={22} />
        </span>
        <div>
          <h3>Build now. Add hardware later.</h3>
          <p>
            The included simulator connects from your laptop with a real device
            token.
          </p>
        </div>
        <Link to="/docs" className="btn btn-secondary btn-sm">
          Set up simulator <ArrowRight size={16} />
        </Link>
      </div>
      {modal?.kind === "create" && (
        <CreateDevice
          onClose={() => setModal(null)}
          onCreated={async (result) => {
            await refresh();
            setModal({
              kind: "created",
              device: result.device,
              token: result.token,
            });
          }}
        />
      )}
      {modal?.kind === "created" && (
        <Modal title="Your device is ready." onClose={() => setModal(null)}>
          <p className="text-muted mb-5">
            Copy this token into your simulator or firmware. It grants access as
            this device.
          </p>
          <TokenDisplay
            token={modal.token}
            name={modal.device.name}
            onExpire={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.kind === "token" && (
        <TokenModal
          device={modal.device}
          onClose={() => setModal(null)}
          onChanged={refresh}
        />
      )}
      {["rename", "toggle", "delete"].includes(modal?.kind) && (
        <DeviceAction
          modal={modal}
          onClose={() => setModal(null)}
          onComplete={complete}
        />
      )}
    </main>
  );
}
function CreateDevice({ onClose, onCreated }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await onCreated(
        await api("/devices", {
          method: "POST",
          body: { name: f.get("name"), deviceType: f.get("deviceType") },
        }),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a new device" onClose={onClose}>
      <p className="text-muted mb-6">
        Give it a name. We’ll take care of its secure credentials.
      </p>
      <form onSubmit={submit}>
        <ErrorMessage message={error} />
        <Field
          label="Device name"
          name="name"
          placeholder="e.g. Workshop controller"
          required
          maxLength={80}
          autoFocus
        />
        <label className="field">
          <span>Device type</span>
          <select name="deviceType" defaultValue="simulator">
            {Object.entries(typeLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <small>Choose Laptop simulator to get started without a board.</small>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="btn">
            {busy ? "Creating…" : "Create device"}
            <Plus size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TokenDisplay({ token, name, onExpire }) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = setTimeout(onExpire, 60000);
    return () => clearTimeout(timer);
  }, [token]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setMessage("Copied to clipboard.");
    } catch {
      setMessage(
        "Clipboard unavailable. Select the token below and copy it manually.",
      );
    }
  }
  function download() {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    const apiUrl = local
      ? `${location.protocol}//${location.hostname}:3000`
      : location.origin;
    const blob = new Blob([`API_URL=${apiUrl}\nDEVICE_TOKEN=${token}\n`], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = ".device.env";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      "Save .device.env in the project root, then run npm run simulate.",
    );
  }
  return (
    <div>
      <label className="field">
        <span>{name} · Device auth token</span>
        <textarea
          className="token-value"
          readOnly
          value={token}
          rows={2}
          aria-label="Device auth token"
          onFocus={(e) => e.target.select()}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={copy}>
          <Copy size={15} />
          Copy token
        </button>
        <button className="btn btn-secondary btn-sm" onClick={download}>
          <Download size={15} />
          Simulator config
        </button>
      </div>
      {message && (
        <p className="text-sm text-forest mt-4" role="status">
          {message}
        </p>
      )}
      <p className="text-xs text-muted mt-5 leading-relaxed">
        Hidden again after 60 seconds. Treat the token and downloaded config as
        secrets. You can reveal it later with your account password.
      </p>
    </div>
  );
}
function TokenModal({ device, onClose, onChanged }) {
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState("reveal");
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const password = new FormData(e.currentTarget).get("password");
    e.currentTarget.reset();
    try {
      const r = await api(`/devices/${device.id}/token/${operation}`, {
        method: "POST",
        body: { password },
      });
      setToken(r.token);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={token ? "Device auth token" : "Manage device token"}
      onClose={onClose}
    >
      {token ? (
        <TokenDisplay
          token={token}
          name={device.name}
          onExpire={() => setToken("")}
        />
      ) : (
        <form onSubmit={submit}>
          <p className="text-muted mb-5">
            Confirm your password to manage credentials for <b>{device.name}</b>
            .
          </p>
          <ErrorMessage message={error} />
          <fieldset className="token-options">
            <legend className="sr-only">Token action</legend>
            <label>
              <input
                type="radio"
                name="operation"
                checked={operation === "reveal"}
                onChange={() => setOperation("reveal")}
              />
              Reveal current token
            </label>
            <label>
              <input
                type="radio"
                name="operation"
                checked={operation === "rotate"}
                onChange={() => setOperation("rotate")}
              />
              Generate replacement token
            </label>
          </fieldset>
          {operation === "rotate" && (
            <p className="warning-message">
              The old token will stop working immediately. Update your simulator
              or firmware with the replacement.
            </p>
          )}
          <Field
            label="Current password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <button className="btn w-full" disabled={busy}>
            {busy
              ? "Checking…"
              : operation === "rotate"
                ? "Rotate token"
                : "Reveal token"}
            <KeyRound size={16} />
          </button>
        </form>
      )}
    </Modal>
  );
}
function DeviceAction({ modal: { kind, device }, onClose, onComplete }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body =
        kind === "rename"
          ? { name: new FormData(e.currentTarget).get("name") }
          : kind === "toggle"
            ? { disabled: !device.disabledAt }
            : {};
      await api(`/devices/${device.id}`, {
        method: kind === "delete" ? "DELETE" : "PATCH",
        body,
      });
      await onComplete(
        kind === "delete"
          ? "Device deleted. Its token no longer works."
          : kind === "rename"
            ? "Device renamed."
            : device.disabledAt
              ? "Device enabled. Waiting for a new heartbeat."
              : "Device access disabled.",
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  const title =
    kind === "rename"
      ? "Rename device"
      : kind === "delete"
        ? "Delete device?"
        : device.disabledAt
          ? "Enable device?"
          : "Disable device?";
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorMessage message={error} />
        {kind === "rename" ? (
          <Field
            label="Device name"
            name="name"
            defaultValue={device.name}
            required
            maxLength={80}
          />
        ) : kind === "delete" ? (
          <>
            <p className="text-muted mb-5">
              This permanently removes <b>{device.name}</b> and revokes its
              token. Type its name to confirm.
            </p>
            <Field
              label="Confirm device name"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
            />
          </>
        ) : (
          <p className="text-muted mb-6">
            {device.disabledAt
              ? "Allow this device to authenticate again with its existing token."
              : "Block this device from authenticating. You can enable it again later."}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${kind === "delete" ? "btn-danger" : ""}`}
            disabled={
              busy || (kind === "delete" && confirmation !== device.name)
            }
          >
            {busy ? "Saving…" : title.replace("?", "")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
