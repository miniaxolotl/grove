# Writing notes with connected agents

Notes are for people to read and review, not transcripts of an agent's work.
Connected agents and Grove's note-authoring prompts use the same writing policy.
The policy also describes complete-body edits and Grove's supported Markdown.

## Writing contract

- **Focused:** one clear subject, understandable without the original conversation.
- **Concise:** plain language, short paragraphs, no repeated summaries, filler or
  conversational preamble. Preserve facts, decisions, reasons and qualifications.
- **Structured when useful:** meaningful headings and lists, not a mandatory template.
  A preference can be one sentence. Explicit requests for depth take precedence.
- **Categorized:** use the requested or established permitted notebook and supported
  kind (`preference`, `fact`, `decision`, `solution`, `handoff`). Notebook names and
  kinds are not interchangeable. Do not invent tag/category arguments or create,
  move or reorganize notebooks without user direction. Clarify ambiguous destinations.
- **Faithful:** preserve uncertainty, real sources, task states and verbatim examples.
  Never invent sources, action owners or deadlines. Do not store raw logs, credentials
  or conversation transcripts as automatic memory.

For example, a complete preference note can be:

```markdown
I prefer concise explanations with one worked example.
```

A decision needing rationale can be slightly more structured:

```markdown
# Search rollout

Use keyword search for the first release. It works without a model provider.

## Next
- [ ] Compare semantic search after collecting representative queries.
```

The fenced examples above illustrate stored source: do **not** store an additional
outer `markdown` fence. Do not add sections with no useful content, turn every
sentence into a bullet, or repeatedly state the same decision in multiple sections.

## Supported Markdown

Grove's reader uses CommonMark with GitHub-flavored Markdown: headings, paragraphs,
ordered/unordered lists, blockquotes, emphasis, links, fenced code, task lists,
tables and strikethrough. Use checkboxes for genuine actions and tables for actual
tabular data; neither is required for ordinary prose.

- Raw HTML is skipped. Fence HTML when it is a literal example that must be visible.
- Mermaid, rendered math and wiki-link extensions are not configured; use ordinary
  prose, code examples or standard links instead.
- Existing owned images and recordings use canonical `grove-media:<UUID>` references.
  Preserve these exactly. A reference is not permission, and agents must not invent
  attachment IDs. External images are links, not automatically embedded requests.
- In-note heading links use Grove's `section-<slug>` anchors, with numeric suffixes
  for duplicates. Reuse actual heading links rather than guessing GitHub anchors.

The reader is shared across note viewing, previews and public readers. Public
readers retain their own link/media authorization. PDF export has a separate GFM
consumer with its existing presentation limits; this policy adds no new syntax.

## Editing without losing information

Read the exact current note before editing. Use its current ID/version and preserve
unrequested text, structure, task states, links, code and attachment references.
Do not silently shorten the rest of a note to satisfy a concise-writing preference.

`update_memory` is partial **by field**, not by passage. Omit unchanged metadata;
when supplying `content`, send the **complete intended note body**, not only the
new paragraph. Legacy `remember` corrections replace metadata too. Keep the same
operation ID and identical arguments for uncertain retries; review a version
conflict before submitting a new operation. An old revision is an authored record,
not an invitation to rewrite history. Exact imports/source excerpts remain exact.

## How the guidance reaches agents

| Surface | Guidance |
| --- | --- |
| Remote MCP / hosted ChatGPT and Claude | Initialization instructions, self-contained tool descriptions and argument documentation |
| Packaged stdio bridge / CLI | The same MCP catalog and initialization instructions |
| OpenCode | Registered memory skill and shared MCP guidance |
| Claude Code / Codex | Generated memory skill plus shared MCP guidance; optional existing SessionStart context |
| Ask Grove / cleanup | The shared prose policy on note-authoring model requests; existing grounding, review/Apply and conflict checks remain |

`lib/shared/src/note-writing.ts` owns the prose policy and content-argument wording.
`lib/integration-core/src/index.ts` composes the runtime skill with scope, capture,
tool, retry and handoff guidance. `pnpm build` generates the checked-in Claude/Codex
skill bodies from that bundled runtime export, preserves frontmatter, and copies
the same skill into OpenCode's artifact. Change the source, rebuild and include the
generated skill changes; do not hand-edit a generated body.

Cleanup's preview profile includes the writing-policy version so new requests do
not reuse old-policy drafts. Existing authored notes and revisions are not rewritten.
Other assistance profiles and the existing review/Apply/Undo behavior are unchanged.

These are model instructions, not a new content validator. Plain text is valid
Markdown; a successful parse does not prove a note is concise or well written.
There is no new style rejection, silent formatter, permission or automatic write.
Hosts choose when to expose/call tools; discovery or deterministic fixtures do not
prove that every external model will follow the policy. Refresh cached MCP metadata
after a deployed update and load the updated packaged skills in native hosts.

## Evaluation cases

Use synthetic content. Check readability and factual fidelity separately from
rendering, scope and mutation behavior. The cases below are a review corpus, not
claims of live-model scores or a new paid-model CI job.

| Request/case | Expected result |
| --- | --- |
| Save a short preference | One readable sentence; correct requested scope/kind; no forced headings |
| Record a decision and rationale | Clear choice plus its actual reason; no duplicated summary |
| Save research findings | Focused prose and only real supplied supporting URLs |
| Save open actions | Genuine task checkboxes; no invented owners/deadlines |
| Compare options | Compact table only when useful; preserve qualifications |
| Save a code example | Correct literal fencing; no extra document wrapper |
| Request a detailed note | Preserve requested depth; do not impose an arbitrary brevity cap |
| Import exact text | Preserve the original; no style rewrite of source evidence |
| Edit one paragraph | Complete resulting body, with unrelated content/metadata retained |
| Edit a note containing media | Preserve exact existing references and authorization |
| Ambiguous destination | Clarify; no guessed UUID, cross-project search or new notebook |
| Organization request | Only requested items; appropriate existing destinations/kinds |
| Paused/private automatic capture | No automatic save/recall; explicit tools retain existing rules |
| Request unsupported rich formatting | Use supported Markdown without claiming unavailable rendering |
| Explain how saving works | Answer; do not create a note merely because tools are available |
| Multi-topic, unclear scope | Clarify rather than unsolicited splitting, moves or notebook creation |

Verification commands and evidence limits are in
[testing](development/testing.md#agent-note-writing-guidance).
