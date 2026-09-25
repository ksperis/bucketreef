/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import { listCephAdminBucketObjects } from "../../../api/cephAdminBucketDetails";
import { listCephAdminBuckets } from "../../../api/cephAdminBuckets";
import { listBuckets } from "../../../api/managerBuckets";
import { listManagerObjects } from "../../../api/managerObjects";
import { listTopics } from "../../../api/topics";
import type {
  SettingsAutocompleteSuggestion,
  SettingsSuggestionSource,
} from "../../../components/settings/SettingsAutocomplete";

const knownStorageClasses = [
  "STANDARD",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER",
  "GLACIER_IR",
  "DEEP_ARCHIVE",
];

const policyActionSuggestions: SettingsAutocompleteSuggestion[] = [
  { value: "s3:*", description: "All S3 actions", source: "S3" },
  { value: "s3:ListAllMyBuckets", description: "Bucket discovery", source: "S3" },
  { value: "s3:ListBucket", description: "Bucket read", source: "S3" },
  { value: "s3:ListBucketVersions", description: "Bucket read", source: "S3" },
  { value: "s3:GetBucketLocation", description: "Bucket read", source: "S3" },
  { value: "s3:GetBucketVersioning", description: "Bucket configuration", source: "S3" },
  { value: "s3:GetBucketTagging", description: "Bucket configuration", source: "S3" },
  { value: "s3:PutBucketTagging", description: "Bucket configuration", source: "S3" },
  { value: "s3:GetBucketPolicy", description: "Bucket permissions", source: "S3" },
  { value: "s3:PutBucketPolicy", description: "Bucket permissions", source: "S3" },
  { value: "s3:DeleteBucketPolicy", description: "Bucket permissions", source: "S3" },
  { value: "s3:GetBucketAcl", description: "Bucket permissions", source: "S3" },
  { value: "s3:PutBucketAcl", description: "Bucket permissions", source: "S3" },
  { value: "s3:GetObject", description: "Object read", source: "S3" },
  { value: "s3:GetObjectVersion", description: "Object read", source: "S3" },
  { value: "s3:GetObjectAttributes", description: "Object read", source: "S3" },
  { value: "s3:GetObjectAcl", description: "Object permissions", source: "S3" },
  { value: "s3:GetObjectTagging", description: "Object metadata", source: "S3" },
  { value: "s3:PutObject", description: "Object write", source: "S3" },
  { value: "s3:DeleteObject", description: "Object write", source: "S3" },
  { value: "s3:DeleteObjectVersion", description: "Object write", source: "S3" },
  { value: "s3:RestoreObject", description: "Object write", source: "S3" },
  { value: "s3:PutObjectAcl", description: "Object permissions", source: "S3" },
  { value: "s3:PutObjectTagging", description: "Object metadata", source: "S3" },
  { value: "s3:DeleteObjectTagging", description: "Object metadata", source: "S3" },
  { value: "s3:ListBucketMultipartUploads", description: "Multipart", source: "S3" },
  { value: "s3:ListMultipartUploadParts", description: "Multipart", source: "S3" },
  { value: "s3:AbortMultipartUpload", description: "Multipart", source: "S3" },
];

const conditionOperatorSuggestions = [
  "StringEquals",
  "StringNotEquals",
  "StringLike",
  "StringNotLike",
  "ArnEquals",
  "ArnLike",
  "IpAddress",
  "NotIpAddress",
  "Bool",
  "Null",
  "NumericEquals",
  "NumericLessThan",
  "NumericLessThanEquals",
  "NumericGreaterThan",
  "NumericGreaterThanEquals",
  "DateEquals",
  "DateLessThan",
  "DateLessThanEquals",
  "DateGreaterThan",
  "DateGreaterThanEquals",
].map((value) => ({ value, source: "IAM" }));

const conditionKeySuggestions = [
  "aws:SourceIp",
  "aws:SecureTransport",
  "aws:PrincipalArn",
  "aws:PrincipalAccount",
  "aws:SourceArn",
  "aws:SourceAccount",
  "s3:prefix",
  "s3:max-keys",
  "s3:x-amz-acl",
  "s3:x-amz-server-side-encryption",
  "s3:ExistingObjectTag/",
  "s3:RequestObjectTag/",
].map((value) => ({ value, source: value.startsWith("s3:") ? "S3" : "AWS" }));

