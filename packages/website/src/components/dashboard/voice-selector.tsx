"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  speechVoices,
  type SpeechVoice,
  type SpeechVoiceId,
} from "@lib/shared/speech-voices";
import { Select } from "./ui/select";
import { claimAudio, releaseAudio } from "./audio-focus";
import "./voice-selector.css";

const unavailableVoices: SpeechVoice[] = speechVoices.map((voice) => ({
  ...voice,
  available: false,
}));
export function VoiceSelector({
  value,
  voices = unavailableVoices,
  remembered,
  onChange,
}: {
  value: SpeechVoiceId;
  voices?: SpeechVoice[];
  remembered?: SpeechVoiceId;
  onChange: (value: SpeechVoiceId) => void;
}) {
  const description = useId();
  const selected = voices.find((voice) => voice.id === value);
  return (
    <div className="speech-voice">
      <div className="speech-voice-row">
        <Select
          label="Voice"
          value={value}
          onValueChange={(id) => onChange(id as SpeechVoiceId)}
          aria-describedby={description}
          options={voices.map((voice) => ({
            value: voice.id,
            label: `${voice.name}${voice.basic ? " · Basic" : ""}${voice.id === remembered ? " · Default" : ""}`,
            description: `${voice.description}${voice.available ? "" : " · Unavailable"}`,
          }))}
        />
        {selected?.sampleId === `${value}-v1` && (
          <VoiceSample key={selected.sampleId} voice={selected} />
        )}
      </div>
      <p id={description} className="speech-voice-description">
        {selected?.description}.
        {selected &&
          !selected.available &&
          " This voice is currently unavailable. Choose another voice to prepare audio."}
      </p>
    </div>
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
      <button
        type="button"
        className="text-button"
        aria-label={`${playing ? "Pause" : "Play"} ${voice.name} sample`}
        onClick={() => void toggle()}
      >
        {playing ? (
          <Pause size={14} aria-hidden="true" />
        ) : (
          <Play size={14} aria-hidden="true" />
        )}
        {playing ? "Pause sample" : "Play sample"}
      </button>
      {error && <span role="alert">Sample couldn’t play. Try again.</span>}
    </span>
  );
}
