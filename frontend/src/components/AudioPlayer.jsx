import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
const API = import.meta.env.VITE_API_URL ?? '';

function fmt(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ src }) {
  const { token } = useAuth();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const a = audioRef.current;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => setDuration(a.duration);
    const onEnd  = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  }

  async function download(e) {
    e.stopPropagation();
    const res = await fetch(`${API}/api/calls/download?url=${encodeURIComponent(src)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = src.split('/').pop().split('?')[0] || 'recording.wav';
    a.click();
    URL.revokeObjectURL(url);
  }

  function changeVolume(e) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    audioRef.current.volume = v;
  }

  return (
    <div className="inline-flex items-center gap-2 bg-slate-100 dark:bg-zinc-800 rounded-lg px-2.5 py-1.5">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play / Pause */}
      <button
        onClick={toggle}
        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
      >
        {playing ? (
          <svg className="w-3 h-3" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1.5" y="1" width="2.5" height="8" rx="1"/>
            <rect x="6" y="1" width="2.5" height="8" rx="1"/>
          </svg>
        ) : (
          <svg className="w-3 h-3 ml-0.5" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
          </svg>
        )}
      </button>

      {/* Time */}
      <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
        {fmt(current)} / {fmt(duration)}
      </span>

      {/* Volume icon + inline slider */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-slate-400 dark:text-zinc-500">
          {volume === 0 ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3L4 6H1.5v4H4l4 3V3zM13 6l-4 4M9 6l4 4"/>
            </svg>
          ) : volume < 0.5 ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3L4 6H1.5v4H4l4 3V3z" fill="currentColor" stroke="none"/>
              <path d="M11 6.5a3 3 0 010 3"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3L4 6H1.5v4H4l4 3V3z" fill="currentColor" stroke="none"/>
              <path d="M11 6a3.5 3.5 0 010 4M13 4.5a6 6 0 010 7"/>
            </svg>
          )}
        </span>
        <input
          type="range"
          min="0" max="1" step="0.05"
          value={volume}
          onChange={changeVolume}
          className="w-16 accent-indigo-600 cursor-pointer h-0.5 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:h-2"
        />
      </div>

      {/* Download */}
      <button
        onClick={download}
        title="Download"
        className="flex-shrink-0 text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1"/>
        </svg>
      </button>
    </div>
  );
}
