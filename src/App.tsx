import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Volume2,
  Download,
  Share2,
  Calendar,
  Clock,
  HardDrive,
  Check,
  AlertCircle,
  RefreshCw,
  ArrowUpDown,
  X,
  ExternalLink,
  ChevronRight,
  Disc3
} from 'lucide-react';

interface Episode {
  id: string;
  number: number;
  title: string;
  date: string;
  year: number;
  durationSeconds: number;
  bytes: number;
  description: string;
  audioUrl: string;
  coverThumbUrl: string;
  coverLargeUrl: string;
}

interface CatalogData {
  updatedAt: string;
  totalEpisodes: number;
  show: {
    title: string;
    subtitle: string;
    author: string;
    artwork: string;
  };
  episodes: Episode[];
}

const DEFAULT_ARTWORK = 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
const RAW_CATALOG_URL = 'https://raw.githubusercontent.com/vjumbo264/basileia-archives/main/catalog.json';

export default function App() {
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [visibleCount, setVisibleCount] = useState(30);

  // Active playing episode id
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  // Toast for copy link
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Load catalog data
  const loadCatalog = async () => {
    setLoading(true);
    setError(null);

    // 1. First try relative /catalog.json (fastest when served locally or bundled)
    try {
      const res = await fetch('/catalog.json?v=' + Date.now());
      if (res.ok) {
        const data: CatalogData = await res.json();
        if (data && Array.isArray(data.episodes) && data.episodes.length > 0) {
          setCatalog(data);
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      // Continue to fallback
    }

    // 2. Fallback to raw GitHub usercontent URL
    try {
      const res = await fetch(RAW_CATALOG_URL + '?v=' + Date.now());
      if (res.ok) {
        const data: CatalogData = await res.json();
        if (data && Array.isArray(data.episodes)) {
          setCatalog(data);
          setLoading(false);
          return;
        }
      }
      throw new Error(`Failed to load archive catalog (HTTP ${res.status})`);
    } catch (err: any) {
      console.error('Failed to fetch catalog:', err);
      setError(err.message || 'Could not connect to archive catalog. Please check your network and try again.');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Handle URL hash permalink on load
  useEffect(() => {
    if (!catalog) return;
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const matched = catalog.episodes.find(
        ep => ep.id === hash || `ep-${ep.number}` === hash || `ep-${ep.id}` === hash
      );
      if (matched) {
        setHighlightedId(matched.id);
        setActiveAudioId(matched.id);
        setTimeout(() => {
          const el = document.getElementById(matched.id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
      }
    }
  }, [catalog]);

  // Pause other audio elements when one starts playing
  const handlePlay = (id: string) => {
    Object.keys(audioRefs.current).forEach(key => {
      if (key !== id && audioRefs.current[key]) {
        audioRefs.current[key]?.pause();
      }
    });
    setActiveAudioId(id);
  };

  const handleCopyLink = (ep: Episode, e: React.MouseEvent) => {
    e.stopPropagation();
    const permalink = `${window.location.origin}${window.location.pathname}#ep-${ep.id}`;
    navigator.clipboard.writeText(permalink).then(() => {
      setCopiedId(ep.id);
      setTimeout(() => setCopiedId(null), 2500);
    });
  };

  const formatDuration = (secs: number) => {
    if (!secs) return 'Unknown';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Compute years and counts
  const { yearCounts, availableYears } = useMemo(() => {
    const counts: { [year: number]: number } = {};
    if (!catalog) return { yearCounts: counts, availableYears: [] };
    catalog.episodes.forEach(ep => {
      counts[ep.year] = (counts[ep.year] || 0) + 1;
    });
    const years = Object.keys(counts)
      .map(Number)
      .sort((a, b) => b - a);
    return { yearCounts: counts, availableYears: years };
  }, [catalog]);

  // Filtered and sorted episodes
  const filteredEpisodes = useMemo(() => {
    if (!catalog) return [];
    let list = catalog.episodes;

    if (selectedYear !== 'all') {
      list = list.filter(ep => ep.year === selectedYear);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        ep =>
          ep.title.toLowerCase().includes(q) ||
          (ep.description && ep.description.toLowerCase().includes(q)) ||
          String(ep.number) === q
      );
    }

    const sorted = [...list].sort((a, b) => {
      const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
      return sortOrder === 'newest' ? diff : -diff;
    });

    return sorted;
  }, [catalog, selectedYear, searchQuery, sortOrder]);

  const latestMessage = useMemo(() => {
    if (!catalog || catalog.episodes.length === 0) return null;
    return [...catalog.episodes].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];
  }, [catalog]);

  const recentlyAdded = useMemo(() => {
    if (!catalog || catalog.episodes.length === 0) return [];
    return [...catalog.episodes]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);
  }, [catalog]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Toast Notification */}
      {copiedId && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg shadow-blue-900/40 flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>Message link copied to clipboard</span>
        </div>
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Basileia Archives
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 font-medium mt-0.5">
              Messages by Pastor Alexander Victor
            </p>
          </div>

          {/* Quick Search in Header */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setVisibleCount(30);
              }}
              placeholder="Search title, keywords, #..."
              className="w-full bg-[#1e293b] text-white text-sm pl-9 pr-8 py-2 rounded-xl border border-slate-700/80 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6 space-y-8">
        {/* Loading State Skeleton */}
        {loading && (
          <div className="space-y-6 animate-pulse">
            <div className="h-44 bg-[#1e293b] rounded-2xl border border-slate-800"></div>
            <div className="flex gap-2 overflow-x-hidden">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 w-20 bg-[#1e293b] rounded-full"></div>
              ))}
            </div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-28 bg-[#1e293b] rounded-xl border border-slate-800"></div>
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-red-200">Could Not Load Archive</h3>
              <p className="text-xs text-red-300/80 max-w-md mx-auto">{error}</p>
            </div>
            <button
              onClick={loadCatalog}
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-red-950"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* Content Loaded */}
        {!loading && !error && catalog && (
          <>
            {/* 1. LATEST MESSAGE FEATURED CARD */}
            {latestMessage && !searchQuery && selectedYear === 'all' && (
              <section className="bg-gradient-to-br from-[#1e293b] to-[#172033] border border-blue-500/20 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl shadow">
                  Latest Message
                </div>

                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center">
                  <img
                    src={latestMessage.coverThumbUrl || latestMessage.coverLargeUrl || DEFAULT_ARTWORK}
                    alt={latestMessage.title}
                    width={96}
                    height={96}
                    loading="lazy"
                    className="w-24 h-24 rounded-xl object-cover bg-slate-900 border border-slate-700/60 shadow-md shrink-0"
                    onError={(e: any) => {
                      e.target.src = DEFAULT_ARTWORK;
                    }}
                  />

                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1 font-medium text-blue-400">
                        <Calendar className="w-3.5 h-3.5" />
                        {latestMessage.date}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDuration(latestMessage.durationSeconds)}
                      </span>
                      {latestMessage.bytes > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1 text-slate-400">
                            <HardDrive className="w-3.5 h-3.5" />
                            {formatFileSize(latestMessage.bytes)}
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="text-base sm:text-lg font-bold text-white line-clamp-2 leading-snug">
                      {latestMessage.title}
                    </h2>

                    {latestMessage.description && (
                      <p className="text-xs text-slate-300/80 line-clamp-2">
                        {latestMessage.description}
                      </p>
                    )}

                    {/* Action buttons */}
                    <div className="pt-2 flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={() => {
                          if (activeAudioId === latestMessage.id) {
                            setActiveAudioId(null);
                          } else {
                            handlePlay(latestMessage.id);
                          }
                        }}
                        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-900/30"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>{activeAudioId === latestMessage.id ? 'Close Audio' : 'Listen Now'}</span>
                      </button>

                      <a
                        href={latestMessage.audioUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3.5 py-2.5 rounded-xl border border-slate-700 transition-all"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-300" />
                        <span>Download ({formatFileSize(latestMessage.bytes)})</span>
                      </a>

                      <button
                        onClick={e => handleCopyLink(latestMessage, e)}
                        className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700 transition-all"
                        title="Copy share link"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Revealed Native Audio */}
                    {activeAudioId === latestMessage.id && (
                      <div className="pt-3 animate-fadeIn">
                        <audio
                          ref={el => {
                            audioRefs.current[latestMessage.id] = el;
                          }}
                          src={latestMessage.audioUrl}
                          controls
                          preload="auto"
                          autoPlay
                          onPlay={() => handlePlay(latestMessage.id)}
                          className="w-full rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* 2. RECENTLY ADDED HORIZONTAL CAROUSEL */}
            {recentlyAdded.length > 0 && !searchQuery && selectedYear === 'all' && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Recently Added
                  </h3>
                  <span className="text-xs text-slate-500 font-medium">Swipe to browse</span>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none no-scrollbar">
                  {recentlyAdded.map(ep => (
                    <div
                      key={`recent-${ep.id}`}
                      onClick={() => {
                        handlePlay(ep.id);
                        const el = document.getElementById(ep.id);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      className="w-44 shrink-0 bg-[#1e293b] hover:bg-[#283548] border border-slate-800/80 hover:border-blue-500/30 rounded-xl p-3 cursor-pointer transition-all flex flex-col justify-between space-y-2 group"
                    >
                      <div className="relative">
                        <img
                          src={ep.coverThumbUrl || DEFAULT_ARTWORK}
                          alt={ep.title}
                          width={152}
                          height={96}
                          loading="lazy"
                          className="w-full h-24 rounded-lg object-cover bg-slate-900 border border-slate-700/40"
                          onError={(e: any) => {
                            e.target.src = DEFAULT_ARTWORK;
                          }}
                        />
                        <div className="absolute bottom-1.5 right-1.5 bg-slate-950/80 text-[10px] font-semibold text-slate-200 px-1.5 py-0.5 rounded">
                          {formatDuration(ep.durationSeconds)}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] text-blue-400 font-medium">{ep.date}</div>
                        <h4 className="text-xs font-semibold text-white line-clamp-2 leading-snug group-hover:text-blue-300 transition-colors">
                          {ep.title}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 3. BROWSE BY YEAR CHIPS */}
            <section className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Browse by Year
                </h3>
                <span className="text-xs text-slate-400 font-medium">
                  {catalog.totalEpisodes} total recorded sermons
                </span>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
                <button
                  onClick={() => {
                    setSelectedYear('all');
                    setVisibleCount(30);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                    selectedYear === 'all'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                      : 'bg-[#1e293b] text-slate-400 hover:text-white border border-slate-700/80'
                  }`}
                >
                  All ({catalog.totalEpisodes})
                </button>
                {availableYears.map(yr => (
                  <button
                    key={yr}
                    onClick={() => {
                      setSelectedYear(yr);
                      setVisibleCount(30);
                    }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                      selectedYear === yr
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                        : 'bg-[#1e293b] text-slate-400 hover:text-white border border-slate-700/80'
                    }`}
                  >
                    {yr} ({yearCounts[yr]})
                  </button>
                ))}
              </div>
            </section>

            {/* 4. ALL MESSAGES HEADER & CONTROLS */}
            <section className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {searchQuery ? `Search Results (${filteredEpisodes.length})` : 'All Archive Messages'}
                  </h3>
                  {selectedYear !== 'all' && (
                    <span className="text-xs bg-blue-950 text-blue-300 border border-blue-800/60 px-2 py-0.5 rounded-full font-medium">
                      Year {selectedYear}
                    </span>
                  )}
                </div>

                {/* Sort Order Toggle */}
                <button
                  onClick={() => setSortOrder(prev => (prev === 'newest' ? 'oldest' : 'newest'))}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-[#1e293b] px-2.5 py-1.5 rounded-lg border border-slate-700/80 transition-all"
                  title="Toggle chronological order"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>{sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}</span>
                </button>
              </div>

              {/* Empty state */}
              {filteredEpisodes.length === 0 && (
                <div className="bg-[#1e293b]/50 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
                  <Disc3 className="w-8 h-8 text-slate-500 mx-auto animate-spin" />
                  <p className="text-sm font-semibold text-slate-300">No messages match your search</p>
                  <p className="text-xs text-slate-400">
                    Try searching with another keyword or selecting "All" years.
                  </p>
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedYear('all');
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold underline"
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {/* 5. ALL MESSAGES LIST */}
              <div className="space-y-3">
                {filteredEpisodes.slice(0, visibleCount).map((ep, idx) => {
                  const isPlayingThis = activeAudioId === ep.id;
                  const isHighlighted = highlightedId === ep.id;

                  return (
                    <article
                      key={ep.id}
                      id={ep.id}
                      className={`bg-[#1e293b] border rounded-2xl p-3 sm:p-4 transition-all duration-200 ${
                        isPlayingThis
                          ? 'border-blue-500 bg-[#1e293b] shadow-lg shadow-blue-950/40 ring-1 ring-blue-500/30'
                          : isHighlighted
                          ? 'border-blue-400/80 bg-blue-950/20'
                          : 'border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex gap-3 sm:gap-4 items-start">
                        {/* Cover image */}
                        <div className="relative shrink-0">
                          <img
                            src={ep.coverThumbUrl || DEFAULT_ARTWORK}
                            alt={ep.title}
                            width={56}
                            height={56}
                            loading="lazy"
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-slate-900 border border-slate-700/60"
                            onError={(e: any) => {
                              e.target.src = DEFAULT_ARTWORK;
                            }}
                          />
                          <span className="absolute -bottom-1 -left-1 bg-slate-900/90 text-slate-400 text-[9px] font-mono font-bold px-1 py-0.2 rounded border border-slate-700">
                            #{ep.number}
                          </span>
                        </div>

                        {/* Metadata & Controls */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="text-blue-400 font-medium">{ep.date}</span>
                            <span>·</span>
                            <span>{formatDuration(ep.durationSeconds)}</span>
                            {ep.bytes > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-slate-500">{formatFileSize(ep.bytes)}</span>
                              </>
                            )}
                          </div>

                          <h4 className="text-sm sm:text-base font-bold text-white leading-snug line-clamp-2">
                            {ep.title}
                          </h4>

                          {ep.description && (
                            <p className="text-xs text-slate-400 line-clamp-1 leading-relaxed">
                              {ep.description}
                            </p>
                          )}

                          {/* Action Row */}
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => {
                                if (isPlayingThis) {
                                  setActiveAudioId(null);
                                  audioRefs.current[ep.id]?.pause();
                                } else {
                                  handlePlay(ep.id);
                                }
                              }}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                                isPlayingThis
                                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-900'
                                  : 'bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30'
                              }`}
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>{isPlayingThis ? 'Hide Audio' : 'Listen'}</span>
                            </button>

                            <a
                              href={ep.audioUrl}
                              download
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-all"
                            >
                              <Download className="w-3.5 h-3.5 text-slate-400" />
                              <span>Download</span>
                            </a>

                            <button
                              onClick={e => handleCopyLink(ep, e)}
                              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                              title="Copy link to sermon"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Native HTML5 Audio Player for this Episode */}
                      {isPlayingThis && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-1.5 animate-fadeIn">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="font-semibold text-blue-400">Direct Stream:</span>
                            <span className="font-mono text-slate-500">64k mono AAC</span>
                          </div>
                          <audio
                            ref={el => {
                              audioRefs.current[ep.id] = el;
                            }}
                            src={ep.audioUrl}
                            controls
                            preload="none"
                            autoPlay
                            onPlay={() => handlePlay(ep.id)}
                            className="w-full rounded-lg"
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {/* Load More Button */}
              {visibleCount < filteredEpisodes.length && (
                <div className="text-center pt-4 pb-8">
                  <button
                    onClick={() => setVisibleCount(prev => prev + 30)}
                    className="inline-flex items-center gap-2 bg-[#1e293b] hover:bg-[#283548] text-white text-xs font-semibold px-6 py-3 rounded-xl border border-slate-700/80 shadow-md transition-all active:scale-95"
                  >
                    <span>Load More Messages ({filteredEpisodes.length - visibleCount} remaining)</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-[#0f172a] py-6 px-4 mt-auto">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <p className="text-xs text-slate-400 font-medium">
            The Basileia Commission · free to listen, download and share
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>Pastor Alexander Victor</span>
            <span>·</span>
            <a
              href="https://github.com/vjumbo264/basileia-archives"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-white inline-flex items-center gap-1 transition-colors"
            >
              <span>GitHub Public Archive</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
