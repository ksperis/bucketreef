import { DemoError, json, page, type DemoRequest } from "./http";

export function openstack(c: DemoRequest): Response | null {
  if (c.path === "/me/openstack/project-options" && c.method === "GET") return json({ options: [], warnings: [] });
  if (c.path === "/me/openstack/clouds" && c.method === "GET") return json([]);
  if (c.path === "/me/openstack/connections" && c.method === "GET") return json([]);
  if (c.path === "/admin/openstack-clouds" && c.method === "GET") return json([]);
  if (c.path === "/admin/openstack-clouds/options" && c.method === "GET") return json(page([], c.url));

  if (c.path.startsWith("/me/openstack/") || c.path.startsWith("/admin/openstack-clouds")) {
    throw new DemoError(403, "OpenStack integration is read-only in the static demo");
  }
  return null;
}
