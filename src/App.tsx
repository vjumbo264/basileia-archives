import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Volume2,
  VolumeX,
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
  Disc3,
  BookmarkCheck,
  Radio
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
  const [visibleCount, setVisibleCount] = useState(15);

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
    <div className="min-h-screen flex flex-col font-sans transition-colors duration-200" style={{ backgroundColor: 'var(--canvas)', color: 'var(--text-primary)' }}>
      {/* Toast Notification */}
      {copiedId && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-bounce transition-transform"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--accent-text)',
            boxShadow: 'var(--shadow-float)'
          }}
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>Message link copied to clipboard</span>
        </div>
      )}

      {/* Top Header */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md transition-colors"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--canvas) 88%, transparent)',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
          {/* Brand Lockup */}
          <div className="flex items-center gap-3">
            {/* Geometric Crown / Arch Emblem */}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors"
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border-subtle)'
              }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                <path d="M4 19V7l5 5 3-7 3 7 5-5v12H4z" />
                <path d="M4 19h16" />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-none" style={{ color: 'var(--text-primary)' }}>
                Basileia Archives
              </h1>
              <p className="text-xs sm:text-xs font-medium tracking-normal mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Messages by Pastor Alexander Victor · The Truth Simply Put
              </p>
            </div>
          </div>

          {/* Quick Search in Header */}
          <div className="flex items-center gap-2.5 w-full sm:w-80">
            <div className="relative w-full">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-tertiary)' }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setVisibleCount(30);
                }}
                placeholder="Search sermons, scriptures, keywords..."
                aria-label="Search sermon archive"
                className="w-full text-xs sm:text-sm pl-9 pr-8 py-2 rounded-xl transition-all outline-none"
                style={{
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search input"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <a
              href="https://github.com/vjumbo264/basileia-archives"
              target="_blank"
              rel="noreferrer"
              aria-label="View public archive repository on GitHub"
              className="p-2.5 rounded-xl shrink-0 transition-colors hidden md:inline-flex items-center justify-center"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}
              title="GitHub Public Archive"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1 w-full space-y-8 sm:space-y-10">
        {/* Loading Skeletons */}
        {loading && (
          <div className="space-y-6 animate-pulse" aria-label="Loading archive catalog">
            <div
              className="h-44 sm:h-52 rounded-2xl animate-shimmer"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border-subtle)'
              }}
            />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-28 rounded-xl animate-shimmer"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border-subtle)'
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Error State with Real Retry */}
        {error && !loading && (
          <div
            className="rounded-2xl p-6 sm:p-8 text-center space-y-4 max-w-lg mx-auto transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)'
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)'
              }}
            >
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base sm:text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Could Not Load Archive
              </h2>
              <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {error}
              </p>
            </div>
            <button
              onClick={loadCatalog}
              className="inline-flex items-center justify-center gap-2 text-xs font-semibold px-5 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer min-h-[44px]"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* Content Loaded */}
        {!loading && !error && catalog && (
          <>
            {/* 1. LATEST MESSAGE FEATURED CARD (Hero Anchor) */}
            {latestMessage && !searchQuery && selectedYear === 'all' && (
              <section
                aria-label="Latest message"
                className="rounded-2xl p-5 sm:p-7 relative overflow-hidden transition-all"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-card)'
                }}
              >
                {/* Hero Kicker */}
                <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-md"
                      style={{
                        backgroundColor: 'var(--accent-gold-subtle)',
                        color: 'var(--accent-gold)',
                        border: '1px solid var(--accent-gold-border)'
                      }}
                    >
                      Latest Archive Addition
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] hidden sm:inline">
                      Message #{latestMessage.number}
                    </span>
                  </div>
                  <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                    {latestMessage.date}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-start">
                  {/* Artwork */}
                  <div className="relative shrink-0 mx-auto sm:mx-0">
                    <img
                      src={latestMessage.coverThumbUrl || latestMessage.coverLargeUrl || DEFAULT_ARTWORK}
                      alt={latestMessage.title}
                      width={120}
                      height={120}
                      loading="eager"
                      className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl object-cover shrink-0"
                      style={{
                        backgroundColor: 'var(--cover-fallback-bg)',
                        border: '1px solid var(--cover-border)'
                      }}
                      onError={(e: any) => {
                        e.target.src = DEFAULT_ARTWORK;
                      }}
                    />
                  </div>

                  <div className="flex-1 space-y-2.5 min-w-0 text-center sm:text-left w-full">
                    {/* Unboxed Metadata Line (Zero-Pill Discipline) */}
                    <div className="flex items-center justify-center sm:justify-start gap-2 text-xs flex-wrap tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-semibold" style={{ color: 'var(--accent)' }}>Pastor Alexander Victor</span>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDuration(latestMessage.durationSeconds)}
                      </span>
                      {latestMessage.bytes > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3.5 h-3.5" />
                            {formatFileSize(latestMessage.bytes)}
                          </span>
                        </>
                      )}
                    </div>

                    <h2
                      className="font-display text-xl sm:text-2xl font-bold leading-snug line-clamp-2"
                      style={{ color: 'var(--text-primary)', textWrap: 'balance' }}
                    >
                      {latestMessage.title}
                    </h2>

                    {latestMessage.description && (
                      <p className="text-xs sm:text-sm line-clamp-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {latestMessage.description}
                      </p>
                    )}

                    {/* Action buttons */}
                    <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                      <button
                        onClick={() => {
                          if (activeAudioId === latestMessage.id) {
                            setActiveAudioId(null);
                          } else {
                            handlePlay(latestMessage.id);
                          }
                        }}
                        className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer min-h-[44px]"
                        style={{
                          backgroundColor: 'var(--accent)',
                          color: 'var(--accent-text)'
                        }}
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>{activeAudioId === latestMessage.id ? 'Hide Player' : 'Listen Now'}</span>
                      </button>

                      <a
                        href={latestMessage.audioUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all cursor-pointer min-h-[44px]"
                        style={{
                          backgroundColor: 'var(--surface-elevated)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <Download className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        <span>Download ({formatFileSize(latestMessage.bytes)})</span>
                      </a>

                      <button
                        onClick={e => handleCopyLink(latestMessage, e)}
                        className="p-2.5 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                        style={{
                          backgroundColor: 'var(--surface-elevated)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)'
                        }}
                        title="Copy share link"
                        aria-label="Copy share link to latest message"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Revealed Native Audio */}
                    {activeAudioId === latestMessage.id && (
                      <div
                        className="mt-4 pt-3.5 pb-2 px-4 rounded-xl space-y-2 transition-all"
                        style={{
                          backgroundColor: 'var(--audio-container)',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                            <Radio className="w-3.5 h-3.5" />
                            <span>Direct Audio Stream</span>
                          </span>
                          <span className="tabular-nums text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            Mono AAC 64 kbps · FastStart MP4
                          </span>
                        </div>
                        <audio
                          ref={el => {
                            audioRefs.current[latestMessage.id] = el;
                          }}
                          src={latestMessage.audioUrl}
                          controls
                          preload="auto"
                          autoPlay
                          onPlay={() => handlePlay(latestMessage.id)}
                          className="w-full"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* 2. RECENTLY ADDED HORIZONTAL CAROUSEL */}
            {recentlyAdded.length > 0 && !searchQuery && selectedYear === 'all' && (
              <section aria-label="Recently added messages" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Recently Added Messages
                  </h3>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    Swipe horizontally to browse
                  </span>
                </div>

                <div className="flex gap-3.5 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth no-scrollbar">
                  {recentlyAdded.map(ep => (
                    <div
                      key={`recent-${ep.id}`}
                      onClick={() => {
                        handlePlay(ep.id);
                        const el = document.getElementById(ep.id);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handlePlay(ep.id);
                        }
                      }}
                      className="snap-start w-48 shrink-0 rounded-xl p-3.5 cursor-pointer transition-all flex flex-col justify-between space-y-2.5 group"
                      style={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border-subtle)',
                        boxShadow: 'var(--shadow-soft)'
                      }}
                    >
                      <div className="space-y-2">
                        <div className="relative overflow-hidden rounded-lg">
                          <img
                            src={ep.coverThumbUrl || DEFAULT_ARTWORK}
                            alt={ep.title}
                            width={160}
                            height={100}
                            loading="lazy"
                            className="w-full h-24 object-cover transition-transform group-hover:scale-105"
                            style={{
                              backgroundColor: 'var(--cover-fallback-bg)',
                              border: '1px solid var(--cover-border)'
                            }}
                            onError={(e: any) => {
                              e.target.src = DEFAULT_ARTWORK;
                            }}
                          />
                        </div>

                        <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                          {ep.date} · {formatDuration(ep.durationSeconds)}
                        </div>

                        <h4
                          className="text-xs font-bold leading-snug line-clamp-2 transition-colors"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {ep.title}
                        </h4>
                      </div>

                      <div
                        className="flex items-center justify-between pt-1 text-[11px] font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        <span>Listen Now</span>
                        <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 3. BROWSE BY YEAR FILTER & SORT CONTROLS */}
            <section aria-label="Archive filters" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Archive Catalog
                  </h3>
                  <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                    ({filteredEpisodes.length} messages)
                  </span>
                </div>

                {/* Sort Toggle Button */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => setSortOrder(prev => (prev === 'newest' ? 'oldest' : 'newest'))}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer min-h-[36px]"
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)'
                    }}
                    title="Toggle chronological sorting"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span>{sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}</span>
                  </button>
                </div>
              </div>

              {/* Segmented Year Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Filter by sermon year">
                <button
                  role="tab"
                  aria-selected={selectedYear === 'all'}
                  onClick={() => {
                    setSelectedYear('all');
                    setVisibleCount(30);
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg shrink-0 transition-all cursor-pointer min-h-[36px] flex items-center gap-1.5"
                  style={{
                    backgroundColor: selectedYear === 'all' ? 'var(--accent)' : 'var(--surface)',
                    color: selectedYear === 'all' ? 'var(--accent-text)' : 'var(--text-secondary)',
                    border: selectedYear === 'all' ? '1px solid transparent' : '1px solid var(--border-subtle)',
                    boxShadow: selectedYear === 'all' ? 'var(--shadow-soft)' : 'none'
                  }}
                >
                  <span>All Years</span>
                  <span className="tabular-nums text-[10px] opacity-80">
                    ({catalog.episodes.length})
                  </span>
                </button>

                {availableYears.map(yr => (
                  <button
                    key={yr}
                    role="tab"
                    aria-selected={selectedYear === yr}
                    onClick={() => {
                      setSelectedYear(yr);
                      setVisibleCount(30);
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg shrink-0 transition-all cursor-pointer min-h-[36px] flex items-center gap-1.5"
                    style={{
                      backgroundColor: selectedYear === yr ? 'var(--accent)' : 'var(--surface)',
                      color: selectedYear === yr ? 'var(--accent-text)' : 'var(--text-secondary)',
                      border: selectedYear === yr ? '1px solid transparent' : '1px solid var(--border-subtle)',
                      boxShadow: selectedYear === yr ? 'var(--shadow-soft)' : 'none'
                    }}
                  >
                    <span>{yr}</span>
                    <span className="tabular-nums text-[10px] opacity-80">
                      ({yearCounts[yr]})
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* 4. MESSAGE LIST / CARDS */}
            <section aria-label="Message list" className="space-y-3">
              {filteredEpisodes.length === 0 && (
                <div
                  className="rounded-2xl p-8 sm:p-12 text-center space-y-3 transition-colors"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <Search className="w-8 h-8 mx-auto" style={{ color: 'var(--text-tertiary)' }} />
                  <h4 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                    No messages found
                  </h4>
                  <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                    No sermons match "{searchQuery}" in {selectedYear === 'all' ? 'all years' : selectedYear}.
                  </p>
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedYear('all');
                    }}
                    className="mt-2 text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer min-h-[44px]"
                    style={{
                      backgroundColor: 'var(--accent-subtle)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent-border)'
                    }}
                  >
                    Reset all filters
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {filteredEpisodes.slice(0, visibleCount).map(ep => {
                  const isPlayingThis = activeAudioId === ep.id;
                  const isHighlighted = highlightedId === ep.id;

                  return (
                    <article
                      id={ep.id}
                      key={ep.id}
                      className="rounded-xl p-4 sm:p-5 transition-all"
                      style={{
                        backgroundColor: isHighlighted ? 'var(--surface-elevated)' : 'var(--surface)',
                        border: isHighlighted ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                        boxShadow: 'var(--shadow-soft)'
                      }}
                    >
                      <div className="flex gap-4 items-start">
                        {/* Cover thumbnail */}
                        <div className="relative shrink-0 pt-0.5">
                          <img
                            src={ep.coverThumbUrl || DEFAULT_ARTWORK}
                            alt={ep.title}
                            width={72}
                            height={72}
                            loading="lazy"
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover"
                            style={{
                              backgroundColor: 'var(--cover-fallback-bg)',
                              border: '1px solid var(--cover-border)'
                            }}
                            onError={(e: any) => {
                              e.target.src = DEFAULT_ARTWORK;
                            }}
                          />
                        </div>

                        {/* Episode Info */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* Unboxed Metadata Line (Zero-Pill Discipline) */}
                          <div className="flex items-center gap-2 text-xs flex-wrap tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                              #{ep.number}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{ep.date}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatDuration(ep.durationSeconds)}</span>
                            {ep.bytes > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span style={{ color: 'var(--text-tertiary)' }}>{formatFileSize(ep.bytes)}</span>
                              </>
                            )}
                          </div>

                          <h4
                            className="text-sm sm:text-base font-bold leading-snug line-clamp-2"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {ep.title}
                          </h4>

                          {ep.description && (
                            <p
                              className="text-xs line-clamp-1 leading-relaxed"
                              style={{ color: 'var(--text-secondary)' }}
                            >
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
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-[38px]"
                              style={{
                                backgroundColor: isPlayingThis ? 'var(--accent)' : 'var(--accent-subtle)',
                                color: isPlayingThis ? 'var(--accent-text)' : 'var(--accent)',
                                border: isPlayingThis ? '1px solid transparent' : '1px solid var(--accent-border)'
                              }}
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>{isPlayingThis ? 'Hide Player' : 'Listen'}</span>
                            </button>

                            <a
                              href={ep.audioUrl}
                              download
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-[38px]"
                              style={{
                                backgroundColor: 'var(--surface-elevated)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border-subtle)'
                              }}
                            >
                              <Download className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                              <span>Download</span>
                            </a>

                            <button
                              onClick={e => handleCopyLink(ep, e)}
                              className="p-2 rounded-lg transition-colors cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
                              style={{
                                backgroundColor: 'transparent',
                                color: 'var(--text-tertiary)'
                              }}
                              title="Copy link to sermon"
                              aria-label={`Copy link to sermon #${ep.number}`}
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Native HTML5 Audio Player for this Episode */}
                      {isPlayingThis && (
                        <div
                          className="mt-3.5 pt-3 pb-2 px-3.5 rounded-xl space-y-2 transition-all"
                          style={{
                            backgroundColor: 'var(--audio-container)',
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                              <Radio className="w-3.5 h-3.5" />
                              <span>Direct Audio Stream</span>
                            </span>
                            <span className="tabular-nums text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              64 kbps mono AAC
                            </span>
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
                            className="w-full"
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
                    className="inline-flex items-center gap-2 text-xs font-semibold px-6 py-3 rounded-xl shadow-sm transition-all cursor-pointer min-h-[44px]"
                    style={{
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <span>Load More Messages ({filteredEpisodes.length - visibleCount} remaining)</span>
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer
        className="py-8 px-4 sm:px-6 mt-auto transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border-subtle)'
        }}
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="space-y-1">
            <p className="font-display text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Basileia Archives
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              The Basileia Commission · free to listen, download, and share publicly
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            <span>Pastor Alexander Victor</span>
            <span aria-hidden="true">·</span>
            <a
              href="https://github.com/vjumbo264/basileia-archives"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span>GitHub Public Archive</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
