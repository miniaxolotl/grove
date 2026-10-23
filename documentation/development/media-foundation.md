# Private image foundation (in development)

The first Images increment implements storage/validation primitives only. It does
**not** enable uploads, render images, add media tables or change public sharing.
`MEDIA_STORAGE` defaults to `disabled`; the API/worker do not call the new factory
yet. Setting these variables alone enables no feature and provisions no resources.
See the [media plan](media-plan.md) for the remaining image, recording and speech gates.

## Data and limits

- `@lib/shared/media` defines canonical lower-case `grove-media:<UUID>` references
  and generated `media/<account UUID>/<attachment UUID>/<object UUID>` storage keys.
  The last ID identifies one immutable write attempt. References are identifiers,
  **not capabilities**; the storage adapter performs no tenant authorization.
- `verifyImage()` reads actual stream bytes with cancellation and a **10 MiB** cap,
  then checks signatures/MIME and fully decodes static PNG, JPEG or WebP using
  pinned sharp 0.35.5. Limits are **24 million decoded pixels** and **10,000 pixels
  per dimension**. Active SVG/HTML, unsupported containers, animation, malformed
  or truncated images are rejected. Metadata inspection alone is insufficient.
- Originals, including EXIF and other metadata, are preserved byte-for-byte with
  a SHA-256 digest; they are not silently scrubbed or re-encoded. Future upload and
  sharing UX must disclose that metadata can be shared/exported. Decoder results
  cancelled during native processing are discarded when decoding settles.
- The bounded input is buffered for native decoding. The future HTTP path must
  acquire bounded upload/decoder admission **before** entering verification, cap
  received bytes through every hop, reserve tenant quota and retain the ordinary
  API's 128 KiB JSON cap. These primitives are not a replacement for those controls.
  Input collection uses a fixed-capacity buffer, not a retained list of arbitrary
  stream fragments. A one-million-fragment regression runs in an isolated GC-enabled
  process and bounds retained JavaScript heap independently of decoder/RSS timing.

## Durable storage

`MediaStore` deliberately exposes no deletion method. It must not be passed to
export cleanup, cache expiry or retained-account cleanup. The calling service will
need transactional revision bindings and retry/lease checks before storing or
reading authored media. None of those bindings is implemented in this increment.

The local adapter uses a trusted private persistent root (0700 directories/0600
files). It rejects symlink components, non-private directories and non-canonical
keys, opens files with `O_NOFOLLOW`, and publishes with a no-overwrite hard link
rather than rename. Concurrent same-key publication has one winner. Successful
writes fsync file bytes; full power-loss/filesystem durability is not qualified.
Errors/cancellation remove the attempt's temporary file. Process-crash `.partial`
reconciliation remains a future tracked-staging responsibility, not permission to
delete final source files. The service's OS user and storage ancestors are trusted;
these checks are not a sandbox against a hostile process with the same privileges.

The S3 adapter writes exact validated buffers with verified MIME, length, checksum
metadata, `private, no-store` and `If-None-Match: *`. No public/presigned URL is
returned. Bucket privacy must be configured and independently verified by the
operator; `ready()` is not proof against every public bucket policy.

Readiness checks bucket access and lifecycle, rejecting enabled expiration or
noncurrent-version expiration rules. It also tests conditional writes using one
unique **`media-probes/` scratch object**, then deletes only that object. A second
write must fail with HTTP 412. Providers that silently ignore the condition,
deny lifecycle inspection or cannot perform the probe fail closed. This requires
separate IAM permissions for bucket HEAD/lifecycle inspection, media GET/PUT and
probe PUT/DELETE; source DELETE permission is unnecessary and should be denied.

Actual local testing found **Garage v2.4.1 ignores the conditional PUT header**;
it is rejected as a durable-source store, even though the existing expiring export
adapter can still use it. RustFS 1.0.3 passed the source-store checks. Neither
observation qualifies DigitalOcean Spaces or another deployed provider. Recheck
the exact provider/version before activation; never weaken immutability to make a
compatibility test pass. Runtime readiness/probe integration is still pending.

## Configuration contract

The reserved factory configuration is server-only:

| Variables                                                                 | Meaning                                                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_STORAGE`                                                           | `disabled` (default), `local` or `s3`; not wired into runtime yet.                                                                                  |
| `MEDIA_DIRECTORY`                                                         | Persistent private root; default `./data/media`.                                                                                                    |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`                                    | Optional compatible endpoint; region defaults to `us-east-1`. HTTPS is required except loopback tests; URL credentials/query/fragment are rejected. |
| `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | Required for S3; use a private durable bucket and independent credentials.                                                                          |
| `MEDIA_S3_PATH_STYLE`                                                     | `false` by default; compatible test stores may need `true`.                                                                                         |

Media and export directories must not be equal or contain each other, including
filesystem-root and symlink-alias cases. S3 bucket names and access-key IDs must
differ from the export configuration; matching names are conservatively rejected
even across endpoint aliases. Do not reuse export lifecycle rules for source media.
No existing bucket, credential, Compose service or provider setting is changed here.

## Verification

`tests/src/media-foundation.test.ts` covers canonical references/keys, real raster
decoding and original-byte checksums, malformed/MIME/size/animation failures,
cancellation, immutable/private local files, concurrent collision, traversal and
symlink denial, configuration overlap and S3 request/lifecycle/capability guards.

```sh
pnpm --filter @monorepo/tests exec tsx --test src/media-foundation.test.ts
```

Two optional tests use **owned loopback disposable stores only** and create/remove
uniquely named `grove-media-test-<UUID>` buckets:

- `TEST_MEDIA_S3_ENDPOINT`, `TEST_MEDIA_S3_REGION`, `TEST_MEDIA_S3_KEY`,
  `TEST_MEDIA_S3_SECRET`: conforming storage; checks private anonymous denial,
  byte identity, immutable collisions and rejected expiration lifecycle. CI supplies
  a digest-pinned disposable RustFS 1.0.3 service for this check.
- `TEST_MEDIA_UNSAFE_S3_ENDPOINT`, `TEST_MEDIA_UNSAFE_S3_KEY`,
  `TEST_MEDIA_UNSAFE_S3_SECRET`: Garage fixture; verifies fail-closed conditional
  probing, unchanged retained source bytes and no leftover probe objects.

Never point these tests at retained data or an application bucket. The test
administrator removes only its own new buckets/objects; application source-store
code still has no source-deletion API. Tests that omit these variables skip the
integration checks explicitly. CI exercises the conforming store, not the
optional Garage fixture; neither qualifies a deployed provider.

## Next image increment

Add tenant quota/reservations and migration 017 (016 belongs to notebook lifecycle),
transactional note/revision bindings, a dedicated bounded upload path, and scoped
current/history/public reads before exposing UI. Then complete paste/drop,
autosave/Undo, image rendering, portable archives/recovery and PDF images. Only
after the image acceptance gates pass should recordings and speech build on them.