const notificationEventSuggestions = [
  "s3:ObjectCreated:Put",
  "s3:ObjectCreated:Post",
  "s3:ObjectCreated:Copy",
  "s3:ObjectCreated:CompleteMultipartUpload",
  "s3:ObjectRemoved:Delete",
  "s3:ObjectRemoved:DeleteMarkerCreated",
  "s3:ObjectRestore:Post",
  "s3:ObjectRestore:Completed",
  "s3:ObjectRestore:Delete",
  "s3:Replication:OperationFailedReplication",
  "s3:Replication:OperationNotTracked",
  "s3:Replication:OperationMissedThreshold",
  "s3:Replication:OperationReplicatedAfterThreshold",
].map((value) => ({ value, source: "S3" }));

const corsHeaderSuggestions = [
  "Authorization",
  "Content-Type",
  "Origin",
  "Range",
  "If-Match",
  "If-None-Match",
  "ETag",
  "x-amz-date",
  "x-amz-content-sha256",
  "x-amz-security-token",
  "x-amz-meta-*",
  "x-amz-server-side-encryption",
  "x-amz-request-payer",
].map((value) => ({ value, source: "HTTP/S3" }));

type ObjectListingShape = {
  objects: Array<{ key: string; storage_class?: string | null }>;
  prefixes: string[];
};

type BucketFeatureSuggestionContextValue = {
  prefixes: SettingsSuggestionSource;
  objectKeys: SettingsSuggestionSource;
  buckets: SettingsSuggestionSource;
  destinationBucketArns: SettingsSuggestionSource;
  topicArns: SettingsSuggestionSource;
  storageClasses: SettingsSuggestionSource;
  suffixes: SettingsSuggestionSource;
  policyActions: SettingsSuggestionSource;
  policyResources: SettingsSuggestionSource;
  conditionOperators: SettingsSuggestionSource;
  conditionKeys: SettingsSuggestionSource;
  notificationEvents: SettingsSuggestionSource;
  corsHeaders: SettingsSuggestionSource;
};

const EMPTY_SOURCE: SettingsSuggestionSource = {};
const EMPTY_VALUE: BucketFeatureSuggestionContextValue = {
  prefixes: EMPTY_SOURCE,
  objectKeys: EMPTY_SOURCE,
  buckets: EMPTY_SOURCE,
  destinationBucketArns: EMPTY_SOURCE,
  topicArns: EMPTY_SOURCE,
  storageClasses: { suggestions: knownStorageClasses.map((value) => ({ value, source: "S3" })) },
  suffixes: EMPTY_SOURCE,
  policyActions: { suggestions: policyActionSuggestions },
  policyResources: EMPTY_SOURCE,
  conditionOperators: { suggestions: conditionOperatorSuggestions },
  conditionKeys: { suggestions: conditionKeySuggestions },
  notificationEvents: { suggestions: notificationEventSuggestions },
  corsHeaders: { suggestions: corsHeaderSuggestions },
};

const BucketFeatureSuggestionContext = createContext<BucketFeatureSuggestionContextValue>(EMPTY_VALUE);

export function useBucketFeatureSuggestions(): BucketFeatureSuggestionContextValue {
  return useContext(BucketFeatureSuggestionContext);
}

function extractSuffix(key: string): string | null {
  const slashIndex = key.lastIndexOf("/");
  const name = slashIndex >= 0 ? key.slice(slashIndex + 1) : key;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return null;
  return name.slice(dotIndex);
}

function bucketSuggestion(name: string): SettingsAutocompleteSuggestion {
  return { value: name, label: name, source: "Bucket" };
}

function bucketArnSuggestion(name: string): SettingsAutocompleteSuggestion {
  return {
    value: `arn:aws:s3:::${name}`,
    label: name,
    description: "Destination bucket ARN",
    source: "Bucket",
  };
}

