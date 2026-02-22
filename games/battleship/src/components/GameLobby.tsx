import React, { useState, useEffect, useRef } from 'react';
import { CONTRACT_ID, parseError } from '../utils/contract';
import type { UseWallet } from '../hooks/useWallet';
import { playPing } from '../utils/sounds';

interface GameLobbyProps {
  stellar: UseWallet;
  onJoin: (asPlayer: 'player1' | 'player2') => Promise<void>;
  joining: boolean;
  joinError: string | null;
  inviteContractId?: string | null;
  onRefresh?: () => void;
}

export function GameLobby({ stellar, onJoin, joining, joinError, inviteContractId, onRefresh }: GameLobbyProps) {
  const [view, setView] = useState<'menu' | 'create' | 'join'>(
    inviteContractId ? 'join' : 'menu',
  );
  const [p1Joined, setP1Joined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // If arriving via invite link, switch to join view once wallet connects
  useEffect(() => {
    if (inviteContractId && stellar.connected && view === 'menu') setView('join');
  }, [inviteContractId, stellar.connected, view]);

  // Poll for P2 joining while P1 is waiting
  useEffect(() => {
    if (p1Joined && onRefresh) {
      pollRef.current = setInterval(onRefresh, 4000);
    }
    return () => clearInterval(pollRef.current);
  }, [p1Joined, onRefresh]);

  const inviteUrl = `${window.location.origin}${window.location.pathname}?game=${CONTRACT_ID}`;

  const handleP1Join = async () => {
    setLocalError(null);
    try {
      await onJoin('player1');
      setP1Joined(true);
      playPing();
    } catch (e) {
      setLocalError(parseError(e));
    }
  };

  const copyInviteLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lobby-container">
      {/* Hero */}
      <div className="lobby-hero">
        <div className="lobby-eyebrow">// ZERO-KNOWLEDGE NAVAL WARFARE</div>
        <div className="lobby-title">
          <span className="lobby-zk">ZK</span>
          <span className="lobby-battle">BATTLE</span>
          <span className="lobby-ship">SHIP</span>
        </div>
        <div className="lobby-tagline">COMMIT · PROVE · CONQUER · NO TRUST REQUIRED</div>
      </div>

      {/* Two-column action panel */}
      <div className="panel lobby-panel" style={{ width: '100%' }}>
        <div className="panel-corner-br" />

        {/* Left col — connect / create */}
        <div className="lobby-col">
          <div className="lobby-col-icon">⬡</div>
          <h3>INITIALIZE FLEET</h3>
          <p>Deploy as Player 1. Your board commitment is sealed on Stellar testnet before battle begins.</p>

          {!stellar.connected ? (
            <div className="flex-col gap-4 w-full" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn-sonar w-full" onClick={stellar.connect} disabled={stellar.connecting}>
                {stellar.connecting
                  ? <span className="flex items-center gap-2"><span className="spinner" /> CONNECTING...</span>
                  : 'CONNECT WALLET'}
              </button>
              {stellar.error && <div className="error-msg">{stellar.error}</div>}
              <a href="https://www.freighter.app/" target="_blank" rel="noreferrer"
                style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textAlign: 'center' }}>
                GET FREIGHTER →
              </a>
            </div>
          ) : view === 'menu' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
              <div className="wallet-info">
                <span className="badge badge-green">◉ ONLINE</span>
                <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
                  {stellar.address?.slice(0, 8)}…{stellar.address?.slice(-6)}
                </span>
                <button className="btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.55rem', marginLeft: 'auto' }} onClick={stellar.disconnect}>
                  DISCONNECT
                </button>
              </div>
              <button className="btn-sonar w-full" onClick={() => setView('create')} disabled={!CONTRACT_ID}>
                INITIALIZE GAME
              </button>
            </div>
          ) : view === 'create' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
              {!p1Joined ? (
                <>
                  <p style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em', lineHeight: 1.6 }}>
                    You are <span style={{ color: 'var(--sonar)' }}>PLAYER 1</span>. Join first, then share the invite link.
                  </p>
                  <button className="btn-primary w-full" onClick={handleP1Join} disabled={joining}>
                    {joining ? <span className="flex items-center gap-2"><span className="spinner" /> JOINING...</span> : 'JOIN AS PLAYER 1'}
                  </button>
                  <button className="btn-secondary w-full" onClick={() => setView('menu')}>← BACK</button>
                  {(localError || joinError) && <div className="error-msg">{localError ?? joinError}</div>}
                </>
              ) : (
                <div className="invite-panel">
                  <div className="invite-panel-label">SHARE WITH OPPONENT</div>
                  <div className="invite-url">{inviteUrl}</div>
                  <button className="btn-sonar w-full" onClick={copyInviteLink}>
                    {copied ? '✓ COPIED' : 'COPY INVITE LINK'}
                  </button>
                  <div className="waiting-pulse">
                    <span className="invite-panel-label">WAITING FOR OPPONENT TO JOIN</span>
                    <div className="waiting-dots">
                      <span>.</span><span>.</span><span>.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="lobby-divider-v" />

        {/* Right col — join */}
        <div className="lobby-col">
          <div className="lobby-col-icon">◈</div>
          <h3>JOIN ENGAGEMENT</h3>
          <p>Enter as Player 2. Player 1 must already be registered in the contract before you join.</p>

          {!stellar.connected ? (
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textAlign: 'center' }}>
              CONNECT WALLET FIRST
            </div>
          ) : view === 'menu' ? (
            <button className="btn-secondary w-full" onClick={() => setView('join')} disabled={!CONTRACT_ID}>
              JOIN ENGAGEMENT
            </button>
          ) : view === 'join' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
              <p style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em', lineHeight: 1.6 }}>
                You are <span style={{ color: 'var(--plasma-glow)' }}>PLAYER 2</span>. Player 1 must already be in the contract.
              </p>
              <button className="btn-primary w-full" onClick={() => onJoin('player2')} disabled={joining}>
                {joining ? <span className="flex items-center gap-2"><span className="spinner" /> JOINING...</span> : 'JOIN AS PLAYER 2'}
              </button>
              <button className="btn-secondary w-full" onClick={() => setView('menu')}>← BACK</button>
              {joinError && <div className="error-msg">{joinError}</div>}
            </div>
          ) : (
            <button className="btn-secondary w-full" onClick={() => setView('join')} disabled={!CONTRACT_ID}>
              JOIN ENGAGEMENT
            </button>
          )}
        </div>
      </div>

      {/* Status tags */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span className="ds-tag ds-tag-active">◉ 2 PLAYERS</span>
        <span className="ds-tag ds-tag-active">⬡ ZK PROOFS</span>
        <span className="ds-tag ds-tag-active">◈ ON-CHAIN</span>
        <span className="ds-tag">⌛ TURN-BASED</span>
        <span className="ds-tag">⬡ POSEIDON2</span>
      </div>

      {/* How it works */}
      <div className="lobby-how">
        <h3>HOW THE ZK WORKS</h3>
        <ol>
          <li><strong style={{ color: 'var(--sonar)' }}>COMMIT:</strong> Place ships, generate a Poseidon2 hash. Only the hash goes on-chain — <em>your board never leaves the browser</em>.</li>
          <li><strong style={{ color: 'var(--sonar)' }}>FIRE:</strong> Attacker registers target coordinates on-chain.</li>
          <li><strong style={{ color: 'var(--sonar)' }}>ZK RESPONSE:</strong> Defender generates an UltraHonk proof that their hit/miss answer is correct against the committed hash, <em>without revealing ship positions</em>.</li>
          <li><strong style={{ color: 'var(--sonar)' }}>VERIFY:</strong> Soroban contract verifies the proof. Cheating is impossible.</li>
        </ol>
      </div>
    </div>
  );
}
