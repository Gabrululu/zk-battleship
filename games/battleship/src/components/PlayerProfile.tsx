import React, { useEffect, useState, useCallback } from 'react';
import { getPlayerStats, PlayerStats } from '../utils/contract';

interface PlayerProfileProps {
  address: string;
  onClose: () => void;
}

// Guard: returns true only for real Stellar addresses (G... 56 chars)
function isValidAddress(addr: string | null | undefined): boolean {
  if (!addr || typeof addr !== 'string') return false;
  return addr.length === 56 && (addr.startsWith('G') || addr.startsWith('C'));
}

export function PlayerProfile({ address, onClose }: PlayerProfileProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStats(null);

    // Validate address before touching the network
    if (!isValidAddress(address)) {
      setError('Invalid wallet address — please reconnect your wallet');
      setLoading(false);
      return;
    }

    try {
      // getPlayerStats never throws — returns null on any failure
      const s = await getPlayerStats(address);
      setStats(s); // null = no record yet, that's fine
    } catch (err) {
      // Should not reach here since getPlayerStats catches internally,
      // but just in case:
      console.error('PlayerProfile load error:', err);
      setError('Could not load combat record');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const short = isValidAddress(address)
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : 'Unknown';

  const winRate =
    stats && stats.games_played > 0
      ? Math.round((stats.games_won / stats.games_played) * 100)
      : 0;

  const accuracy =
    stats && stats.total_shots_fired > 0
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

        {/* Error state — shown only for real errors, not missing stats */}
        {!loading && error && (
          <div className="profile-empty">
            <div className="profile-empty-icon" style={{ color: 'var(--danger)' }}>⚠</div>
            <div className="profile-empty-title" style={{ color: 'var(--danger-glow)' }}>
              {error}
            </div>
            <div className="profile-empty-sub">
              Try disconnecting and reconnecting your wallet.
            </div>
          </div>
        )}

        {/* No record yet — this is normal for new players */}
        {!loading && !error && !stats && (
          <div className="profile-empty">
            <div className="profile-empty-icon">⬡</div>
            <div className="profile-empty-title">NO COMBAT RECORD</div>
            <div className="profile-empty-sub">
              Complete a game to start building your record.
            </div>
          </div>
        )}

        {/* Stats — only shown when we have real data */}
        {!loading && !error && stats && (
          <>
            {/* ── Primary stats row ── */}
            <div className="profile-stats-grid">
              <div className="stat-block">
                <div className="stat-value">{stats.games_played}</div>
                <div className="stat-label">GAMES PLAYED</div>
              </div>
              <div className="stat-block">
                <div className="stat-value" style={{ color: 'var(--sonar)' }}>
                  {stats.games_won}
                </div>
                <div className="stat-label">VICTORIES</div>
              </div>
              <div className="stat-block">
                <div className="stat-value" style={{ color: 'var(--danger)' }}>
                  {stats.games_played - stats.games_won}
                </div>
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
                <span style={{ color: 'var(--plasma-bright)' }}>{accuracy}%</span>
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
                    ? Math.round(
                        ((stats.total_shots_received -
                          (stats.games_played - stats.games_won) * 3) /
                          stats.total_shots_received) *
                          100,
                      )
                    : 0}
                  %
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