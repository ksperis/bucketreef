/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketJsonFeatureEditor from "./BucketJsonFeatureEditor";
import type { useBucketPolicyController } from "./useBucketPolicyController";

type BucketPolicyController = ReturnType<typeof useBucketPolicyController>;

type BucketPolicyFeatureProps = {
  bucketName?: string;
  controller: BucketPolicyController;
  onRequestDelete: () => void;
};

function buildPolicyExample(bucketName?: string) {
  return `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${bucketName || "bucket"}/*"
    }
  ]
}`;
}

export default function BucketPolicyFeature({
  bucketName,
  controller,
  onRequestDelete,
}: BucketPolicyFeatureProps) {
  const example = buildPolicyExample(bucketName);
  return (
    <BucketJsonFeatureEditor
      controller={controller}
      title="Bucket policy"
      description="IAM-like JSON applied directly on the bucket."
      testId="bucket-feature-policy"
      label="Bucket policy (JSON)"
      rows={12}
        placeholder='{"Version":"2012-10-17","Statement":[...]}'
      example={example}
      onRequestDelete={onRequestDelete}
    />
  );
}
