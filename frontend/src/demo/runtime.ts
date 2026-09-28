import { favorites } from "./favorites";
import { currentUser, DemoError, done, json, type DemoRequest } from "./http";
import { loadState, resetState, saveState } from "./persistence";
import { personaIds, settings, type Persona } from "./state";
import { disabledRequest, disabledRoute, readonlyRequest } from "./registry";
import { readModels } from "./readModels";
import { governance } from "./governance";
import { objects } from "./objects";
import { buckets } from "./buckets";
import { portal } from "./portal";
import { iam } from "./iam";
import { ceph } from "./ceph";
import { mountToolbar } from "./toolbar";
import "./style.css";

declare global {
  interface Window { __bucketreefDemo: { revision: string; failures: string[]; requests: string[]; responses: { path: string; status: number }[] } }
}

function personaForLocation(): Persona {
  const url = new URL(location.href); const requested = url.searchParams.get("demoPersona");
  if (requested && Object.hasOwn(personaIds, requested)) {
    sessionStorage.setItem("demo-persona", requested); url.searchParams.delete("demoPersona"); history.replaceState(null, "", url);
    return requested as Persona;
  }
  if (url.pathname.startsWith("/admin")) return "admin";
  if (url.pathname.startsWith("/ceph-admin")) return "ceph-admin";
  if (url.pathname.startsWith("/manager")) return "manager";
  if (url.pathname.startsWith("/portal") || url.pathname.startsWith("/browser")) return sessionStorage.getItem("demo-persona") === "project-manager" ? "project-manager" : "member";
  return "manager";
}

async function dispatch(c: DemoRequest): Promise<Response> {
  const read = readModels(c); if (read) return read;
  if (disabledRequest.test(c.path) || (c.method !== "GET" && readonlyRequest.test(c.path))) throw new DemoError(403, "This feature is disabled in the static demo. No external operation was performed.");
  if (c.method !== "GET" && /^\/(?:auth|admin\/identity)|\/security(?:\/|$)|\/mfa(?:\/|$)|\/external-identities(?:\/|$)/.test(c.path) && c.path !== "/auth/logout") throw new DemoError(403, "Authentication and security configuration are read-only in this demo");
  if (c.path.startsWith("/admin/") && c.user.role !== "ui_superadmin" && c.user.role !== "ui_admin") throw new DemoError(403, "Switch to Platform admin to use this action");
  if (c.path.startsWith("/ceph-admin/") && !c.user.can_access_ceph_admin) throw new DemoError(403, "Switch to Ceph admin to use this action");
  if (c.path === "/auth/logout" && c.method === "POST") return done();
  const notification = c.path.match(/^\/users\/me\/notifications(?:\/(read|\d+))?$/);
  if (notification) {
    const items = c.state.notifications[c.user.id] ?? []; const before = items.length;
    let updated = 0;
    if (notification[1] === "read" && c.method === "POST") for (const item of items) {
      if (!item.read_at && (c.body.all || (Array.isArray(c.body.notification_ids) && c.body.notification_ids.includes(item.id)))) { item.read_at = new Date().toISOString(); updated++; }
    }
    else if (c.method === "DELETE") c.state.notifications[c.user.id] = items.filter(n => notification[1] ? n.id !== Number(notification[1]) : !n.read_at);
    else throw new DemoError(405, "Unsupported notification action");
    const remaining = c.state.notifications[c.user.id] ?? [];
    return json({ updated_count: updated, deleted_count: before - remaining.length, unread_count: remaining.filter(n => !n.read_at).length });
  }
  if (c.path === "/users/me" && c.method === "PUT") {
    for (const field of ["full_name", "ui_language", "ui_preferences", "quota_alerts_enabled"]) if (field in c.body) Object.assign(c.user, { [field]: c.body[field] });
    return json(c.user);
  }
  const result = favorites(c) ?? governance(c) ?? await objects(c) ?? buckets(c) ?? portal(c) ?? iam(c) ?? ceph(c);
  if (result) return result;
  throw new DemoError(501, `Not covered by the demo: ${c.method} ${c.path}`);
}

