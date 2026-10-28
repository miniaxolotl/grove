# Grove documentation

This directory describes **current source behavior**, not what is deployed. Use a
topic guide for its contract, limits, rollout and verification. Source files and
executable tests resolve implementation details; release evidence establishes live
acceptance. [Dated records](archive/README.md) must not be treated as current status.

## Use Grove

- [Workspace and writing](workspace.md) · [notebook organization](notebook-organization.md)
  · [archive and deletion](notebook-lifecycle.md)
- [Agent installation](client.md) · [Cloud connection flow](cloud-onboarding.md)
  · [ChatGPT and Claude web](hosted-chat.md) · [social sign-in](social-sign-in.md)
- [Ask tools](ask-tools.md) · [selected sources](explicit-context.md)
  · [search](search.md) · [notebook assistance](notebook-assistance.md)
- [Document imports and Ask attachments](imports.md) · [files and storage](files-storage.md)
- [Images and durable media](media.md) · [recordings](recordings.md)
  · [transcription and read aloud](speech.md) · [public sharing](sharing.md)
- [Billing and allowances](billing.md) · [administration](system-administration.md)
  · [usage reports](admin-usage-reports.md) · [support and contact](website-support-contact.md)

## Build and operate

- [Tools, authentication and API](server.md) · [agent note-writing contract](agent-note-writing.md)
- [Models and preferences](models.md) · [relationships](relationships.md)
  · [AI caching](ai-caching.md) · [background jobs](jobs.md)
  · [broker and account email](background-services.md)
- [Deployment and recovery](deploy.md) · [schema upgrades](operations/schema.md)
  · [legacy data import](migration.md)
- [Testing](development/testing.md) · [capacity](development/backend-capacity.md)
  · [client cache](development/client-cache.md) · [interaction invariants](development/stable-interactions.md)
  · [note context actions](note-context-actions.md) · [product copy](development/product-copy.md)
- [Release/contribution rules](release-conventions.md) · [CI/CD](pipeline-conventions.md)
  · [observability](product-observability.md) · [advertising conversions](advertising-conversions.md)
- [Public reference publishing](website-discovery.md) · [website design](website-marketing-05.md)
  · [identity](design/grove-sprout.md)

## Maintain the source of truth

[Documentation maintenance](development/documentation.md) defines topic ownership,
validation and how to avoid shared-file conflicts. [Delivery and evidence](delivery.md)
defines what belongs in PRs, galleries and dated evaluation reports.

Do not add a progress entry here for every PR. Edit this index only when navigation
changes. Topic guides own their details; indexes link rather than repeat them.
