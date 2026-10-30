/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  browserBucketDetails,
  managerBucketDetails,
} from "../../api/bucketDetails";
import { useBrowserBucketDetailsScope } from "./BucketDetailsScope";

/** Route the shared bucket controllers through their owning workspace. */
export function useBucketDetailsApi() {
  return useBrowserBucketDetailsScope()
    ? browserBucketDetails
    : managerBucketDetails;
}
