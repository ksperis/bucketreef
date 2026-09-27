import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { coverage } from "./registry";
import { resetState } from "./persistence";
import type { Persona } from "./state";

const destinations = { admin: "/admin", manager: "/manager", member: "/portal", "project-manager": "/portal", "ceph-admin": "/ceph-admin" };
function switchProfile(persona: Persona, destination?: string) {
  location.href = `${destination ?? destinations[persona]}?demoPersona=${persona}`;
}
function Toolbar({ persona, initializedAt }: { persona: Persona; initializedAt: string }) {
  const [help, setHelp] = useState(false); const [error, setError] = useState(""); const [resetting, setResetting] = useState(false);
  const endUser = persona === "member" || persona === "project-manager";
  useEffect(() => {
    const listener = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("demo-error", listener); return () => window.removeEventListener("demo-error", listener);
  }, []);
  return <>
    <nav className="demo-toolbar" aria-label="Demo profiles">
      <a className="demo-brand" href="https://bucketreef.ksperis.com">BucketReef <strong>DEMO</strong></a>
      <label>Explore as <select aria-label="Demo profile" value={endUser ? "member" : persona} onChange={e => switchProfile(e.target.value as Persona)}>
        <option value="admin">Platform admin</option><option value="manager">Account manager</option><option value="member">End user</option><option value="ceph-admin">Ceph admin</option>
      </select></label>
      {endUser && <><label>Identity <select aria-label="End user identity" value={persona} onChange={e => switchProfile(e.target.value as Persona)}><option value="member">Member</option><option value="project-manager">Project manager</option></select></label><a href={`/portal?demoPersona=${persona}`}>Portal</a><a href={`/browser?demoPersona=${persona}`}>Browser</a></>}
      <span className="demo-local">Simulated · saved in this browser</span>
      <button type="button" onClick={() => setHelp(true)}>Coverage & limits</button>
      <button type="button" disabled={resetting} onClick={async () => {
        if (!confirm("Reset the demo? All local changes, uploaded files and saved versions will be deleted.")) return;
        setResetting(true); try { await resetState(); location.reload(); } catch { setError("The reset could not be saved. Your existing data has been kept."); setResetting(false); }
      }}>Reset demo</button>
      <code title="Demo revision">{import.meta.env.DEMO_REVISION.slice(0, 12)}</code>
    </nav>
    {error && <div className="demo-error" role="alert">{error} <button onClick={() => setError("")}>Dismiss</button></div>}
    {help && <dialog ref={element => { if (element && !element.open) element.showModal(); }} className="demo-coverage" aria-labelledby="demo-coverage-title" onCancel={() => setHelp(false)}>
      <h2 id="demo-coverage-title">Demo coverage</h2><p>One shared Ceph scenario. Changes stay on this device. History is a snapshot initialized on {new Date(initializedAt).toLocaleDateString("en-GB")}. Uploads: 20 MiB per file, 100 MiB total including retained versions.</p>
      <table className="ui-data-table"><thead><tr><th>Mode</th><th>Features</th><th>Limitations</th></tr></thead><tbody>{coverage.map(item => <tr key={item.id}><td>{item.mode}</td><td>{item.scope}</td><td>{item.limitation}</td></tr>)}</tbody></table>
      <button autoFocus onClick={() => setHelp(false)}>Close coverage</button>
    </dialog>}
  </>;
}
export function mountToolbar(persona: Persona, initializedAt: string) {
  const root = document.createElement("div"); root.id = "demo-toolbar-root"; document.body.prepend(root);
  createRoot(root).render(<Toolbar persona={persona} initializedAt={initializedAt} />);
  let height = 0;
  new ResizeObserver(([entry]) => {
    const measured = Math.ceil(entry.contentRect.height);
    if (measured === height) return;
    height = measured;
    requestAnimationFrame(() => document.documentElement.style.setProperty("--demo-toolbar-height", `${height}px`));
  }).observe(root);
}
