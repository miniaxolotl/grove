# Backend capacity measurements

`pnpm perf:backend` runs the real Hono HTTP routes, PostgreSQL authorization/RLS,
and an official-SDK MCP recall preflight. It creates a uniquely named disposable
database, migrates it, seeds dense 4,096-dimensional vectors and ready enrichment,
then drops only that owned database after closing connections. First bootstrap
the disposable server's runtime roles as described in `documentation/development/testing.md`.
All three `TEST_*DATABASE_URL` variables must identify the same `_test` database.

```sh
pnpm perf:backend --accounts 20 --notes 100 --rate 10 --seconds 30 --output /absolute/path/baseline.json
pnpm perf:backend --accounts 100 --notes 1000 --rate 50 --seconds 60 --workload search
pnpm perf:backend --accounts 20 --notes 100 --rate 10 --seconds 30 --workload mixed
```

Workloads: `read` lists 30 notes; `search` performs hybrid library search; `mixed`
uses 75% lists, 20% searches and 5% saves; `chat` uses actual conversation turns
with two synthetic generation calls. `--embedding`/`--generation` set fixture
latency in milliseconds. Chat has the normal one-turn-per-conversation rule and
100-turn lifetime; select accounts/rate/duration accordingly and inspect every
status. Rate limits are real and remain visible in the report.

The open-loop generator offers `--rate` operations per second independently of
response time. Its `--concurrency` safety ceiling reports dropped arrivals instead
of silently slowing down. Scheduled latency includes generator scheduling lag.
Reports include HTTP status distribution, SQL/query-count scaling, pool pressure,
event-loop delay, process CPU and peak sampled RSS. The API/load generator share
a process. Database CPU/memory/network constraints must be recorded separately;
loopback timings are not production capacity or cloud-auth/provider qualification.
The fixture verifier replaces only token cryptography/provider verification;
ordinary database authentication and service authorization still run.

The worker is not running in this initial harness: mixed traffic measures durable
save acceptance and reports resulting jobs, not sustainable end-to-end indexing.
Queue-processing's worker-lane integration supplies processing contention/fairness
qualification. Use a fixed source/configuration and representative independent
accounts for before/after comparisons; test single-account bursts separately.
Never run fixture setup or destructive load against an application database.
