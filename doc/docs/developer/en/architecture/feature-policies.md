# Feature policy configuration

`AppSettings.manager.feature_policies` and `AppSettings.portal.feature_policies`
store typed `disabled`, `targeted` and `default_on` policies. These replace the
feature-specific General/Portal booleans; workspace switches and creation defaults
keep their existing contracts. `resolve_feature_policy` resolves only configuration,
never storage authorization. Existing access, capability and execution services
remain authoritative and use the same resolution for catalogues and operations.

Account/RGW User override columns are nullable booleans. Missing update fields
are unchanged, explicit `null` restores inheritance, and booleans are explicit
choices. Portal retains its single Account JSON override and delegation model.
New activations under a platform prohibition are rejected; unchanged historical
activations can be retained while their effective value stays disabled.

`EffectiveAccessService` adds platform Tool/provisioning grants for eligible UI
roles in `default_on` mode. Direct and Group grants still add together. A false
direct field is not a denial. Effective access auditing includes `platform`
alongside `direct` and `group` sources.

The authenticated `/settings/general` API is a read-only availability projection
with `manager_feature_policies`; it is not the persisted General configuration.
Manager context and Portal settings expose effective values, source and refusal
metadata. Projection booleans must never be written back as configuration.

Migration `0148_feature_policies` converts only the `default` AppSetting row,
preserves all existing resource booleans and removes their defaults for future
rows. Manager true/false settings become targeted/disabled; Portal true/false
defaults become default_on/targeted. Legacy bootstrap JSON is converted when
imported, then saved canonically. Normal database reads do not run compatibility
conversion. Backend and bundled frontend must be upgraded together.

An older version cannot express inheritance or Portal prohibitions. Downgrade
conservatively converts inherited resource values to explicit false and loses
policy semantics. For a faithful rollback, restore the pre-upgrade database
backup rather than relying on schema downgrade to preserve behavior.

The configuration editor reuses compact settings tokens. Help tooltips use a
shared primitive extracted from dashboard information, preserving its hover,
focus, pin, dismissal and viewport-positioning behavior. Essential applied values,
errors and blockers remain outside tooltips.
