CREATE TABLE storage_endpoints (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	endpoint_url VARCHAR NOT NULL,
	region VARCHAR,
	realm_id VARCHAR,
	zonegroup_id VARCHAR,
	zone_id VARCHAR,
	provider VARCHAR NOT NULL,
	admin_access_key VARCHAR,
	admin_secret_key VARCHAR,
	identity_namespace VARCHAR(32) NOT NULL,
	ceph_admin_allowed BOOLEAN DEFAULT '0' NOT NULL,
	features JSON NOT NULL,
	latitude FLOAT,
	longitude FLOAT,
	force_path_style BOOLEAN DEFAULT '0' NOT NULL,
	verify_tls BOOLEAN DEFAULT '1' NOT NULL,
	is_default BOOLEAN DEFAULT '0' NOT NULL,
	is_editable BOOLEAN DEFAULT '1' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_storage_endpoints_name UNIQUE (name),
	CONSTRAINT uq_storage_endpoints_endpoint UNIQUE (endpoint_url),
	CONSTRAINT ck_storage_endpoints_provider CHECK (provider IN ('ceph', 'aws', 'other')),
	CONSTRAINT ck_storage_endpoints_endpoint_url_canonical CHECK (endpoint_url = trim(endpoint_url) AND endpoint_url NOT LIKE '%%/' AND length(endpoint_url) > 0),
	UNIQUE (identity_namespace)
);

CREATE TABLE users (
	id SERIAL NOT NULL,
	email VARCHAR NOT NULL,
	full_name VARCHAR,
	picture_url VARCHAR,
	avatar_preference VARCHAR DEFAULT 'auto' NOT NULL,
	avatar_image BYTEA,
	avatar_content_type VARCHAR,
	avatar_updated_at TIMESTAMP WITH TIME ZONE,
	hashed_password VARCHAR,
	auth_version INTEGER DEFAULT '1' NOT NULL,
	is_active BOOLEAN NOT NULL,
	role VARCHAR DEFAULT 'ui_user' NOT NULL,
	can_access_ceph_admin BOOLEAN DEFAULT '0' NOT NULL,
	can_access_storage_ops BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_compare BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_integrity_check BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_migration BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_feature_rules BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_purge BOOLEAN DEFAULT '0' NOT NULL,
	can_create_manual_private_connections BOOLEAN DEFAULT '0' NOT NULL,
	can_provision_managed_private_connections BOOLEAN DEFAULT '0' NOT NULL,
	allow_multisite_endpoint_switching BOOLEAN DEFAULT '0' NOT NULL,
	browser_advanced_features_enabled BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_login_at TIMESTAMP WITH TIME ZONE,
	ui_language VARCHAR,
	quota_alerts_enabled BOOLEAN DEFAULT '1' NOT NULL,
	quota_alerts_global_watch BOOLEAN DEFAULT '0' NOT NULL,
	ui_preferences JSON DEFAULT '{}' NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_users_email UNIQUE (email),
	CONSTRAINT ck_users_role CHECK (role IN ('ui_superadmin', 'ui_admin', 'ui_user', 'ui_none')),
	CONSTRAINT ck_users_avatar_preference CHECK (avatar_preference IN ('auto', 'uploaded', 'gravatar', 'initials'))
);

CREATE TABLE s3_sessions (
	id VARCHAR NOT NULL,
	access_key_enc VARCHAR,
	secret_key_enc VARCHAR,
	access_key_hash VARCHAR NOT NULL,
	actor_type VARCHAR NOT NULL,
	role VARCHAR NOT NULL,
	account_id VARCHAR,
	account_name VARCHAR,
	user_uid VARCHAR,
	capabilities JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_used_at TIMESTAMP WITH TIME ZONE NOT NULL,
	idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	absolute_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	revoked_at TIMESTAMP WITH TIME ZONE,
	revoke_reason VARCHAR,
	PRIMARY KEY (id)
);

CREATE TABLE auth_rate_limits (
	id VARCHAR NOT NULL,
	bucket_key VARCHAR NOT NULL,
	window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	attempts INTEGER DEFAULT '0' NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_auth_rate_limit_window UNIQUE (bucket_key, window_started_at)
);

