"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  speechVoices,
  type SpeechVoice,
  type SpeechVoiceId,
} from "@lib/shared/speech-voices";
import { Dialog } from "./dialog";
import { Button, IconButton } from "./ui/button";
import { claimAudio, releaseAudio } from "./audio-focus";
import "./voice-chooser.css";

const unavailableVoices: SpeechVoice[] = speechVoices.map((voice) => ({
  ...voice,
  available: false,
}));
type VoiceChoice = {
  value: SpeechVoiceId;
  voices?: SpeechVoice[];
  onChange: (value: SpeechVoiceId) => void;
};

export function VoicePreference({ value, voices, onChange }: VoiceChoice) {
  const [open, setOpen] = useState(false);
  const selected = speechVoices.find((voice) => voice.id === value);
  return (
    <div className="speech-voice-preference">
      <span>Reading voice</span>
      <span className="speech-voice-name">{selected?.name}</span>
      <button
        type="button"
        className="text-button"
        aria-label="Change reading voice"
        onClick={() => setOpen(true)}
      >
        Change
      </button>
      {open && (
        <VoiceChooser
          value={value}
          voices={voices}
          onChange={onChange}
          close={() => setOpen(false)}
          settings
        />
      )}
    </div>
  );
}

/** Browsing and samples never change the applied voice or the account preference. */
export function VoiceChooser({
  value,
  voices = unavailableVoices,
  onChange,
  close,
  settings = false,
}: VoiceChoice & {
  close: () => void;
  settings?: boolean;
}) {
  const group = useId();
  const [candidate, setCandidate] = useState(value);
  const selected = voices.find((voice) => voice.id === candidate);
  const focusId =
    selected && (settings || selected.available)
      ? selected.id
      : voices.find((voice) => voice.available)?.id;
  return (
    <Dialog title="Choose a voice" variant="inspector" close={close}>
      <div className="speech-voice-chooser">
        <fieldset className="speech-voice-options">
          <legend className="sr-only">Voice</legend>
          {voices.map((voice) => (
            <div className="speech-voice-option" key={voice.id}>
              <label>
                <input
                  type="radio"
                  name={group}
                  value={voice.id}
                  checked={candidate === voice.id}
                  disabled={!settings && !voice.available}
                  data-autofocus={voice.id === focusId ? "" : undefined}
                  aria-labelledby={`${group}-${voice.id}-name`}
                  aria-describedby={`${group}-${voice.id}-description`}
                  onChange={() => setCandidate(voice.id)}
                />
                <span>
                  <span id={`${group}-${voice.id}-name`}>
                    {voice.name}
                    {voice.basic && (
                      <span className="speech-voice-basic"> · Basic</span>
                    )}
                  </span>
                  <span
                    id={`${group}-${voice.id}-description`}
                    className="speech-voice-description"
                  >
                    {voice.description}
                    {!voice.available ? " · Unavailable" : ""}
                  </span>
                </span>
              </label>
              {voice.sampleId === `${voice.id}-v1` && (
                <VoiceSample voice={voice} />
              )}
            </div>
          ))}
        </fieldset>
        <p className="speech-voice-hint">
          {settings
            ? "Save preferences to keep this voice."
            : "Used for future read-alouds."}
        </p>
        <div className="speech-voice-footer">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!selected || (!settings && !selected.available)}
            onClick={() => {
              if (candidate !== value) onChange(candidate);
              close();
            }}
          >
            Use voice
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function VoiceSample({ voice }: { voice: SpeechVoice }) {
  const audio = useRef<HTMLAudioElement>(null);
  const intent = useRef({ value: 0 });
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = audio.current;
    const pending = intent.current;
    return () => {
      pending.value++;
      if (element) {
        element.pause();
        releaseAudio(element);
        element.removeAttribute("src");
        element.load();
      }
    };
  }, []);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    const token = ++intent.current.value;
    if (!element.paused && !element.error) {
      element.pause();
      return;
    }
    setError(false);
    if (!element.getAttribute("src"))
      element.src = `/voice-samples/${voice.sampleId}.mp3`;
    if (element.error) element.load();
    if (element.ended) element.currentTime = 0;
    try {
      await element.play();
    } catch {
      if (intent.current.value === token) setError(true);
    }
  }
  return (
    <span className="speech-sample">
      <audio
        ref={audio}
        preload="none"
        onPlay={(event) => {
          claimAudio(event.currentTarget);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError(true);
        }}
      />
      <IconButton
        label={`${playing ? "Pause" : "Play"} ${voice.name} sample`}
        data-playing={playing || undefined}
        onClick={() => void toggle()}
      >
        {playing ? (
          <Pause size={16} aria-hidden="true" />
        ) : (
          <Play size={16} aria-hidden="true" />
        )}
      </IconButton>
      {error && <span role="alert">Couldn’t play. Try again.</span>}
    </span>
  );
}
