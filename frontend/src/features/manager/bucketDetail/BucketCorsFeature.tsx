/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketJsonFeatureEditor from "./BucketJsonFeatureEditor";
import type { useBucketCorsController } from "./useBucketCorsController";

type BucketCorsController = ReturnType<typeof useBucketCorsController>;

type BucketCorsFeatureProps = {
  controller: BucketCorsController;
  onRequestDelete: () => void;
};

const defaultCorsExample = `[
  {
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedHeaders": ["*"]
  }
]`;

export default function BucketCorsFeature({ controller, onRequestDelete }: BucketCorsFeatureProps) {
  return (
    <BucketJsonFeatureEditor
      controller={controller}
      title="CORS"
      description="CORS rules in AWS format (CORSRules)."
      testId="bucket-feature-cors"
      label="CORS rules (JSON)"
      rows={8}
      placeholder='[{"AllowedMethods":["GET"],"AllowedOrigins":["*"]}]'
      example={defaultCorsExample}
      onRequestDelete={onRequestDelete}
    />
  );
}