export async function initializeDemo(): Promise<boolean> {
  document.documentElement.dataset.bucketreefDemo = "true";
  const persona = personaForLocation();
  if (location.pathname === "/" || location.pathname === "/login") history.replaceState(null, "", "/manager");
  window.__bucketreefDemo = { revision: import.meta.env.DEMO_REVISION, failures: [], requests: [], responses: [] };
  let state;
  try { state = await loadState(); }
  catch (error) {
    window.__bucketreefDemo.failures.push(`Demo storage: ${error instanceof Error ? error.message : String(error)}`);
    showRecovery("Your browser could not open demo storage. Allow local storage, then reload. No changes have been discarded.", false);
    return false;
  }
  if (!state) { showRecovery("This demo uses a newer data format. Your saved data has been kept. Reset explicitly to start the new scenario.", true); return false; }
  const active = { state };
  localStorage.setItem("settings:general:v1", JSON.stringify(settings.general));
  const nativeFetch = window.fetch.bind(window);
  let queue: Promise<unknown> = Promise.resolve();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.protocol === "blob:") return nativeFetch(input, init);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      if (url.origin === location.origin && /\.(?:svg|png|jpg|webp|ico|woff2?)$/.test(url.pathname)) return nativeFetch(input, init);
      const signature = `Blocked external business request: ${url.origin}${url.pathname}`;
      window.__bucketreefDemo.failures.push(signature); throw new TypeError(signature);
    }
    const request = new Request(input instanceof Request ? input : url, init);
    const method = request.method.toUpperCase(); const path = decodeURI(url.pathname.slice(4));
    const run = async () => {
      if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const signature = `${method} ${path}`;
      window.__bucketreefDemo.requests.push(signature);
      const mutating = !["GET", "HEAD"].includes(method);
      const before = mutating ? structuredClone(active.state) : null;
      try {
        const body = request.headers.get("content-type")?.includes("application/json") ? await request.clone().json() as Record<string, unknown> : {};
        const response = await dispatch({ state: active.state, persona, user: currentUser(active.state, persona), request, url, path, method, body });
        window.__bucketreefDemo.responses.push({ path: signature, status: response.status });
        if (mutating && response.ok) await saveState(active.state);
        return response;
      } catch (error) {
        if (before) active.state = before;
        const status = error instanceof DemoError ? error.status : 500;
        window.__bucketreefDemo.responses.push({ path: signature, status });
        const message = error instanceof Error ? error.message : "Demo request failed";
        if (status >= 500) { window.__bucketreefDemo.failures.push(`${signature}: ${message}`); window.dispatchEvent(new CustomEvent("demo-error", { detail: message })); }
        return json({ detail: message, demo: true }, status);
      }
    };
    // Serialize mutations and subsequent reads; only committed state becomes visible.
    const pending = queue.then(run, run); queue = pending.catch(() => undefined); return pending;
  };
  mountToolbar(persona, state.initializedAt);
  if (disabledRoute.test(location.pathname)) {
    showRecovery("This operation is disabled in the demo. Choose a workspace in the profile bar to continue.", false);
    return false;
  }
  return true;
}

function showRecovery(message: string, reset: boolean) {
  const root = document.getElementById("root")!; const panel = document.createElement("section"); panel.className = "demo-recovery";
  const title = document.createElement("h1"); title.textContent = "BucketReef demo";
  const description = document.createElement("p"); description.textContent = message;
  const button = document.createElement("button"); button.textContent = reset ? "Reset saved demo data" : "Open Manager";
  button.onclick = async () => { if (reset && !confirm("Delete all locally saved demo changes and uploaded files?")) return; if (reset) await resetState(); location.href = "/manager"; };
  panel.append(title, description, button); root.replaceChildren(panel);
}
