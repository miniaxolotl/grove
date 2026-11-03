/** Shared prose policy, not a validator or authority to create/change notes. */
export const noteWritingPolicyVersion = "note-writing-v1";

export const noteWritingInstructions = [
  "Write human-readable notes: simple, concise, focused on one subject and understandable without the original chat. Use plain language; preserve important facts, decisions, reasons and uncertainty. Omit filler, repetition and conversational preambles. Honor explicit requests for detail or verbatim content; never invent sources, owners or deadlines.",
  "Use CommonMark/GitHub-flavored Markdown. A short note can be one sentence; do not force a template. Use descriptive headings and lists when helpful, checkboxes only for real tasks, tables only for tabular information, and fenced blocks for code/literal examples. Do not wrap the whole note in a Markdown fence. Do not rely on raw HTML, Mermaid, math or wiki-link rendering. Preserve existing links and grove-media: attachment references; never fabricate attachment IDs.",
  "For edits, preserve unrequested facts, structure, task states, links and verbatim examples. Supplied content is the complete intended body, not a changed fragment. Do not summarize away unrelated information or rewrite historical revisions. Apply this style to authored note bodies only, not ordinary replies, structured evidence or verbatim source excerpts.",
].join("\n\n");

/** Kept beside the policy so tool argument docs remain concise and consistent. */
export const noteContentDescription =
  "The complete note body in CommonMark/GitHub-flavored Markdown (1–6000 characters). Write concise, human-readable prose; headings/lists only when useful. On edits this replaces the whole body, not a fragment: preserve unrequested content, links and attachment references. Do not wrap the whole note in a code fence.";
