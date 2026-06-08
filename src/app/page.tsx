'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';

const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'];

const AVATARS = [
  '😀','😎','🤓','🧐','😏','🥳','🤩','😤','🫡','🤠',
  '🦊','🐱','🐶','🦁','🐸','🐵','🦄','🐧','🐼','🐨',
  '🦋','🐝','🐙','🦈','🐉','🦅','🐺','🦖','🐯','🐻',
  '🌟','🔥','💎','🎯','🎲','🎪','⚡','🍀','🎭','🏆',
  '👑','💫','🌸','🎸','🚀','🌊','🎵','🍕','👻','💀',
];

function FloatingSuits() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const suits: HTMLSpanElement[] = [];
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('span');
      el.className = 'floating-suit';
      el.textContent = SUIT_SYMBOLS[i % 4];
      el.style.color = i % 4 === 1 || i % 4 === 2 ? 'rgba(212,175,55,0.08)' : 'rgba(245,240,225,0.04)';
      el.style.fontSize = `${1.2 + Math.random() * 1.8}rem`;
      container.appendChild(el);
      suits.push(el);
    }

    suits.forEach((el, i) => {
      const startX = Math.random() * 100;
      const duration = 12 + Math.random() * 16;
      gsap.set(el, { x: `${startX}vw`, y: '110vh', opacity: 0 });
      gsap.to(el, {
        y: '-10vh',
        x: `+=${(Math.random() - 0.5) * 200}`,
        rotation: (Math.random() - 0.5) * 360,
        opacity: 0.1,
        duration,
        delay: i * 1.2,
        repeat: -1,
        ease: 'none',
      });
    });

    return () => {
      suits.forEach(el => el.remove());
    };
  }, []);

  return <div ref={containerRef} className="floating-suits" />;
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savedAvatar, setSavedAvatar] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [showLog, setShowLog] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth')
      .then(r => r.json())
      .then(data => {
        if (data.name) {
          setSavedName(data.name);
          setName(data.name);
          setSavedAvatar(data.avatar || '');
          setAvatar(data.avatar || '');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const tl = gsap.timeline();
    tl.fromTo(panelRef.current,
      { y: 40, opacity: 0, scale: 0.95 },
      { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.4)' }
    );
    if (titleRef.current) {
      tl.fromTo(titleRef.current,
        { y: -20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' },
        '-=0.3'
      );
      gsap.to(titleRef.current, {
        backgroundPosition: '-200% 0',
        duration: 3,
        repeat: -1,
        ease: 'linear',
      });
    }
    if (contentRef.current) {
      const children = contentRef.current.children;
      tl.fromTo(children,
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'power2.out' },
        '-=0.2'
      );
    }
  }, [loading, savedName, editingProfile]);

  async function saveProfile() {
    if (!name.trim()) return;
    setError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), avatar }),
    });
    const data = await res.json();
    if (res.ok) {
      setSavedName(data.name);
      setSavedAvatar(data.avatar || '');
      setEditingProfile(false);
    } else {
      setError(data.error);
    }
  }

  async function createGame() {
    setError('');
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showLog }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/game/${data.code}`);
    } else {
      setError(data.error);
    }
  }

  async function joinGame() {
    if (!joinCode.trim()) return;
    setError('');
    const code = joinCode.trim().toUpperCase();
    const res = await fetch(`/api/games/${code}/join`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      router.push(`/game/${code}`);
    } else {
      setError(data.error);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gold-light/50 animate-pulse">Loading...</div>
      </div>
    );
  }

  const showSetup = !savedName || editingProfile;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <FloatingSuits />

      {/* Top navbar with profile */}
      {savedName && !editingProfile && (
        <nav className="fixed top-0 left-0 right-0 z-20 bg-wood-dark/60 backdrop-blur-sm border-b border-wood/30 px-4 py-2 flex items-center justify-between">
          <span className="text-gold font-bold text-sm tracking-tight font-heading">Literature</span>
          <button
            onClick={() => setEditingProfile(true)}
            className="profile-btn"
            title="Edit Profile"
          >
            <span className="avatar-circle sm">
              {savedAvatar || savedName.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm text-gold-light mr-1">{savedName}</span>
          </button>
        </nav>
      )}

      <div ref={panelRef} className="glass-panel rounded-2xl p-5 sm:p-8 max-w-lg w-full relative z-10" style={{ opacity: 0 }}>
        <h1 ref={titleRef} className="text-3xl sm:text-5xl font-bold text-center mb-1 title-shimmer tracking-tight" style={{ opacity: 0 }}>
          Literature
        </h1>
        <p className="text-center text-gold-light/40 mb-5 sm:mb-8 text-xs sm:text-sm tracking-wide">
          The classic card game
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-300 px-4 py-2.5 rounded-xl mb-4 text-sm font-medium">
            {error}
          </div>
        )}

        <div ref={contentRef}>
          {showSetup ? (
            /* ─── Profile Setup ─── */
            <div className="space-y-5">
              {/* Avatar Picker */}
              <div>
                <label className="block text-sm text-gold-light/60 mb-2 font-medium">Pick your avatar</label>
                <div className="avatar-grid">
                  {AVATARS.map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAvatar(a)}
                      className={avatar === a ? 'selected' : ''}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name Input */}
              <div>
                <label className="block text-sm text-gold-light/60 mb-2 font-medium">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveProfile()}
                  placeholder="Enter your name"
                  maxLength={20}
                  autoFocus
                  className="input-field"
                />
              </div>

              <div className="flex gap-3">
                {editingProfile && (
                  <button
                    onClick={() => {
                      setEditingProfile(false);
                      setName(savedName || '');
                      setAvatar(savedAvatar || '');
                    }}
                    className="btn-secondary flex-1 py-3"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={saveProfile}
                  disabled={!name.trim()}
                  className="btn-primary flex-1 py-3 text-lg"
                >
                  {editingProfile ? 'Save' : 'Continue'}
                </button>
              </div>
            </div>
          ) : (
            /* ─── Main Menu ─── */
            <>
              {/* Profile Card */}
              <div className="panel-section p-3 sm:p-4 mb-4 sm:mb-6 flex items-center gap-3 sm:gap-4">
                <div className="avatar-circle lg">
                  {savedAvatar || savedName?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] sm:text-xs text-gold-light/40 uppercase tracking-widest">Playing as</div>
                  <div className="text-base sm:text-lg font-semibold text-gold-light truncate">{savedName}</div>
                </div>
                <button
                  onClick={() => setEditingProfile(true)}
                  className="text-xs text-gold-light/50 hover:text-gold transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-felt-light/15"
                >
                  Edit
                </button>
              </div>

              {/* Game Settings */}
              <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
                {/* Game Log Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gold-light/60 font-medium">Game Log</label>
                  <button
                    onClick={() => setShowLog(!showLog)}
                    className={`relative w-12 h-6 rounded-full transition-all ${showLog ? 'bg-gold shadow-md shadow-gold/20' : 'bg-felt-dark/60 border border-wood/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${showLog ? 'translate-x-6' : ''}`} />
                  </button>
                </div>
                {!showLog && (
                  <div className="text-xs text-gold-light/40 text-center -mt-2">
                    Game log will be hidden for all players
                  </div>
                )}

                <div className="text-xs text-gold-light/40 text-center">
                  Seats (6, 8, or 12) are auto-determined based on how many players join
                </div>
              </div>

              {/* Create Game */}
              <button onClick={createGame} className="btn-primary w-full py-3.5 text-lg mb-1">
                Create New Game
              </button>

              {/* Divider */}
              <div className="relative my-6">
                <div className="divider" />
                <div className="relative flex justify-center -mt-2.5">
                  <span className="px-3 text-xs text-gold-light/40 uppercase tracking-wider" style={{ background: 'var(--bg-primary)' }}>
                    or join a game
                  </span>
                </div>
              </div>

              {/* Join Game */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && joinGame()}
                  placeholder="Game code"
                  maxLength={6}
                  className="input-field flex-1 uppercase tracking-[0.2em] text-center font-mono"
                />
                <button onClick={joinGame} className="btn-secondary px-6 py-3 font-semibold">
                  Join
                </button>
              </div>

              {/* How to Play */}
              <div className="mt-8 pt-6 border-t border-wood/20">
                <h3 className="text-gold/80 font-semibold mb-2 text-sm font-heading">How to Play</h3>
                <ul className="text-gold-light/50 text-xs space-y-1.5 list-disc list-inside leading-relaxed">
                  <li>6+ players — seats (6, 8, or 12) auto-fit to player count, extras pair up</li>
                  <li>48 cards: low 2-7 and high 9-A, with no 8s</li>
                  <li>Ask opponents for specific cards you need</li>
                  <li>Claim half-suits by declaring who holds each card</li>
                  <li>Team with the most claimed sets wins!</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
