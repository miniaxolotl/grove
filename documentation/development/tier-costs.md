# Free and Pro provider cost report

## Scope and price

Pro's **$5 USD/month is an introductory price**, intentionally separate from full-
allowance cost. The owner plans to reconsider pricing later; this change does not
reprice subscriptions, alter the price flag or activate billing.

The figures below use the public provider rates retrieved during this task, not
invented invoices. They are **calculated per-user scenarios, not measured actual
monthly spending**. Actual cost depends on tokens, narration characters, selected
voices, successful fetched pages, cache hits, retries, provider discounts/credits
and infrastructure. Normal verification uses synthetic local providers and incurs
no paid model/research calls. Production invoices/account usage were not accessed.

## Verified public rates

| Component                                    | Rate (USD)                                                                               | Source                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cloud generation: MiniMax-M3.1-Flash         | $0.15 / million input tokens; $0.60 / million output; $0.015 / million cache-read tokens | [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview.md) |
| Transcription: OpenAI Whisper                | $0.006 / minute                                                                          | [OpenAI pricing](https://platform.openai.com/docs/pricing)              |
| Reed/Basic: OpenAI tts-1                     | $15 / million characters                                                                 | [OpenAI pricing](https://platform.openai.com/docs/pricing)              |
| Willow/Cedar/Brook: MiniMax speech-2.8-turbo | $60 / million characters                                                                 | [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview.md) |
| Exa Lite search, at most 10 results          | $0.004 / call                                                                            | [Exa pricing](https://exa.ai/pricing)                                   |
| Exa contents, one text content type          | $0.001 / fetched page                                                                    | [Exa pricing](https://exa.ai/pricing)                                   |
| Tavily pay-as-you-go                         | $0.008 / credit; credits depend on operation                                             | [Tavily pricing](https://www.tavily.com/pricing)                        |
| DeepInfra Qwen3-Embedding-8B                 | $0.01 / million tokens                                                                   | [Model rate](https://deepinfra.com/Qwen/Qwen3-Embedding-8B)             |
| DeepInfra Cloudflare/clef-flash              | $0.038 / million tokens (displayed promotional rate)                                     | [Model rate](https://deepinfra.com/Cloudflare/clef-flash)               |

These are listed rates, not proof of the installed account's negotiated price or
current effective invoice. Recheck before launch/repricing. The source Cloud model
catalog is described in [models](../models.md); operator overrides change costs.
Research SQL reserves estimated microdollars, not provider-reconciled invoice data.

## At the monthly allowances

The [user-action policy](../billing.md#library-and-user-actions) now additionally
limits replies (300/1,500), organization (1,000/5,000), on-demand assistance (50/250)
and recall/search (30,000/150,000) for Free/Pro. Those are not generation-token or
provider-call units. Background work, retries and multi-call actions can consume the
independent provider budgets below; do not present 31,000/155,000 attempts as that
many user-visible replies. These safety-budget scenarios are not predicted spending.

For illustration only, 5,000 input plus 1,000 output tokens at the listed MiniMax
rates cost $0.00135/call. At two calls/reply, using every reply costs $0.81 Free or
$4.05 Pro, before organization, summaries, research, speech, retries, embeddings,
hosting and payment fees. This is not a measured average or a profitability claim;
the unchanged speech/research exposure can already exceed the introductory price.

Explicit scenario assumptions:

- All 31,000 Free / 155,000 Pro generation attempts complete with **1,000 uncached
  input tokens plus 250 output tokens each**. That is $0.0003 per request. This is
  a modelling input, not observed average usage or an upper bound.
- Every research call is Exa Lite: 620 Free / 3,100 Pro, without additional paid
  extraction. This is one supported mix, not all possible research activity.
- All 120 Free / 480 Pro transcription minutes are sent to Whisper.
- TTS consumes its full 120/480 generated-minute allowance at **900 billed
  characters per minute**. This is an illustrative English narration rate, **not
  the quota conversion**: quota uses decoded duration. Languages/voices/speed,
  silence and rejected/failed output can materially change characters per minute.
- No cache savings, provider free credits, bulk discounts or invoice tax included.

| Calculated monthly variable cost         |       Free |        Pro |
| ---------------------------------------- | ---------: | ---------: |
| Generation under the token assumption    |      $9.30 |     $46.50 |
| Research, all Exa Lite                   |      $2.48 |     $12.40 |
| Transcription, full time allowance       |      $0.72 |      $2.88 |
| TTS if all Reed/Basic                    |      $1.62 |      $6.48 |
| **Subtotal with Reed/Basic**             | **$14.12** | **$68.26** |
| TTS instead if all MiniMax voices        |      $6.48 |     $25.92 |
| **Subtotal with MiniMax voices instead** | **$18.98** | **$87.70** |

The two TTS rows are **alternatives**, not additive: all voices share one quota.
These subtotals **exclude embedding, classification, storage, bandwidth, database,
API/worker hosting, email, payment fees, tax and support**. They are neither a total
cost of service nor a guaranteed maximum. Pro gross revenue is $5 before fees;
in the illustrated full-use case its variable subtotal alone exceeds that revenue.

### Measured MiniMax sample sensitivity

The retained [public voice samples](../../packages/website/public/voice-samples/README.md)
were generated from the same **127-character** synthetic text. No new provider
request was made for this report. The new MPEG-frame meter reads 8,388 / 7,956 /
7,668 ms for Willow/Cedar/Brook, including encoded padding/frame overhead rather
than trusting a duration tag. That yields the following **sample-based projections**
at the listed $60/million-character rate:

| Voice  | Measured characters/minute | TTS at Free 2h | TTS at Pro 8h | Full-use variable subtotal Free / Pro |
| ------ | -------------------------: | -------------: | ------------: | ------------------------------------: |
| Willow |                     908.44 |          $6.54 |        $26.16 |                       $19.04 / $87.94 |
| Cedar  |                     957.77 |          $6.90 |        $27.58 |                       $19.40 / $89.36 |
| Brook  |                     993.74 |          $7.15 |        $28.62 |                       $19.65 / $90.40 |

At this public rate, each retained 127-character sample represents **$0.00762**
of list-price synthesis work before credits/discounts. This is not a retrieved
invoice. Extrapolating an eight-second sentence does not establish long-form or
multilingual characters/minute; it makes the sample assumption measurable, not
the resulting monthly bill certain. There is no retained Reed sample, so the
OpenAI row remains the explicit 900-characters/minute scenario, not measured Reed
cost. All other rows/exclusions are the same as the full-allowance table above.

Generation sensitivity: at 4,000 input plus 1,000 output tokens/request the request
cost is $0.0012: **$37.20 Free / $186.00 Pro generation alone**. Even the 4,096
completion-token ceiling is not a fixed request price; input context, reasoning,
cached tokens and retries matter. Research entirely at one Tavily credit/call would
be $4.96/$24.80 before extra operation credits instead of the Exa row above.

## Illustrative course-use case, not a measured average

For 23/115 lecture-note sessions/month, assume 40 generation requests and four
Exa Lite calls/session at the same 1,000-input/250-output token profile. Generation
is $0.276/$1.38 and research $0.368/$1.84. If both speech budgets are fully used:

| Calculated course-use variable subtotal |  Free |    Pro |
| --------------------------------------- | ----: | -----: |
| Reed/Basic TTS                          | $2.98 | $12.58 |
| MiniMax TTS instead                     | $7.84 | $32.02 |

These are transparent planning assumptions, not live-token measurements. Written
notes for a course are distinct from the speech allowance: 2/8 hours does not cover
every 90-minute lecture in one/five courses, and individual recordings still have
the existing short-clip bound. Cache reuse and lower adoption reduce provider work;
heavy context, optional research and repeated voice generation increase it.

## How to calculate actual costs after rollout

1. For each provider/model and billing window, reconcile provider-reported input,
   output and cache-read tokens with the account's applicable rates. Grove's
   inference counters retain aggregate tokens but not all per-model price/cache
   metadata, so a simple request-count multiplication is not an actual invoice.
2. Reconcile TTS's billed characters and Whisper's billed audio with provider
   invoices. Retained `speech_usage.units` remain character/original-duration
   counters; `duration_ms` includes conservative reservations for uncertainty and
   historical attempts, so it is **not itself a provider invoice**.
3. Use actual research operation/page/credit line items; remove double-counting
   between a search and its included contents. Account for shared provider credits
   once per installation, not once for each Free user.
4. Allocate actual hosting/storage/egress/database/payment costs using an explicit
   active-user or usage allocation rule. No provider invoice or allocation inputs
   were available in this source task, so no infrastructure dollars are invented.

Retain global research-spend and concurrency protections. Generous per-user caps
are ceilings, not a reserved capacity commitment or an installation-wide cost cap.
The owner can raise the introductory price later through the existing protected
pricing process; this report does not authorize that change automatically.
