/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import StorageEndpointConnectionFields from "./StorageEndpointConnectionFields";
import { createEmptyForm } from "./storageEndpointFormModel";

describe("StorageEndpointConnectionFields RGW multisite", () => {
  it("hides topology fields until multisite endpoint switching is enabled", async () => {
    const user = userEvent.setup();

    function Fields() {
      const [form, setForm] = useState(createEmptyForm);
      return <StorageEndpointConnectionFields
        form={form}
        setForm={setForm}
        readOnly={false}
        canEditTags={false}
        busy={false}
        catalog={[]}
        catalogLoading={false}
        errors={{}}
        onProviderChange={() => {}}
        onRegionChange={() => {}}
        invalidateChecks={() => {}}
      />;
    }

    render(<Fields />);

    const multisiteSwitch = screen.getByRole("switch", { name: "Enable multisite endpoint switching" });
    expect(multisiteSwitch).not.toBeChecked();
    expect(screen.queryByLabelText("Realm ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zonegroup ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zone ID")).not.toBeInTheDocument();

    await user.click(multisiteSwitch);

    expect(multisiteSwitch).toBeChecked();
    expect(screen.getByLabelText("Realm ID")).toBeRequired();
    expect(screen.getByLabelText("Zonegroup ID")).toBeRequired();
    expect(screen.getByLabelText("Zone ID")).toBeRequired();
  });
});