CREATE TABLE openstack_clouds (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	auth_url VARCHAR NOT NULL,
	config_version INTEGER DEFAULT '1' NOT NULL,
	enabled BOOLEAN DEFAULT '0' NOT NULL,
	allow_password BOOLEAN DEFAULT '1' NOT NULL,
	allow_token BOOLEAN DEFAULT '1' NOT NULL,
	managed_endpoints_only BOOLEAN DEFAULT '0' NOT NULL,
	default_domain VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE ui_groups (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	system_key VARCHAR,
	description TEXT,
	avatar_source VARCHAR DEFAULT 'initials' NOT NULL,
	avatar_icon VARCHAR,
	avatar_image BYTEA,
	avatar_content_type VARCHAR,
	avatar_updated_at TIMESTAMP WITH TIME ZONE,
	can_access_ceph_admin BOOLEAN DEFAULT '0' NOT NULL,
	can_access_storage_ops BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_compare BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_integrity_check BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_migration BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_feature_rules BOOLEAN DEFAULT '0' NOT NULL,
	can_access_manager_bucket_purge BOOLEAN DEFAULT '0' NOT NULL,
	can_create_manual_private_connections BOOLEAN DEFAULT '0' NOT NULL,
	can_provision_managed_private_connections BOOLEAN DEFAULT '0' NOT NULL,
	allow_multisite_endpoint_switching BOOLEAN DEFAULT '0' NOT NULL,
	browser_advanced_features_enabled BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_ui_groups_name UNIQUE (name),
	CONSTRAINT uq_ui_groups_system_key UNIQUE (system_key)
);

CREATE TABLE ldap_providers (
	id SERIAL NOT NULL,
	provider_id VARCHAR NOT NULL,
	display_name VARCHAR NOT NULL,
	url VARCHAR NOT NULL,
	bind_dn VARCHAR,
	bind_password VARCHAR,
	user_base_dn VARCHAR NOT NULL,
	user_filter TEXT NOT NULL,
	import_search_filter TEXT,
	email_attribute VARCHAR NOT NULL,
	name_attribute VARCHAR,
	subject_attribute VARCHAR,
	start_tls BOOLEAN NOT NULL,
	tls_verify BOOLEAN NOT NULL,
	tls_ca_file VARCHAR,
	allow_legacy_tls BOOLEAN NOT NULL,
	timeout_seconds FLOAT NOT NULL,
	enabled BOOLEAN NOT NULL,
	allow_insecure BOOLEAN NOT NULL,
	linking_policy VARCHAR DEFAULT 'manual' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (provider_id)
);

CREATE TABLE oidc_authorization_codes (
	id VARCHAR NOT NULL,
	provider VARCHAR NOT NULL,
	code_hash VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
);

CREATE TABLE oidc_providers (
	id SERIAL NOT NULL,
	provider_id VARCHAR NOT NULL,
	display_name VARCHAR NOT NULL,
	discovery_url VARCHAR NOT NULL,
	client_id VARCHAR NOT NULL,
	client_secret VARCHAR,
	redirect_uri VARCHAR NOT NULL,
	scopes JSON DEFAULT '["openid","email","profile"]' NOT NULL,
	prompt VARCHAR,
	enabled BOOLEAN NOT NULL,
	icon_url VARCHAR,
	use_pkce BOOLEAN NOT NULL,
	use_nonce BOOLEAN NOT NULL,
	linking_policy VARCHAR DEFAULT 'manual' NOT NULL,
	trusted_email_domains JSON DEFAULT '[]' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (provider_id)
);

CREATE TABLE oidc_provider_issuer_pins (
	provider_id VARCHAR NOT NULL,
	issuer VARCHAR NOT NULL,
	PRIMARY KEY (provider_id)
);

CREATE TABLE cost_models (
	id INTEGER NOT NULL,
	currency VARCHAR DEFAULT 'EUR' NOT NULL,
	storage_gb_month_price NUMERIC(12, 6) NOT NULL,
	egress_gb_price NUMERIC(12, 6) NOT NULL,
	ingress_gb_price NUMERIC(12, 6) NOT NULL,
	requests_per_1000_price NUMERIC(12, 6) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_cost_models_singleton CHECK (id = 1),
	CONSTRAINT ck_cost_models_storage_price_nonnegative CHECK (storage_gb_month_price >= 0),
	CONSTRAINT ck_cost_models_egress_price_nonnegative CHECK (egress_gb_price >= 0),
	CONSTRAINT ck_cost_models_ingress_price_nonnegative CHECK (ingress_gb_price >= 0),
	CONSTRAINT ck_cost_models_requests_price_nonnegative CHECK (requests_per_1000_price >= 0)
);

CREATE TABLE bucket_usage_stats_snapshots (
	id SERIAL NOT NULL,
	scope_kind VARCHAR NOT NULL,
	scope_id VARCHAR NOT NULL,
	scope_name VARCHAR,
	bucket_tenant VARCHAR DEFAULT '' NOT NULL,
	bucket_name VARCHAR NOT NULL,
	scan_mode VARCHAR DEFAULT 'versions' NOT NULL,
	version_listing_available BOOLEAN DEFAULT '1' NOT NULL,
	object_version_count INTEGER DEFAULT '0' NOT NULL,
	current_version_count INTEGER DEFAULT '0' NOT NULL,
	noncurrent_version_count INTEGER DEFAULT '0' NOT NULL,
	delete_marker_count INTEGER DEFAULT '0' NOT NULL,
	total_bytes INTEGER DEFAULT '0' NOT NULL,
	current_bytes INTEGER DEFAULT '0' NOT NULL,
	noncurrent_bytes INTEGER DEFAULT '0' NOT NULL,
	data_type_distribution JSON NOT NULL,
	storage_class_distribution JSON NOT NULL,
	size_distribution JSON NOT NULL,
	age_distribution JSON NOT NULL,
	current_noncurrent_distribution JSON NOT NULL,
	warnings JSON,
	calculated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_bucket_usage_stats_scope_bucket UNIQUE (scope_kind, scope_id, bucket_tenant, bucket_name)
);

CREATE TABLE backend_operation_leases (
	operation_name VARCHAR NOT NULL,
	lease_owner VARCHAR NOT NULL,
	lease_until TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	lease_context JSON,
	PRIMARY KEY (operation_name)
);

CREATE TABLE app_settings (
	key VARCHAR NOT NULL,
	payload JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (key)
);

CREATE TABLE first_admin_bootstrap (
	id SERIAL NOT NULL,
	token_digest VARCHAR(64),
	expires_at TIMESTAMP WITH TIME ZONE,
	consumed_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	CONSTRAINT ck_first_admin_bootstrap_singleton CHECK (id = 1)
);

CREATE TABLE webhook_endpoints (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	url TEXT NOT NULL,
	enabled BOOLEAN DEFAULT '0' NOT NULL,
	signing_secret VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_webhook_endpoints_name UNIQUE (name)
);

CREATE TABLE endpoint_service_identities (
	id SERIAL NOT NULL,
	endpoint_id INTEGER NOT NULL,
	kind VARCHAR(24) NOT NULL,
	mode VARCHAR(16) NOT NULL,
	rgw_uid VARCHAR(128),
	access_key VARCHAR,
	secret_key VARCHAR,
	provenance VARCHAR(128),
	status VARCHAR(24) NOT NULL,
	last_error VARCHAR(256),
	last_reconciled_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_endpoint_service_identity_kind UNIQUE (endpoint_id, kind),
	CONSTRAINT ck_endpoint_service_identity_kind CHECK (kind IN ('runtime', 'supervision', 'ceph_admin')),
	CONSTRAINT ck_endpoint_service_identity_mode CHECK (mode IN ('managed', 'external')),
	CONSTRAINT ck_endpoint_service_identity_ceph_admin_external CHECK (kind != 'ceph_admin' OR mode = 'external'),
	CONSTRAINT ck_endpoint_service_identity_status CHECK (status IN ('not_provisioned', 'missing', 'provisioning', 'ready', 'error', 'revocation_pending', 'disabled')),
	FOREIGN KEY(endpoint_id) REFERENCES storage_endpoints (id) ON DELETE CASCADE
);

CREATE TABLE key_rotation_intents (
	id SERIAL NOT NULL,
	endpoint_id INTEGER NOT NULL,
	key_type VARCHAR(32) NOT NULL,
	target_id INTEGER NOT NULL,
	rgw_uid VARCHAR NOT NULL,
	tenant VARCHAR,
	rgw_endpoint VARCHAR NOT NULL,
	old_access_key VARCHAR NOT NULL,
	new_access_key VARCHAR NOT NULL,
	new_secret_key VARCHAR NOT NULL,
	deactivate_only BOOLEAN NOT NULL,
	phase VARCHAR(16) NOT NULL,
	actor_email VARCHAR NOT NULL,
	last_error VARCHAR(256),
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_key_rotation_intent_target UNIQUE (endpoint_id, key_type, target_id),
	CONSTRAINT ck_key_rotation_intent_phase CHECK (phase IN ('prepared', 'activated')),
	CONSTRAINT ck_key_rotation_intent_type CHECK (key_type IN ('endpoint_admin', 'endpoint_runtime', 'endpoint_supervision', 'ceph_admin', 'account', 's3_user')),
	FOREIGN KEY(endpoint_id) REFERENCES storage_endpoints (id) ON DELETE CASCADE
);

CREATE TABLE s3_accounts (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	rgw_account_id VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	email VARCHAR,
	rgw_access_key VARCHAR,
	rgw_secret_key VARCHAR,
	rgw_user_uid VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	portal_settings_override JSON,
	portal_settings_delegated BOOLEAN DEFAULT '0' NOT NULL,
	portal_collaborator_role_management_delegated BOOLEAN DEFAULT '0' NOT NULL,
	portal_collaborator_addition_delegated BOOLEAN DEFAULT '0' NOT NULL,
	allow_bucket_quota_management BOOLEAN,
	allow_access_key_metadata BOOLEAN,
	allow_access_key_expiration BOOLEAN,
	allow_activity_history BOOLEAN,
	allow_rgw_usage_metrics BOOLEAN,
	allow_cost_estimation BOOLEAN,
	allow_bucket_usage_stats BOOLEAN,
	allow_bucket_usage_stats_collection BOOLEAN,
	allow_multisite_endpoint_switching BOOLEAN,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_accounts_endpoint_tenant_name UNIQUE (storage_endpoint_id, rgw_tenant, name),
	CONSTRAINT ck_s3_accounts_rgw_account_id_canonical CHECK (rgw_account_id = TRIM(rgw_account_id) AND LENGTH(rgw_account_id) > 0),
	CONSTRAINT ck_s3_accounts_rgw_user_uid_canonical CHECK (rgw_user_uid = TRIM(rgw_user_uid) AND LENGTH(rgw_user_uid) > 0),
	UNIQUE (rgw_account_id),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE s3_account_import_intents (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	rgw_account_id VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	root_uid VARCHAR NOT NULL,
	account_name VARCHAR NOT NULL,
	requested_name VARCHAR,
	requested_email VARCHAR,
	credential_action VARCHAR NOT NULL,
	access_key_id VARCHAR NOT NULL,
	secret_access_key VARCHAR NOT NULL,
	phase VARCHAR DEFAULT 'prepared' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_account_import_intents_rgw_account UNIQUE (rgw_account_id),
	CONSTRAINT ck_s3_account_import_intents_credential_action CHECK (credential_action IN ('reuse', 'create_root', 'create_key')),
	CONSTRAINT ck_s3_account_import_intents_phase CHECK (phase IN ('prepared', 'creating', 'remote_created')),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE browser_favorites (
	id VARCHAR(36) NOT NULL,
	user_id INTEGER NOT NULL,
	name VARCHAR(120) NOT NULL,
	context VARCHAR(256) NOT NULL,
	bucket VARCHAR(255) NOT NULL,
	prefix VARCHAR(1024) NOT NULL,
	revision INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
	id SERIAL NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	user_id INTEGER,
	user_email VARCHAR NOT NULL,
	user_role VARCHAR NOT NULL,
	scope VARCHAR NOT NULL,
	action VARCHAR NOT NULL,
	entity_type VARCHAR,
	entity_id VARCHAR,
	context_kind VARCHAR,
	context_id VARCHAR,
	context_name VARCHAR,
	status VARCHAR NOT NULL,
	message VARCHAR,
	metadata JSON,
	request_id VARCHAR,
	ip_address VARCHAR,
	user_agent VARCHAR,
	PRIMARY KEY (id),
	CONSTRAINT ck_audit_logs_status CHECK (status IN ('success', 'failure', 'partial')),
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE auth_sessions (
	id VARCHAR NOT NULL,
	user_id INTEGER,
	s3_session_id VARCHAR,
	principal_type VARCHAR NOT NULL,
	auth_type VARCHAR NOT NULL,
	auth_version INTEGER DEFAULT '1' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL,
	idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	absolute_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	mfa_verified_at TIMESTAMP WITH TIME ZONE,
	ip_address VARCHAR,
	user_agent TEXT,
	csrf_token_hash VARCHAR NOT NULL,
	revoked_at TIMESTAMP WITH TIME ZONE,
	revoke_reason VARCHAR,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(s3_session_id) REFERENCES s3_sessions (id) ON DELETE CASCADE
);

CREATE TABLE external_identities (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	provider_type VARCHAR NOT NULL,
	provider_id VARCHAR NOT NULL,
	issuer VARCHAR,
	subject VARCHAR NOT NULL,
	email VARCHAR,
	email_verified BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_login_at TIMESTAMP WITH TIME ZONE,
	revoked_at TIMESTAMP WITH TIME ZONE,
	link_source VARCHAR DEFAULT 'jit' NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_external_identity_provider_issuer CHECK (provider_id = lower(trim(provider_id)) AND length(provider_id) > 0 AND ((provider_type = 'oidc' AND issuer IS NOT NULL AND length(issuer) > 0 AND issuer = trim(issuer) AND issuer = rtrim(issuer, '/')) OR (provider_type = 'ldap' AND issuer IS NULL))),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE external_identity_link_requests (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	provider_type VARCHAR NOT NULL,
	provider_id VARCHAR NOT NULL,
	issuer VARCHAR,
	subject VARCHAR NOT NULL,
	email VARCHAR NOT NULL,
	email_verified BOOLEAN DEFAULT '0' NOT NULL,
	request_source VARCHAR,
	display_name VARCHAR,
	picture_url VARCHAR,
	status VARCHAR DEFAULT 'pending' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	decided_at TIMESTAMP WITH TIME ZONE,
	decided_by_user_id INTEGER,
	decision_reason VARCHAR,
	decision_source VARCHAR,
	PRIMARY KEY (id),
	CONSTRAINT ck_external_link_request_provider_issuer CHECK (provider_id = lower(trim(provider_id)) AND length(provider_id) > 0 AND ((provider_type = 'oidc' AND issuer IS NOT NULL AND length(issuer) > 0 AND issuer = trim(issuer) AND issuer = rtrim(issuer, '/')) OR (provider_type = 'ldap' AND issuer IS NULL))),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(decided_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE external_identity_link_attempts (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	provider_type VARCHAR NOT NULL,
	provider_id VARCHAR NOT NULL,
	issuer VARCHAR,
	subject VARCHAR,
	email VARCHAR,
	email_verified BOOLEAN DEFAULT '0' NOT NULL,
	display_name VARCHAR,
	picture_url VARCHAR,
	source VARCHAR NOT NULL,
	browser_secret_hash VARCHAR NOT NULL,
	proof_method VARCHAR,
	proof_verified_at TIMESTAMP WITH TIME ZONE,
	mfa_verified_at TIMESTAMP WITH TIME ZONE,
	status VARCHAR DEFAULT 'pending' NOT NULL,
	redirect_path VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	consumed_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	CONSTRAINT ck_external_link_attempt_provider_issuer CHECK (provider_id = lower(trim(provider_id)) AND length(provider_id) > 0 AND ((provider_type = 'oidc' AND issuer IS NOT NULL AND length(issuer) > 0 AND issuer = trim(issuer) AND issuer = rtrim(issuer, '/')) OR (provider_type = 'ldap' AND issuer IS NULL))),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE webauthn_credentials (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	credential_id VARCHAR NOT NULL,
	public_key TEXT NOT NULL,
	sign_count INTEGER DEFAULT '0' NOT NULL,
	transports JSON DEFAULT '[]' NOT NULL,
	name VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_used_at TIMESTAMP WITH TIME ZONE,
	revoked_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE auth_challenges (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	binding_sid VARCHAR,
	purpose VARCHAR NOT NULL,
	challenge_hash VARCHAR NOT NULL,
	payload JSON DEFAULT '{}' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	consumed_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	UNIQUE (challenge_hash)
);

CREATE TABLE recovery_codes (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	code_hash VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	consumed_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	UNIQUE (code_hash)
);

CREATE TABLE api_tokens (
	id VARCHAR NOT NULL,
	jti VARCHAR NOT NULL,
	token_hash VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	scopes JSON DEFAULT '[]' NOT NULL,
	auth_version INTEGER DEFAULT '1' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_used_at TIMESTAMP WITH TIME ZONE,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	revoked_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE openstack_cloud_users (
	cloud_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	PRIMARY KEY (cloud_id, user_id),
	FOREIGN KEY(cloud_id) REFERENCES openstack_clouds (id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE openstack_cloud_groups (
	cloud_id INTEGER NOT NULL,
	group_id INTEGER NOT NULL,
	PRIMARY KEY (cloud_id, group_id),
	FOREIGN KEY(cloud_id) REFERENCES openstack_clouds (id) ON DELETE CASCADE,
	FOREIGN KEY(group_id) REFERENCES ui_groups (id) ON DELETE CASCADE
);

CREATE TABLE openstack_connections (
	id VARCHAR NOT NULL,
	user_id INTEGER NOT NULL,
	cloud_id INTEGER NOT NULL,
	keystone_user_id VARCHAR NOT NULL,
	display_name VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_openstack_connection_identity UNIQUE (user_id, cloud_id, keystone_user_id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(cloud_id) REFERENCES openstack_clouds (id) ON DELETE CASCADE
);

CREATE TABLE s3_users (
	id SERIAL NOT NULL,
	name VARCHAR NOT NULL,
	rgw_user_uid VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	email VARCHAR,
	rgw_access_key VARCHAR NOT NULL,
	rgw_secret_key VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	allow_bucket_quota_management BOOLEAN,
	allow_access_key_management BOOLEAN,
	allow_access_key_metadata BOOLEAN,
	allow_access_key_expiration BOOLEAN,
	allow_activity_history BOOLEAN,
	allow_rgw_usage_metrics BOOLEAN,
	allow_cost_estimation BOOLEAN,
	allow_bucket_usage_stats BOOLEAN,
	allow_bucket_usage_stats_collection BOOLEAN,
	allow_multisite_endpoint_switching BOOLEAN,
	allow_managed_private_connection_provisioning BOOLEAN,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_users_endpoint_tenant_uid UNIQUE (storage_endpoint_id, rgw_tenant, rgw_user_uid),
	CONSTRAINT ck_s3_users_rgw_user_uid_canonical CHECK (rgw_user_uid = TRIM(rgw_user_uid) AND LENGTH(rgw_user_uid) > 0),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE s3_user_import_intents (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	rgw_user_uid VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	requested_name VARCHAR,
	requested_email VARCHAR,
	access_key_id VARCHAR NOT NULL,
	secret_access_key VARCHAR NOT NULL,
	phase VARCHAR DEFAULT 'prepared' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_user_import_intents_identity UNIQUE (storage_endpoint_id, rgw_tenant, rgw_user_uid),
	CONSTRAINT ck_s3_user_import_intents_phase CHECK (phase IN ('prepared', 'creating', 'remote_created')),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE s3_connections (
	id SERIAL NOT NULL,
	created_by_user_id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	is_shared BOOLEAN DEFAULT '0' NOT NULL,
	is_active BOOLEAN DEFAULT '1' NOT NULL,
	access_manager BOOLEAN DEFAULT '0' NOT NULL,
	access_browser BOOLEAN DEFAULT '1' NOT NULL,
	allow_activity_history BOOLEAN,
	remediation_required BOOLEAN DEFAULT '0' NOT NULL,
	remediation_reason VARCHAR,
	server_managed BOOLEAN DEFAULT '0' NOT NULL,
	rgw_user_uid VARCHAR,
	rgw_tenant VARCHAR,
	rgw_account_id VARCHAR,
	storage_endpoint_id INTEGER,
	custom_endpoint_url VARCHAR,
	custom_region VARCHAR,
	custom_force_path_style BOOLEAN,
	custom_verify_tls BOOLEAN,
	custom_provider VARCHAR,
	access_key_id VARCHAR NOT NULL,
	secret_access_key VARCHAR NOT NULL,
	session_token VARCHAR,
	expires_at TIMESTAMP WITH TIME ZONE,
	capabilities JSON DEFAULT '{"can_manage_iam":false}' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_used_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	CONSTRAINT ck_s3_connections_endpoint_source CHECK ((storage_endpoint_id IS NOT NULL AND custom_endpoint_url IS NULL AND custom_region IS NULL AND custom_force_path_style IS NULL AND custom_verify_tls IS NULL AND custom_provider IS NULL) OR (storage_endpoint_id IS NULL AND custom_endpoint_url IS NOT NULL AND custom_force_path_style IS NOT NULL AND custom_verify_tls IS NOT NULL)),
	FOREIGN KEY(created_by_user_id) REFERENCES users (id),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE user_ui_groups (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	group_id INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_ui_group UNIQUE (user_id, group_id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(group_id) REFERENCES ui_groups (id)
);

CREATE TABLE tag_definitions (
	id SERIAL NOT NULL,
	domain_kind VARCHAR NOT NULL,
	owner_user_id INTEGER,
	label VARCHAR NOT NULL,
	label_key VARCHAR NOT NULL,
	color_key VARCHAR NOT NULL,
	scope VARCHAR DEFAULT 'standard' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(owner_user_id) REFERENCES users (id)
);

CREATE TABLE cost_endpoint_overrides (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	storage_gb_month_price NUMERIC(12, 6) NOT NULL,
	egress_gb_price NUMERIC(12, 6) NOT NULL,
	ingress_gb_price NUMERIC(12, 6) NOT NULL,
	requests_per_1000_price NUMERIC(12, 6) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_cost_endpoint_overrides_endpoint UNIQUE (storage_endpoint_id),
	CONSTRAINT ck_cost_endpoint_overrides_storage_price_nonnegative CHECK (storage_gb_month_price >= 0),
	CONSTRAINT ck_cost_endpoint_overrides_egress_price_nonnegative CHECK (egress_gb_price >= 0),
	CONSTRAINT ck_cost_endpoint_overrides_ingress_price_nonnegative CHECK (ingress_gb_price >= 0),
	CONSTRAINT ck_cost_endpoint_overrides_requests_price_nonnegative CHECK (requests_per_1000_price >= 0),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id) ON DELETE CASCADE
);

CREATE TABLE endpoint_health_checks (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
	http_status INTEGER,
	latency_ms INTEGER,
	check_mode VARCHAR DEFAULT 'http' NOT NULL,
	status VARCHAR NOT NULL,
	error_message VARCHAR,
	PRIMARY KEY (id),
	CONSTRAINT ck_endpoint_health_checks_mode CHECK (check_mode IN ('http', 's3')),
	CONSTRAINT ck_endpoint_health_checks_status CHECK (status IN ('up', 'degraded', 'down', 'unknown')),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE endpoint_health_latest (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	check_mode VARCHAR DEFAULT 'http' NOT NULL,
	check_type VARCHAR DEFAULT 'availability' NOT NULL,
	scope VARCHAR DEFAULT 'endpoint' NOT NULL,
	checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
	status VARCHAR NOT NULL,
	latency_ms INTEGER,
	http_status INTEGER,
	error_message VARCHAR,
	min_latency_ms INTEGER,
	avg_latency_ms INTEGER,
	max_latency_ms INTEGER,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_endpoint_health_latest_mode CHECK (check_mode IN ('http', 's3')),
	CONSTRAINT ck_endpoint_health_latest_dimensions CHECK (check_type = 'availability' AND scope = 'endpoint'),
	CONSTRAINT ck_endpoint_health_latest_status CHECK (status IN ('up', 'degraded', 'down', 'unknown')),
	CONSTRAINT uq_endpoint_health_latest_scope UNIQUE (storage_endpoint_id, check_mode, check_type, scope),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE endpoint_health_status_segments (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	check_mode VARCHAR DEFAULT 'http' NOT NULL,
	check_type VARCHAR DEFAULT 'availability' NOT NULL,
	scope VARCHAR DEFAULT 'endpoint' NOT NULL,
	status VARCHAR NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ended_at TIMESTAMP WITH TIME ZONE,
	min_latency_ms INTEGER,
	avg_latency_ms INTEGER,
	max_latency_ms INTEGER,
	latency_sample_count INTEGER DEFAULT '0' NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_endpoint_health_status_segments_mode CHECK (check_mode IN ('http', 's3')),
	CONSTRAINT ck_endpoint_health_status_segments_dimensions CHECK (check_type = 'availability' AND scope = 'endpoint'),
	CONSTRAINT ck_endpoint_health_status_segments_status CHECK (status IN ('up', 'degraded', 'down', 'unknown')),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE endpoint_health_rollups (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	check_mode VARCHAR DEFAULT 'http' NOT NULL,
	check_type VARCHAR DEFAULT 'availability' NOT NULL,
	scope VARCHAR DEFAULT 'endpoint' NOT NULL,
	resolution_seconds INTEGER DEFAULT '300' NOT NULL,
	bucket_start TIMESTAMP WITH TIME ZONE NOT NULL,
	up_count INTEGER DEFAULT '0' NOT NULL,
	degraded_count INTEGER DEFAULT '0' NOT NULL,
	down_count INTEGER DEFAULT '0' NOT NULL,
	unknown_count INTEGER DEFAULT '0' NOT NULL,
	latency_avg_ms INTEGER,
	latency_p95_ms INTEGER,
	latency_sample_count INTEGER DEFAULT '0' NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_endpoint_health_rollups_mode CHECK (check_mode IN ('http', 's3')),
	CONSTRAINT ck_endpoint_health_rollups_dimensions CHECK (check_type = 'availability' AND scope = 'endpoint'),
	CONSTRAINT uq_endpoint_health_rollup_bucket UNIQUE (storage_endpoint_id, check_mode, check_type, scope, resolution_seconds, bucket_start),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id)
);

CREATE TABLE onboarding_preferences (
	user_id INTEGER NOT NULL,
	dismissed BOOLEAN NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (user_id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE onboarding_journeys (
	id VARCHAR(36) NOT NULL,
	user_id INTEGER NOT NULL,
	revision INTEGER NOT NULL,
	draft JSON NOT NULL,
	resources JSON DEFAULT '{}' NOT NULL,
	pending_step VARCHAR(40),
	configured_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE webhook_endpoint_subscriptions (
	id SERIAL NOT NULL,
	endpoint_id INTEGER NOT NULL,
	event_type VARCHAR NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_webhook_endpoint_subscription UNIQUE (endpoint_id, event_type),
	FOREIGN KEY(endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE CASCADE
);

CREATE TABLE webhook_deliveries (
	id SERIAL NOT NULL,
	delivery_id VARCHAR NOT NULL,
	event_id VARCHAR NOT NULL,
	endpoint_id INTEGER NOT NULL,
	event_type VARCHAR NOT NULL,
	payload JSON NOT NULL,
	is_test BOOLEAN DEFAULT '0' NOT NULL,
	status VARCHAR DEFAULT 'pending' NOT NULL,
	attempt_count INTEGER DEFAULT '0' NOT NULL,
	next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
	last_http_status INTEGER,
	last_error TEXT,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	delivered_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	CONSTRAINT uq_webhook_deliveries_delivery_id UNIQUE (delivery_id),
	FOREIGN KEY(endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE CASCADE
);

CREATE TABLE manager_access_key_metadata (
	id SERIAL NOT NULL,
	account_id INTEGER,
	s3_user_id INTEGER,
	principal_name VARCHAR(256),
	access_key_id VARCHAR(256) NOT NULL,
	name VARCHAR(128),
	notes TEXT,
	expires_at TIMESTAMP WITH TIME ZONE,
	expiration_state VARCHAR(32),
	expiration_enforced_at TIMESTAMP WITH TIME ZONE,
	expiration_last_attempt_at TIMESTAMP WITH TIME ZONE,
	expiration_last_error TEXT,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_manager_access_key_metadata_scope CHECK ((account_id IS NOT NULL AND s3_user_id IS NULL AND principal_name IS NOT NULL) OR (account_id IS NULL AND s3_user_id IS NOT NULL AND principal_name IS NULL)),
	CONSTRAINT uq_manager_access_key_metadata_iam UNIQUE (account_id, principal_name, access_key_id),
	CONSTRAINT uq_manager_access_key_metadata_s3_user UNIQUE (s3_user_id, access_key_id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id) ON DELETE CASCADE
);

CREATE TABLE s3_account_deletions (
	id SERIAL NOT NULL,
	account_id INTEGER NOT NULL,
	rgw_account_id VARCHAR NOT NULL,
	rgw_user_uid VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	iam_cleanup_completed BOOLEAN DEFAULT '0' NOT NULL,
	root_user_deleted BOOLEAN DEFAULT '0' NOT NULL,
	remote_account_deleted BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_account_deletions_account UNIQUE (account_id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE
);

CREATE TABLE user_s3_accounts (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	manager_role VARCHAR,
	portal_role VARCHAR,
	allow_manager_browser_data_access BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_s3_account UNIQUE (user_id, account_id),
	CONSTRAINT ck_user_s3_accounts_manager_role CHECK (manager_role IS NULL OR manager_role = 'account_administrator'),
	CONSTRAINT ck_user_s3_accounts_portal_role CHECK (portal_role IS NULL OR portal_role IN ('portal_user', 'portal_manager')),
	CONSTRAINT ck_user_s3_accounts_has_role CHECK (manager_role IS NOT NULL OR portal_role IS NOT NULL),
	CONSTRAINT ck_user_s3_accounts_manager_browser_role CHECK (allow_manager_browser_data_access IS FALSE OR manager_role = 'account_administrator'),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id)
);

CREATE TABLE account_iam_users (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	iam_user_id VARCHAR NOT NULL,
	iam_username VARCHAR,
	active_access_key VARCHAR,
	active_secret_key VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_account_iam_user UNIQUE (user_id, account_id),
	CONSTRAINT uq_account_iam_user_id UNIQUE (iam_user_id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id)
);

CREATE TABLE refresh_tokens (
	id VARCHAR NOT NULL,
	family_id VARCHAR NOT NULL,
	auth_session_id VARCHAR NOT NULL,
	parent_id VARCHAR,
	token_hash VARCHAR NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	used_at TIMESTAMP WITH TIME ZONE,
	replaced_by_id VARCHAR,
	revoked_at TIMESTAMP WITH TIME ZONE,
	revoke_reason VARCHAR,
	PRIMARY KEY (id),
	FOREIGN KEY(auth_session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE,
	FOREIGN KEY(parent_id) REFERENCES refresh_tokens (id) ON DELETE SET NULL,
	FOREIGN KEY(replaced_by_id) REFERENCES refresh_tokens (id) ON DELETE SET NULL
);

CREATE TABLE openstack_sessions (
	id VARCHAR NOT NULL,
	connection_id VARCHAR NOT NULL,
	auth_session_id VARCHAR NOT NULL,
	token VARCHAR,
	cloud_version INTEGER DEFAULT '1' NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_openstack_ui_session UNIQUE (connection_id, auth_session_id),
	FOREIGN KEY(connection_id) REFERENCES openstack_connections (id) ON DELETE CASCADE,
	FOREIGN KEY(auth_session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE
);

CREATE TABLE openstack_project_contexts (
	id VARCHAR NOT NULL,
	connection_id VARCHAR NOT NULL,
	project_id VARCHAR NOT NULL,
	project_name VARCHAR NOT NULL,
	target_id VARCHAR NOT NULL,
	region_id VARCHAR NOT NULL,
	endpoint_url VARCHAR NOT NULL,
	endpoint_name VARCHAR NOT NULL,
	endpoint_interface VARCHAR NOT NULL,
	service_type VARCHAR NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_openstack_project_target UNIQUE (connection_id, project_id, target_id),
	FOREIGN KEY(connection_id) REFERENCES openstack_connections (id) ON DELETE CASCADE
);

CREATE TABLE s3_user_deletions (
	id SERIAL NOT NULL,
	s3_user_id INTEGER NOT NULL,
	mode VARCHAR NOT NULL,
	rgw_user_uid VARCHAR NOT NULL,
	rgw_tenant VARCHAR DEFAULT '' NOT NULL,
	access_key_id VARCHAR,
	remote_completed BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_user_deletions_s3_user UNIQUE (s3_user_id),
	CONSTRAINT ck_s3_user_deletions_mode CHECK (mode IN ('access_key', 'remote_user')),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id) ON DELETE CASCADE
);

CREATE TABLE user_s3_users (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	s3_user_id INTEGER NOT NULL,
	allow_manager_browser_data_access BOOLEAN DEFAULT '0' NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_s3_user UNIQUE (user_id, s3_user_id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE user_s3_connections (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	s3_connection_id INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_s3_connection UNIQUE (user_id, s3_connection_id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(s3_connection_id) REFERENCES s3_connections (id)
);

CREATE TABLE managed_private_accesses (
	id SERIAL NOT NULL,
	owner_user_id INTEGER NOT NULL,
	source_context_type VARCHAR NOT NULL,
	source_context_id INTEGER NOT NULL,
	remote_principal_type VARCHAR NOT NULL,
	remote_principal_identifier VARCHAR NOT NULL,
	iam_username VARCHAR,
	access_key_id VARCHAR,
	s3_connection_id INTEGER,
	state VARCHAR DEFAULT 'provisioning' NOT NULL,
	cleanup_error TEXT,
	iam_groups JSON DEFAULT '[]' NOT NULL,
	iam_managed_policies JSON DEFAULT '[]' NOT NULL,
	iam_inline_policy_names JSON DEFAULT '[]' NOT NULL,
	created_remote_principal BOOLEAN DEFAULT '0' NOT NULL,
	created_access_key BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_managed_private_access_source_type CHECK (source_context_type IN ('account', 'connection', 's3_user')),
	CONSTRAINT ck_managed_private_access_principal_type CHECK (remote_principal_type IN ('iam_user', 'rgw_user')),
	CONSTRAINT ck_managed_private_access_state CHECK (state IN ('provisioning', 'active', 'deleting', 'cleanup_pending', 'failed')),
	CONSTRAINT uq_managed_private_access_connection UNIQUE (s3_connection_id),
	FOREIGN KEY(owner_user_id) REFERENCES users (id),
	FOREIGN KEY(s3_connection_id) REFERENCES s3_connections (id) ON DELETE SET NULL
);

CREATE TABLE ui_group_s3_accounts (
	id SERIAL NOT NULL,
	group_id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	manager_role VARCHAR,
	portal_role VARCHAR,
	allow_manager_browser_data_access BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_ui_group_s3_account UNIQUE (group_id, account_id),
	CONSTRAINT ck_ui_group_s3_accounts_manager_role CHECK (manager_role IS NULL OR manager_role = 'account_administrator'),
	CONSTRAINT ck_ui_group_s3_accounts_portal_role CHECK (portal_role IS NULL OR portal_role IN ('portal_user', 'portal_manager')),
	CONSTRAINT ck_ui_group_s3_accounts_has_role CHECK (manager_role IS NOT NULL OR portal_role IS NOT NULL),
	CONSTRAINT ck_ui_group_s3_accounts_manager_browser_role CHECK (allow_manager_browser_data_access IS FALSE OR manager_role = 'account_administrator'),
	FOREIGN KEY(group_id) REFERENCES ui_groups (id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id)
);

CREATE TABLE ui_group_s3_users (
	id SERIAL NOT NULL,
	group_id INTEGER NOT NULL,
	s3_user_id INTEGER NOT NULL,
	allow_manager_browser_data_access BOOLEAN DEFAULT '0' NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_ui_group_s3_user UNIQUE (group_id, s3_user_id),
	FOREIGN KEY(group_id) REFERENCES ui_groups (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE ui_group_s3_connections (
	id SERIAL NOT NULL,
	group_id INTEGER NOT NULL,
	s3_connection_id INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_ui_group_s3_connection UNIQUE (group_id, s3_connection_id),
	FOREIGN KEY(group_id) REFERENCES ui_groups (id),
	FOREIGN KEY(s3_connection_id) REFERENCES s3_connections (id)
);

CREATE TABLE bucket_ui_tag_assignments (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	tenant_key VARCHAR DEFAULT '' NOT NULL,
	bucket_name VARCHAR NOT NULL,
	tag_definition_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_bucket_ui_tag_assignment UNIQUE (storage_endpoint_id, tenant_key, bucket_name, tag_definition_id),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_definition_id) REFERENCES tag_definitions (id) ON DELETE CASCADE
);

CREATE TABLE storage_endpoint_tags (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	tag_definition_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_storage_endpoint_tag UNIQUE (storage_endpoint_id, tag_definition_id),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_definition_id) REFERENCES tag_definitions (id) ON DELETE CASCADE
);

CREATE TABLE s3_account_tags (
	id SERIAL NOT NULL,
	account_id INTEGER NOT NULL,
	tag_definition_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_account_tag UNIQUE (account_id, tag_definition_id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_definition_id) REFERENCES tag_definitions (id) ON DELETE CASCADE
);

CREATE TABLE s3_user_tags (
	id SERIAL NOT NULL,
	s3_user_id INTEGER NOT NULL,
	tag_definition_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_user_tag UNIQUE (s3_user_id, tag_definition_id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_definition_id) REFERENCES tag_definitions (id) ON DELETE CASCADE
);

CREATE TABLE s3_connection_tags (
	id SERIAL NOT NULL,
	s3_connection_id INTEGER NOT NULL,
	tag_definition_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_s3_connection_tag UNIQUE (s3_connection_id, tag_definition_id),
	FOREIGN KEY(s3_connection_id) REFERENCES s3_connections (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_definition_id) REFERENCES tag_definitions (id) ON DELETE CASCADE
);

CREATE TABLE oidc_login_states (
	state VARCHAR NOT NULL,
	provider VARCHAR NOT NULL,
	issuer VARCHAR,
	code_verifier VARCHAR NOT NULL,
	nonce VARCHAR,
	redirect_path VARCHAR,
	redirect_uri VARCHAR,
	browser_secret_hash VARCHAR,
	purpose VARCHAR DEFAULT 'login' NOT NULL,
	link_attempt_id VARCHAR,
	require_auth_time BOOLEAN DEFAULT '0' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (state),
	FOREIGN KEY(link_attempt_id) REFERENCES external_identity_link_attempts (id) ON DELETE CASCADE
);

CREATE TABLE cost_usage_daily (
	id SERIAL NOT NULL,
	day DATE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	bytes_in BIGINT DEFAULT '0' NOT NULL,
	bytes_out BIGINT DEFAULT '0' NOT NULL,
	ops_total BIGINT DEFAULT '0' NOT NULL,
	ops_breakdown JSON,
	source VARCHAR NOT NULL,
	collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_cost_usage_daily UNIQUE (day, storage_endpoint_id, s3_account_id, s3_user_id, source),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE cost_storage_daily (
	id SERIAL NOT NULL,
	day DATE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	total_bytes BIGINT DEFAULT '0' NOT NULL,
	total_objects BIGINT DEFAULT '0' NOT NULL,
	source VARCHAR NOT NULL,
	collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_cost_storage_daily UNIQUE (day, storage_endpoint_id, s3_account_id, s3_user_id, source),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE quota_usage_hourly (
	id SERIAL NOT NULL,
	hour_ts TIMESTAMP WITH TIME ZONE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	used_bytes BIGINT DEFAULT '0' NOT NULL,
	used_objects BIGINT DEFAULT '0' NOT NULL,
	bucket_count INTEGER,
	quota_size_bytes BIGINT,
	quota_objects BIGINT,
	usage_ratio_pct NUMERIC(8, 3),
	collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_quota_usage_hourly_subject_kind CHECK ((s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE quota_usage_daily (
	id SERIAL NOT NULL,
	day DATE NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	last_used_bytes BIGINT DEFAULT '0' NOT NULL,
	last_used_objects BIGINT DEFAULT '0' NOT NULL,
	bucket_count INTEGER,
	max_ratio_pct NUMERIC(8, 3),
	samples_count INTEGER DEFAULT '1' NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_quota_usage_daily_subject_kind CHECK ((s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE quota_alert_states (
	id SERIAL NOT NULL,
	storage_endpoint_id INTEGER NOT NULL,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	last_level VARCHAR DEFAULT 'normal' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_quota_alert_states_subject_kind CHECK ((s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)),
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE user_notifications (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	notification_type VARCHAR NOT NULL,
	severity VARCHAR NOT NULL,
	title VARCHAR NOT NULL,
	message TEXT NOT NULL,
	subject_type VARCHAR,
	storage_endpoint_id INTEGER,
	s3_account_id INTEGER,
	s3_user_id INTEGER,
	event_key VARCHAR NOT NULL,
	payload JSON DEFAULT '{}' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	read_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_notifications_user_event UNIQUE (user_id, event_key),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(storage_endpoint_id) REFERENCES storage_endpoints (id),
	FOREIGN KEY(s3_account_id) REFERENCES s3_accounts (id),
	FOREIGN KEY(s3_user_id) REFERENCES s3_users (id)
);

CREATE TABLE bucket_migrations (
	execution_auth_session_id VARCHAR,
	id SERIAL NOT NULL,
	created_by_user_id INTEGER,
	source_context_id VARCHAR NOT NULL,
	target_context_id VARCHAR NOT NULL,
	mode VARCHAR DEFAULT 'pre_sync' NOT NULL,
	copy_bucket_settings BOOLEAN DEFAULT '0' NOT NULL,
	strong_integrity_check BOOLEAN DEFAULT '0' NOT NULL,
	lock_target_writes BOOLEAN DEFAULT '1' NOT NULL,
	use_same_endpoint_copy BOOLEAN DEFAULT '0' NOT NULL,
	auto_grant_source_read_for_copy BOOLEAN DEFAULT '0' NOT NULL,
	status VARCHAR DEFAULT 'draft' NOT NULL,
	worker_lease_owner VARCHAR,
	worker_lease_until TIMESTAMP WITH TIME ZONE,
	precheck_report JSON,
	precheck_checked_at TIMESTAMP WITH TIME ZONE,
	workflow_version INTEGER DEFAULT '2' NOT NULL,
	configuration_revision INTEGER DEFAULT '1' NOT NULL,
	preparation_status VARCHAR DEFAULT 'unverified' NOT NULL,
	preparation_active_checks BOOLEAN DEFAULT '0' NOT NULL,
	preparation_completed_items INTEGER DEFAULT '0' NOT NULL,
	preparation_requested_at TIMESTAMP WITH TIME ZONE,
	maintenance_operation VARCHAR,
	maintenance_status VARCHAR DEFAULT 'idle' NOT NULL,
	maintenance_error TEXT,
	maintenance_requested_by_user_id INTEGER,
	parallelism_max INTEGER DEFAULT '16' NOT NULL,
	total_items INTEGER DEFAULT '0' NOT NULL,
	completed_items INTEGER DEFAULT '0' NOT NULL,
	failed_items INTEGER DEFAULT '0' NOT NULL,
	canceled_items INTEGER DEFAULT '0' NOT NULL,
	awaiting_items INTEGER DEFAULT '0' NOT NULL,
	error_message VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(execution_auth_session_id) REFERENCES auth_sessions (id) ON DELETE SET NULL,
	FOREIGN KEY(created_by_user_id) REFERENCES users (id),
	FOREIGN KEY(maintenance_requested_by_user_id) REFERENCES users (id)
);

CREATE TABLE portal_storage_space_metadata (
	id SERIAL NOT NULL,
	account_id INTEGER NOT NULL,
	bucket_name VARCHAR NOT NULL,
	display_name VARCHAR,
	description TEXT,
	owner_user_id INTEGER,
	visibility VARCHAR NOT NULL,
	share_scope VARCHAR NOT NULL,
	account_member_role VARCHAR,
	project_key VARCHAR,
	dataset_label VARCHAR,
	icon_source VARCHAR DEFAULT 'preset' NOT NULL,
	icon_preset VARCHAR DEFAULT 'bucket' NOT NULL,
	icon_image BYTEA,
	icon_content_type VARCHAR,
	icon_updated_at TIMESTAMP WITH TIME ZONE,
	origin VARCHAR NOT NULL,
	name_editable BOOLEAN NOT NULL,
	archived_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_portal_storage_space_metadata_account_bucket UNIQUE (account_id, bucket_name),
	CONSTRAINT ck_portal_storage_space_metadata_canonical_sharing CHECK ((visibility = 'private' AND share_scope = 'restricted' AND account_member_role IS NULL) OR (visibility = 'shared' AND ((share_scope = 'restricted' AND account_member_role IS NULL) OR (share_scope = 'account' AND account_member_role IS NOT NULL AND account_member_role IN ('Viewer', 'Editor'))))),
	CONSTRAINT ck_portal_storage_space_metadata_origin CHECK (origin IN ('portal_generic', 'portal_named', 'imported')),
	CONSTRAINT ck_portal_storage_space_metadata_icon_source CHECK (icon_source IN ('preset', 'uploaded')),
	CONSTRAINT ck_portal_storage_space_metadata_icon_preset CHECK (icon_preset IN ('bucket', 'folder', 'archive', 'database', 'media')),
	CONSTRAINT ck_portal_storage_space_metadata_icon_content_type CHECK (icon_content_type IS NULL OR icon_content_type IN ('image/jpeg', 'image/png')),
	CONSTRAINT ck_portal_storage_space_metadata_private_owner CHECK ((visibility = 'private' AND owner_user_id IS NOT NULL) OR (visibility = 'shared' AND owner_user_id IS NULL)),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(owner_user_id) REFERENCES users (id)
);

CREATE TABLE portal_public_links (
	id SERIAL NOT NULL,
	token VARCHAR NOT NULL,
	account_id INTEGER NOT NULL,
	bucket_name VARCHAR NOT NULL,
	object_key TEXT NOT NULL,
	label VARCHAR,
	created_by_user_id INTEGER,
	created_by_email VARCHAR,
	expires_at TIMESTAMP WITH TIME ZONE,
	revoked_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_portal_public_links_token UNIQUE (token),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE TABLE portal_iam_revocations (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	iam_user_id VARCHAR NOT NULL,
	iam_username VARCHAR,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_portal_iam_revocations_user_account UNIQUE (user_id, account_id),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE
);

CREATE TABLE portal_admin_requests (
	id SERIAL NOT NULL,
	account_id INTEGER NOT NULL,
	requester_user_id INTEGER,
	requester_email VARCHAR NOT NULL,
	request_type VARCHAR NOT NULL,
	status VARCHAR DEFAULT 'pending' NOT NULL,
	payload JSON NOT NULL,
	result JSON,
	error_message TEXT,
	decided_by_user_id INTEGER,
	decided_by_email VARCHAR,
	decided_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_portal_admin_requests_type CHECK (request_type IN ('portal_user_access', 'portal_user_removal', 'account_quota_change', 'portal_setting_change')),
	CONSTRAINT ck_portal_admin_requests_status CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'failed')),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(requester_user_id) REFERENCES users (id) ON DELETE SET NULL,
	FOREIGN KEY(decided_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE openstack_project_credentials (
	id VARCHAR NOT NULL,
	session_id VARCHAR NOT NULL,
	context_id VARCHAR NOT NULL,
	access_key VARCHAR NOT NULL,
	secret_key VARCHAR,
	validated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	can_manage_iam BOOLEAN DEFAULT '0' NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_openstack_project_credential UNIQUE (session_id, context_id),
	FOREIGN KEY(session_id) REFERENCES openstack_sessions (id) ON DELETE CASCADE,
	FOREIGN KEY(context_id) REFERENCES openstack_project_contexts (id) ON DELETE CASCADE
);

CREATE TABLE bucket_migration_items (
	id SERIAL NOT NULL,
	migration_id INTEGER NOT NULL,
	source_bucket VARCHAR NOT NULL,
	target_bucket VARCHAR NOT NULL,
	status VARCHAR DEFAULT 'pending' NOT NULL,
	step VARCHAR DEFAULT 'create_bucket' NOT NULL,
	pre_sync_done BOOLEAN DEFAULT '0' NOT NULL,
	read_only_applied BOOLEAN DEFAULT '0' NOT NULL,
	target_lock_applied BOOLEAN DEFAULT '0' NOT NULL,
	target_created_by_migration BOOLEAN DEFAULT '0' NOT NULL,
	preparation_effects JSON,
	source_deleted BOOLEAN DEFAULT '0' NOT NULL,
	cleanup_error TEXT,
	cleanup_verification JSON,
	objects_copied INTEGER DEFAULT '0' NOT NULL,
	objects_deleted INTEGER DEFAULT '0' NOT NULL,
	source_count INTEGER,
	target_count INTEGER,
	matched_count INTEGER,
	different_count INTEGER,
	only_source_count INTEGER,
	only_target_count INTEGER,
	diff_sample JSON,
	source_snapshot JSON,
	execution_strategy VARCHAR,
	replication_state JSON,
	source_policy_backup JSON,
	target_policy_backup JSON,
	error_message VARCHAR,
	started_at TIMESTAMP WITH TIME ZONE,
	finished_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_bucket_migration_items_source UNIQUE (migration_id, source_bucket),
	FOREIGN KEY(migration_id) REFERENCES bucket_migrations (id)
);

CREATE TABLE portal_storage_space_grants (
	id SERIAL NOT NULL,
	storage_space_metadata_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	role VARCHAR NOT NULL,
	created_by_user_id INTEGER,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_portal_storage_space_grants_space_user UNIQUE (storage_space_metadata_id, user_id),
	CONSTRAINT ck_portal_storage_space_grants_role CHECK (role IN ('Viewer', 'Editor')),
	FOREIGN KEY(storage_space_metadata_id) REFERENCES portal_storage_space_metadata (id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE TABLE portal_external_access_credentials (
	id SERIAL NOT NULL,
	account_id INTEGER NOT NULL,
	storage_space_metadata_id INTEGER NOT NULL,
	bucket_name VARCHAR NOT NULL,
	created_by_user_id INTEGER,
	external_email VARCHAR NOT NULL,
	permission VARCHAR NOT NULL,
	iam_user_id VARCHAR,
	iam_username VARCHAR NOT NULL,
	access_key_id VARCHAR NOT NULL,
	status VARCHAR DEFAULT 'Active' NOT NULL,
	revoked_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_portal_external_access_credentials_iam_username UNIQUE (iam_username),
	CONSTRAINT uq_portal_external_access_credentials_access_key UNIQUE (access_key_id),
	CONSTRAINT ck_portal_external_access_credentials_permission CHECK (permission IN ('read_only', 'read_write')),
	CONSTRAINT ck_portal_external_access_credentials_status CHECK (status IN ('Active', 'Inactive', 'RevocationPending')),
	FOREIGN KEY(account_id) REFERENCES s3_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(storage_space_metadata_id) REFERENCES portal_storage_space_metadata (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE portal_admin_request_messages (
	id SERIAL NOT NULL,
	request_id INTEGER NOT NULL,
	author_user_id INTEGER,
	author_email VARCHAR NOT NULL,
	author_role VARCHAR,
	message TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(request_id) REFERENCES portal_admin_requests (id) ON DELETE CASCADE,
	FOREIGN KEY(author_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE bucket_migration_events (
	id SERIAL NOT NULL,
	migration_id INTEGER NOT NULL,
	item_id INTEGER,
	level VARCHAR DEFAULT 'info' NOT NULL,
	message TEXT NOT NULL,
	metadata JSON,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(migration_id) REFERENCES bucket_migrations (id),
	FOREIGN KEY(item_id) REFERENCES bucket_migration_items (id)
);

CREATE INDEX ix_account_iam_users_account_user ON account_iam_users (account_id, user_id);

CREATE INDEX ix_account_iam_users_id ON account_iam_users (id);

CREATE INDEX ix_api_tokens_created_at ON api_tokens (created_at);

CREATE INDEX ix_api_tokens_id ON api_tokens (id);

CREATE INDEX ix_api_tokens_user_id ON api_tokens (user_id);

CREATE INDEX ix_audit_logs_context_kind_id_id ON audit_logs (context_kind, context_id, id);

CREATE INDEX ix_audit_logs_created_at ON audit_logs (created_at);

CREATE INDEX ix_audit_logs_id ON audit_logs (id);

CREATE INDEX ix_audit_logs_request_id ON audit_logs (request_id);

CREATE INDEX ix_audit_logs_scope_id ON audit_logs (scope, id);

CREATE INDEX ix_audit_logs_user_id_id ON audit_logs (user_id, id);

CREATE INDEX ix_audit_logs_user_role_id ON audit_logs (user_role, id);

CREATE INDEX ix_auth_challenges_binding_sid ON auth_challenges (binding_sid);

CREATE INDEX ix_auth_challenges_expires_at ON auth_challenges (expires_at);

CREATE INDEX ix_auth_challenges_purpose ON auth_challenges (purpose);

CREATE INDEX ix_auth_challenges_user_id ON auth_challenges (user_id);

CREATE INDEX ix_auth_rate_limits_bucket_key ON auth_rate_limits (bucket_key);

CREATE INDEX ix_auth_sessions_absolute_expires_at ON auth_sessions (absolute_expires_at);

CREATE INDEX ix_auth_sessions_idle_expires_at ON auth_sessions (idle_expires_at);

CREATE INDEX ix_auth_sessions_last_activity_at ON auth_sessions (last_activity_at);

CREATE INDEX ix_auth_sessions_revoked_at ON auth_sessions (revoked_at);

CREATE INDEX ix_auth_sessions_s3_session_id ON auth_sessions (s3_session_id);

CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);

CREATE INDEX ix_backend_operation_leases_lease_until ON backend_operation_leases (lease_until);

CREATE INDEX ix_browser_favorites_user_id ON browser_favorites (user_id);

CREATE INDEX ix_bucket_migration_events_created_at ON bucket_migration_events (created_at);

CREATE INDEX ix_bucket_migration_events_id ON bucket_migration_events (id);

CREATE INDEX ix_bucket_migration_events_item_created ON bucket_migration_events (item_id, created_at);

CREATE INDEX ix_bucket_migration_events_item_id ON bucket_migration_events (item_id);

CREATE INDEX ix_bucket_migration_events_migration_created ON bucket_migration_events (migration_id, created_at);

CREATE INDEX ix_bucket_migration_events_migration_id ON bucket_migration_events (migration_id);

CREATE INDEX ix_bucket_migration_items_created_at ON bucket_migration_items (created_at);

CREATE INDEX ix_bucket_migration_items_id ON bucket_migration_items (id);

CREATE INDEX ix_bucket_migration_items_migration_id ON bucket_migration_items (migration_id);

CREATE INDEX ix_bucket_migration_items_migration_status ON bucket_migration_items (migration_id, status);

CREATE INDEX ix_bucket_migration_items_status ON bucket_migration_items (status);

CREATE INDEX ix_bucket_migration_items_updated_at ON bucket_migration_items (updated_at);

CREATE INDEX ix_bucket_migrations_created_at ON bucket_migrations (created_at);

CREATE INDEX ix_bucket_migrations_created_by_user_id ON bucket_migrations (created_by_user_id);

CREATE INDEX ix_bucket_migrations_id ON bucket_migrations (id);

CREATE INDEX ix_bucket_migrations_preparation_status ON bucket_migrations (preparation_status);

CREATE INDEX ix_bucket_migrations_source_context_id ON bucket_migrations (source_context_id);

CREATE INDEX ix_bucket_migrations_source_target ON bucket_migrations (source_context_id, target_context_id);

CREATE INDEX ix_bucket_migrations_status ON bucket_migrations (status);

CREATE INDEX ix_bucket_migrations_status_created ON bucket_migrations (status, created_at);

CREATE INDEX ix_bucket_migrations_target_context_id ON bucket_migrations (target_context_id);

CREATE INDEX ix_bucket_migrations_updated_at ON bucket_migrations (updated_at);

CREATE INDEX ix_bucket_migrations_worker_lease ON bucket_migrations (worker_lease_until, status);

CREATE INDEX ix_bucket_migrations_worker_lease_owner ON bucket_migrations (worker_lease_owner);

CREATE INDEX ix_bucket_migrations_worker_lease_until ON bucket_migrations (worker_lease_until);

CREATE INDEX ix_bucket_ui_tag_assignments_bucket ON bucket_ui_tag_assignments (storage_endpoint_id, tenant_key, bucket_name);

CREATE INDEX ix_bucket_ui_tag_assignments_definition_endpoint ON bucket_ui_tag_assignments (tag_definition_id, storage_endpoint_id);

CREATE INDEX ix_bucket_usage_stats_calculated_at ON bucket_usage_stats_snapshots (calculated_at);

CREATE INDEX ix_bucket_usage_stats_scope ON bucket_usage_stats_snapshots (scope_kind, scope_id);

CREATE INDEX ix_bucket_usage_stats_snapshots_id ON bucket_usage_stats_snapshots (id);

CREATE INDEX ix_cost_endpoint_overrides_id ON cost_endpoint_overrides (id);

CREATE INDEX ix_cost_endpoint_overrides_storage_endpoint_id ON cost_endpoint_overrides (storage_endpoint_id);

CREATE INDEX ix_cost_storage_daily_day ON cost_storage_daily (day);

CREATE INDEX ix_cost_storage_daily_endpoint_day_account ON cost_storage_daily (storage_endpoint_id, day, s3_account_id);

CREATE INDEX ix_cost_storage_daily_endpoint_day_user ON cost_storage_daily (storage_endpoint_id, day, s3_user_id);

CREATE INDEX ix_cost_storage_daily_id ON cost_storage_daily (id);

CREATE INDEX ix_cost_storage_daily_s3_account_id ON cost_storage_daily (s3_account_id);

CREATE INDEX ix_cost_storage_daily_s3_user_id ON cost_storage_daily (s3_user_id);

CREATE INDEX ix_cost_storage_daily_storage_endpoint_id ON cost_storage_daily (storage_endpoint_id);

CREATE INDEX ix_cost_usage_daily_day ON cost_usage_daily (day);

CREATE INDEX ix_cost_usage_daily_endpoint_day_account ON cost_usage_daily (storage_endpoint_id, day, s3_account_id);

CREATE INDEX ix_cost_usage_daily_endpoint_day_user ON cost_usage_daily (storage_endpoint_id, day, s3_user_id);

CREATE INDEX ix_cost_usage_daily_id ON cost_usage_daily (id);

CREATE INDEX ix_cost_usage_daily_s3_account_id ON cost_usage_daily (s3_account_id);

CREATE INDEX ix_cost_usage_daily_s3_user_id ON cost_usage_daily (s3_user_id);

CREATE INDEX ix_cost_usage_daily_storage_endpoint_id ON cost_usage_daily (storage_endpoint_id);

CREATE INDEX ix_endpoint_health_checks_checked_at ON endpoint_health_checks (checked_at);

CREATE INDEX ix_endpoint_health_checks_endpoint_mode_checked ON endpoint_health_checks (storage_endpoint_id, check_mode, checked_at);

CREATE INDEX ix_endpoint_health_checks_id ON endpoint_health_checks (id);

CREATE INDEX ix_endpoint_health_checks_storage_endpoint_id ON endpoint_health_checks (storage_endpoint_id);

CREATE INDEX ix_endpoint_health_latest_checked_at ON endpoint_health_latest (checked_at);

CREATE INDEX ix_endpoint_health_latest_endpoint_type_scope_checked ON endpoint_health_latest (storage_endpoint_id, check_type, scope, checked_at);

CREATE INDEX ix_endpoint_health_latest_id ON endpoint_health_latest (id);

CREATE INDEX ix_endpoint_health_latest_storage_endpoint_id ON endpoint_health_latest (storage_endpoint_id);

CREATE INDEX ix_endpoint_health_latest_updated_at ON endpoint_health_latest (updated_at);

CREATE INDEX ix_endpoint_health_rollups_bucket_start ON endpoint_health_rollups (bucket_start);

CREATE INDEX ix_endpoint_health_rollups_endpoint_type_scope_res_bucket ON endpoint_health_rollups (storage_endpoint_id, check_type, scope, resolution_seconds, bucket_start);

CREATE INDEX ix_endpoint_health_rollups_id ON endpoint_health_rollups (id);

CREATE INDEX ix_endpoint_health_rollups_storage_endpoint_id ON endpoint_health_rollups (storage_endpoint_id);

CREATE INDEX ix_endpoint_health_rollups_updated_at ON endpoint_health_rollups (updated_at);

CREATE INDEX ix_endpoint_health_segments_endpoint_type_scope_ended ON endpoint_health_status_segments (storage_endpoint_id, check_type, scope, ended_at);

CREATE INDEX ix_endpoint_health_segments_endpoint_type_scope_started ON endpoint_health_status_segments (storage_endpoint_id, check_type, scope, started_at);

CREATE INDEX ix_endpoint_health_status_segments_ended_at ON endpoint_health_status_segments (ended_at);

CREATE INDEX ix_endpoint_health_status_segments_id ON endpoint_health_status_segments (id);

CREATE INDEX ix_endpoint_health_status_segments_started_at ON endpoint_health_status_segments (started_at);

CREATE INDEX ix_endpoint_health_status_segments_status ON endpoint_health_status_segments (status);

CREATE INDEX ix_endpoint_health_status_segments_storage_endpoint_id ON endpoint_health_status_segments (storage_endpoint_id);

CREATE INDEX ix_endpoint_health_status_segments_updated_at ON endpoint_health_status_segments (updated_at);

CREATE INDEX ix_endpoint_service_identities_endpoint_id ON endpoint_service_identities (endpoint_id);

CREATE INDEX ix_external_identities_email ON external_identities (email);

CREATE INDEX ix_external_identities_issuer ON external_identities (issuer);

CREATE INDEX ix_external_identities_revoked_at ON external_identities (revoked_at);

CREATE INDEX ix_external_identities_user_id ON external_identities (user_id);

CREATE INDEX ix_external_identity_link_attempts_consumed_at ON external_identity_link_attempts (consumed_at);

CREATE INDEX ix_external_identity_link_attempts_expires_at ON external_identity_link_attempts (expires_at);

CREATE INDEX ix_external_identity_link_attempts_status ON external_identity_link_attempts (status);

CREATE INDEX ix_external_identity_link_attempts_user_id ON external_identity_link_attempts (user_id);

CREATE INDEX ix_external_identity_link_requests_status ON external_identity_link_requests (status);

CREATE INDEX ix_external_identity_link_requests_user_id ON external_identity_link_requests (user_id);

CREATE INDEX ix_key_rotation_intents_endpoint_id ON key_rotation_intents (endpoint_id);

CREATE INDEX ix_ldap_providers_id ON ldap_providers (id);

CREATE INDEX ix_managed_private_accesses_id ON managed_private_accesses (id);

CREATE INDEX ix_managed_private_accesses_owner_user_id ON managed_private_accesses (owner_user_id);

CREATE INDEX ix_managed_private_accesses_s3_connection_id ON managed_private_accesses (s3_connection_id);

CREATE INDEX ix_manager_access_key_metadata_access_key ON manager_access_key_metadata (access_key_id);

CREATE INDEX ix_manager_access_key_metadata_expires_at ON manager_access_key_metadata (expires_at);

CREATE INDEX ix_manager_access_key_metadata_id ON manager_access_key_metadata (id);

CREATE INDEX ix_oidc_authorization_codes_expires_at ON oidc_authorization_codes (expires_at);

CREATE INDEX ix_oidc_authorization_codes_provider ON oidc_authorization_codes (provider);

CREATE INDEX ix_oidc_login_states_created_at ON oidc_login_states (created_at);

CREATE INDEX ix_oidc_login_states_link_attempt_id ON oidc_login_states (link_attempt_id);

CREATE INDEX ix_oidc_login_states_purpose ON oidc_login_states (purpose);

CREATE INDEX ix_oidc_login_states_state ON oidc_login_states (state);

CREATE INDEX ix_oidc_provider_issuer_pins_issuer ON oidc_provider_issuer_pins (issuer);

CREATE INDEX ix_oidc_providers_id ON oidc_providers (id);

CREATE INDEX ix_onboarding_journeys_user_id ON onboarding_journeys (user_id);

CREATE INDEX ix_openstack_connections_cloud_id ON openstack_connections (cloud_id);

CREATE INDEX ix_openstack_connections_user_id ON openstack_connections (user_id);

CREATE INDEX ix_openstack_project_contexts_connection_id ON openstack_project_contexts (connection_id);

CREATE INDEX ix_openstack_project_credentials_context_id ON openstack_project_credentials (context_id);

CREATE INDEX ix_openstack_project_credentials_session_id ON openstack_project_credentials (session_id);

CREATE INDEX ix_openstack_sessions_auth_session_id ON openstack_sessions (auth_session_id);

CREATE INDEX ix_openstack_sessions_connection_id ON openstack_sessions (connection_id);

CREATE INDEX ix_portal_admin_request_messages_author ON portal_admin_request_messages (author_user_id, created_at);

CREATE INDEX ix_portal_admin_request_messages_id ON portal_admin_request_messages (id);

CREATE INDEX ix_portal_admin_request_messages_request ON portal_admin_request_messages (request_id, created_at);

CREATE INDEX ix_portal_admin_requests_account_status ON portal_admin_requests (account_id, status, created_at);

CREATE INDEX ix_portal_admin_requests_id ON portal_admin_requests (id);

CREATE INDEX ix_portal_admin_requests_requester ON portal_admin_requests (requester_user_id, created_at);

CREATE INDEX ix_portal_admin_requests_status_created ON portal_admin_requests (status, created_at);

CREATE INDEX ix_portal_external_access_credentials_account ON portal_external_access_credentials (account_id);

CREATE INDEX ix_portal_external_access_credentials_creator ON portal_external_access_credentials (created_by_user_id);

CREATE INDEX ix_portal_external_access_credentials_id ON portal_external_access_credentials (id);

CREATE INDEX ix_portal_external_access_credentials_revoked ON portal_external_access_credentials (revoked_at);

CREATE INDEX ix_portal_external_access_credentials_space ON portal_external_access_credentials (storage_space_metadata_id);

CREATE INDEX ix_portal_iam_revocations_account ON portal_iam_revocations (account_id);

CREATE INDEX ix_portal_iam_revocations_id ON portal_iam_revocations (id);

CREATE INDEX ix_portal_iam_revocations_user ON portal_iam_revocations (user_id);

CREATE INDEX ix_portal_public_links_account_bucket ON portal_public_links (account_id, bucket_name);

CREATE INDEX ix_portal_public_links_expires ON portal_public_links (expires_at);

CREATE INDEX ix_portal_public_links_id ON portal_public_links (id);

CREATE INDEX ix_portal_storage_space_grants_id ON portal_storage_space_grants (id);

CREATE INDEX ix_portal_storage_space_grants_space ON portal_storage_space_grants (storage_space_metadata_id);

CREATE INDEX ix_portal_storage_space_grants_user ON portal_storage_space_grants (user_id);

CREATE INDEX ix_portal_storage_space_metadata_account ON portal_storage_space_metadata (account_id);

CREATE INDEX ix_portal_storage_space_metadata_id ON portal_storage_space_metadata (id);

CREATE INDEX ix_portal_storage_space_metadata_owner_user ON portal_storage_space_metadata (owner_user_id);

CREATE INDEX ix_quota_alert_states_endpoint_account ON quota_alert_states (storage_endpoint_id, s3_account_id);

CREATE INDEX ix_quota_alert_states_endpoint_user ON quota_alert_states (storage_endpoint_id, s3_user_id);

CREATE INDEX ix_quota_alert_states_id ON quota_alert_states (id);

CREATE INDEX ix_quota_alert_states_s3_account_id ON quota_alert_states (s3_account_id);

CREATE INDEX ix_quota_alert_states_s3_user_id ON quota_alert_states (s3_user_id);

CREATE INDEX ix_quota_alert_states_storage_endpoint_id ON quota_alert_states (storage_endpoint_id);

CREATE INDEX ix_quota_usage_daily_day ON quota_usage_daily (day);

CREATE INDEX ix_quota_usage_daily_endpoint_day_account ON quota_usage_daily (storage_endpoint_id, day, s3_account_id);

CREATE INDEX ix_quota_usage_daily_endpoint_day_user ON quota_usage_daily (storage_endpoint_id, day, s3_user_id);

CREATE INDEX ix_quota_usage_daily_id ON quota_usage_daily (id);

CREATE INDEX ix_quota_usage_daily_s3_account_id ON quota_usage_daily (s3_account_id);

CREATE INDEX ix_quota_usage_daily_s3_user_id ON quota_usage_daily (s3_user_id);

CREATE INDEX ix_quota_usage_daily_storage_endpoint_id ON quota_usage_daily (storage_endpoint_id);

CREATE INDEX ix_quota_usage_hourly_endpoint_hour_account ON quota_usage_hourly (storage_endpoint_id, hour_ts, s3_account_id);

CREATE INDEX ix_quota_usage_hourly_endpoint_hour_user ON quota_usage_hourly (storage_endpoint_id, hour_ts, s3_user_id);

CREATE INDEX ix_quota_usage_hourly_hour_ts ON quota_usage_hourly (hour_ts);

CREATE INDEX ix_quota_usage_hourly_id ON quota_usage_hourly (id);

CREATE INDEX ix_quota_usage_hourly_s3_account_id ON quota_usage_hourly (s3_account_id);

CREATE INDEX ix_quota_usage_hourly_s3_user_id ON quota_usage_hourly (s3_user_id);

CREATE INDEX ix_quota_usage_hourly_storage_endpoint_id ON quota_usage_hourly (storage_endpoint_id);

CREATE INDEX ix_recovery_codes_consumed_at ON recovery_codes (consumed_at);

CREATE INDEX ix_recovery_codes_user_id ON recovery_codes (user_id);

CREATE INDEX ix_refresh_tokens_auth_session_id ON refresh_tokens (auth_session_id);

CREATE INDEX ix_refresh_tokens_expires_at ON refresh_tokens (expires_at);

CREATE INDEX ix_refresh_tokens_family_id ON refresh_tokens (family_id);

CREATE INDEX ix_refresh_tokens_revoked_at ON refresh_tokens (revoked_at);

CREATE INDEX ix_s3_account_deletions_id ON s3_account_deletions (id);

CREATE INDEX ix_s3_account_import_intents_id ON s3_account_import_intents (id);

CREATE INDEX ix_s3_account_tags_account_position ON s3_account_tags (account_id, position);

CREATE INDEX ix_s3_account_tags_definition ON s3_account_tags (tag_definition_id);

CREATE INDEX ix_s3_accounts_id ON s3_accounts (id);

CREATE INDEX ix_s3_accounts_storage_endpoint ON s3_accounts (storage_endpoint_id);

CREATE INDEX ix_s3_connection_tags_connection_position ON s3_connection_tags (s3_connection_id, position);

CREATE INDEX ix_s3_connection_tags_definition ON s3_connection_tags (tag_definition_id);

CREATE INDEX ix_s3_connections_created_by_user_id ON s3_connections (created_by_user_id);

CREATE INDEX ix_s3_connections_id ON s3_connections (id);

CREATE INDEX ix_s3_connections_storage_endpoint_id ON s3_connections (storage_endpoint_id);

CREATE INDEX ix_s3_sessions_access_key_hash ON s3_sessions (access_key_hash);

CREATE INDEX ix_s3_sessions_id ON s3_sessions (id);

CREATE INDEX ix_s3_sessions_revoked_at ON s3_sessions (revoked_at);

CREATE INDEX ix_s3_user_deletions_id ON s3_user_deletions (id);

CREATE INDEX ix_s3_user_deletions_remote_completed ON s3_user_deletions (remote_completed);

CREATE INDEX ix_s3_user_import_intents_id ON s3_user_import_intents (id);

CREATE INDEX ix_s3_user_tags_definition ON s3_user_tags (tag_definition_id);

CREATE INDEX ix_s3_user_tags_user_position ON s3_user_tags (s3_user_id, position);

CREATE INDEX ix_s3_users_id ON s3_users (id);

CREATE INDEX ix_s3_users_storage_endpoint ON s3_users (storage_endpoint_id);

CREATE INDEX ix_storage_endpoint_tags_definition ON storage_endpoint_tags (tag_definition_id);

CREATE INDEX ix_storage_endpoint_tags_endpoint_position ON storage_endpoint_tags (storage_endpoint_id, position);

CREATE INDEX ix_storage_endpoints_id ON storage_endpoints (id);

CREATE INDEX ix_tag_definitions_domain_owner ON tag_definitions (domain_kind, owner_user_id);

CREATE INDEX ix_ui_group_s3_accounts_account_group ON ui_group_s3_accounts (account_id, group_id);

CREATE INDEX ix_ui_group_s3_accounts_id ON ui_group_s3_accounts (id);

CREATE INDEX ix_ui_group_s3_connections_connection_group ON ui_group_s3_connections (s3_connection_id, group_id);

CREATE INDEX ix_ui_group_s3_connections_id ON ui_group_s3_connections (id);

CREATE INDEX ix_ui_group_s3_users_id ON ui_group_s3_users (id);

CREATE INDEX ix_ui_group_s3_users_s3_user_group ON ui_group_s3_users (s3_user_id, group_id);

CREATE INDEX ix_ui_groups_id ON ui_groups (id);

CREATE INDEX ix_ui_groups_name ON ui_groups (name);

CREATE INDEX ix_user_notifications_created_at ON user_notifications (created_at);

CREATE INDEX ix_user_notifications_id ON user_notifications (id);

CREATE INDEX ix_user_notifications_notification_type ON user_notifications (notification_type);

CREATE INDEX ix_user_notifications_s3_account_id ON user_notifications (s3_account_id);

CREATE INDEX ix_user_notifications_s3_user_id ON user_notifications (s3_user_id);

CREATE INDEX ix_user_notifications_storage_endpoint_id ON user_notifications (storage_endpoint_id);

CREATE INDEX ix_user_notifications_subject_account ON user_notifications (s3_account_id, created_at);

CREATE INDEX ix_user_notifications_subject_s3_user ON user_notifications (s3_user_id, created_at);

CREATE INDEX ix_user_notifications_user_created ON user_notifications (user_id, created_at);

CREATE INDEX ix_user_notifications_user_id ON user_notifications (user_id);

CREATE INDEX ix_user_notifications_user_read ON user_notifications (user_id, read_at);

CREATE INDEX ix_user_s3_accounts_account_user ON user_s3_accounts (account_id, user_id);

CREATE INDEX ix_user_s3_accounts_id ON user_s3_accounts (id);

CREATE INDEX ix_user_s3_connections_connection_user ON user_s3_connections (s3_connection_id, user_id);

CREATE INDEX ix_user_s3_connections_id ON user_s3_connections (id);

CREATE INDEX ix_user_s3_users_id ON user_s3_users (id);

CREATE INDEX ix_user_s3_users_s3_user_user ON user_s3_users (s3_user_id, user_id);

CREATE INDEX ix_user_ui_groups_group_user ON user_ui_groups (group_id, user_id);

CREATE INDEX ix_user_ui_groups_id ON user_ui_groups (id);

CREATE INDEX ix_users_id ON users (id);

CREATE INDEX ix_webauthn_credentials_revoked_at ON webauthn_credentials (revoked_at);

CREATE INDEX ix_webauthn_credentials_user_id ON webauthn_credentials (user_id);

CREATE INDEX ix_webhook_deliveries_created_at ON webhook_deliveries (created_at);

CREATE INDEX ix_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at, id);

CREATE INDEX ix_webhook_deliveries_endpoint_created ON webhook_deliveries (endpoint_id, created_at, id);

CREATE INDEX ix_webhook_deliveries_endpoint_id ON webhook_deliveries (endpoint_id);

CREATE INDEX ix_webhook_deliveries_event ON webhook_deliveries (event_id, endpoint_id);

CREATE INDEX ix_webhook_deliveries_event_id ON webhook_deliveries (event_id);

CREATE INDEX ix_webhook_deliveries_event_type ON webhook_deliveries (event_type);

CREATE INDEX ix_webhook_deliveries_id ON webhook_deliveries (id);

CREATE INDEX ix_webhook_deliveries_next_attempt_at ON webhook_deliveries (next_attempt_at);

CREATE INDEX ix_webhook_deliveries_status ON webhook_deliveries (status);

CREATE INDEX ix_webhook_endpoint_subscriptions_endpoint_id ON webhook_endpoint_subscriptions (endpoint_id);

CREATE INDEX ix_webhook_endpoint_subscriptions_id ON webhook_endpoint_subscriptions (id);

CREATE INDEX ix_webhook_endpoints_enabled_id ON webhook_endpoints (enabled, id);

CREATE INDEX ix_webhook_endpoints_id ON webhook_endpoints (id);

CREATE INDEX ix_webhook_subscriptions_event_endpoint ON webhook_endpoint_subscriptions (event_type, endpoint_id);

CREATE UNIQUE INDEX ix_api_tokens_jti ON api_tokens (jti);

CREATE UNIQUE INDEX ix_api_tokens_token_hash ON api_tokens (token_hash);

CREATE UNIQUE INDEX ix_oidc_authorization_codes_code_hash ON oidc_authorization_codes (code_hash);

CREATE UNIQUE INDEX ix_refresh_tokens_token_hash ON refresh_tokens (token_hash);

CREATE UNIQUE INDEX ix_webauthn_credentials_credential_id ON webauthn_credentials (credential_id);

CREATE UNIQUE INDEX uq_cost_storage_daily_account ON cost_storage_daily (day, storage_endpoint_id, s3_account_id, source) WHERE s3_account_id IS NOT NULL AND s3_user_id IS NULL;

CREATE UNIQUE INDEX uq_cost_storage_daily_user ON cost_storage_daily (day, storage_endpoint_id, s3_user_id, source) WHERE s3_user_id IS NOT NULL AND s3_account_id IS NULL;

CREATE UNIQUE INDEX uq_cost_usage_daily_account ON cost_usage_daily (day, storage_endpoint_id, s3_account_id, source) WHERE s3_account_id IS NOT NULL AND s3_user_id IS NULL;

CREATE UNIQUE INDEX uq_cost_usage_daily_user ON cost_usage_daily (day, storage_endpoint_id, s3_user_id, source) WHERE s3_user_id IS NOT NULL AND s3_account_id IS NULL;

CREATE UNIQUE INDEX uq_external_identity_ldap_provider_subject ON external_identities (provider_id, subject) WHERE provider_type = 'ldap';

CREATE UNIQUE INDEX uq_external_identity_oidc_issuer_subject ON external_identities (issuer, subject) WHERE provider_type = 'oidc';

CREATE UNIQUE INDEX uq_external_link_request_ldap_provider_subject ON external_identity_link_requests (provider_id, subject) WHERE provider_type = 'ldap';

CREATE UNIQUE INDEX uq_external_link_request_oidc_issuer_subject ON external_identity_link_requests (issuer, subject) WHERE provider_type = 'oidc';

CREATE UNIQUE INDEX uq_managed_private_access_active_source ON managed_private_accesses (owner_user_id, source_context_type, source_context_id) WHERE state IN ('provisioning', 'active', 'deleting', 'cleanup_pending');

CREATE UNIQUE INDEX uq_quota_alert_states_account ON quota_alert_states (storage_endpoint_id, s3_account_id) WHERE s3_account_id IS NOT NULL AND s3_user_id IS NULL;

CREATE UNIQUE INDEX uq_quota_alert_states_user ON quota_alert_states (storage_endpoint_id, s3_user_id) WHERE s3_user_id IS NOT NULL AND s3_account_id IS NULL;

CREATE UNIQUE INDEX uq_quota_usage_daily_account ON quota_usage_daily (day, storage_endpoint_id, s3_account_id) WHERE s3_account_id IS NOT NULL AND s3_user_id IS NULL;

CREATE UNIQUE INDEX uq_quota_usage_daily_user ON quota_usage_daily (day, storage_endpoint_id, s3_user_id) WHERE s3_user_id IS NOT NULL AND s3_account_id IS NULL;

CREATE UNIQUE INDEX uq_quota_usage_hourly_account ON quota_usage_hourly (hour_ts, storage_endpoint_id, s3_account_id) WHERE s3_account_id IS NOT NULL AND s3_user_id IS NULL;

CREATE UNIQUE INDEX uq_quota_usage_hourly_user ON quota_usage_hourly (hour_ts, storage_endpoint_id, s3_user_id) WHERE s3_user_id IS NOT NULL AND s3_account_id IS NULL;

CREATE UNIQUE INDEX uq_s3_connections_private_creator_name ON s3_connections (created_by_user_id, name) WHERE is_shared = false;

CREATE UNIQUE INDEX uq_s3_connections_shared_name ON s3_connections (name) WHERE is_shared = true;

CREATE UNIQUE INDEX uq_tag_definitions_bucket_ui_ceph_admin_label ON tag_definitions (label_key) WHERE domain_kind = 'bucket_ui_ceph_admin';

CREATE UNIQUE INDEX uq_tag_definitions_domain_global_label ON tag_definitions (domain_kind, label_key) WHERE owner_user_id IS NULL;

CREATE UNIQUE INDEX uq_tag_definitions_domain_owner_label ON tag_definitions (domain_kind, owner_user_id, label_key) WHERE owner_user_id IS NOT NULL;
