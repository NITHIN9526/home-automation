import { uuid } from "./uuid";
import React, { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Activity,
  Power,
  Thermometer,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "./api";
import { ErrorMessage, Field, Modal, Status } from "./ui";

const display = (v) =>
  v === null || v === undefined
    ? "Not reported"
    : typeof v === "boolean"
      ? v
        ? "ON"
        : "OFF"
      : String(v);
const time = (v) =>
  v ? new Date(v).toLocaleTimeString() : "Waiting for device";
export function useLiveDevice(id) {
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [live, setLive] = useState(false);
  useEffect(() => {
    let stopped = false,
      socket,
      retry,
      delay = 1000,
      lastSnapshot = Date.now();
    const controller = new AbortController();
    setState(null);
    setError("");
    setLive(false);
    async function refresh() {
      try {
        const value = await api(`/devices/${id}/state`, {
          signal: controller.signal,
        });
        if (!stopped) {
          setState(value);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    }
    function connect() {
      if (stopped) return;
      const url = new URL("/api/live", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("deviceId", id);
      socket = new WebSocket(url);
      socket.onmessage = (e) => {
        try {
          const value = JSON.parse(e.data);
          if (value.type === "snapshot" && !stopped) {
            setState(value);
            setError("");
            setLive(true);
            delay = 1000;
            lastSnapshot = Date.now();
          }
        } catch {
          socket.close();
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stopped) return;
        setLive(false);
        refresh();
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    }
    refresh();
    connect();
    const fallback = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) refresh();
      else if (Date.now() - lastSnapshot > 10000) {
        setLive(false);
        socket.close();
      }
    }, 5000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(retry);
      clearInterval(fallback);
      socket?.close();
    };
  }, [id]);
  return { state, error, live };
}

export function DeviceControl() {
  const { id } = useParams(),
    { state, error, live } = useLiveDevice(id);
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState("V0"),
    [samples, setSamples] = useState([]),
    [historyError, setHistoryError] = useState("");
  useEffect(() => {
    let stopped = false,
      busy = false;
    const controller = new AbortController();
    setSamples([]);
    setHistoryError("");
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const result = await api(`/devices/${id}/history?pin=${selected}`, {
          signal: controller.signal,
        });
        if (!stopped) {
          setSamples(result.samples);
          setHistoryError("");
        }
      } catch (e) {
        if (!stopped) setHistoryError(e.message);
      } finally {
        busy = false;
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [id, selected]);
  if (!state)
    return (
      <main className="console-content">
        <Link to="/dashboard" className="back-link">
          <ArrowLeft size={16} /> Devices
        </Link>
        <ErrorMessage message={error} />
        {!error && <p className="mt-6">Loading device…</p>}
      </main>
    );
  const pin = state.pins.find((p) => p.pin === selected);
  return (
    <main className="console-content control-page">
      <Link to="/dashboard" className="back-link">
        <ArrowLeft size={15} /> All devices
      </Link>
      <div className="page-title">
        <div>
          <div className="eyebrow">DEVICE WORKSPACE</div>
          <h1>{state.device.name}</h1>
          <p>Read a signal. Send a command. See it confirmed.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>
          <Plus size={17} /> Add virtual pin
        </button>
      </div>
      <div className="connection-bar">
        <Status status={state.device.status} />
        <span className={live ? "live-label" : "text-muted"}>
          <Activity size={15} />
          {live ? "Live updates connected" : "Reconnecting live updates…"}
        </span>
        <span>Last seen: {time(state.device.lastSeenAt)}</span>
      </div>
      <ErrorMessage message={error} />
      {state.device.status !== "online" && (
        <p className="control-note">
          Start <code>npm run simulate</code> in your second terminal to bring
          this device online. Controls are available when the device connects.
        </p>
      )}
      <div className="pin-grid">
        {state.pins.map((p) => (
          <PinCard
            key={p.pin}
            pin={p}
            id={id}
            online={state.device.status === "online" && live}
            command={state.commands.find((c) => c.pin === p.pin)}
          />
        ))}
      </div>
      <section className="device-panel chart-panel">
        <div className="panel-head">
          <div>
            <h2>Signal history</h2>
            <p>Latest 120 stored readings · 24-hour retention</p>
          </div>
          <label className="chart-select">
            <span className="sr-only">Chart pin</span>
            <select
              aria-label="Chart pin"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {state.pins
                .filter(
                  (p) => p.dataType === "number" && p.direction === "input",
                )
                .map((p) => (
                  <option key={p.pin} value={p.pin}>
                    {p.label} · {p.pin}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <ErrorMessage message={historyError} />
        <SignalChart
          samples={samples}
          unit={pin?.unit ?? ""}
          label={pin?.label ?? selected}
        />
      </section>
      <section className="device-panel command-panel">
        <div className="panel-head">
          <div>
            <h2>Command activity</h2>
            <p>Success means the device acknowledged the requested value.</p>
          </div>
          <SlidersHorizontal size={20} />
        </div>
        {!state.commands.length ? (
          <p className="control-empty">
            Send your first command using Power or Brightness above.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="device-table">
              <thead>
                <tr>
                  <th>PIN</th>
                  <th>REQUESTED VALUE</th>
                  <th>RESULT</th>
                  <th>SENT</th>
                </tr>
              </thead>
              <tbody>
                {state.commands.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.pin}</code>
                    </td>
                    <td>{display(c.value)}</td>
                    <td>
                      <span className={`command-status ${c.status}`}>
                        {c.status === "acknowledged"
                          ? "Confirmed"
                          : c.status === "pending"
                            ? "Pending"
                            : c.status === "expired"
                              ? "Timed out"
                              : "Cancelled"}
                      </span>
                    </td>
                    <td>{time(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="control-footnote">
        These are virtual channels, not ESP32 GPIO numbers. V0 is simulated
        temperature; output controls change values inside your laptop simulator.
        No physical appliance is connected.
      </p>
      {adding && (
        <AddPin id={id} pins={state.pins} onClose={() => setAdding(false)} />
      )}
    </main>
  );
}
function PinCard({ pin, id, online, command }) {
  const [draft, setDraft] = useState(pin.value ?? pin.min),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [queued, setQueued] = useState(null);
  useEffect(() => {
    setDraft(pin.value ?? pin.min);
  }, [pin.value, pin.min]);
  useEffect(() => {
    if (command?.id === queued) setQueued(null);
  }, [command, queued]);
  // A disconnected request can have committed; the activity list is authoritative.
  useEffect(() => {
    if (!queued) return;
    const timer = setTimeout(() => setQueued(null), 16000);
    return () => clearTimeout(timer);
  }, [queued]);
  const pending = busy || !!queued || command?.status === "pending";
  const disabled = !online || pending;
  async function send(value) {
    setBusy(true);
    setError("");
    try {
      const commandId = uuid();
      await api(`/devices/${id}/commands`, {
        method: "POST",
        body: { id: commandId, pin: pin.pin, value },
      });
      setQueued(commandId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const Icon =
    pin.direction === "input"
      ? Thermometer
      : pin.dataType === "boolean"
        ? Power
        : SlidersHorizontal;
  return (
    <article
      className={`pin-card ${pin.direction === "output" ? "actuator-card" : ""}`}
      aria-label={`${pin.label} ${pin.pin}`}
    >
      <div className="pin-heading">
        <span className="feature-icon">
          <Icon size={20} />
        </span>
        <code>
          {pin.pin} / {pin.direction === "input" ? "SENSOR" : "CONTROL"}
        </code>
      </div>
      <h2>{pin.label}</h2>
      <div className="pin-value" aria-live="polite">
        {display(pin.value)}
        {pin.value !== null && <small>{pin.unit}</small>}
      </div>
      <p className="pin-updated">
        {pin.reportedAt
          ? `Last reported ${time(pin.reportedAt)}`
          : "No device report yet"}
      </p>
      {pin.direction === "output" &&
        (pin.dataType === "boolean" ? (
          <div className="switch-actions">
            <button
              className={`btn ${pin.value === true ? "" : "btn-secondary"}`}
              disabled={disabled}
              onClick={() => send(true)}
              aria-label={`Turn ${pin.label} on`}
            >
              ON
            </button>
            <button
              className={`btn ${pin.value === false ? "" : "btn-secondary"}`}
              disabled={disabled}
              onClick={() => send(false)}
              aria-label={`Turn ${pin.label} off`}
            >
              OFF
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(Number(draft));
            }}
          >
            <label className="range-label">
              <span>
                Set to {draft}
                {pin.unit}
              </span>
              <input
                aria-label={`${pin.label} value`}
                type="range"
                min={pin.min}
                max={pin.max}
                step={pin.unit === "%" ? "1" : "any"}
                value={draft}
                disabled={disabled}
                onChange={(e) => setDraft(Number(e.target.value))}
              />
            </label>
            <button className="btn btn-sm w-full" disabled={disabled}>
              Apply {pin.label.toLowerCase()}
            </button>
          </form>
        ))}
      {pending ? (
        <p className="command-hint" role="status">
          Waiting for device confirmation…
        </p>
      ) : command?.status === "expired" ? (
        <p className="command-hint error-text">
          Timed out. The requested value was not confirmed.
        </p>
      ) : pin.direction === "input" ? (
        <p className="command-hint">Device → dashboard</p>
      ) : (
        <p className="command-hint">
          {online ? "Ready for a command" : "Waiting for a connection"}
        </p>
      )}
      <ErrorMessage message={error} />
    </article>
  );
}
function SignalChart({ samples, unit, label }) {
  const container = useRef(null),
    [width, setWidth] = useState(780);
  const hasSamples = samples.length > 0;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasSamples]);
  if (!samples.length)
    return (
      <div className="control-empty chart-empty">
        <Activity size={30} />
        <p>Waiting for {label.toLowerCase()} readings.</p>
        <small>The simulator sends V0 every two seconds.</small>
      </div>
    );
  const values = samples.map((p) => p.value),
    low = Math.min(...values),
    high = Math.max(...values),
    pad = Math.max((high - low) * 0.15, 0.5),
    min = low - pad,
    max = high + pad;
  const first = new Date(samples[0].time).getTime(),
    last = new Date(samples.at(-1).time).getTime();
  const pts = samples.map((p) => [
    50 +
      ((new Date(p.time).getTime() - first) / Math.max(last - first, 1)) *
        (width - 70),
    190 - ((p.value - min) / (max - min)) * 160,
  ]);
  return (
    <div className="signal-chart" ref={container}>
      <div className="chart-summary">
        <span>
          Latest{" "}
          <b>
            {values.at(-1).toFixed(2)} {unit}
          </b>
        </span>
        <span>
          Min {low.toFixed(2)} · Max {high.toFixed(2)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 230`}
        role="img"
        aria-label={`${label}: ${samples.length} readings, latest ${values.at(-1)} ${unit}`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="50"
              x2={width - 20}
              y1={30 + i * 40}
              y2={30 + i * 40}
              stroke="#e7ecdf"
            />
            <text
              x="40"
              y={34 + i * 40}
              textAnchor="end"
              fill="#77816f"
              fontSize="11"
            >
              {(max - ((max - min) * i) / 4).toFixed(1)}
            </text>
          </g>
        ))}
        <polyline
          points={pts.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="#285340"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="5" fill="#89a35d" />
        <text x="50" y="220" fill="#77816f" fontSize="11">
          {time(samples[0].time)}
        </text>
        <text
          x={width - 20}
          y="220"
          fill="#77816f"
          fontSize="11"
          textAnchor="end"
        >
          {time(samples.at(-1).time)}
        </text>
      </svg>
    </div>
  );
}
function AddPin({ id, pins, onClose }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const available = Array.from({ length: 32 }, (_, i) => `V${i}`).filter(
    (p) => !pins.some((x) => x.pin === p),
  );
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(`/devices/${id}/pins`, {
        method: "POST",
        body: {
          pin: f.get("pin"),
          label: f.get("label"),
          dataType: f.get("dataType"),
          direction: f.get("direction"),
          unit: f.get("unit"),
          min: Number(f.get("min")),
          max: Number(f.get("max")),
        },
      });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Add virtual pin" onClose={onClose}>
      <p className="text-muted mb-5">
        Add a channel from V0–V31. The simulator handles all output pins; custom
        sensor pins need a client that sends their readings.
      </p>
      <form onSubmit={submit}>
        <ErrorMessage message={error} />
        <label className="field">
          <span>Virtual pin</span>
          <select name="pin">
            {available.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <Field
          label="Label"
          name="label"
          required
          maxLength={60}
          placeholder="e.g. Desk lamp"
        />
        <div className="pin-form-grid">
          <label className="field">
            <span>Data type</span>
            <select name="dataType">
              <option value="boolean">Boolean (ON/OFF)</option>
              <option value="number">Number</option>
            </select>
          </label>
          <label className="field">
            <span>Direction</span>
            <select name="direction">
              <option value="output">Output — control</option>
              <option value="input">Input — sensor</option>
            </select>
          </label>
          <Field
            label="Minimum (numbers)"
            name="min"
            type="number"
            step="any"
            defaultValue={0}
            required
          />
          <Field
            label="Maximum (numbers)"
            name="max"
            type="number"
            step="any"
            defaultValue={100}
            required
          />
        </div>
        <Field
          label="Unit (optional)"
          name="unit"
          maxLength={12}
          placeholder="e.g. %"
        />
        <p className="text-xs text-muted">
          Pin type and direction are fixed after creation in this milestone.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !available.length}>
            {busy ? "Adding…" : "Add pin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
