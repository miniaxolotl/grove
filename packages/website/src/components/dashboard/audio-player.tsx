"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { claimAudio, releaseAudio } from "./audio-focus";
import "./audio-player.css";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function timeLabel(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The source key resets playback state when a historical revision changes. */
export function AudioPlayer({
  src,
  label = "recording",
}: {
  src: string;
  label?: string;
}) {
  return <AudioPlayback key={src} src={src} label={label} />;
}

function AudioPlayback({ src, label }: { src: string; label: string }) {
  const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const enhanced = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState("");
  const intent = useRef({ value: 0 });

  useEffect(() => {
    const element = audio.current;
    const pending = intent.current;
    return () => {
      pending.value++;
      element?.pause();
      if (element) {
        releaseAudio(element);
        element.removeAttribute("src");
        element.load();
      }
    };
  }, []);

  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    const request = ++intent.current.value;
    // WebKit may leave paused=false after a failed load. Retry must reload
    // that failed source rather than treating the click as Pause.
    if (!element.paused && !element.error) {
      element.pause();
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    // WebKit can ignore preload="none"; attach the enhanced player's source
    // synchronously with the user gesture, not while rendering a note.
    if (!element.getAttribute("src")) element.src = src;
    if (element.error) element.load();
    element.playbackRate = rate;
    if (element.ended) element.currentTime = 0;
    try {
      await element.play();
    } catch {
      if (intent.current.value === request) {
        setLoading(false);
        setError("Audio couldn’t play. Try again.");
      }
    }
  };

  return (
    <span
      className="audio-player"
      data-enhanced={enhanced}
      role="group"
      aria-label={`${displayLabel} playback`}
    >
      <audio
        ref={audio}
        controls={!enhanced}
        preload="none"
        src={enhanced ? undefined : src}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={(event) => {
          claimAudio(event.currentTarget);
          setPlaying(true);
        }}
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPause={() => {
          setPlaying(false);
          setLoading(false);
        }}
        onEnded={() => {
          setPlaying(false);
          setLoading(false);
        }}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onError={() => {
          setPlaying(false);
          setLoading(false);
          setError("Audio couldn’t load. Try again.");
        }}
      />
      <span className="audio-player-controls">
        <button
          type="button"
          className="audio-player-play"
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
          title={`${playing ? "Pause" : "Play"} ${label}`}
          onClick={() => void toggle()}
        >
          {playing ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </button>
        <span className="audio-player-timeline">
          <input
            type="range"
            className="audio-player-seek"
            aria-label={`${displayLabel} position`}
            aria-valuetext={`${timeLabel(position)} of ${duration ? timeLabel(duration) : "unknown duration"}`}
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration || 0)}
            style={
              {
                "--audio-progress": `${duration ? Math.min(100, (position / duration) * 100) : 0}%`,
              } as CSSProperties
            }
            disabled={!duration || !!error}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (audio.current) audio.current.currentTime = value;
              setPosition(value);
            }}
          />
          <span className="audio-player-time" aria-hidden="true">
            <span>
              {timeLabel(position)} / {duration ? timeLabel(duration) : "–:––"}
            </span>
            {loading && <span>Loading…</span>}
          </span>
        </span>
        <select
          className="audio-player-speed"
          aria-label="Playback speed"
          title="Playback speed"
          value={rate}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (audio.current) audio.current.playbackRate = value;
            setRate(value);
          }}
        >
          {[0.75, 1, 1.25, 1.5, 2].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <button
          type="button"
          className="audio-player-mute"
          aria-label={`${muted ? "Unmute" : "Mute"} ${label}`}
          title={`${muted ? "Unmute" : "Mute"} ${label}`}
          onClick={() => {
            if (audio.current) audio.current.muted = !audio.current.muted;
          }}
        >
          {muted ? (
            <VolumeX size={18} aria-hidden="true" />
          ) : (
            <Volume2 size={18} aria-hidden="true" />
          )}
        </button>
      </span>
      <span className="sr-only" role="status">
        {loading ? "Loading audio…" : ""}
      </span>
      {error && (
        <span className="audio-player-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void toggle()}
          >
            Retry playback
          </button>
        </span>
      )}
    </span>
  );
}
