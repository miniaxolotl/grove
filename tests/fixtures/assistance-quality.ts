/** Synthetic labelled cases. Expected text is a semantic rubric, not a substring oracle. */
export const assistanceCases = [
  {
    name: "Research",
    notes: [
      "The pilot found a correlation, not a causal effect. Request: repeat the blinded trial.",
      "The sample had 12 participants; confidence remains low.",
    ],
    actions: ["repeat the blinded trial"],
    unfiled: "Blinded trial protocol and low-confidence pilot measurements.",
    filing: "match",
    cleanup: "unrelated",
    updated:
      "The blinded trial is complete. The causal hypothesis was not supported.",
  },
  {
    name: "Japan travel",
    notes: [
      "Mira will book Kyoto train tickets tomorrow. Hotel reservation is confirmed.",
      "Kyoto travel budget is 80,000 yen. Museum visit is optional.",
    ],
    actions: [
      "Mira: book Kyoto train tickets tomorrow (retain relative wording)",
    ],
    unfiled: "Kyoto train booking confirmation and travel budget.",
    filing: "match",
    cleanup: "unrelated",
    updated:
      "Mira booked the Kyoto train tickets. The confirmed hotel reservation is cancelled.",
  },
  {
    name: "Study",
    notes: [
      "Photosynthesis converts light to chemical energy. Review chapter 3 before Friday.",
      "We reviewed chapter 2 yesterday; that work is complete.",
    ],
    actions: ["review chapter 3 before Friday"],
    unfiled: "A recipe for rye bread, flour and a home oven.",
    filing: "abstain",
    cleanup: "unrelated",
    updated:
      "Chapter 3 is reviewed. Photosynthesis converts light to chemical energy.",
  },
  {
    name: "Home",
    notes: [
      "The kitchen wall must stay blue. Ask the landlord about repainting.",
      "The kitchen wall must stay green. This conflicts with the blue-wall plan; no decision yet.",
    ],
    actions: ["ask the landlord about repainting"],
    unfiled: "Kitchen wall repainting plan and landlord permission.",
    filing: "match",
    cleanup: "conflicting",
    updated:
      "The landlord approved green for the kitchen wall. This replaces the blue-wall plan.",
  },
  {
    name: "Software",
    notes: [
      "Use schema v1 for imports. Add a migration test before release.",
      "Schema v2 explicitly replaces schema v1 for all imports; v1 is retired.",
    ],
    actions: ["add a migration test before release"],
    unfiled: "A birdwatching trip by the lake.",
    filing: "abstain",
    cleanup: "superseded",
    updated:
      "The import migration test is complete. Use schema v2, which replaces v1.",
  },
  {
    name: "Mixed subjects",
    notes: [
      "Buy basil for the garden this weekend.",
      "The reading group meets monthly. We could discuss geology someday; this is only an idea.",
      "Buy basil for the garden this weekend.",
    ],
    actions: ["buy basil this weekend (deduplicate)"],
    unfiled: "Unsorted thoughts with no stated subject.",
    filing: "abstain",
    cleanup: "duplicate",
    updated:
      "Basil has been purchased for the garden. Gardening task completed.",
  },
] as const;
