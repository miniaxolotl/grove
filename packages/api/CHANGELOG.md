# Changelog

## [1.0.0](https://github.com/miniaxolotl/grove/compare/grove-server-v0.1.0...grove-server-v1.0.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* replace the direct Qdrant server and legacy graph tools with authenticated PostgreSQL-backed remember, recall, memories and forget. Existing installations require explicit ownership-mapped import and new agent setup.

### Features

* consolidate private memory on PostgreSQL ([707eb0c](https://github.com/miniaxolotl/grove/commit/707eb0c7302c7ea0e9d4c6371e039dae211a5476))
* private PostgreSQL memory, Clerk dashboard and agent integrations ([6664f51](https://github.com/miniaxolotl/grove/commit/6664f51891ccaba9c6fdc547a2a3b79467518d09))


### Bug Fixes

* validate fresh database bootstrap and resource-based website auth ([83d312c](https://github.com/miniaxolotl/grove/commit/83d312c368f7752558f6d2f6269b86392028d824))
