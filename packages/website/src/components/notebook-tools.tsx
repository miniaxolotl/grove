"use client";

import {
  BookOpen,
  FileText,
  Headphones,
  RotateCcw,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./notebook-tools.module.css";

const sample =
  "Recall the idea before checking your notes. Explain it in your own words, then revisit the parts you missed. Bring one question to the next seminar.";
const views = [
  { label: "Notes", Icon: BookOpen },
  { label: "Transcript", Icon: FileText },
  { label: "Listen", Icon: Headphones },
] as const;

/** A browser-only illustration, never an account editor or an AI request. */
export function NotebookTools() {
  const [view, setView] = useState(0);
  const [draft, setDraft] = useState(sample);
  const [speaking, setSpeaking] = useState(false);
  const [message, setMessage] = useState("");
  const activeSpeech = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(
    () => () => {
      const active = activeSpeech.current;
      activeSpeech.current = null;
      if (active) window.speechSynthesis?.cancel();
    },
    [],
  );

  function stop() {
    const active = activeSpeech.current;
    activeSpeech.current = null;
    if (active) window.speechSynthesis.cancel();
    setSpeaking(false);
    setMessage("Playback stopped.");
  }

  function listen() {
    if (!("speechSynthesis" in window)) {
      setMessage(
        "Read-aloud is unavailable in this browser. You can still read the sample.",
      );
      return;
    }
    const voice = window.speechSynthesis
      .getVoices()
      .find((item) => item.localService && item.lang.startsWith("en"));
    if (!voice) {
      setMessage(
        "No on-device English voice is available. You can still read the sample.",
      );
      return;
    }
    stop();
    const utterance = new SpeechSynthesisUtterance(sample);
    utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.onend = () => {
      if (activeSpeech.current !== utterance) return;
      activeSpeech.current = null;
      setSpeaking(false);
      setMessage("Finished reading the sample.");
    };
    utterance.onerror = () => {
      if (activeSpeech.current !== utterance) return;
      activeSpeech.current = null;
      setSpeaking(false);
      setMessage("Playback stopped. The sample is still available to read.");
    };
    activeSpeech.current = utterance;
    setSpeaking(true);
    setMessage("Reading the sample with an on-device voice.");
    window.speechSynthesis.speak(utterance);
  }

  return (
    <figure
      className={styles.tools}
      data-ui
      aria-label="Try sample notebook tools"
    >
      <div className={styles.header}>
        <span>Learning notebook</span>
        <span>Interactive example</span>
      </div>
      <div
        className={styles.tabs}
        role="group"
        aria-label="Explore notebook tools"
      >
        {views.map(({ label, Icon }, index) => (
          <button
            key={label}
            type="button"
            aria-pressed={view === index}
            aria-controls="notebook-tools-content"
            onClick={() => {
              stop();
              setView(index);
              setMessage("");
            }}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div id="notebook-tools-content" className={styles.panels}>
        <div
          className={styles.panel}
          data-inactive={view !== 0}
          aria-hidden={view !== 0}
          inert={view !== 0}
        >
          <label htmlFor="sample-study-note" className={styles.title}>
            After the seminar
          </label>
          <p>Try an edit. It stays in this example until you leave.</p>
          <textarea
            id="sample-study-note"
            value={draft}
            maxLength={1200}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-describedby="sample-note-privacy"
          />
          <div className={styles.controls}>
            <span>{draft.length} / 1,200</span>
            <button type="button" onClick={() => setDraft(sample)}>
              <RotateCcw size={14} aria-hidden="true" /> Reset sample
            </button>
          </div>
        </div>
        <div
          className={styles.panel}
          data-inactive={view !== 1}
          aria-hidden={view !== 1}
          inert={view !== 1}
        >
          <p className={styles.title}>From recording to notes</p>
          <p>Prepared transcript excerpt, not live transcription.</p>
          <div className={styles.transcript}>
            <span>00:04</span>
            <p>Recall the idea before checking your notes.</p>
            <span>00:11</span>
            <p>
              Explain it in your own words, then revisit the parts you missed.
            </p>
            <span>00:19</span>
            <p>Bring one question to the next seminar.</p>
          </div>
          <p className={styles.note}>
            In Grove, record a short voice note and keep its transcript with
            your notes.
          </p>
        </div>
        <div
          className={styles.panel}
          data-inactive={view !== 2}
          aria-hidden={view !== 2}
          inert={view !== 2}
        >
          <p className={styles.title}>Listen back to an idea</p>
          <p>
            Hear the original sample with your browser’s on-device voice, when
            available.
          </p>
          <blockquote>{sample}</blockquote>
          <div className={styles.controls}>
            <button type="button" onClick={speaking ? stop : listen}>
              {speaking ? (
                <Square size={16} aria-hidden="true" />
              ) : (
                <Headphones size={16} aria-hidden="true" />
              )}
              {speaking ? "Stop reading" : "Read sample aloud"}
            </button>
          </div>
        </div>
      </div>
      <p className={styles.status} role="status">
        {message || "Sample content · no account needed"}
      </p>
      <figcaption id="sample-note-privacy">
        Demo edits are not saved or sent to Grove. Audio reads the original
        sample, not your edits.
      </figcaption>
    </figure>
  );
}
