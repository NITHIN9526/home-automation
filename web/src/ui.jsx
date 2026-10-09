import React, { useEffect, useRef, useId } from "react";
import { Link } from "react-router-dom";
import { Cpu, X, ArrowUpRight } from "lucide-react";
export function Logo({ light = false }) {
  return (
    <Link
      to="/"
      className={`logo ${light ? "text-white" : ""}`}
      aria-label="Open IoT home"
    >
      <span className="logo-mark">
        <Cpu size={21} />
      </span>
      <span>
        open<span className="font-normal opacity-70">iot</span>
        <span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <div className="flex items-start justify-between gap-4 mb-6">
          <h2
            id="modal-title"
            className="text-2xl font-semibold tracking-tight"
          >
            {title}
          </h2>
          <button
            aria-label="Close dialog"
            className="icon-btn"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Field({ label, hint, ...props }) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      <input
        aria-labelledby={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function ErrorMessage({ message }) {
  return message ? (
    <div className="error-message" role="alert">
      {message}
    </div>
  ) : null;
}
export function Status({ status }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
export function Footer() {
  return (
    <footer className="page-width py-9 flex flex-wrap gap-5 items-center justify-between border-t border-line">
      <Logo />
      <p className="text-xs text-muted">
        Built for makers. Designed to be yours.
      </p>
      <a className="text-xs flex gap-1 items-center" href="/docs">
        Getting started <ArrowUpRight size={14} />
      </a>
    </footer>
  );
}
