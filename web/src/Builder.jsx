import { uuid } from "./uuid";
import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { Responsive } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Plus,
  GripVertical,
  Settings2,
  Trash2,
  LayoutDashboard,
  Save,
  Smartphone,
  Monitor,
  Power,
} from "lucide-react";
import { api } from "./api";
import { Modal, Field, ErrorMessage, Status } from "./ui";
import { useLiveDevice } from "./DeviceControl";
function Grid({children,...props}) {
 const ref=useRef(null),[width,setWidth]=useState(0);
 useLayoutEffect(()=>{
  const node=ref.current;
  const measure=()=>setWidth(Math.round(node.getBoundingClientRect().width));
  measure();
  const observer=new ResizeObserver(measure);observer.observe(node);
  return()=>observer.disconnect();
 },[]);
 return <div ref={ref} style={{width:"100%",minWidth:0}}>{width>0&&<Responsive {...props} width={width}>{children}</Responsive>}</div>;
}
const initial = { title: "My dashboard", version: 0, widgets: [] };
const shown = (v) =>
  v == null
    ? "Not reported"
    : typeof v === "boolean"
      ? v
        ? "ON"
        : "OFF"
      : Number(v.toFixed(2));
function DeviceBridge({ id, onState }) {
  const data = useLiveDevice(id);
  useEffect(() => {
    onState(id, data);
  }, [id, data.state, data.error, data.live, onState]);
  return null;
}
export function Builder() {
  const [board, setBoard] = useState(initial),
    [catalog, setCatalog] = useState([]),
    [states, setStates] = useState({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [modal, setModal] = useState(null),
    [mobile, setMobile] = useState(false),
    [note, setNote] = useState("");
  const ids = useMemo(
    () => [...new Set(board.widgets.map((w) => w.deviceId))],
    [board.widgets],
  );
  const onState = useCallback(
    (id, data) => setStates((s) => ({ ...s, [id]: data })),
    [],
  );
  useEffect(() => {
    let stop = false;
    Promise.all([api("/dashboard-layout"), api("/catalog")])
      .then(([b, c]) => {
        if (!stop) {
          setBoard(b);
          setCatalog(c.devices);
        }
      })
      .catch((e) => {
        if (!stop) setError(e.message);
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(fn) {
    setBoard(fn);
    setDirty(true);
    setNote("");
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await api("/dashboard-layout", { method: "PUT", body: board });
      setBoard((b) => ({ ...b, version: r.version }));
      setDirty(false);
      setEditing(false);
      setNote("Dashboard saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function layoutsChanged(_, layouts) {
    if (!editing || saving) return;
    setBoard((b) => {
      const widgets = b.widgets.map((w) => ({
        ...w,
        layouts: {
          lg: clean(
            layouts.lg?.find((l) => l.i === w.id),
            w.layouts.lg,
          ),
          sm: clean(
            layouts.sm?.find((l) => l.i === w.id),
            w.layouts.sm,
          ),
        },
      }));
      if (JSON.stringify(widgets) === JSON.stringify(b.widgets)) return b;
      setDirty(true);
      return { ...b, widgets };
    });
  }
  if (loading)
    return (
      <main className="m4-page">
        <p>Loading your dashboard…</p>
      </main>
    );
  return (
    <main className="m4-page">
      {ids.map((id) => (
        <DeviceBridge key={id} id={id} onState={onState} />
      ))}
      <header className="m4-heading">
        <div>
          <p className="m4-eyebrow">YOUR SPACE, YOUR CONTROLS</p>
          <h1>{board.title}</h1>
          <p>Bring your devices together. Make every control your own.</p>
        </div>
        <div className="m4-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <Monitor size={17} /> : <Smartphone size={17} />}{" "}
            {mobile ? "Desktop preview" : "Phone preview"}
          </button>
          {editing ? (
            <>
              <button
                className="btn btn-secondary"
                disabled={saving || board.widgets.length >= 24}
                onClick={() => setModal({})}
              >
                <Plus size={17} /> Add widget
              </button>
              <button className="btn" disabled={saving} onClick={save}>
                <Save size={17} />
                {saving ? "Saving…" : "Save dashboard"}
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setEditing(true)}>
              <Settings2 size={17} /> Edit dashboard
            </button>
          )}
        </div>
      </header>
      <ErrorMessage message={error} />
      {note && (
        <p className="m4-notice" role="status">
          {note}
        </p>
      )}
      {editing && (
        <div className="m4-editbar">
          <label>
            Dashboard name{" "}
            <input
              aria-label="Dashboard name"
              maxLength={80}
              value={board.title}
              disabled={saving}
              onChange={(e) => update((b) => ({ ...b, title: e.target.value }))}
            />
          </label>
          <span>
            {dirty
              ? "Unsaved changes · save before leaving"
              : "Drag a handle or resize a corner. Settings also provide keyboard layout controls."}
          </span>
        </div>
      )}
      {!board.widgets.length ? (
        <section className="m4-empty">
          <LayoutDashboard size={44} />
          <h2>A home for your devices</h2>
          <p>
            Add switches, sliders, gauges, live values and charts. Bind each
            widget to a virtual pin.
          </p>
          <button
            className="btn"
            onClick={() => {
              setEditing(true);
              setModal({});
            }}
          >
            Add your first widget
          </button>
          <p>
            <Link to="/dashboard">Manage devices</Link>
          </p>
        </section>
      ) : (
        <div className={mobile ? "m4-grid-wrap phone" : "m4-grid-wrap"}>
          <Grid
            key={mobile ? "phone" : "full"}
            breakpoints={{ lg: 900, sm: 0 }}
            cols={{ lg: 12, sm: 4 }}
            layouts={{
              lg: board.widgets.map((w) => ({ i: w.id, ...w.layouts.lg })),
              sm: board.widgets.map((w) => ({ i: w.id, ...w.layouts.sm })),
            }}
            rowHeight={62}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={editing && !saving}
            isResizable={editing && !saving}
            draggableHandle=".m4-handle"
            minH={3}
            onLayoutChange={layoutsChanged}
          >
            {board.widgets.map((w) => (
              <div
                key={w.id}
                className="m4-widget"
                style={{ "--widget-color": w.config.color }}
              >
                <header className="m4-widget-header">
                  <div>
                    {editing && (
                      <span className="m4-handle" title="Drag widget">
                        <GripVertical size={20} />
                      </span>
                    )}
                    <h2>{w.label}</h2>
                  </div>
                  {editing ? (
                    <div className="m4-actions">
                      <button
                        className="icon-btn"
                        aria-label={`Edit ${w.label}`}
                        disabled={saving}
                        onClick={() => setModal(w)}
                      >
                        <Settings2 size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Remove ${w.label}`}
                        disabled={saving}
                        onClick={() =>
                          update((b) => ({
                            ...b,
                            widgets: b.widgets.filter((x) => x.id !== w.id),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : (
                    <small>{w.pin}</small>
                  )}
                </header>
                <Widget
                  w={w}
                  connection={states[w.deviceId]}
                  editing={editing}
                />
              </div>
            ))}
          </Grid>
        </div>
      )}
      <p className="m4-footnote">
        {board.widgets.length}/24 widgets · Up to 5 devices per dashboard ·
        Controls show the last device-confirmed value.
      </p>
      {modal && (
        <WidgetEditor
          initial={modal}
          devices={catalog}
          onClose={() => setModal(null)}
          onSave={(w) => {
            if (
              !board.widgets.some((x) => x.id === w.id) &&
              new Set([...ids, w.deviceId]).size > 5
            ) {
              throw Error("Limit: 5 devices per dashboard.");
            }
            update((b) => ({
              ...b,
              widgets: b.widgets.some((x) => x.id === w.id)
                ? b.widgets.map((x) => (x.id === w.id ? w : x))
                : [...b.widgets, w],
            }));
            setModal(null);
          }}
          count={board.widgets.length}
        />
      )}
    </main>
  );
}
function clean(p, fallback) {
  return p
    ? {
        x: p.x,
        y: Math.min(500, p.y),
        w: p.w,
        h: Math.max(3, Math.min(12, p.h)),
      }
    : fallback;
}
function Widget({ w, connection, editing }) {
  const [draft, setDraft] = useState(w.config.min),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const state = connection?.state,
    pin = state?.pins.find((p) => p.pin === w.pin),
    command = state?.commands.find((c) => c.pin === w.pin),
    online = state?.device.status === "online" && !connection?.error;
  useEffect(() => {
    if (typeof pin?.value === "number")
      setDraft(Math.max(w.config.min, Math.min(w.config.max, pin.value)));
  }, [pin?.value, w.config.min, w.config.max]);
  async function send(value) {
    setBusy(true);
    setError("");
    try {
      await api(`/devices/${w.deviceId}/commands`, {
        method: "POST",
        body: { id: uuid(), pin: w.pin, value },
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const disabled = editing || busy || !online || command?.status === "pending";
  const value = pin?.value;
  const pct =
    typeof value === "number"
      ? Math.max(
          0,
          Math.min(
            100,
            ((value - w.config.min) / (w.config.max - w.config.min)) * 100,
          ),
        )
      : 0;
  return (
    <div className="m4-widget-body">
      <div className="m4-device-line">
        <Link to={`/dashboard/devices/${w.deviceId}`}>
          {state?.device.name ?? "Device"}
        </Link>
        <span className={online ? "m4-online" : "m4-offline"}>
          {state?.device.status ?? "Connecting"}
        </span>
      </div>
      {w.kind === "chart" ? (
        <HistoryChart w={w} />
      ) : w.kind === "gauge" ? (
        <div className="m4-gauge">
          <svg
            viewBox="0 0 200 110"
            role="img"
            aria-label={`${w.label}: ${shown(value)} ${w.config.unit}`}
          >
            <path
              d="M 20 95 A 80 80 0 0 1 180 95"
              fill="none"
              stroke="#e9eee8"
              strokeWidth="14"
              pathLength="100"
            />
            <path
              d="M 20 95 A 80 80 0 0 1 180 95"
              fill="none"
              stroke="var(--widget-color)"
              strokeWidth="14"
              pathLength="100"
              strokeDasharray={`${pct} 100`}
            />
            <text
              x="100"
              y="89"
              textAnchor="middle"
              fill="currentColor"
              fontSize="22"
            >
              {shown(value)} {value != null ? w.config.unit : ""}
            </text>
          </svg>
          <div className="m4-between">
            <small>{w.config.min}</small>
            <small>
              {w.config.max} {w.config.unit}
            </small>
          </div>
        </div>
      ) : (
        <div className="m4-value">
          {shown(value)}
          {value != null && typeof value === "number" && (
            <small>{w.config.unit}</small>
          )}
        </div>
      )}
      {w.kind === "switch" && (
        <div className="m4-switch">
          <button
            className={`btn ${value === true ? "" : "btn-secondary"}`}
            disabled={disabled}
            onClick={() => send(true)}
          >
            <Power size={16} /> ON
          </button>
          <button
            className={`btn ${value === false ? "" : "btn-secondary"}`}
            disabled={disabled}
            onClick={() => send(false)}
          >
            OFF
          </button>
        </div>
      )}
      {w.kind === "slider" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(Number(draft));
          }}
        >
          <label className="m4-slider-label">
            Set to {Number(Number(draft).toFixed(4))}
            {w.config.unit}
            <input
              aria-label={`${w.label} target`}
              type="range"
              min={w.config.min}
              max={w.config.max}
              step={w.config.step}
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button className="btn w-full" disabled={disabled}>
            Apply
          </button>
        </form>
      )}
      <small className="m4-reported">
        {pin?.reportedAt
          ? `Reported ${new Date(pin.reportedAt).toLocaleTimeString()}`
          : "Waiting for device report"}
      </small>
      {["slider", "switch"].includes(w.kind) && command && (
        <small className={`m4-command ${command.status}`} role="status">
          {command.status === "pending"
            ? "Waiting for device confirmation…"
            : command.status === "acknowledged"
              ? "Device confirmed"
              : command.status === "expired"
                ? "Timed out — device did not confirm"
                : "Command cancelled"}
        </small>
      )}
      <ErrorMessage
        message={
          error ||
          connection?.error ||
          (!pin && state
            ? "Mapped pin no longer exists. Edit this widget."
            : "")
        }
      />
    </div>
  );
}
function HistoryChart({ w }) {
  const [samples, setSamples] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let stop = false,
      busy = false;
    const ctl = new AbortController();
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const r = await api(`/devices/${w.deviceId}/history?pin=${w.pin}`, {
          signal: ctl.signal,
        });
        if (!stop) {
          setSamples(r.samples);
          setError("");
        }
      } catch (e) {
        if (!stop) setError(e.message);
      } finally {
        busy = false;
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => {
      stop = true;
      ctl.abort();
      clearInterval(t);
    };
  }, [w.deviceId, w.pin]);
  if (error) return <ErrorMessage message={error} />;
  if (samples.length < 2)
    return (
      <p className="m4-chart-empty">
        Waiting for at least two telemetry samples…
      </p>
    );
  const min = Math.min(...samples.map((s) => s.value)),
    max = Math.max(...samples.map((s) => s.value)),
    range = max - min || 1;
  const first = +new Date(samples[0].time),
    last = +new Date(samples.at(-1).time);
  const points = samples
    .map(
      (s) =>
        `${12 + ((+new Date(s.time) - first) / Math.max(1, last - first)) * 376},${135 - ((s.value - min) / range) * 110}`,
    )
    .join(" ");
  return (
    <div className="m4-chart">
      <div className="m4-between">
        <b>
          {shown(samples.at(-1).value)} {w.config.unit}
        </b>
        <small>Latest {samples.length} samples</small>
      </div>
      <svg
        viewBox="0 0 400 155"
        role="img"
        aria-label={`${w.label} history, minimum ${min}, maximum ${max}`}
      >
        <path
          d="M12 25H388 M12 80H388 M12 135H388"
          stroke="#e6ece5"
          fill="none"
        />
        <polyline
          points={points}
          stroke="var(--widget-color)"
          strokeWidth="3"
          fill="none"
        />
      </svg>
      <div className="m4-between">
        <small>{new Date(first).toLocaleTimeString()}</small>
        <small>{new Date(last).toLocaleTimeString()}</small>
      </div>
    </div>
  );
}
function WidgetEditor({ initial, devices, onClose, onSave, count }) {
  const [w, setW] = useState(() =>
      initial.id
        ? structuredClone(initial)
        : {
            id: uuid(),
            deviceId: devices[0]?.id ?? "",
            pin: "",
            kind: "value",
            label: "",
            config: { color: "#285b48", unit: "", min: 0, max: 100, step: 1 },
            layouts: {
              lg: { x: 0, y: Math.min(500, count * 5), w: 4, h: 5 },
              sm: { x: 0, y: Math.min(500, count * 5), w: 4, h: 5 },
            },
          },
    ),
    [error, setError] = useState("");
  const device = devices.find((d) => d.id === w.deviceId);
  const compatible = (p) =>
    w.kind === "switch"
      ? p.direction === "output" && p.dataType === "boolean"
      : w.kind === "slider"
        ? p.direction === "output" && p.dataType === "number"
        : w.kind === "chart"
          ? p.dataType === "number" && p.direction === "input"
          : w.kind === "gauge"
            ? p.dataType === "number"
            : true;
  const pins = (device?.pins ?? []).filter(compatible);
  function selectPin(name) {
    const p = device?.pins.find((p) => p.pin === name);
    setW((x) => ({
      ...x,
      pin: name,
      label: p?.label ?? x.label,
      config: {
        ...x.config,
        unit: p?.unit ?? "",
        min: p?.min ?? 0,
        max: p?.max ?? 100,
        step:
          p?.unit === "%"
            ? 1
            : Math.min(1, ((p?.max ?? 100) - (p?.min ?? 0)) / 100),
      },
    }));
  }
  function config(key, value) {
    setW((x) => ({ ...x, config: { ...x.config, [key]: value } }));
  }
  return (
    <Modal
      title={initial.id ? "Customize widget" : "Add a widget"}
      onClose={onClose}
    >
      <form
        className="m4-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!pins.some((p) => p.pin === w.pin))
              throw Error("Choose a compatible pin.");
            onSave(w);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <ErrorMessage message={error} />
        <label className="field">
          Widget type
          <select aria-label="Widget type"
            value={w.kind}
            onChange={(e) =>
              setW((x) => ({ ...x, kind: e.target.value, pin: "" }))
            }
          >
            {["value", "switch", "slider", "gauge", "chart"].map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Device
          <select aria-label="Device"
            required
            value={w.deviceId}
            onChange={(e) =>
              setW((x) => ({ ...x, deviceId: e.target.value, pin: "" }))
            }
          >
            <option value="">Choose device</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Virtual pin
          <select aria-label="Virtual pin"
            required
            value={w.pin}
            onChange={(e) => selectPin(e.target.value)}
          >
            <option value="">Choose compatible pin</option>
            {pins.map((p) => (
              <option key={p.pin} value={p.pin}>
                {p.pin} · {p.label}
              </option>
            ))}
          </select>
        </label>
        {!pins.length && (
          <p>
            No compatible pins. Add the required pin in the device workspace
            first.
          </p>
        )}
        <Field
          label="Widget label"
          value={w.label}
          required
          maxLength={60}
          onChange={(e) => setW((x) => ({ ...x, label: e.target.value }))}
        />
        <div className="m4-two">
          <Field
            label="Accent colour"
            type="color"
            value={w.config.color}
            onChange={(e) => config("color", e.target.value)}
          />
          <Field
            label="Display unit"
            maxLength={12}
            value={w.config.unit}
            onChange={(e) => config("unit", e.target.value)}
          />
        </div>
        {["slider", "gauge"].includes(w.kind) && (
          <div className="m4-two">
            <Field
              label="Minimum"
              type="number"
              step="any"
              value={w.config.min}
              required
              onChange={(e) => config("min", Number(e.target.value))}
            />
            <Field
              label="Maximum"
              type="number"
              step="any"
              value={w.config.max}
              required
              onChange={(e) => config("max", Number(e.target.value))}
            />
            {w.kind === "slider" && (
              <Field
                label="Slider step"
                type="number"
                min="0.000001"
                step="any"
                value={w.config.step}
                required
                onChange={(e) => config("step", Number(e.target.value))}
              />
            )}
          </div>
        )}
        <details>
          <summary>Keyboard layout settings</summary>
          {[
            ["lg", 12, "Desktop"],
            ["sm", 4, "Phone"],
          ].map(([key, cols, label]) => (
            <fieldset key={key}>
              <legend>{label} grid (zero-based position)</legend>
              <div className="m4-two">
                {[
                  ["x", "Column", 0, cols - 1],
                  ["y", "Row", 0, 500],
                  ["w", "Width", 1, cols],
                  ["h", "Height", 3, 12],
                ].map(([prop, title, min, max]) => (
                  <Field
                    key={prop}
                    label={`${label} ${title}`}
                    type="number"
                    min={min}
                    max={max}
                    required
                    value={w.layouts[key][prop]}
                    onChange={(e) =>
                      setW((x) => ({
                        ...x,
                        layouts: {
                          ...x.layouts,
                          [key]: {
                            ...x.layouts[key],
                            [prop]: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </details>
        <p className="m4-help">
          Units and colours change presentation only. Firmware must support the
          mapped pin.
        </p>
        <button className="btn" type="submit">
          {initial.id ? "Update widget" : "Add widget"}
        </button>
      </form>
    </Modal>
  );
}
