let csrfToken = "";
export function setCsrf(value) {
  csrfToken = value ?? "";
}
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = Object.assign(Error(data.error ?? "Request failed."), {
      status: response.status,
    });
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  if (data.csrfToken) setCsrf(data.csrfToken);
  return data;
}
