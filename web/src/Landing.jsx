import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShieldCheck,
  Server,
  Cpu,
  Radio,
  KeyRound,
  Terminal,
  Check,
  Workflow,
  Code2,
  Plus,
  ArrowUpRight,
  Monitor,
} from "lucide-react";
import { Logo, Footer, Status } from "./ui";
import { useAuth } from "./auth";
export function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <nav className="page-width nav">
        <Logo />
        <div className="hidden sm:flex items-center gap-8 text-sm">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <Link to="/docs">Documentation</Link>
        </div>
        <div className="flex gap-4 items-center">
          <Link
            className="text-sm hidden sm:block"
            to={user ? "/dashboard" : "/login"}
          >
            {user ? "Dashboard" : "Log in"}
          </Link>
          <Link className="btn btn-sm" to={user ? "/dashboard" : "/register"}>
            Get started <ArrowUpRight size={15} />
          </Link>
        </div>
      </nav>
      <main>
        <section className="page-width hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="small-dot" /> OPEN SOURCE. SELF HOSTED. YOURS.
            </div>
            <h1>
              Your devices.
              <br />
              Your rules.
              <br />
              <span className="hero-accent">One open platform.</span>
            </h1>
            <p className="hero-description">
              Bring your connected ideas to life. Register devices, manage
              secure access, and build your own IoT ecosystem—on infrastructure
              you control.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                className="btn btn-lg"
                to={user ? "/dashboard" : "/register"}
              >
                Start building <ArrowRight size={18} />
              </Link>
              <a className="btn btn-secondary btn-lg" href="#features">
                Explore the platform
              </a>
            </div>
            <p className="hero-note">
              <Check size={14} /> No board required to get started{" "}
              <span>·</span> MIT licensed
            </p>
          </div>
          <div
            className="hero-visual"
            aria-label="Illustrative preview of the device dashboard"
          >
            <div className="preview-window">
              <div className="preview-top">
                <div className="flex gap-1.5">
                  <i />
                  <i />
                  <i />
                </div>
                <span>YOUR WORKSPACE / DEVICES</span>
                <ShieldCheck size={14} />
              </div>
              <div className="preview-body">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-[10px] text-muted">
                      WELCOME TO YOUR WORKSPACE
                    </span>
                    <h3 className="text-2xl font-semibold mt-1">
                      Connected, on your terms.
                    </h3>
                  </div>
                  <span className="preview-plus">
                    <Plus size={17} />
                  </span>
                </div>
                <div className="preview-stats">
                  <div>
                    <small>Devices</small>
                    <strong>03</strong>
                  </div>
                  <div>
                    <small>Online</small>
                    <strong className="text-green-700">
                      02 <span className="tiny-dot" />
                    </strong>
                  </div>
                  <div>
                    <small>Your infrastructure</small>
                    <strong className="text-base pt-2">
                      100% yours <Server size={17} />
                    </strong>
                  </div>
                </div>
                <div className="preview-device">
                  <span className="device-icon">
                    <Cpu size={20} />
                  </span>
                  <div>
                    <b>Workshop controller</b>
                    <small>ESP32 · VIRTUAL PIN READY</small>
                  </div>
                  <Status status="online" />
                </div>
                <div className="preview-device">
                  <span className="device-icon">
                    <Monitor size={20} />
                  </span>
                  <div>
                    <b>Laptop simulator</b>
                    <small>SIMULATED DEVICE</small>
                  </div>
                  <Status status="online" />
                </div>
                <div className="preview-device">
                  <span className="device-icon">
                    <Radio size={20} />
                  </span>
                  <div>
                    <b>Garden sensor</b>
                    <small>ESP8266</small>
                  </div>
                  <Status status="offline" />
                </div>
                <div className="preview-token">
                  <KeyRound size={14} />
                  <code>Device credentials, securely managed</code>
                  <ShieldCheck size={15} />
                </div>
              </div>
            </div>
            <div className="floating-code">
              <span className="text-lime-300">●</span> &nbsp; heartbeat accepted{" "}
              <span className="opacity-45 ml-5">200 OK</span>
            </div>
            <p className="preview-caption">
              Illustrative preview · your workspace starts empty
            </p>
          </div>
        </section>
        <section className="stack-strip">
          <div className="page-width flex flex-wrap items-center justify-between gap-5">
            <span>OPEN BY DESIGN. BUILT ON TOOLS YOU KNOW.</span>
            <b>React</b>
            <b>Node.js</b>
            <b>PostgreSQL</b>
            <b>ESP32-ready</b>
          </div>
        </section>
        <section id="features" className="page-width section-space">
          <div className="eyebrow">A FOUNDATION YOU CAN BUILD ON</div>
          <div className="section-heading">
            <h2>
              Less setup.
              <br />
              More making.
            </h2>
            <p>
              Start with a secure home for your devices.
              <br />
              Grow into the ecosystem you want to build.
            </p>
          </div>
          <div className="feature-grid">
            {[
              [
                Server,
                "Your server. Your data.",
                "Run the platform on your own machine or server. Your accounts and device registry live in your PostgreSQL database.",
              ],
              [
                KeyRound,
                "Credentials, under control.",
                "Generate a unique token for every device. Reveal it securely, rotate it when needed, and disable access in a click.",
              ],
              [
                Terminal,
                "Start without hardware.",
                "Connect the included laptop simulator and watch it come online. Your first device can be the computer you already own.",
              ],
            ].map(([Icon, title, text], i) => (
              <article className="feature-card" key={title}>
                <div className="flex justify-between">
                  <span className="feature-icon">
                    <Icon size={24} />
                  </span>
                  <span className="text-xs text-muted font-mono">0{i + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="how-it-works" className="page-width mb-24">
          <div className="how-panel">
            <div>
              <div className="eyebrow text-lime-200">FROM IDEA TO ONLINE</div>
              <h2>
                Your first device.
                <br />
                Three simple steps.
              </h2>
              <Link to="/register" className="btn btn-lime mt-7">
                Create your workspace <ArrowRight size={17} />
              </Link>
            </div>
            <div className="steps">
              {[
                [
                  "01",
                  "Make it yours",
                  "Create an account on your self-hosted instance.",
                ],
                [
                  "02",
                  "Register a device",
                  "Name your board or choose the laptop simulator.",
                ],
                [
                  "03",
                  "Connect securely",
                  "Copy its token, start the simulator, and see it online.",
                ],
              ].map(([n, title, text]) => (
                <div className="step" key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="page-width roadmap">
          <div className="eyebrow">THE BIGGER PICTURE</div>
          <h2>An open foundation for your IoT ecosystem.</h2>
          <p>
            Milestone 2 adds live virtual-pin controls and sensor charts. MQTT,
            drag-and-drop dashboards, and Google/Alexa bridges are the next
            steps—planned, not included in this release.
          </p>
          <Link to="/docs">
            See what’s included <ArrowRight size={16} />
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
