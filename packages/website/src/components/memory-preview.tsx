"use client";

import { BookOpen, Check, LockKeyhole, MessageSquare } from "lucide-react";
import { useState } from "react";
import { GroveMark } from "@/components/brand";

const notes = [
  {
    id: "weekend",
    notebook: "The long weekend",
    title: "A slower Sunday",
    text: "Skip the early start. Meet Maya at 10:30 by the boathouse. Take the lakeside path, then lunch at the cabin.",
    detail: "Bring the camera. Leave the rest of the day unplanned.",
    question: "What’s the plan for Sunday?",
    answer:
      "Meet Maya at the boathouse at 10:30, walk by the lake, then have lunch at the cabin. Bring your camera.",
  },
  {
    id: "newsletter",
    notebook: "A small newsletter",
    title: "The first issue",
    text: "Monthly, not weekly. One useful idea, one photograph, five minutes to read. Draft the first issue by Friday.",
    detail:
      "Send it only when it feels worth keeping. No need to fill an inbox just to keep a schedule.",
    question: "How often did I want to send it?",
    answer:
      "Once a month. Keep each issue to one idea and one photograph, with about five minutes of reading.",
  },
  {
    id: "journal",
    notebook: "Journal",
    title: "What worked today",
    text: "Left my phone at home for the morning walk. Finally worked out the opening for the essay somewhere between the park and the bakery.",
    detail:
      "Try the walk before opening email tomorrow. A little space seems to help.",
    question: "What helped me get unstuck?",
    answer:
      "A morning walk without your phone gave you the opening for your essay. You wanted to try walking before email again.",
  },
] as const;

export function MemoryPreview() {
  const [selected, setSelected] = useState(0);
  return (
    <figure
      className="notebook-preview"
      data-ui
      aria-label="Example notebook with saved notes and source-linked answers"
    >
      <div className="notebook-preview-bar">
        <span>
          <GroveMark className="size-5" /> Your Grove
        </span>
        <span>
          <LockKeyhole size={13} aria-hidden="true" /> Private
        </span>
      </div>
      <div
        className="notebook-sample-choices"
        role="group"
        aria-label="Choose a sample note"
      >
        {notes.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === index}
            aria-controls="hero-notebook-page"
            onClick={() => setSelected(index)}
          >
            {item.notebook}
          </button>
        ))}
      </div>
      <div
        className="notebook-preview-pages"
        id="hero-notebook-page"
        aria-live="polite"
        aria-atomic="true"
      >
        {notes.map((note, index) => (
          <div
            key={note.id}
            className="notebook-preview-body"
            data-inactive={selected !== index}
            aria-hidden={selected !== index}
            inert={selected !== index}
          >
            <article
              id={`hero-note-${note.id}`}
              className="preview-note"
              tabIndex={-1}
            >
              <div className="preview-note-label">
                <BookOpen size={14} aria-hidden="true" /> {note.notebook}
              </div>
              <h2>{note.title}</h2>
              <p>{note.text}</p>
              <p className="preview-note-detail">{note.detail}</p>
              <div className="preview-note-footer">
                <span>Saved to {note.notebook}</span>
                <Check size={14} aria-label="Saved" />
              </div>
            </article>
            <div className="preview-answer">
              <div>
                <MessageSquare size={14} aria-hidden="true" /> Ask Grove
              </div>
              <p>{note.question}</p>
              <div className="preview-answer-copy">
                <GroveMark className="size-5" />
                <div>
                  <p>{note.answer}</p>
                  <a
                    href={`#hero-note-${note.id}`}
                    aria-label={`View source: ${note.title}`}
                  >
                    1. {note.title}
                  </a>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <figcaption>
        Interactive illustration. Sample notes and answers.
      </figcaption>
    </figure>
  );
}
