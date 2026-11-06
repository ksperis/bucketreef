/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";

import { resolveStorageSpaceObjectDetailsView } from "../shared/objectDetailsContract";
import BrowserObjectDetailsDrawer from "./BrowserObjectDetailsDrawer";
import BrowserPathDetailsDrawer from "./BrowserPathDetailsDrawer";
import BrowserStorageSpaceObjectDetailsDrawer from "./BrowserStorageSpaceObjectDetailsDrawer";
import type { BrowserObjectDetailsTarget } from "./useBrowserDetailsDrawerState";

type ObjectDrawerProps = ComponentProps<typeof BrowserObjectDetailsDrawer>;
type PathDrawerProps = ComponentProps<typeof BrowserPathDetailsDrawer>;
type StorageSpaceDrawerProps = ComponentProps<
  typeof BrowserStorageSpaceObjectDetailsDrawer
>;

type BrowserObjectDetailsSurfaceProps = {
  target: BrowserObjectDetailsTarget | null;
  navigation: ObjectDrawerProps["navigation"];
  bucketName: string;
  onClose: ObjectDrawerProps["onClose"];
  isStorageSpaceContext: boolean;
  advancedProfile: boolean;
  storageSpace: Omit<
    StorageSpaceDrawerProps,
    | "navigation"
    | "bucketName"
    | "item"
    | "initialView"
    | "createPublicLinkOnOpen"
    | "onClose"
  >;
  object: Omit<
    ObjectDrawerProps,
    "navigation" | "bucketName" | "item" | "initialTab" | "onClose"
  >;
  path: Omit<PathDrawerProps, "bucketName" | "prefix" | "onClose">;
};

export default function BrowserObjectDetailsSurface({
  target,
  navigation,
  bucketName,
  onClose,
  isStorageSpaceContext,
  advancedProfile,
  storageSpace,
  object,
  path,
}: BrowserObjectDetailsSurfaceProps) {
  if (!target) return null;

  if (target.item.type === "file" && isStorageSpaceContext) {
    return (
      <BrowserStorageSpaceObjectDetailsDrawer
        {...storageSpace}
        navigation={navigation}
        key={`${bucketName}:${target.item.id}`}
        bucketName={bucketName}
        createPublicLinkOnOpen={target.intent === "create-public-link"}
        initialView={resolveStorageSpaceObjectDetailsView({
          initialTab: target.initialTab,
          intent: target.intent,
          isDeleted: target.item.isDeleted,
        })}
        item={target.item}
        onClose={onClose}
      />
    );
  }

  if (target.item.type === "file") {
    return (
      <BrowserObjectDetailsDrawer
        {...object}
        navigation={navigation}
        key={`${bucketName}:${target.item.id}`}
        bucketName={bucketName}
        item={target.item}
        initialTab={target.initialTab}
        onClose={onClose}
      />
    );
  }

  if (!advancedProfile) return null;

  return (
    <BrowserPathDetailsDrawer
      {...path}
      key={`${bucketName}:${target.item.id}`}
      bucketName={bucketName}
      prefix={target.item.key}
      onClose={onClose}
    />
  );
}
