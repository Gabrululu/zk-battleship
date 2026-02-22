import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GameLobby } from './components/GameLobby';
import { CommitPhase } from './components/CommitPhase';
import { PlayPhase } from './components/PlayPhase';
import { GameOver } from './components/GameOver';
import { PlayerProfile } from './components/PlayerProfile';
import { useGameState } from './hooks/useGameState';
import { useWallet } from './hooks/useWallet';
import { joinGame, CONTRACT_ID, parseError } from './utils/contract';
import { initAudio, toggleMute } from './utils/sounds';

type AppScreen = 'lobby' | 'commit' | 'play' | 'gameover';

export default function App() {
  const stellar = useWallet();
  const { gameState, refresh } = useGameState();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioInitRef = useRef(false);
  const [inviteContractId, setInviteContractId] = useState<string | null>(null);

  // Read ?game= param from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    if (gameId) {
      setInviteContractId(gameId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleFirstInteraction = useCallback(() => {
    if (audioInitRef.current) return;
    audioInitRef.current = true;
    initAudio();
  }, []);

  const handleMuteToggle = useCallback(() => {
    initAudio();
    audioInitRef.current = true;
    setMuted(toggleMute());
  }, []);

  const screen = deriveScreen(gameState, stellar.address);

  // ── Space canvas animation ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    type Star = { x: number; y: number; r: number; opacity: number; twinkle: number; twinkleSpeed: number };
    type Nebula = { x: number; y: number; r: number; hue: number; opacity: number };
    let stars: Star[] = [];
    let nebulas: Nebula[] = [];
    let W = 0, H = 0;
    let animId: number;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      stars = Array.from({ length: 220 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.4 + 0.2,
        opacity: Math.random() * 0.7 + 0.1,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.018 + 0.004,
      }));
      nebulas = [
        { x: 0.15 * W, y: 0.2 * H,  r: 220, hue: 210, opacity: 0.028 },
        { x: 0.85 * W, y: 0.7 * H,  r: 260, hue: 180, opacity: 0.022 },
        { x: 0.3  * W, y: 0.75 * H, r: 190, hue: 220, opacity: 0.020 },
        { x: 0.7  * W, y: 0.25 * H, r: 200, hue: 200, opacity: 0.025 },
      ];
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      nebulas.forEach(n => {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `hsla(${n.hue},80%,50%,${n.opacity * 2})`);
        g.addColorStop(0.5, `hsla(${n.hue},60%,40%,${n.opacity})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      });
      stars.forEach(s => {
        s.twinkle += s.twinkleSpeed;
        const alpha = s.opacity * (0.6 + 0.4 * Math.sin(s.twinkle));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,225,255,${alpha})`;
        ctx.fill();
        if (s.r > 1.1) {
          ctx.strokeStyle = `rgba(200,225,255,${alpha * 0.35})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(s.x - s.r * 3, s.y); ctx.lineTo(s.x + s.r * 3, s.y);
          ctx.moveTo(s.x, s.y - s.r * 3); ctx.lineTo(s.x, s.y + s.r * 3);
          ctx.stroke();
        }
      });
      animId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  const handleJoin = useCallback(
    async (_role: 'player1' | 'player2') => {
      if (!stellar.address) return;
      setJoining(true);
      setJoinError(null);
      try {
        await joinGame(stellar.address, stellar.signTransaction);
        await refresh();
      } catch (err) {
        setJoinError(parseError(err));
      } finally {
        setJoining(false);
      }
    },
    [stellar, refresh],
  );

  const handleNewGame = useCallback(() => { window.location.reload(); }, []);

  const phaseLabel = gameState?.phase ?? null;

  return (
    <>
      <canvas id="space-canvas" ref={canvasRef} />
      <div id="sonar-sweep" />
      <div className="app" onClick={handleFirstInteraction}>
        <header className="app-header">
          <div className="header-brand">
            <span className="header-zk">ZK</span>
            <span className="header-sep">⬡</span>
            <span className="header-name">BATTLESHIP</span>
          </div>
          <div className="header-meta">
            <div className="hud-indicator">
              <div className="hud-dot" />
              STELLAR TESTNET
            </div>
            {phaseLabel && (
              <div className="hud-indicator" style={{ color: 'var(--sonar)', opacity: 0.85 }}>
                PHASE · {phaseLabel.toUpperCase()}
              </div>
            )}
            <button
              className="hud-indicator hud-indicator--btn"
              onClick={handleMuteToggle}
              title={muted ? 'Unmute' : 'Mute'}
              style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
            >
              {muted ? '🔇' : '🔊'}
            </button>
            {stellar.connected && (
              <button
                className="hud-indicator hud-indicator--btn"
                onClick={() => setShowProfile(true)}
                title="View combat record"
              >
                {stellar.state.walletId ? `[${stellar.state.walletId.toUpperCase()}] ` : ''}{stellar.address?.slice(0, 6)}…{stellar.address?.slice(-4)}
                <span style={{ marginLeft: '0.4em', opacity: 0.6, fontSize: '0.7em' }}>◈</span>
              </button>
            )}
          </div>
        </header>

        <main className="app-main">
          {screen === 'lobby' && (
            <GameLobby stellar={stellar} onJoin={handleJoin} joining={joining} joinError={joinError} inviteContractId={inviteContractId} onRefresh={refresh} />
          )}
          {screen === 'commit' && gameState && stellar.address && (
            <CommitPhase
              playerAddress={stellar.address}
              contractId={CONTRACT_ID}
              gameState={gameState}
              getSignTx={stellar.getSignTx}
              onCommitted={refresh}
            />
          )}
          {screen === 'play' && gameState && stellar.address && (
            <PlayPhase
              playerAddress={stellar.address}
              contractId={CONTRACT_ID}
              gameState={gameState}
              getSignTx={stellar.getSignTx}
            />
          )}
          {screen === 'gameover' && gameState && stellar.address && (
            <GameOver
              playerAddress={stellar.address}
              contractId={CONTRACT_ID}
              gameState={gameState}
              onNewGame={handleNewGame}
            />
          )}
        </main>

        {showProfile && stellar.address && (
        <PlayerProfile address={stellar.address} onClose={() => setShowProfile(false)} />
      )}

      <footer className="app-footer">
          <span>ZK BATTLESHIP · STELLAR TESTNET · NOIR + SOROBAN</span>
          {CONTRACT_ID && (
            <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">
              VIEW CONTRACT →
            </a>
          )}
        </footer>
      </div>
    </>
  );
}

function deriveScreen(
  gameState: ReturnType<typeof useGameState>['gameState'],
  address: string | null,
): AppScreen {
  if (!gameState || !address) return 'lobby';
  const isParticipant = gameState.player1 === address || gameState.player2 === address;
  if (!isParticipant) return 'lobby';
  if (gameState.phase === 'Finished') return 'gameover';
  if (gameState.phase === 'Playing') return 'play';
  if (gameState.phase === 'Commit') return 'commit';
  return 'lobby';
}
