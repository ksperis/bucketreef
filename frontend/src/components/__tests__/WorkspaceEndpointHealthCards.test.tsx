import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import { LanguageProvider, useLanguage } from "../language";
import WorkspaceEndpointHealthCards from "../WorkspaceEndpointHealthCards";

function LanguageControls() {
  const { setLanguage } = useLanguage();
  return <button onClick={() => setLanguage("fr")}>fr</button>;
}

const workspaceHealth: WorkspaceEndpointHealthOverviewResponse = {
  generated_at: new Date().toISOString(),
  stale_after_seconds: 600,
  incident_highlight_minutes: 720,
  endpoint_count: 1,
  up_count: 0,
  degraded_count: 0,
  down_count: 1,
  unknown_count: 0,
  endpoints: [
    {
      endpoint_id: 10,
      name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      checked_at: new Date().toISOString(),
      latency_ms: null,
      check_mode: "http",
      is_stale: false,
    },
  ],
  incidents: [
    {
      endpoint_id: 10,
      endpoint_name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      start: "2026-03-12T12:30:00Z",
      end: null,
      duration_minutes: 30,
      check_mode: "http",
      ongoing: true,
      recent: true,
    },
    {
      endpoint_id: 10,
      endpoint_name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      start: "2026-03-12T10:00:00Z",
      end: "2026-03-12T10:20:00Z",
      duration_minutes: 20,
      check_mode: "http",
      ongoing: false,
      recent: true,
    },
  ],
};

describe("WorkspaceEndpointHealthCards", () => {
  it("shows only incident state badges while keeping endpoint status badges", () => {
    render(
      <WorkspaceEndpointHealthCards
        data={workspaceHealth}
        loading={false}
        showStatusCounters={false}
      />
    );

    const title = screen.getByText("Ongoing / Recent Incidents");
    const incidentsSection = title.closest("section");
    expect(incidentsSection).not.toBeNull();
    const incidents = within(incidentsSection as HTMLElement);

    expect(incidents.getByText("In progress")).toBeInTheDocument();
    expect(incidents.getByText("Resolved")).toBeInTheDocument();
    expect(incidents.queryByText("Down")).not.toBeInTheDocument();
    expect(incidents.queryByText("Degraded")).not.toBeInTheDocument();
    expect(incidents.queryByText("Up")).not.toBeInTheDocument();
    expect(incidents.queryByText("Unknown")).not.toBeInTheDocument();
    expect(screen.getAllByText("Down")).toHaveLength(1);
  });

  it("uses the shared compact incident model for resolved rows", () => {
    const { container } = render(
      <WorkspaceEndpointHealthCards
        data={workspaceHealth}
        loading={false}
        showStatusCounters={false}
      />
    );

    const resolvedRow = container.querySelector('[data-incident-state="resolved"]');
    expect(resolvedRow).not.toBeNull();
    expect(resolvedRow).toHaveClass("ui-dashboard-incident");
    expect(within(resolvedRow as HTMLElement).getByText("Resolved")).toHaveClass("ui-dashboard-badge");
  });

  it("summarizes incidents beyond the five visible rows", () => {
    const { container } = render(
      <WorkspaceEndpointHealthCards
        data={{
          ...workspaceHealth,
          incidents: Array.from({ length: 7 }, (_, index) => ({
            ...workspaceHealth.incidents[index % workspaceHealth.incidents.length],
            endpoint_id: 100 + index,
            endpoint_name: `Endpoint ${index + 1}`,
            start: `2026-03-12T0${index}:00:00Z`,
            ongoing: index === 0,
          })),
        }}
        loading={false}
        showStatusCounters={false}
      />
    );

    expect(screen.getByText("+ 2 more incident(s)")).toBeInTheDocument();
    expect(screen.getByText("Endpoint 1")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-incident-state]")).toHaveLength(5);
  });

  it("does not present an old successful check as current", () => {
    render(
      <WorkspaceEndpointHealthCards
        data={{
          ...workspaceHealth,
          up_count: 0,
          down_count: 0,
          endpoints: [
            {
              ...workspaceHealth.endpoints[0],
              status: "up",
              checked_at: "2026-01-01T00:00:00Z",
              is_stale: true,
            },
          ],
          unknown_count: 1,
        }}
        loading={false}
      />
    );

    expect(screen.getByText(/Stale/)).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("localizes shared endpoint health and incident copy in French", async () => {
    render(
      <LanguageProvider>
        <LanguageControls />
        <WorkspaceEndpointHealthCards data={workspaceHealth} loading={false} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "fr" }));

    await waitFor(() => expect(screen.getByText("Santé de l’endpoint")).toBeInTheDocument());
    expect(screen.getByText("État enregistré lors du dernier contrôle de l’endpoint.")).toBeInTheDocument();
    expect(screen.getByText("Incidents en cours / récents")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.getByText("Résolu")).toBeInTheDocument();
    expect(screen.getAllByText("Indisponible").length).toBeGreaterThan(0);
  });
});
