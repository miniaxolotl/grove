import {
  MessageSquare,
  Heart,
  UserRound,
  ListChecks,
  Plus,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";

export type ContextPrompt = {
  title: string;
  kind: Memory["kind"];
  guidance: string;
};
const prompts = [
  {
    title: "Communication",
    kind: "preference",
    icon: MessageSquare,
    guidance:
      "How do you like explanations, feedback, and answers to be written?",
  },
  {
    title: "Interests",
    kind: "preference",
    icon: Heart,
    guidance: "What do you enjoy learning about or spending time on?",
  },
  {
    title: "About my work",
    kind: "fact",
    icon: UserRound,
    guidance: "What are you working on, and what matters to you?",
  },
  {
    title: "Working preferences",
    kind: "preference",
    icon: ListChecks,
    guidance: "What helps you plan, focus, and get things done?",
  },
] satisfies (ContextPrompt & { icon: typeof MessageSquare })[];

export function PersonalOptions({
  onCreate,
}: {
  onCreate: (prompt: ContextPrompt) => void;
}) {
  return (
    <section
      className="personal-options"
      aria-labelledby="personal-options-title"
    >
      <h2 id="personal-options-title">Make it personal</h2>
      <p>A few notes about you. Start with whatever feels useful.</p>
      <div>
        {prompts.map(({ icon: Icon, ...prompt }) => (
          <button key={prompt.title} onClick={() => onCreate(prompt)}>
            <Icon size={18} />
            <span>
              <strong>{prompt.title}</strong>
              <span>{prompt.guidance}</span>
            </span>
            <Plus size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
