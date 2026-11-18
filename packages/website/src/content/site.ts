export const positioning = {
  title: "Grove | Private notes. Lasting context.",
  description:
    "A private notebook for your ideas, plans and journal. Search by meaning, ask source-linked questions and carry context into your AI tools. Start free.",
  shareText: "Keep your notes in one place. Find them again with Grove.",
  imageAlt:
    "Grove. Your notes, in one place. Write, organize and find them again.",
} as const;

export const navigation = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Integrations", href: "/#for-developers" },
  { label: "Docs", href: "/docs" },
];

export const faqs = [
  {
    question: "Will Ask change my notes without asking?",
    answer:
      "Proposed note edits and notebook changes are previews. Review the changes and choose the explicit save or apply action before Grove writes them. Asking a question does not authorize a change.",
  },
  {
    question: "Is my notebook private?",
    answer:
      "Your notes belong to your account. Grove uses service providers to store notes and provide search and answers; private does not mean end-to-end encrypted. The Privacy Policy explains how your information is handled.",
  },
  {
    question: "Can I undo a deletion?",
    answer:
      "Deletion hides the note and its history and has no ordinary Undo or restore. Use Archive when you want to put a note away but may need it again.",
  },
  {
    question: "What if an answer misses something?",
    answer:
      "Open the citations and check the evidence. You can choose exact notes in Sources and ask a narrower question. A cited answer is not a guarantee that the whole notebook was read or that every statement is correct.",
  },
  {
    question: "Is there a browser extension?",
    answer:
      "Yes, for Chrome, Firefox and Edge. Install it locally from the repository build, save notes from any tab and search your library from the panel. Spelling and grammar checks run on your device; sentence-level AI rewrites need your explicit consent, a separate connection permission and a configured provider. It is not a browser-store listing.",
  },
  {
    question: "Can I run Grove on my own server?",
    answer:
      "Yes. Grove is open source. The self-hosting guide covers the separate infrastructure and provider configuration; creating a Cloud account does not set up a self-hosted server.",
  },
];
