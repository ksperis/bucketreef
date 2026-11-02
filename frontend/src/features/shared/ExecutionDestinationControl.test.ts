import { describe, expect, it } from "vitest";

import { buildExecutionDestinationControlModel } from "./ExecutionDestinationControl";

const destinations = [
  {
    endpoint_id: 10,
    name: "Zone A",
    endpoint_url: "https://zone-a.example.test",
    region: "eu-west-1",
    zone_id: "zone-a",
  },
  {
    endpoint_id: 11,
    name: "Zone B",
    endpoint_url: "https://zone-b.example.test",
    region: null,
    zone_id: "zone-b",
  },
];

describe("buildExecutionDestinationControlModel", () => {
  it("prefers the selected endpoint and builds searchable destination options", () => {
    const model = buildExecutionDestinationControlModel(destinations, 11, 10, "RGW zone");

    expect(model.active?.endpoint_id).toBe(11);
    expect(model.options).toEqual([
      {
        value: "10",
        label: "Zone A",
        description: "RGW zone: zone-a · eu-west-1 · https://zone-a.example.test",
        searchText: "Zone A zone-a eu-west-1 https://zone-a.example.test",
      },
      {
        value: "11",
        label: "Zone B",
        description: "RGW zone: zone-b · https://zone-b.example.test",
        searchText: "Zone B zone-b https://zone-b.example.test",
      },
    ]);
  });

  it("falls back to the context endpoint and then the first destination", () => {
    expect(buildExecutionDestinationControlModel(destinations, 99, 10, "RGW zone").active?.endpoint_id)
      .toBe(10);
    expect(buildExecutionDestinationControlModel(destinations, 99, 98, "RGW zone").active?.endpoint_id)
      .toBe(10);
    expect(buildExecutionDestinationControlModel([], 99, 98, "RGW zone").active).toBeNull();
  });
});
