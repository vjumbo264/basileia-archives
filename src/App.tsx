import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, 
  Search, 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Download, 
  Sparkles, 
  Clock, 
  CheckCircle2, 
  Calendar, 
  SlidersHorizontal,
  ChevronDown,
  Volume2,
  Lock,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';

interface Episode {
  id: string;
  number: number;
  title: string;
  pubDate: string;
  year: number;
  description: string;
  durationSeconds: number;
  hasAudio: boolean;
  audioBytes?: number | null;
  friendlyDownloadName?: string;
  cover?: {
    sha256: string | null;
    hasOwn: boolean;
  };
  status: string;
}

interface ShowMetadata {
  title: string;
  author: string;
  description: string;
  artwork: string;
}

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [show, setShow] = useState<ShowMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];

  useEffect(() => {
    fetchEpisodes();
  }, []);

  const fetchEpisodes = async () => {
    setLoading(true);
      // First try local static episodes.json (instant for dev)
      try {
        const localRes = await fetch('/episodes.json');
        if (localRes.ok) {
          const data = await localRes.json();
          setEpisodes(data.episodes || []);
          setShow(data.show || null);
          return;
        }
      } catch (errLocal) {}

      // Try worker /api/episodes
      try {
        const res = await fetch('/api/episodes');
        if (res.ok) {
          const data = await res.json();
          setEpisodes(data.episodes || []);
          setShow(data.show || null);
          return;
        }
      } catch (errApi) {}

      // Fallback: try loading directly from Cloudflare Worker
      try {
        const cfRes = await fetch('https://pav-podcast.vjumbo264.workers.dev/api/episodes');
        if (cfRes.ok) {
          const data = await cfRes.json();
          setEpisodes(data.episodes || []);
          setShow(data.show || null);
          return;
        }
      } catch (errCf) {
        console.error('Failed to load episodes', errCf);
      } finally {
      setLoading(false);
    }
  };

  const years = Array.from(new Set(episodes.map(e => e.year))).sort((a, b) => b - a);

  const filteredEpisodes = episodes
    .filter(ep => {
      if (selectedYear !== 'all' && ep.year !== parseInt(selectedYear, 10)) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        ep.title.toLowerCase().includes(q) ||
        (ep.description && ep.description.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => (newestFirst ? b.number - a.number : a.number - b.number));

  const doneEpisodes = episodes.filter(e => e.hasAudio);
  const featured = doneEpisodes.length > 0 ? doneEpisodes[doneEpisodes.length - 1] : episodes[episodes.length - 1];

  const getCoverUrl = (ep: Episode | null, size: 'thumb' | 'large' = 'thumb') => {
    if (!ep) return show?.artwork || 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
    if (ep.cover?.sha256) {
      return `/cover/${ep.id}/${size}`;
    }
    return show?.artwork || 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
  };

  const getAudioUrl = (ep: Episode) => {
    return `/audio/${ep.id}`;
  };

  const handlePlayEpisode = (ep: Episode) => {
    if (currentEpisode?.id === ep.id && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      return;
    }

    setCurrentEpisode(ep);
    if (!ep.hasAudio) {
      alert(`Message #${ep.number} is in the conversion queue (speech-optimised 64k mono AAC) and will be ready shortly.`);
      return;
    }

    if (audioRef.current) {
      audioRef.current.src = getAudioUrl(ep);
      audioRef.current.playbackRate = speed;

      // Restore position if in localStorage
      try {
        const savedPos = localStorage.getItem(`pos_${ep.id}`);
        if (savedPos) {
          audioRef.current.currentTime = parseFloat(savedPos);
        }
      } catch (err) {}

      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }

    // MediaSession lockscreen controls
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ep.title,
        artist: 'The Basileia Commission',
        album: 'The Truth Simply Put with PAV',
        artwork: [
          { src: getCoverUrl(ep, 'large'), sizes: '800x800', type: 'image/webp' }
        ]
      });
      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => skipTime(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => skipTime(30));
    }
  };

  const skipTime = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + seconds));
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPos = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = clickPos * duration;
  };

  const cycleSpeed = () => {
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100 font-sans pb-28 antialiased selection:bg-blue-600 selection:text-white">
      {/* Hidden Native Audio Element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
            if (currentEpisode) {
              try {
                localStorage.setItem(`pos_${currentEpisode.id}`, String(audioRef.current.currentTime));
              } catch (e) {}
            }
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          // Autoplay next in list
          if (currentEpisode) {
            const idx = filteredEpisodes.findIndex(e => e.id === currentEpisode.id);
            const nextEp = filteredEpisodes[idx + 1];
            if (nextEp && nextEp.hasAudio) {
              handlePlayEpisode(nextEp);
            }
          }
        }}
      />

      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#0b1120]/80 backdrop-blur-md border-b border-white/6 px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-white leading-none">PAV Podcast</h1>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase mt-0.5">The Truth Simply Put</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowStatusModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Archive State</span>
          </button>
          <a
            href="https://pav-podcast.vjumbo264.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-white/5 border border-white/8 text-slate-400 hover:text-white transition-colors"
            title="Open Live Cloudflare Worker"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sermons by title, keyword, scripture..."
            className="w-full bg-[#1e293b] border border-white/8 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-inner"
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white bg-slate-800 px-1.5 py-0.5 rounded"
            >
              Clear
            </button>
          )}
        </div>

        {/* Featured Latest Sermon Card */}
        {featured && !search && (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e293b] via-[#1a2333] to-[#0f172a] border border-white/10 p-5 shadow-2xl">
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
            
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-400 tracking-wider uppercase mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Latest Message</span>
            </div>

            <h2 className="text-xl font-bold text-white tracking-tight line-clamp-2 leading-snug mb-2">
              {featured.title}
            </h2>

            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-4">
              {featured.description || 'Sermon message from The Truth Simply Put archive with Pastor Alexander Victor.'}
            </p>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  {new Date(featured.pubDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {Math.floor(featured.durationSeconds / 60)} min
                </span>
              </div>

              <button
                onClick={() => handlePlayEpisode(featured)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-600/30"
              >
                {currentEpisode?.id === featured.id && isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 fill-white" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>{featured.hasAudio ? 'Play Message' : 'Queued'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Categories / Years Section */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-bold text-slate-200">Browse Years</h3>
            <span className="text-xs font-medium text-slate-400">
              {episodes.length} total messages
            </span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none no-scrollbar">
            <button
              onClick={() => setSelectedYear('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                selectedYear === 'all'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-[#1e293b] text-slate-400 hover:text-slate-200 border border-white/6'
              }`}
            >
              All Years
            </button>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(String(y))}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedYear === String(y)
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-[#1e293b] text-slate-400 hover:text-slate-200 border border-white/6'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Sermon Episodes List Header */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-200">
              Messages ({filteredEpisodes.length})
            </h3>
            <button
              onClick={() => setNewestFirst(!newestFirst)}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{newestFirst ? 'Newest First' : 'Oldest First'}</span>
            </button>
          </div>

          {/* Episode List */}
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              <Clock className="w-6 h-6 mx-auto mb-2 animate-spin text-blue-500" />
              Loading catalog from archive...
            </div>
          ) : filteredEpisodes.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm bg-[#1e293b]/50 rounded-2xl border border-white/6">
              No messages match your criteria.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredEpisodes.map(ep => {
                const isSelected = currentEpisode?.id === ep.id;
                const isCurrentPlaying = isSelected && isPlaying;

                return (
                  <div
                    key={ep.id}
                    onClick={() => handlePlayEpisode(ep)}
                    className={`group flex items-center gap-3.5 p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-950/40 border-blue-500/40 ring-1 ring-blue-500/20'
                        : 'bg-[#1e293b] hover:bg-[#243248] border-white/6'
                    }`}
                  >
                    {/* Thumbnail Cover */}
                    <img
                      src={getCoverUrl(ep, 'thumb')}
                      alt={ep.title}
                      loading="lazy"
                      width={52}
                      height={52}
                      className="w-13 h-13 rounded-xl object-cover bg-slate-900 border border-white/6 flex-shrink-0"
                    />

                    {/* Metadata */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                          #{String(ep.number).padStart(4, '0')} · {ep.year}
                        </span>
                        {ep.hasAudio ? (
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                            64k AAC
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                            Queued
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-white truncate leading-snug">
                        {ep.title}
                      </h4>

                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span>
                          {new Date(ep.pubDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span>·</span>
                        <span>{Math.floor(ep.durationSeconds / 60)} min</span>
                      </div>
                    </div>

                    {/* Play/Action Button */}
                    <div className="flex items-center gap-1.5">
                      {ep.hasAudio && (
                        <a
                          href={`/audio/${ep.id}?download=1`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                          title="Download speech-optimised audio"
                          download
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}

                      <button
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                          isCurrentPlaying
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40'
                            : 'bg-white/8 group-hover:bg-blue-600 text-white'
                        }`}
                      >
                        {isCurrentPlaying ? (
                          <Pause className="w-4 h-4 fill-white" />
                        ) : (
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Sticky Bottom Mini-Player */}
      {currentEpisode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0f172a]/95 backdrop-blur-xl border-t border-white/10 px-4 py-3 shadow-2xl">
          {/* Progress Seek Bar */}
          <div
            onClick={handleSeek}
            className="w-full h-1.5 bg-slate-800 rounded-full mb-3 cursor-pointer group relative overflow-hidden"
          >
            <div
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              className="h-full bg-blue-500 rounded-full transition-all group-hover:bg-blue-400"
            />
          </div>

          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            {/* Left Track Info */}
            <div 
              className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
              onClick={() => setExpandedPlayer(!expandedPlayer)}
            >
              <img
                src={getCoverUrl(currentEpisode, 'thumb')}
                alt={currentEpisode.title}
                className="w-11 h-11 rounded-lg object-cover bg-slate-900 border border-white/8 flex-shrink-0"
              />
              <div className="min-w-0">
                <h5 className="text-xs font-semibold text-white truncate leading-snug">
                  {currentEpisode.title}
                </h5>
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                  <span>·</span>
                  <span className="text-blue-400">#{currentEpisode.number}</span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={cycleSpeed}
                className="text-[11px] font-bold text-slate-300 bg-white/8 hover:bg-white/12 px-2 py-1 rounded-md"
                title="Playback speed"
              >
                {speed}x
              </button>

              <button
                onClick={() => skipTime(-15)}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
                title="Skip back 15s"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => handlePlayEpisode(currentEpisode)}
                className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-md transition-all"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-black" />
                ) : (
                  <Play className="w-5 h-5 fill-black ml-0.5" />
                )}
              </button>

              <button
                onClick={() => skipTime(30)}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
                title="Skip forward 30s"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <a
                href={`/audio/${currentEpisode.id}?download=1`}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
                title="Download"
                download
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Player Modal */}
      {expandedPlayer && currentEpisode && (
        <div className="fixed inset-0 z-50 bg-[#0b1120]/95 backdrop-blur-2xl flex flex-col justify-between p-6 overflow-y-auto animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setExpandedPlayer(false)}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
              Now Playing
            </span>
            <div className="w-9" />
          </div>

          <div className="flex flex-col items-center max-w-sm mx-auto my-auto text-center w-full">
            <img
              src={getCoverUrl(currentEpisode, 'large')}
              alt={currentEpisode.title}
              className="w-64 h-64 rounded-2xl shadow-2xl object-cover border border-white/10 mb-6"
            />
            <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">
              Episode #{currentEpisode.number} · {currentEpisode.year}
            </div>
            <h3 className="text-lg font-bold text-white mb-2 leading-tight">
              {currentEpisode.title}
            </h3>
            <p className="text-xs text-slate-400 line-clamp-3 mb-6 leading-relaxed">
              {currentEpisode.description}
            </p>

            {/* Seek Bar */}
            <div className="w-full mb-4">
              <div
                onClick={handleSeek}
                className="w-full h-2 bg-slate-800 rounded-full cursor-pointer relative overflow-hidden"
              >
                <div
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  className="h-full bg-blue-500 rounded-full"
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Full Controls */}
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={cycleSpeed}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/8 text-slate-300"
              >
                {speed}x
              </button>
              <button
                onClick={() => skipTime(-15)}
                className="p-3 text-slate-300 hover:text-white"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
              <button
                onClick={() => handlePlayEpisode(currentEpisode)}
                className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-xl shadow-blue-600/40"
              >
                {isPlaying ? <Pause className="w-7 h-7 fill-white" /> : <Play className="w-7 h-7 fill-white ml-0.5" />}
              </button>
              <button
                onClick={() => skipTime(30)}
                className="p-3 text-slate-300 hover:text-white"
              >
                <RotateCw className="w-6 h-6" />
              </button>
              <a
                href={`/audio/${currentEpisode.id}?download=1`}
                download
                className="p-3 text-slate-300 hover:text-white"
              >
                <Download className="w-6 h-6" />
              </a>
            </div>
          </div>

          <div className="text-center text-[11px] text-slate-500">
            Speech-Optimised Mono AAC 64 kbps · FastStart Streaming Proxy
          </div>
        </div>
      )}

      {/* Archive State / Status Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">PAV Podcast Architecture</h3>
              </div>
              <button 
                onClick={() => setShowStatusModal(false)}
                className="text-xs text-slate-400 hover:text-white bg-slate-800 px-2 py-1 rounded-md"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/6 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Feed Episodes:</span>
                  <span className="font-semibold text-white">512</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Audio Spec:</span>
                  <span className="font-semibold text-emerald-400">AAC mono @ 64 kbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Embedded Artwork:</span>
                  <span className="font-semibold text-white">600x600 JPEG attached_pic</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Web Artwork:</span>
                  <span className="font-semibold text-white">WebP 320px & 800px (Deduplicated)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Release Storage:</span>
                  <span className="font-semibold text-white">GitHub Releases (audio-YYYY)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Streaming Proxy:</span>
                  <span className="font-semibold text-white">Cloudflare Worker (HTTP 206 Range)</span>
                </div>
              </div>

              <p className="text-slate-400">
                Chained GitHub Actions pipeline automatically processes all pending sermons oldest-first and pushes progress after every episode.
              </p>

              <div className="pt-2">
                <a
                  href="https://github.com/vjumbo264/pav-podcast"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  View GitHub Repository
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
