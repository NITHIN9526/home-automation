import React, { useEffect, useState } from "react";
import {
  Plus,
  Clock3,
  CalendarDays,
  Pencil,
  Trash2,
  Pause,
  Play,
} from "lucide-react";
import { api } from "./api";
import { Modal, Field, ErrorMessage } from "./ui";
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const valueText = (v) =>
  typeof v === "boolean" ? (v ? "ON" : "OFF") : String(v);
const at = (date, zone) =>
  date
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(date))
    : "—";
const payload = (a) => ({
  name: a.name,
  deviceId: a.device_id,
  pin: a.pin,
  value: a.value,
  timezone: a.timezone,
  schedule: a.schedule,
  enabled: a.enabled,
});
function description(a) {
  const s = a.schedule;
  return s.kind === "once"
    ? `Once · ${s.localDateTime.replace("T", " ")}`
    : s.kind === "daily"
      ? `Every day · ${s.time}`
      : `${s.days.map((d) => days[d]).join(", ")} · ${s.time}`;
}
export function Automations() {
  const [data, setData] = useState({ automations: [], runs: [] }),
    [catalog, setCatalog] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  useEffect(() => {
    let stopped = false,
      inFlight = false;
    const ctl = new AbortController();
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const d = await api("/automations", { signal: ctl.signal });
        if (!stopped) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        inFlight = false;
        if (!stopped) setLoading(false);
      }
    }
    api("/catalog", { signal: ctl.signal })
      .then((r) => {
        if (!stopped) setCatalog(r.devices);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    load();
    const t = setInterval(load, 5000);
    return () => {
      stopped = true;
      ctl.abort();
      clearInterval(t);
    };
  }, []);
  async function refresh() {
    setData(await api("/automations"));
  }
  async function toggle(a) {
    setBusy(true);
    setError("");
    try {
      await api(`/automations/${a.id}`, {
        method: "PUT",
        body: { ...payload(a), enabled: !a.enabled },
      });
      await refresh();
      setNote(
        a.enabled
          ? "Automation paused. Pending commands were cancelled where still possible."
          : "Automation enabled.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(a) {
    if (
      !window.confirm(
        `Delete “${a.name}” and its run history? Commands already applied cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/automations/${a.id}`, { method: "DELETE", body: {} });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="m4-page">
      <header className="m4-heading">
        <div>
          <p className="m4-eyebrow">LET TIME TAKE CARE OF IT</p>
          <h1>Automations</h1>
          <p>Set a time. Choose an action. See what actually happened.</p>
        </div>
        <button className="btn" onClick={() => setEditing({})}>
          <Plus size={18} /> Create automation
        </button>
      </header>
      <div className="m4-schedule-banner">
        <Clock3 size={24} />
        <div>
          <b>Your server is the clock.</b>
          <p>
            Keep the laptop awake, PostgreSQL running, and the backend open.
            Offline devices are skipped. Schedules over one minute late are
            logged, not replayed.
          </p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {note && (
        <p className="m4-notice" role="status">
          {note}
        </p>
      )}
      <div className="m4-summary">
        <span>
          <b>{data.automations.filter((a) => a.enabled).length}</b> enabled
        </span>
        <span>
          <b>{data.automations.length}</b> total schedules
        </span>
        <span>
          <b>{data.runs.filter((r) => r.outcome === "acknowledged").length}</b>{" "}
          confirmed in recent history
        </span>
      </div>
      {loading ? (
        <p>Loading schedules…</p>
      ) : !data.automations.length ? (
        <section className="m4-empty">
          <CalendarDays size={44} />
          <h2>A little less to remember</h2>
          <p>
            Turn Light on at 6:00 PM and off at 10:00 PM with two schedules.
          </p>
          <button className="btn" onClick={() => setEditing({})}>
            Create your first automation
          </button>
        </section>
      ) : (
        <div className="m4-automation-list">
          {data.automations.map((a) => (
            <article key={a.id} className="m4-automation">
              <div className="m4-schedule-icon">
                <Clock3 size={24} />
              </div>
              <div className="m4-auto-main">
                <div className="m4-auto-title">
                  <h2>{a.name}</h2>
                  <span className={a.enabled ? "m4-badge enabled" : "m4-badge"}>
                    {a.enabled ? "Enabled" : "Inactive"}
                  </span>
                </div>
                <p>
                  <b>{a.device_name}</b> · {a.pin} → <b>{valueText(a.value)}</b>
                </p>
                <p>
                  {description(a)} <span className="m4-zone">{a.timezone}</span>
                </p>
                <small>
                  {a.next_run_at
                    ? `Next: ${at(a.next_run_at, a.timezone)}`
                    : "No upcoming run — edit to reschedule or enable."}
                </small>
              </div>
              <div className="m4-actions">
                <button
                  className="icon-btn"
                  disabled={busy}
                  aria-label={`${a.enabled ? "Pause" : "Enable"} ${a.name}`}
                  onClick={() => toggle(a)}
                >
                  {a.enabled ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Edit ${a.name}`}
                  onClick={() => setEditing(a)}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="icon-btn"
                  disabled={busy}
                  aria-label={`Delete ${a.name}`}
                  onClick={() => remove(a)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="m4-history">
        <div className="m4-between">
          <h2>Run history</h2>
          <small>Latest 100 runs · refreshes every 5 seconds</small>
        </div>
        <p className="m4-help">
          Queued means sent for execution. Confirmed means the device
          acknowledged it, not that a physical sensor verified the output.
        </p>
        {!data.runs.length ? (
          <p className="m4-history-empty">
            Your first scheduled run will appear here.
          </p>
        ) : (
          <div className="m4-run-list">
            {data.runs.map((r) => (
              <div key={r.id} className="m4-run">
                <div>
                  <b>{r.name}</b>
                  <small>
                    {at(r.scheduled_for, r.timezone)} · {r.timezone}
                  </small>
                </div>
                <span className={`m4-outcome ${r.outcome}`}>
                  {r.outcome === "acknowledged" ? "Confirmed" : r.outcome}
                </span>
                <p>
                  {r.outcome === "acknowledged"
                    ? "Device acknowledged the requested value."
                    : r.outcome === "expired"
                      ? "Device did not confirm before the command expired."
                      : r.outcome === "cancelled"
                        ? "Command cancelled before confirmation."
                        : r.detail}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing && (
        <AutomationEditor
          original={editing}
          devices={catalog}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNote(
              "Automation saved. Times use the timezone shown on the schedule.",
            );
            await refresh();
          }}
        />
      )}
    </main>
  );
}
function AutomationEditor({ original, devices, onClose, onSaved }) {
  const [a, setA] = useState(() =>
      original.id
        ? payload(original)
        : {
            name: "",
            deviceId: devices[0]?.id ?? "",
            pin: "",
            value: true,
            timezone:
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "Asia/Kolkata",
            schedule: { kind: "daily", time: "18:00" },
            enabled: true,
          },
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const device = devices.find((d) => d.id === a.deviceId),
    pins = (device?.pins ?? []).filter((p) => p.direction === "output"),
    pin = pins.find((p) => p.pin === a.pin);
  function schedule(key, value) {
    setA((x) => ({ ...x, schedule: { ...x.schedule, [key]: value } }));
  }
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(original.id ? `/automations/${original.id}` : "/automations", {
        method: original.id ? "PUT" : "POST",
        body: a,
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={original.id ? "Edit automation" : "Create automation"}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className="m4-form" onSubmit={submit}>
        <fieldset disabled={saving} className="m4-form">
          <ErrorMessage message={error} />
          <Field
            label="Automation name"
            placeholder="Light on in the evening"
            value={a.name}
            required
            maxLength={80}
            onChange={(e) => setA((x) => ({ ...x, name: e.target.value }))}
          />
          <label className="field">
            Device
            <select aria-label="Device"
              required
              value={a.deviceId}
              onChange={(e) =>
                setA((x) => ({ ...x, deviceId: e.target.value, pin: "" }))
              }
            >
              <option value="">Choose device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.disabled ? " (disabled)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Output pin
            <select aria-label="Output pin"
              required
              value={a.pin}
              onChange={(e) => {
                const p = pins.find((p) => p.pin === e.target.value);
                setA((x) => ({
                  ...x,
                  pin: e.target.value,
                  value: p?.dataType === "number" ? p.min : true,
                }));
              }}
            >
              <option value="">Choose output pin</option>
              {pins.map((p) => (
                <option key={p.pin} value={p.pin}>
                  {p.pin} · {p.label}
                </option>
              ))}
            </select>
          </label>
          {pin?.dataType === "boolean" ? (
            <label className="field">
              Action
              <select aria-label="Action"
                value={String(a.value)}
                onChange={(e) =>
                  setA((x) => ({ ...x, value: e.target.value === "true" }))
                }
              >
                <option value="true">Turn ON</option>
                <option value="false">Turn OFF</option>
              </select>
            </label>
          ) : (
            pin && (
              <Field
                label={`Set value (${pin.unit || pin.label})`}
                type="number"
                min={pin.min}
                max={pin.max}
                step={pin.unit === "%" ? 1 : "any"}
                value={a.value}
                required
                onChange={(e) =>
                  setA((x) => ({ ...x, value: Number(e.target.value) }))
                }
              />
            )
          )}
          <label className="field">
            Repeat
            <select aria-label="Repeat"
              value={a.schedule.kind}
              onChange={(e) =>
                setA((x) => ({
                  ...x,
                  schedule:
                    e.target.value === "once"
                      ? { kind: "once", localDateTime: "" }
                      : e.target.value === "weekly"
                        ? {
                            kind: "weekly",
                            time: "18:00",
                            days: [1, 2, 3, 4, 5],
                          }
                        : { kind: "daily", time: "18:00" },
                }))
              }
            >
              <option value="once">Once</option>
              <option value="daily">Every day</option>
              <option value="weekly">Selected weekdays</option>
            </select>
          </label>
          {a.schedule.kind === "once" ? (
            <Field
              label="Date and time"
              type="datetime-local"
              required
              value={a.schedule.localDateTime}
              onChange={(e) => schedule("localDateTime", e.target.value)}
            />
          ) : (
            <Field
              label="Time"
              type="time"
              required
              value={a.schedule.time}
              onChange={(e) => schedule("time", e.target.value)}
            />
          )}
          {a.schedule.kind === "weekly" && (
            <fieldset>
              <legend>Run on</legend>
              <div className="m4-days">
                {days.map((day, i) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={a.schedule.days.includes(i)}
                      onChange={(e) =>
                        schedule(
                          "days",
                          e.target.checked
                            ? [...a.schedule.days, i].sort()
                            : a.schedule.days.filter((d) => d !== i),
                        )
                      }
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field
            label="Timezone"
            list="m4-timezones"
            required
            maxLength={80}
            value={a.timezone}
            onChange={(e) => setA((x) => ({ ...x, timezone: e.target.value }))}
          />
          <datalist id="m4-timezones">
            {[
              "Asia/Kolkata",
              "UTC",
              "Europe/London",
              "America/New_York",
              "Asia/Dubai",
            ].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="m4-help">
            The selected time is interpreted in{" "}
            <b>{a.timezone || "your chosen timezone"}</b>. Use Asia/Kolkata for
            Indian Standard Time.
          </p>
          <label className="m4-checkbox">
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) =>
                setA((x) => ({ ...x, enabled: e.target.checked }))
              }
            />{" "}
            Enable this automation
          </label>
          <p className="m4-help">
            Saving edits replaces the next run and cancels commands still
            pending. A command already received by a device cannot be recalled.
          </p>
          <button className="btn" type="submit">
            {saving ? "Saving…" : "Save automation"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
