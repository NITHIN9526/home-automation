import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Cpu } from "lucide-react";
import { useAuth } from "./auth";
import { Logo, Field, ErrorMessage } from "./ui";
export function AuthPage({ register = false }) {
  const { user, login, loading } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const data = {
      email: form.get("email").trim(),
      password: form.get("password"),
    };
    if (register) data.name = form.get("name");
    try {
      await login(data, register);
      const from = location.state?.from;
      navigate(
        typeof from === "string" && from.startsWith("/dashboard")
          ? from
          : "/dashboard",
        { replace: true },
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <aside className="auth-art">
        <Logo light />
        <div>
          <span className="eyebrow text-lime-200">
            BUILD SOMETHING THAT’S YOURS
          </span>
          <h1>
            Big ideas.
            <br />
            Connected things.
            <br />
            <span>Open possibilities.</span>
          </h1>
          <p>A secure workspace for your devices, hosted on your terms.</p>
          <ul>
            {[
              "Your infrastructure, your data",
              "Unique credentials for every device",
              "Works with a laptop simulator",
            ].map((x) => (
              <li key={x}>
                <Check size={16} />
                {x}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-60">Open IoT · Milestone 1</p>
        <div className="auth-circuit">
          <Cpu size={140} strokeWidth={0.6} />
        </div>
      </aside>
      <section className="auth-form-panel">
        <Link className="back-link" to="/">
          <ArrowLeft size={15} /> Back to home
        </Link>
        <div className="auth-form-wrap">
          <div className="lg:hidden mb-10">
            <Logo />
          </div>
          <div className="eyebrow">YOUR CONNECTED WORKSPACE</div>
          <h1>{register ? "Start building." : "Welcome back."}</h1>
          <p className="text-muted mb-8">
            {register
              ? "Create an account to register your first device."
              : "Sign in to manage your devices and account."}
          </p>
          <form onSubmit={submit}>
            <ErrorMessage message={error} />
            {register && (
              <Field
                label="Full name"
                name="name"
                autoComplete="name"
                required
                maxLength={80}
                placeholder="Your name"
              />
            )}
            <Field
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 12 : 1}
              maxLength={72}
              placeholder={
                register ? "Choose a strong password" : "Enter your password"
              }
              hint={
                register
                  ? "At least 12 characters; maximum 72 UTF-8 bytes."
                  : undefined
              }
            />
            <button className="btn w-full mt-3" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Log in"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
          <p className="text-sm text-muted text-center mt-7">
            {register ? "Already have an account?" : "New to Open IoT?"}{" "}
            <Link
              className="text-forest font-semibold"
              to={register ? "/login" : "/register"}
            >
              {register ? "Log in" : "Create an account"}
            </Link>
          </p>
          <p className="text-xs text-muted mt-12 leading-relaxed">
            Your account belongs to this self-hosted instance. Password recovery
            and email verification are not available in Milestone 1.
          </p>
        </div>
      </section>
    </main>
  );
}
