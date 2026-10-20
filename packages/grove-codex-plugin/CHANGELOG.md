# Changelog

## [1.1.0](https://github.com/miniaxolotl/grove/compare/grove-codex-plugin-v1.0.0...grove-codex-plugin-v1.1.0) (2026-10-20)


### Features

* add guided Grove Cloud agent onboarding ([b3870d4](https://github.com/miniaxolotl/grove/commit/b3870d4cd3ddca934631972885a94e6b4fcec37b))
* seamless Grove Cloud account and agent onboarding ([6f45c48](https://github.com/miniaxolotl/grove/commit/6f45c4842ceeed193232012a27fac5f9d769eabf))

## [1.0.0](https://github.com/miniaxolotl/grove/compare/grove-codex-plugin-v0.1.0...grove-codex-plugin-v1.0.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* replace the direct Qdrant server and legacy graph tools with authenticated PostgreSQL-backed remember, recall, memories and forget. Existing installations require explicit ownership-mapped import and new agent setup.

### Features

* consolidate private memory on PostgreSQL ([707eb0c](https://github.com/miniaxolotl/grove/commit/707eb0c7302c7ea0e9d4c6371e039dae211a5476))
* private PostgreSQL memory, Clerk dashboard and agent integrations ([6664f51](https://github.com/miniaxolotl/grove/commit/6664f51891ccaba9c6fdc547a2a3b79467518d09))
