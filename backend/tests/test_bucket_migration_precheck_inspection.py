# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.bucket import (
    BucketAcl,
    BucketAclGrant,
    BucketAclGrantee,
    BucketLoggingConfiguration,
    BucketWebsiteConfiguration,
)
from app.services.bucket_migration.precheck_inspection import (
    _bucket_acl_is_default_private,
    _logging_is_configured,
    _website_is_configured,
)


def test_precheck_normalizes_typed_acl_strings():
    acl = BucketAcl(
        owner="  owner-a  ",
        grants=[
            BucketAclGrant(
                grantee=BucketAclGrantee(
                    type="CanonicalUser",
                    display_name=" owner-a ",
                    uri="   ",
                ),
                permission=" FULL_CONTROL ",
            )
        ],
    )

    assert _bucket_acl_is_default_private(acl)


def test_precheck_treats_whitespace_only_website_and_logging_values_as_unconfigured():
    website = BucketWebsiteConfiguration(
        index_document="   ",
        error_document=None,
        redirect_all_requests_to=None,
        routing_rules=[],
    )
    logging = BucketLoggingConfiguration(
        enabled=True,
        target_bucket="   ",
        target_prefix=None,
    )

    assert not _website_is_configured(website)
    assert not _logging_is_configured(logging)
