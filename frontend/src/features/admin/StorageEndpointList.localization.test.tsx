/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import { LanguageProvider, useLanguage, type UiLanguage } from "../../components/language";
import StorageEndpointList from "./StorageEndpointList";

function LanguageControls() {
  const { setLanguage } = useLanguage();
  return <>{(["fr", "de", "zh"] as UiLanguage[]).map((locale) => (
    <button key={locale} onClick={() => setLanguage(locale)}>{locale}</button>
  ))}</>;
}

function makeEndpoint(id: number): StorageEndpoint {
  return {
    id,
    name: `Endpoint ${id}`,
    endpoint_url: `https://s3-${id}.example.test`,
    region: "eu-west-1",
    force_path_style: false,
    verify_tls: true,
    provider: "ceph",
    has_admin_secret: false,
    features: {
      admin: { enabled: true }, account: { enabled: true }, sts: { enabled: false }, usage: { enabled: false },
      metrics: { enabled: false }, static_website: { enabled: false }, iam: { enabled: false }, sns: { enabled: false },
      sse: { enabled: false }, replication: { enabled: false }, healthcheck: { enabled: true, mode: "http" },
    },
    is_default: id === 1,
    is_editable: true,
    tags: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("StorageEndpointList localization", () => {
  it("localizes filtered counts and formats totals with the active locale", async () => {
    const endpoints = Array.from({ length: 1001 }, (_, index) => makeEndpoint(index + 1));
    render(<LanguageProvider>
      <LanguageControls />
      <StorageEndpointList
        endpoints={endpoints}
        loading={false}
        error={null}
        envManaged={false}
        metadataReady
        canEdit
        defaultBusyId={null}
        deleteBusy={false}
        filters={{ query: "no-match", mode: "contains", provider: "all" }}
        onFiltersChange={vi.fn()}
        onOpen={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />
    </LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "fr" }));
    const frenchTotal = new Intl.NumberFormat("fr").format(endpoints.length);
    const normalizedFrenchTotal = frenchTotal.replace(/\s/g, " ");
    await waitFor(() => expect(screen.getByText(`0 sur ${normalizedFrenchTotal} endpoints`)).toBeInTheDocument());
    expect(screen.getByText("Filtres actifs :")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tout effacer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changer le mode de correspondance du filtre" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "de" }));
    const germanTotal = new Intl.NumberFormat("de").format(endpoints.length);
    await waitFor(() => expect(screen.getByText(`0 von ${germanTotal} Endpunkten`)).toBeInTheDocument());
    expect(screen.getByText("Aktive Filter:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alle löschen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filterabgleichsmodus wechseln" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "zh" }));
    const chineseTotal = new Intl.NumberFormat("zh").format(endpoints.length);
    await waitFor(() => expect(screen.getByText(`0 / ${chineseTotal} 个端点`)).toBeInTheDocument());
    expect(screen.getByText("当前筛选：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除全部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换筛选匹配模式" })).toBeInTheDocument();
  });
});
