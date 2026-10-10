import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Monitor, KeyRound } from "lucide-react";
import { Logo, Footer } from "./ui";
export function Docs() {
  return (
    <>
      <nav className="page-width nav">
        <Logo />
        <Link className="btn btn-sm" to="/dashboard">
          Open dashboard
        </Link>
      </nav>
      <main className="docs page-width">
        <Link to="/" className="back-link">
          <ArrowLeft size={14} />
          Home
        </Link>
        <div className="eyebrow mt-10">MILESTONE 2 / QUICK START</div>
        <h1>Make your first connection.</h1>
        <p className="text-lg text-muted">
          You only need your laptop. No ESP32 or other board required.
        </p>
        <article>
          <h2>1. Create an account</h2>
          <p>
            Register with your name, email, and a password of at least 12
            characters. You’ll arrive in an empty workspace that belongs only to
            you.
          </p>
          <Link className="btn btn-secondary btn-sm" to="/register">
            Create account
          </Link>
          <h2>2. Add a simulated device</h2>
          <p>
            In Devices, select <b>Add device</b>, enter a name, and choose{" "}
            <b>Laptop simulator</b>. A cryptographically random token is
            generated for this device.
          </p>
          <h2>3. Save the simulator config</h2>
          <p>
            Select <b>Simulator config</b> in the token dialog. Save the
            downloaded <code>.device.env</code> in the project root, alongside{" "}
            <code>package.json</code>. Keep it private. Alternatively, copy{" "}
            <code>.device.env.example</code> and paste your device token into
            it.
          </p>
          <pre>
            <code>
              API_URL=http://localhost:3000{"\n"}DEVICE_TOKEN=YOUR_DEVICE_TOKEN
            </code>
          </pre>
          <h2>4. Start the simulator</h2>
          <p>Open a terminal in the project root:</p>
          <pre>
            <code>npm run simulate</code>
          </pre>
          <p>
            Keep the terminal running. It sends simulated temperature and
            command acknowledgements every 2 seconds. The dashboard refreshes
            every 5 seconds and marks the device online after a valid heartbeat.
            Press Ctrl+C to stop; after 30 seconds without a heartbeat the
            device becomes offline.
          </p>
          <h2>5. Open device controls</h2>
          <p>
            Click your device name in the registry. V0 shows simulated
            temperature and a history chart; V1 provides ON/OFF controls; V2
            sets brightness. A value changes only after the simulator
            acknowledges it. Add more output pins with Add virtual pin.
          </p>
          <h2>6. Manage access</h2>
          <p>
            Click the masked token in the device list to reveal or rotate it
            after confirming your password. Rotation immediately invalidates the
            old token. Update your simulator configuration, then restart it.
            Disabling a device blocks its token until you enable it again.
          </p>
          <div className="docs-note">
            <KeyRound size={22} />
            <p>
              Device credentials are encrypted at rest and can authenticate as
              that device. Never include them in screenshots, public
              repositories, or support messages.
            </p>
          </div>
          <h2>What’s included?</h2>
          <p>
            Landing page, registration, login, account settings, device
            management, secure token access, virtual pins, sensor charts,
            command acknowledgements, and live WebSocket updates. MQTT,
            Google/Alexa, drag-and-drop layouts, password recovery, and email
            verification are later milestones.
          </p>
          <h2>Self-hosting</h2>
          <p>
            The source package includes a PostgreSQL schema, Node.js/Express
            API, React/Tailwind interface, Docker configuration, tests, and a
            detailed README. This upgrade retains your Milestone 1 database
            named <code>openiot_m1</code>; migration 002 adds the pin, command,
            and telemetry tables. Keep your existing environment files and
            encryption key.
          </p>
          <Link className="btn mt-6" to="/dashboard">
            <Monitor size={17} />
            Go to your devices
          </Link>
        </article>
      </main>
      <Footer />
    </>
  );
}
