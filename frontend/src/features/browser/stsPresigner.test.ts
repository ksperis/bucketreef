import { describe, expect, it } from "vitest";

import type { StsCredentials } from "../../api/browserContracts";
import { presignObjectWithSts } from "./stsPresigner";

const credentials: StsCredentials = {
  access_key_id: "temporary-access-key",
  secret_access_key: "temporary-secret-key",
  session_token: "temporary-session-token",
  expiration: "2099-01-01T00:00:00Z",
  endpoint: "https://s3.example.test",
  region: "us-east-1",
};

describe("presignObjectWithSts", () => {
  it("signs the requested download content disposition", async () => {
    const disposition =
      "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt";

    const result = await presignObjectWithSts(credentials, "bucket-a", {
      key: "docs/report.txt",
      operation: "get_object",
      expires_in: 900,
      response_content_disposition: disposition,
    });

    expect(new URL(result.url).searchParams.get("response-content-disposition")).toBe(
      disposition,
    );
  });
});
