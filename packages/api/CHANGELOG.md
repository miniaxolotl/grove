# Changelog

## [1.1.0](https://github.com/miniaxolotl/grove/compare/grove-server-v1.0.0...grove-server-v1.1.0) (2026-10-20)


### Features

* add configurable model providers and organized memory ([2dd2c90](https://github.com/miniaxolotl/grove/commit/2dd2c9019475449ae27c527dad1d5d59e80a3e69))
* add guided Grove Cloud agent onboarding ([b3870d4](https://github.com/miniaxolotl/grove/commit/b3870d4cd3ddca934631972885a94e6b4fcec37b))
* notebook workspace, cited chat and configurable models ([fb42885](https://github.com/miniaxolotl/grove/commit/fb4288528a492ade9aada20cf8f007da22f88f0a))
* notebook, journal, cited chat and background services ([1912179](https://github.com/miniaxolotl/grove/commit/191217930113564db551baf5fbc8d1fde08d56d9))
* seamless Grove Cloud account and agent onboarding ([6f45c48](https://github.com/miniaxolotl/grove/commit/6f45c4842ceeed193232012a27fac5f9d769eabf))

## [1.0.0](https://github.com/miniaxolotl/grove/compare/grove-server-v0.1.0...grove-server-v1.0.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* replace the direct Qdrant server and legacy graph tools with authenticated PostgreSQL-backed remember, recall, memories and forget. Existing installations require explicit ownership-mapped import and new agent setup.

### Features

* consolidate private memory on PostgreSQL ([707eb0c](https://github.com/miniaxolotl/grove/commit/707eb0c7302c7ea0e9d4c6371e039dae211a5476))
* private PostgreSQL memory, Clerk dashboard and agent integrations ([6664f51](https://github.com/miniaxolotl/grove/commit/6664f51891ccaba9c6fdc547a2a3b79467518d09))


### Bug Fixes

* validate fresh database bootstrap and resource-based website auth ([83d312c](https://github.com/miniaxolotl/grove/commit/83d312c368f7752558f6d2f6269b86392028d824))
