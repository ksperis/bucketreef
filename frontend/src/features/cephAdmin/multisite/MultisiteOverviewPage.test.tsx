import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultisiteFlow, MultisiteObservation, MultisiteOverview, MultisiteSyncStatus } from "../../../api/cephMultisite";
import MultisiteOverviewPage from "./MultisiteOverviewPage";

const useCephAdminEndpointMock = vi.fn();
const getMultisiteOverviewMock = vi.fn();
const getMultisiteFlowMock = vi.fn();
const textMock = (message: string, values?: Record<string, string | number>) =>
  Object.entries(values ?? {}).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), message);

vi.mock("../CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../cephAdminI18n", () => ({
  useCephAdminI18n: () => ({
    text: textMock,
  }),
}));

vi.mock("../../../api/cephMultisite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/cephMultisite")>();
  return {
    ...actual,
    getMultisiteOverview: (...args: unknown[]) => getMultisiteOverviewMock(...args),
    getMultisiteFlow: (...args: unknown[]) => getMultisiteFlowMock(...args),
  };
});

vi.mock("./MultisitePage", () => ({
  default: ({
    children,
    actions = [],
    metaContent,
  }: {
    children: React.ReactNode;
    actions?: Array<{ label: string; disabled?: boolean; onClick: () => void }>;
    metaContent?: React.ReactNode;
  }) => (
    <div>
      <div>{metaContent}</div>
      {actions.map((action) => (
        <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
      {children}
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function status(marker: string, collectedAt: string): MultisiteObservation<MultisiteSyncStatus> {
  return {
    availability: "available",
    stale: false,
    collected_at: collectedAt,
    last_success_at: collectedAt,
    reason_code: null,
    provenance: {
      endpoint_id: 2,
      realm_id: "realm-id",
      local_zone_id: "zone-destination",
      source_zone_id: "zone-source",
      operation: "flow_status",
      http_status: 200,
      duration_ms: 1,
      collection_id: collectedAt,
    },
    data: {
      family: "data",
      phase: "syncing",
      raw_status: "syncing",
      expected_shards: 1,
      period: "period-1",
      realm_epoch: "1",
      instance_id: null,
      generation: null,
      shards: [
        {
          shard_id: 0,
          phase: "syncing",
          raw_status: "syncing",
          marker,
          timestamp: null,
          details: {},
        },
      ],
      details: {},
    },
  };
}

function flow(marker: string, collectedAt: string): MultisiteFlow {
  return {
    destination_endpoint_id: 2,
    destination_zone_id: "zone-destination",
    source_zone_id: "zone-source",
    scope_requires_confirmation: false,
    status: status(marker, collectedAt),
  };
}

function overview(name: string, marker: string, collectedAt: string, nextOffset: number | null): MultisiteOverview {
  const zones = [
    {
      id: "zone-source",
      name: "Source zone",
      zonegroup_id: "zg",
      zonegroup_name: "Zonegroup",
      metadata_master: true,
      read_only: false,
      sync_from_all: true,
      sync_from: [],
      policy_requires_confirmation: false,
      endpoints: [{ id: 1, name: "Source endpoint", diagnostic: true }],
      diagnostic_endpoint_id: 1,
    },
    {
      id: "zone-destination",
      name: "Destination zone",
      zonegroup_id: "zg",
      zonegroup_name: "Zonegroup",
      metadata_master: false,
      read_only: false,
      sync_from_all: true,
      sync_from: [],
      policy_requires_confirmation: false,
      endpoints: [{ id: 2, name: "Destination endpoint", diagnostic: true }],
      diagnostic_endpoint_id: 2,
    },
  ];
  return {
    topology: {
      configured: true,
      configuration_reason: null,
      local_zone: {
        availability: "available",
        data: {
          id: "zone-source",
          name: "Source zone",
          realm_id: "realm-id",
          placements: [],
          storage_classes: ["STANDARD"],
        },
        collected_at: collectedAt,
        last_success_at: collectedAt,
        stale: false,
        reason_code: null,
        provenance: {
          ...status(marker, collectedAt).provenance,
          endpoint_id: 1,
          local_zone_id: "zone-source",
          operation: "zone_configuration",
        },
      },
      realm: {
        availability: "available",
        data: { name },
        collected_at: collectedAt,
        last_success_at: collectedAt,
        stale: false,
        reason_code: null,
        provenance: status(marker, collectedAt).provenance,
      },
      period: {
        availability: "available",
        data: {
          id: "period-1",
          realm_id: "realm-id",
          epoch: "1",
          realm_epoch: "1",
          master_zone: "zone-source",
          zones,
          details: {},
        },
        collected_at: collectedAt,
        last_success_at: collectedAt,
        stale: false,
        reason_code: null,
        provenance: status(marker, collectedAt).provenance,
      },
    },
    metadata: [],
    data: [flow(marker, collectedAt)],
    uncollected: [],
    next_offset: nextOffset,
  };
}

describe("MultisiteOverviewPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useCephAdminEndpointMock.mockReset();
    getMultisiteOverviewMock.mockReset();
    getMultisiteFlowMock.mockReset();
    useCephAdminEndpointMock.mockReturnValue({
      endpoints: [{ id: 1, name: "Endpoint 1" }],
      selectedEndpointId: 1,
      loading: false,
      error: null,
      retryEndpoints: vi.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("uses next_offset, hides the previous page immediately, and resets observations across page scopes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page0 = deferred<MultisiteOverview>();
    const page8 = deferred<MultisiteOverview>();
    const page0Again = deferred<MultisiteOverview>();
    getMultisiteOverviewMock
      .mockReturnValueOnce(page0.promise)
      .mockReturnValueOnce(page8.promise)
      .mockReturnValueOnce(page0Again.promise);

    render(<MultisiteOverviewPage />);
    page0.resolve(overview("Realm page 0", "marker-a", "2026-10-27T10:00:00Z", 8));
    expect(await screen.findByText("Realm page 0")).toBeInTheDocument();
    expect(screen.getAllByText("First observation").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.queryByText("Realm page 0")).not.toBeInTheDocument();
    expect(getMultisiteOverviewMock).toHaveBeenLastCalledWith(1, 8, expect.any(AbortSignal));

    page8.resolve(overview("Realm page 8", "marker-b", "2026-10-27T10:01:00Z", null));
    expect(await screen.findByText("Realm page 8")).toBeInTheDocument();
    expect(screen.getAllByText("First observation").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.queryByText("Realm page 8")).not.toBeInTheDocument();
    expect(getMultisiteOverviewMock).toHaveBeenLastCalledWith(1, 0, expect.any(AbortSignal));
    page0Again.resolve(overview("Realm page 0 again", "marker-c", "2026-10-27T10:02:00Z", 8));
    expect(await screen.findByText("Realm page 0 again")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refreshes one drawer flow and records its equality change without console errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getMultisiteOverviewMock.mockResolvedValue(overview("Realm fixture", "marker-a", "2026-10-27T10:00:00Z", null));
    getMultisiteFlowMock.mockResolvedValue(flow("marker-b", "2026-10-27T10:01:00Z"));

    render(<MultisiteOverviewPage />);
    expect(await screen.findByText("Realm fixture")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh flow" }));

    await waitFor(() =>
      expect(getMultisiteFlowMock).toHaveBeenCalledWith(1, 2, "zone-source", "data", expect.any(AbortSignal)),
    );
    await waitFor(() => expect(screen.getAllByText("Changed").length).toBeGreaterThan(0));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("hides the metadata master self-observation from the replication table", async () => {
    const fixture = overview("Realm fixture", "marker-a", "2026-10-27T10:00:00Z", null);
    fixture.metadata = [
      {
        destination_endpoint_id: 1,
        destination_zone_id: "zone-source",
        source_zone_id: "zone-source",
        scope_requires_confirmation: false,
        status: {
          ...status("marker-self", "2026-10-27T10:00:00Z"),
          availability: "not_applicable",
          reason_code: "metadata_master",
          data: null,
        },
      },
      {
        destination_endpoint_id: 2,
        destination_zone_id: "zone-destination",
        source_zone_id: "zone-source",
        scope_requires_confirmation: false,
        status: status("marker-replica", "2026-10-27T10:00:00Z"),
      },
    ];
    getMultisiteOverviewMock.mockResolvedValue(fixture);

    render(<MultisiteOverviewPage />);

    expect(await screen.findByText("Realm fixture")).toBeInTheDocument();
    const metadataSection = screen.getByRole("heading", { name: "Metadata replication" }).closest("section");
    expect(metadataSection).not.toBeNull();
    expect(within(metadataSection as HTMLElement).getByText("1 flows")).toBeInTheDocument();
    expect(within(metadataSection as HTMLElement).queryByText("Not applicable")).not.toBeInTheDocument();
  });

  it("hides data directions for which Ceph returned no sync state", async () => {
    const fixture = overview("Realm fixture", "marker-a", "2026-10-27T10:00:00Z", null);
    fixture.data = [
      flow("marker-visible", "2026-10-27T10:00:00Z"),
      {
        destination_endpoint_id: 1,
        destination_zone_id: "zone-source",
        source_zone_id: "zone-destination",
        scope_requires_confirmation: false,
        status: {
          ...status("marker-missing", "2026-10-27T10:00:00Z"),
          availability: "not_found",
          reason_code: "rgw_read_failed",
          data: null,
          provenance: {
            ...status("marker-missing", "2026-10-27T10:00:00Z").provenance,
            endpoint_id: 1,
            local_zone_id: "zone-source",
            source_zone_id: "zone-destination",
            http_status: 404,
          },
        },
      },
    ];
    getMultisiteOverviewMock.mockResolvedValue(fixture);

    render(<MultisiteOverviewPage />);

    expect(await screen.findByText("Realm fixture")).toBeInTheDocument();
    const dataSection = screen.getByRole("heading", { name: "Data replication" }).closest("section");
    expect(dataSection).not.toBeNull();
    expect(within(dataSection as HTMLElement).getByText("1 flows")).toBeInTheDocument();
    expect(within(dataSection as HTMLElement).queryByText("No sync state")).not.toBeInTheDocument();
    expect(within(dataSection as HTMLElement).queryByText("Ceph returned no data sync status for this direction.")).not.toBeInTheDocument();
  });

  it("keeps overview tables focused on topology and replication state", async () => {
    const fixture = overview("Realm fixture", "marker-a", "2026-10-27T10:00:00Z", null);
    fixture.metadata = [{
      destination_endpoint_id: 2,
      destination_zone_id: "zone-destination",
      source_zone_id: "zone-source",
      scope_requires_confirmation: false,
      status: status("marker-metadata", "2026-10-27T10:00:00Z"),
    }];
    getMultisiteOverviewMock.mockResolvedValue(fixture);

    render(<MultisiteOverviewPage />);

    expect(await screen.findByText("Realm fixture")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Declared diagnostic endpoint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Observation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Collected" })).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
});
