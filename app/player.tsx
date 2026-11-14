"use client";

import { Captions, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const formatTime = (time: number) => "0:" + Math.floor(time).toString().padStart(2, "0");

type Props = { video: string; poster?: string; captions: string[]; title: string; sample?: boolean; active: boolean };

export default function Player({ video, poster, captions, title, sample, active }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(6);
  const [showCaptions, setShowCaptions] = useState(true);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const captionIndex = Math.min(captions.length - 1, Math.floor(time / duration * captions.length));

  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  async function toggle() {
    const media = ref.current;
    if (!media) return;
    if (!media.paused) return media.pause();
    if (media.currentTime >= duration - 0.1) media.currentTime = 0;
    try {
      await media.play();
      setStarted(true);
      setError(false);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="video-frame" aria-label={title + " video"} inert={!active}>
      <video
        ref={ref} src={video} poster={poster} preload="metadata" muted playsInline
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)} onError={() => setError(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const length = event.currentTarget.duration;
          if (Number.isFinite(length) && length > 0) setDuration(length);
        }}
      />
      <div className="video-shade" aria-hidden="true" />
      {sample && <span className="sample-label"><span aria-hidden="true" /> SAMPLE LESSON</span>}
      {sample && !started && <div className="video-cover-title">{title}<span>.</span></div>}
      {!playing && (
        <button className="center-play" type="button" onClick={toggle} aria-label={started ? "Play or resume video" : "Play lesson video"}>
          {started && time >= duration - 0.1 ? <RotateCcw size={22} /> : <Play size={23} fill="currentColor" />}
        </button>
      )}
      {error && <p className="video-error" role="alert">Video playback failed. Try playing it again.</p>}
      {sample && showCaptions && <p className="video-caption">{captions[captionIndex]}</p>}
      <div className="video-controls">
        <input type="range" aria-label="Video position" min={0} max={duration} step={0.05} value={Math.min(time, duration)}
          style={{ "--progress": (time / duration * 100) + "%" } as React.CSSProperties}
          onChange={(event) => {
            if (!ref.current) return;
            ref.current.currentTime = Number(event.target.value);
            setTime(ref.current.currentTime);
          }}
        />
        <div className="control-row">
          <button type="button" aria-label={playing ? "Pause video" : "Play video"} onClick={toggle}>
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span>{formatTime(time)} / {formatTime(duration)}</span>
          {sample && <button type="button" aria-label="Captions" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}><Captions size={19} /></button>}
        </div>
      </div>
    </div>
  );
}
