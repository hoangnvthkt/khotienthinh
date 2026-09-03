-- The Edge worker calls public RPC wrappers as service_role. PostgreSQL also
-- requires USAGE on the referenced private schema while resolving those
-- wrappers; no table or private-function privilege is granted here.
grant usage on schema app_private to service_role;
