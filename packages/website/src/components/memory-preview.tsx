import {
  BookOpen,
  Check,
  LockKeyhole,
  MessageSquare,
  Plus,
} from "lucide-react";
import { GroveMark } from "@/components/brand";

export function MemoryPreview() {
  return (
    <figure
      className="notebook-preview"
      data-parallax
      aria-label="Example notebook with weekend plans and an answer from a saved note"
    >
      <div className="notebook-preview-bar">
        <span>
          <GroveMark className="size-5" /> Your Grove
        </span>
        <span>
          <LockKeyhole size={12} aria-hidden="true" /> Private
        </span>
      </div>
      <div className="notebook-preview-body">
        <div className="notebook-preview-heading">
          <div>
            <span>Personal notebook</span>
            <h2>Weekend plans</h2>
          </div>
          <Plus size={18} aria-hidden="true" />
        </div>
        <article className="preview-note">
          <div className="preview-note-label">
            <BookOpen size={13} /> Weekend plans
          </div>
          <h3>Saturday</h3>
          <p>
            A long walk by the river. A visit to the bookshop on Maple Street.
            Leave the rest of the day open.
          </p>
          <div className="preview-note-footer">
            <span>Saved to Weekend plans</span>
            <Check size={13} aria-label="Saved" />
          </div>
        </article>
        <div className="preview-note-peek">
          <BookOpen size={14} aria-hidden="true" />
          <span>Things I want to learn</span>
          <span>3 ideas</span>
        </div>
        <div className="preview-answer">
          <div>
            <MessageSquare size={14} /> Ask Grove
          </div>
          <p>What did I want to do this weekend?</p>
          <div className="preview-answer-copy">
            <GroveMark className="size-5" />
            <span>
              Take a walk by the river and visit the bookshop on Maple Street.
              Keep the rest of Saturday open.
              <small>1. Saturday</small>
            </span>
          </div>
        </div>
      </div>
      <figcaption>Example notebook with sample notes.</figcaption>
    </figure>
  );
}
