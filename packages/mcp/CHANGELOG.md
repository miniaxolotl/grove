# @miniaxolotl/grove

## [0.3.0](https://github.com/miniaxolotl/grove/compare/grove-v0.2.8...grove-v0.3.0) (2026-04-26)


### Features

* add Grove Deployment Guide and update plugin configurations ([c8351ea](https://github.com/miniaxolotl/grove/commit/c8351ea074148d584eabdee5287c4835e0613c20))
* add homepage field to package.json for better project visibility ([26b3ca9](https://github.com/miniaxolotl/grove/commit/26b3ca97fac0e9525c9868fde7eb3ec5e03e093b))
* add shared library dependency to Grove OpenCode Plugin and MCP package ([3b7fd9e](https://github.com/miniaxolotl/grove/commit/3b7fd9e986b70212a40180adfc85e5a4b831fcd5))
* add updateMemory method to MCPClient and refactor importance decay logic ([ff206a4](https://github.com/miniaxolotl/grove/commit/ff206a4c127a10a3cc678a2fa107c1d90669d967))
* add validation for configuration values and improve error handling in repository methods ([563c9ad](https://github.com/miniaxolotl/grove/commit/563c9ad77a444295c4a00a6dcff9e090f2703147))
* add warmup function to initialize local embedder in embedding service ([b927acc](https://github.com/miniaxolotl/grove/commit/b927acc5ba351901a963ba91aaa38ef60e317a1e))
* bump version to 0.2.4 in package.json ([8a90f06](https://github.com/miniaxolotl/grove/commit/8a90f06685c599d24624241644c8d8ba41a92067))
* enhance collection initialization to include index fields for entities, memories, and relations ([d86f894](https://github.com/miniaxolotl/grove/commit/d86f8948c8a66110aa65f3d3683597f8a24d682c))
* implement graceful shutdown and logging for server initialization and index creation ([bd0244d](https://github.com/miniaxolotl/grove/commit/bd0244de3a520686ba6088fcfe2fac2b80ee678c))
* implement memory and relation repositories with Qdrant integration ([660a718](https://github.com/miniaxolotl/grove/commit/660a718769a293726da46534cf3bcf82aebc5e2d))
* **mcp:** add memory management tools and refactor repository methods ([70753f0](https://github.com/miniaxolotl/grove/commit/70753f054e54e6627b17651fc32b9392b7f50288))
* update README files with additional badges for npm, Docker Hub, GHCR, and License ([dac3c3e](https://github.com/miniaxolotl/grove/commit/dac3c3ec3e9af1e07a633e13902db39633ef6424))
* update release and deploy scripts for improved version handling and GitHub release creation ([b84a7f7](https://github.com/miniaxolotl/grove/commit/b84a7f77fcabbc5b76f15ad3d7f351a2ed18136d))


### Bug Fixes

* enhance deleteEntities function to handle empty filter case ([081ee47](https://github.com/miniaxolotl/grove/commit/081ee470a4ad538b5391e52f2f7a4625468d105e))
* revert version number in root package.json and update mcp package version to 0.2.3 ([c562e1e](https://github.com/miniaxolotl/grove/commit/c562e1e04a05efac5f29cbfa41f79b1379b64499))
* update condition to check for text updates in updateMemory function ([2a36917](https://github.com/miniaxolotl/grove/commit/2a3691780f073386a71be99eb8e3797f81e85b83))
* update eslint.config.js references from @grove/eslint-config to @lib/eslint-config ([d13e280](https://github.com/miniaxolotl/grove/commit/d13e280cdc4da96bbd6b307a5e0c618bef7b1a8e))
* update remaining @grove/mcp references to @miniaxolotl/grove ([a6e67ec](https://github.com/miniaxolotl/grove/commit/a6e67ec97521c3e4f28b9e687f1065b6e4d0faff))
* update version to 0.2.5 in package.json ([27e7079](https://github.com/miniaxolotl/grove/commit/27e7079ca890456de46f95507a6039e2d71752f5))


### Code Refactoring

* rename internal packages to @script/* and @lib/* ([0ab2ceb](https://github.com/miniaxolotl/grove/commit/0ab2ceb5b9cc28da185276f2849afe32a583feff))

## 0.2.8 (2026-04-25)

### Features

- CLI binary for global install (`grove serve`)
- Release-please automated versioning and releases
- Docker images pushed to GHCR and Docker Hub via CI

### Bug Fixes

- Dockerfile base image label corrected to node:24
- Removed stale changeset references from workflows
- Removed scripts/release directory

### Documentation

- Updated README with npm/pnpm/bun install instructions
- Updated server documentation with correct ports and env vars
- Added deployment and release guide
