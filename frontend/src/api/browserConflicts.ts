import client from "./client";
import { withS3AccountParam, type S3AccountSelector } from "./accountParams";
import { buildBrowserFetchHeaders } from "./browserTransfers";
import type { BrowserRequestOptions } from "./browserWorkspace";

export type BrowserWriteGuard = { exists: boolean; etag: string | null };
export type BrowserDestinationObservation = BrowserWriteGuard & { key: string; size?: number | null; modified?: string | null };
export async function inspectBrowserDestinations(account: S3AccountSelector, bucket: string, keys: string[], options?: BrowserRequestOptions, sseKey?: string | null) {
  const { data } = await client.post<{ objects: BrowserDestinationObservation[]; protection: "conditional" | "preflight" }>(
    `/browser/buckets/${encodeURIComponent(bucket)}/write-preflight`, { keys },
    { params: withS3AccountParam(undefined, account), headers: buildBrowserFetchHeaders(options, sseKey) },
  );
  return data;
}
