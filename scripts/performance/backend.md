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

Workloads: `read` lists 30 notes; `search` performs hybrid library search; `recall`
ranks exact vector and lexical candidates through the REST recall route; `mixed`
uses 75% lists, 20% searches and 5% saves; `chat` uses actual conversation turns
with two synthetic generation calls. `--embedding`/`--generation` set fixture
latency in milliseconds. Chat has the normal one-turn-per-conversation rule and
100-turn lifetime; select accounts/rate/duration accordingly and inspect every
status. Rate limits are real and remain visible in the report.

`--query` selects lexical input; `--query-seed 999` selects an unmatched dense
query vector (seed1 matches one eighth of fixture vectors). Combine them to
exercise empty full-vector scans. `--explain` captures actual recall SQL and runs
`EXPLAIN (ANALYZE, BUFFERS)` using the non-owner role and tenant authorization;
large synthetic vector expressions are abbreviated in the JSON report.

The open-loop generator offers `--rate` operations per second independently of
response time. Its `--concurrency` safety ceiling reports dropped arrivals instead
of silently slowing down. Scheduled latency includes generator scheduling lag.
Reports include HTTP status distribution, SQL/query-count scaling, pool pressure,
pool acquisition/hold and SQL duration (last20,000 samples), sampled database lock
waits, per-operation successful p95, event-loop delay, CPU and peak sampled RSS.
The API/load generator share
a process. Database CPU/memory/network constraints must be recorded separately;
loopback timings are not production capacity or cloud-auth/provider qualification.
The fixture verifier replaces only token cryptography/provider verification;
ordinary database authentication and service authorization still run.

`--worker 4` runs the shipped PostgreSQL fallback batch loop with its normal
one-second idle wait, using a separate non-owner worker pool. The report includes
jobs handled, peak/remaining backlog, failed jobs and observed provider concurrency.
Synthetic relationship providers abstain; the fixture qualifies scheduling and
contention, not inference quality. `--provider-failure-every 5` injects retryable
provider faults. With the default `--worker 0`, mixed traffic measures only durable
save acceptance. Queue-processing owns qualification of its new lanes, broker,
exports and cross-replica provider fairness. Use a fixed clean source/configuration and representative independent
accounts for before/after comparisons; test single-account bursts separately.
Never run fixture setup or destructive load against an application database.