export function BucketFeatureSuggestionsProvider({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
  topicsEnabled,
  children,
}: {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
  topicsEnabled: boolean;
  children: ReactNode;
}) {
  const generationRef = useRef(0);
  const objectCacheRef = useRef(new Map<string, Promise<ObjectListingShape>>());
  const managerBucketsRef = useRef<Promise<string[]> | null>(null);
  const cephBucketsRef = useRef(new Map<string, Promise<string[]>>());
  const topicsRef = useRef<Promise<SettingsAutocompleteSuggestion[]> | null>(null);
  const [observedStorageClasses, setObservedStorageClasses] = useState<string[]>([]);
  const [observedSuffixes, setObservedSuffixes] = useState<string[]>([]);

  useEffect(() => {
    generationRef.current += 1;
    objectCacheRef.current.clear();
    managerBucketsRef.current = null;
    cephBucketsRef.current.clear();
    topicsRef.current = null;
    setObservedStorageClasses([]);
    setObservedSuffixes([]);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const observeObjects = useCallback((listing: ObjectListingShape) => {
    const storageClasses = listing.objects
      .map((object) => object.storage_class)
      .filter((value): value is string => Boolean(value));
    const suffixes = listing.objects
      .map((object) => extractSuffix(object.key))
      .filter((value): value is string => Boolean(value));
    if (storageClasses.length) {
      setObservedStorageClasses((current) =>
        Array.from(new Set([...current, ...storageClasses])).sort(),
      );
    }
    if (suffixes.length) {
      setObservedSuffixes((current) => Array.from(new Set([...current, ...suffixes])).sort());
    }
  }, []);

  const loadObjectListing = useCallback(
    async (prefix: string): Promise<ObjectListingShape> => {
      if (!enabled || !bucketName || (cephAdmin && !endpointId)) {
        return { objects: [], prefixes: [] };
      }
      const generation = generationRef.current;
      const cached = objectCacheRef.current.get(prefix);
      if (cached) return cached;

      const request = (async () => {
        try {
          const data = cephAdmin
            ? await listCephAdminBucketObjects(endpointId as number, bucketName, prefix)
            : await listManagerObjects(accountId, bucketName, prefix);
          if (generationRef.current !== generation) return { objects: [], prefixes: [] };
          const listing: ObjectListingShape = {
            objects: data.objects.map((object) => ({
              key: object.key,
              storage_class: object.storage_class,
            })),
            prefixes: [...data.prefixes],
          };
          observeObjects(listing);
          return listing;
        } catch {
          if (generationRef.current === generation) objectCacheRef.current.delete(prefix);
          return { objects: [], prefixes: [] };
        }
      })();
      objectCacheRef.current.set(prefix, request);
      return request;
    },
    [accountId, bucketName, cephAdmin, enabled, endpointId, observeObjects],
  );

  const loadPrefixSuggestions = useCallback(
    async (query: string) => {
      const listing = await loadObjectListing(query);
      return listing.prefixes.map((prefix) => ({
        value: prefix,
        label: prefix,
        description: "Prefix found in this bucket",
        source: "Bucket",
      }));
    },
    [loadObjectListing],
  );

  const loadObjectKeySuggestions = useCallback(
    async (query: string) => {
      const listing = await loadObjectListing(query);
      return listing.objects.map((object) => ({
        value: object.key,
        label: object.key,
        description: "Object found in this bucket",
        source: "Bucket",
      }));
    },
    [loadObjectListing],
  );

  const loadBucketNames = useCallback(
    async (query: string): Promise<string[]> => {
      if (!enabled || (cephAdmin && !endpointId)) return [];
      const generation = generationRef.current;
      if (cephAdmin) {
        const cacheKey = query;
        const cached = cephBucketsRef.current.get(cacheKey);
        if (cached) return cached;
        const request = listCephAdminBuckets(endpointId as number, {
          filter: query || undefined,
          page: 1,
          page_size: 50,
          with_stats: false,
        })
          .then((data) =>
            generationRef.current === generation ? data.items.map((bucket) => bucket.name) : [],
          )
          .catch(() => {
            if (generationRef.current === generation) cephBucketsRef.current.delete(cacheKey);
            return [];
          });
        cephBucketsRef.current.set(cacheKey, request);
        return request;
      }

      if (!managerBucketsRef.current) {
        managerBucketsRef.current = listBuckets(accountId, { with_stats: false })
          .then((data) =>
            generationRef.current === generation ? data.map((bucket) => bucket.name) : [],
          )
          .catch(() => {
            if (generationRef.current === generation) managerBucketsRef.current = null;
            return [];
          });
      }
      return managerBucketsRef.current;
    },
    [accountId, cephAdmin, enabled, endpointId],
  );

  const loadBucketSuggestions = useCallback(
    async (query: string) => (await loadBucketNames(query)).map(bucketSuggestion),
    [loadBucketNames],
  );

  const loadDestinationBucketArnSuggestions = useCallback(
    async (query: string) => {
      const bucketQuery = query.startsWith("arn:aws:s3:::") ? query.slice("arn:aws:s3:::".length) : query;
      return (await loadBucketNames(bucketQuery)).map(bucketArnSuggestion);
    },
    [loadBucketNames],
  );

  const loadTopicSuggestions = useCallback(
    async (_query: string) => {
      if (!enabled || cephAdmin || !topicsEnabled) return [];
      const generation = generationRef.current;
      if (!topicsRef.current) {
        topicsRef.current = listTopics(accountId)
          .then((topics) =>
            generationRef.current === generation
              ? topics.map((topic) => ({
                  value: topic.arn,
                  label: topic.name,
                  description: topic.arn,
                  source: "Topic",
                }))
              : [],
          )
          .catch(() => {
            if (generationRef.current === generation) topicsRef.current = null;
            return [];
          });
      }
      return topicsRef.current;
    },
    [accountId, cephAdmin, enabled, topicsEnabled],
  );

  const policyResourceSuggestions = useMemo<SettingsAutocompleteSuggestion[]>(() => {
    if (!bucketName) return [];
    return [
      { value: `arn:aws:s3:::${bucketName}`, description: "Bucket", source: "Bucket" },
      { value: `arn:aws:s3:::${bucketName}/*`, description: "All objects", source: "Bucket" },
    ];
  }, [bucketName]);

  const loadPolicyResourceSuggestions = useCallback(
    async (query: string) => {
      if (!bucketName) return [];
      const resourceRoot = `arn:aws:s3:::${bucketName}/`;
      let prefixQuery = "";
      if (query.startsWith(resourceRoot)) {
        prefixQuery = query.slice(resourceRoot.length);
        if (prefixQuery.endsWith("*")) prefixQuery = prefixQuery.slice(0, -1);
      } else if (query.startsWith("arn:")) {
        if (!resourceRoot.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return [];
      } else {
        prefixQuery = query;
      }
      const listing = await loadObjectListing(prefixQuery);
      return listing.prefixes.map((prefix) => ({
        value: `${resourceRoot}${prefix}*`,
        label: prefix,
        description: "Objects under this prefix",
        source: "Bucket",
      }));
    },
    [bucketName, loadObjectListing],
  );

  const storageClassSuggestions = useMemo(
    () =>
      Array.from(new Set([...knownStorageClasses, ...observedStorageClasses])).map((value) => ({
        value,
        source: knownStorageClasses.includes(value) ? "S3" : "Observed",
      })),
    [observedStorageClasses],
  );
  const suffixSuggestions = useMemo(
    () => observedSuffixes.map((value) => ({ value, source: "Observed" })),
    [observedSuffixes],
  );

  const value = useMemo<BucketFeatureSuggestionContextValue>(
    () => ({
      prefixes: { loadSuggestions: loadPrefixSuggestions },
      objectKeys: { loadSuggestions: loadObjectKeySuggestions },
      buckets: { loadSuggestions: loadBucketSuggestions },
      destinationBucketArns: { loadSuggestions: loadDestinationBucketArnSuggestions },
      topicArns: cephAdmin ? EMPTY_SOURCE : { loadSuggestions: loadTopicSuggestions },
      storageClasses: { suggestions: storageClassSuggestions },
      suffixes: { suggestions: suffixSuggestions },
      policyActions: { suggestions: policyActionSuggestions },
      policyResources: {
        suggestions: policyResourceSuggestions,
        loadSuggestions: loadPolicyResourceSuggestions,
      },
      conditionOperators: { suggestions: conditionOperatorSuggestions },
      conditionKeys: { suggestions: conditionKeySuggestions },
      notificationEvents: { suggestions: notificationEventSuggestions },
      corsHeaders: { suggestions: corsHeaderSuggestions },
    }),
    [
      cephAdmin,
      loadBucketSuggestions,
      loadDestinationBucketArnSuggestions,
      loadObjectKeySuggestions,
      loadPolicyResourceSuggestions,
      loadPrefixSuggestions,
      loadTopicSuggestions,
      policyResourceSuggestions,
      storageClassSuggestions,
      suffixSuggestions,
    ],
  );

  return (
    <BucketFeatureSuggestionContext.Provider value={value}>
      {children}
    </BucketFeatureSuggestionContext.Provider>
  );
}
