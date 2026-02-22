import React, { useEffect, useState, useCallback } from 'react';
import { getPlayerStats, PlayerStats } from '../utils/contract';

interface PlayerProfileProps {
  address: string;
  onClose: () => void;
}

export function PlayerProfile({ address, onClose }: PlayerProfileProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    // Validate address before attempting to fetch
    if (!address || address.length < 56 || !address.startsWith('G')) {
      setError('Invalid wallet address');
      setLoading(false);
      return;
    }

    try {
      const s = await getPlayerStats(address);
      setStats(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Clean up "invalid encoded string" errors
      if (msg.includes('invalid encoded')) {
        setError('Wallet address is malformed');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const winRate = stats && stats.games_played > 0
    ? Math.round((stats.games_won / stats.games_played) * 100)
    : 0;
  const accuracy = stats && stats.total_shots_fired > 0
    ? Math.round((stats.total_hits / stats.total_shots_fired) * 100)
    : 0;

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-panel" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="profile-header">
          <div className="profile-title">
            <span className="profile-icon">◈</span>
            COMBAT RECORD
          </div>
          <button className="profile-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Address ── */}
        <div className="profile-address">
          <span className="profile-address-label">WALLET</span>
          <span className="profile-address-value">{short}</span>
        </div>

        {/* ── Body ── */}
        {loading && (
          <div className="profile-loading">
            <span className="spinner" />
            FETCHING RECORD…
          </div>
        )}

        {error && (
          <div className="error-msg" style={{ margin: '1rem 0' }}>{error}</div>
        )}

        {!loading && !error && !stats && (
          <div className="profile-empty">
            <div className="profile-empty-icon">⬡</div>
            <div className="profile-empty-title">NO COMBAT RECORD</div>
            <div className="profile-empty-sub">Complete a game to start building your record.</div>
          </div>
        )}

        {!loading && !error && stats && (
          <>
            {/* ── Primary stats row ── */}
            <div className="profile-stats-grid">
              <div className="stat-block">
                <div className="stat-value">{stats.games_played}</div>
                <div className="stat-label">GAMES PLAYED</div>
              </div>
              <div className="stat-block stat-block--win">
                <div className="stat-value" style={{ color: 'var(--sonar)' }}>{stats.games_won}</div>
                <div className="stat-label">VICTORIES</div>
              </div>
              <div className="stat-block stat-block--loss">
                <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.games_played - stats.games_won}</div>
                <div className="stat-label">DEFEATS</div>
              </div>
            </div>

            {/* ── Win rate bar ── */}
            <div className="profile-rate-row">
              <div className="profile-rate-label">
                <span>WIN RATE</span>
                <span style={{ color: 'var(--sonar)' }}>{winRate}%</span>
              </div>
              <div className="profile-rate-bar">
                <div
                  className="profile-rate-fill profile-rate-fill--win"
                  style={{ width: `${winRate}%` }}
                />
              </div>
            </div>

            {/* ── Accuracy bar ── */}
            <div className="profile-rate-row">
              <div className="profile-rate-label">
                <span>ACCURACY</span>
                <span style={{ color: 'var(--plasma)' }}>{accuracy}%</span>
              </div>
              <div className="profile-rate-bar">
                <div
                  className="profile-rate-fill profile-rate-fill--acc"
                  style={{ width: `${accuracy}%` }}
                />
              </div>
            </div>

            {/* ── Secondary stats ── */}
            <div className="profile-stats-grid profile-stats-grid--4">
              <div className="stat-block">
                <div className="stat-value">{stats.total_shots_fired}</div>
                <div className="stat-label">SHOTS FIRED</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">{stats.total_hits}</div>
                <div className="stat-label">HITS SCORED</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">{stats.total_shots_received}</div>
                <div className="stat-label">SHOTS RECV</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">
                  {stats.total_shots_received > 0
                    ? Math.round(((stats.total_shots_received - (stats.games_played - stats.games_won) * 3) / stats.total_shots_received) * 100)
                    : 0}%
                </div>
                <div className="stat-label">SURVIVED</div>
              </div>
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <div className="profile-footer">
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? 'REFRESHING…' : '↻ REFRESH'}
          </button>
        </div>

      </div>
    </div>
  );
}
