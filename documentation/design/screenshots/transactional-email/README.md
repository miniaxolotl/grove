# Transactional email previews

Synthetic letters from the worker's HTML renderer. The preview banner distinguishes these samples from real account events. Captured in Chromium at 390 px (export and deletion) and 620 px (welcome and connections); inbox clients may render them differently.

Source: `packages/api/src/email-template.ts` at `c964c8ad`. Rendered with
`node scripts/testing/email-previews.mjs render DIRECTORY` and captured locally
with images disabled by design (the letters use no remote assets). These are
light-mode browser renders, not Gmail/Outlook compatibility or delivery evidence.

| Export ready | Deletion requested |
| --- | --- |
| ![Download deadline and sign-in link](export_ready.png) | ![Deletion request with public support link](deletion_requested.png) |

| Welcome | Connection approved | Connection revoked |
| --- | --- | --- |
| ![Welcome and open Grove action](welcome.png) | ![Access approval and review action](connection_approved.png) | ![Revocation and review action](connection_revoked.png) |
