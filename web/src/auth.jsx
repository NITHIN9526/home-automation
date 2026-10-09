import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api, setCsrf } from "./api";
const Context = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/auth/me");
      setUser(data.user);
    } catch (e) {
      setUser(null);
      if (e.status !== 401)
        setError(
          "Cannot reach your server. Check that the API and database are running.",
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const expired = () => {
      setUser(null);
      setCsrf("");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function login(values, register = false) {
    const data = await api(`/auth/${register ? "register" : "login"}`, {
      method: "POST",
      body: values,
    });
    setUser(data.user);
    setError("");
  }
  async function logout(all = false) {
    await api(`/auth/${all ? "logout-all" : "logout"}`, {
      method: "POST",
      body: {},
    });
    setUser(null);
    setCsrf("");
  }
  return (
    <Context.Provider
      value={{ user, setUser, loading, error, refresh, login, logout }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
export function Protected() {
  const auth = useAuth(),
    location = useLocation();
  if (auth.loading)
    return <div className="screen-message">Opening your workspace…</div>;
  if (auth.error)
    return (
      <div className="screen-message">
        <p>{auth.error}</p>
        <button className="btn mt-5" onClick={auth.refresh}>
          Try again
        </button>
      </div>
    );
  return auth.user ? (
    <Outlet />
  ) : (
    <Navigate to="/login" state={{ from: location.pathname }} replace />
  );
}
