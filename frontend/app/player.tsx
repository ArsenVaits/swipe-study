"use client";

import { Captions, Download, LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const formatTime = (time: number) => "0:" + Math.floor(time).toString().padStart(2, "0");

type Props = { video: string; poster?: string; captions: string[]; title: string; sample?: boolean; serverVideo?: boolean; demoVideo?: boolean; active: boolean; onRefresh?: () => void };

export default function Player({ video, poster, captions, title, sample, serverVideo, demoVideo, active, onRefresh }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(6);
  const [showCaptions, setShowCaptions] = useState(true);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const captionIndex = Math.min(captions.length - 1, Math.floor(time / duration * captions.length));

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    if (!active) media.pause();
    else if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void media.play().catch(() => undefined);
    }
  }, [active, video]);

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

  function toggleSound() {
    const media = ref.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
  }

  async function downloadVideo() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(video);
      if (!response.ok) throw new Error("Video download failed");
      const blob = await response.blob();
      const extension = blob.type.includes("webm") || /\.webm(?:[?#]|$)/i.test(video) ? "webm" : "mp4";
      const filename = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 100) || "swipe-study-lesson";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename + "." + extension;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="video-frame" aria-label={title + " video"} inert={!active}>
      <video
        ref={ref} src={video} poster={poster} preload="metadata" muted={muted} loop playsInline
        onPlay={() => { setPlaying(true); setStarted(true); setError(false); }} onPause={() => setPlaying(false)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onEnded={() => setPlaying(false)} onError={() => setError(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const length = event.currentTarget.duration;
          if (Number.isFinite(length) && length > 0) setDuration(length);
        }}
      />
      <div className="video-shade" aria-hidden="true" />
      {(sample || demoVideo) && <span className="sample-label"><span aria-hidden="true" /> {sample ? "SAMPLE LESSON" : "DEMO VIDEO"}</span>}
      {sample && !started && <div className="video-cover-title">{title}<span>.</span></div>}
      {!playing && (
        <button className="center-play" type="button" onClick={toggle} aria-label={started ? "Play or resume video" : "Play lesson video"}>
          {started && time >= duration - 0.1 ? <RotateCcw size={22} /> : <Play size={23} fill="currentColor" />}
        </button>
      )}
      {error && <div className="video-error" role="status">
        <p>Could not play this video.</p>
        {onRefresh && <button className="secondary" type="button" onClick={onRefresh}>Refresh video</button>}
      </div>}
      {(sample || serverVideo) && showCaptions && <p className="video-caption">{captions[captionIndex]}</p>}
      {downloadError && <p className="download-error" role="alert">Could not download video. Please try again.</p>}
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
          <button type="button" aria-label={muted ? "Unmute video" : "Mute video"} title={muted ? "Unmute video" : "Mute video"} onClick={toggleSound}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
          </button>
          {(sample || serverVideo) && <button type="button" aria-label="Captions" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}><Captions size={19} /></button>}
          <button type="button" aria-label={downloading ? "Downloading video" : "Download video"} title={downloading ? "Downloading video" : "Download video"} disabled={downloading} aria-busy={downloading} onClick={downloadVideo}>
            {downloading ? <LoaderCircle size={19} className="spin" /> : <Download size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}
