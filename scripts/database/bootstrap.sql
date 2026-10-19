-- Run once with the migration owner after migrations. Supply passwords with
-- psql variables; never commit or pass production passwords on the command line.
CREATE USER grove_api WITH PASSWORD :'api_password' NOSUPERUSER NOBYPASSRLS;
CREATE USER grove_jobs WITH PASSWORD :'worker_password' NOSUPERUSER NOBYPASSRLS;
GRANT grove_runtime TO grove_api;
GRANT grove_worker TO grove_jobs;
