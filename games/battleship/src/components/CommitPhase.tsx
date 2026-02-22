import React, { useState, useCallback } from 'react';
import { Board } from './Board';
import type { CellMark } from './Board';
import {
  emptyBoard,
  toggleCell,
  countShips,
  generateSalt,
  computeBoardHash,
  savePlayerSecret,
  TOTAL_SHIPS,
  BOARD_SIZE,
} from '../utils/board';
import type { Board as BoardType } from '../utils/board';
import { commitBoard } from '../utils/contract';
import { NETWORK_PASSPHRASE } from '../utils/contract';
import type { GameState } from '../utils/contract';

interface CommitPhaseProps {
  playerAddress: string;
  contractId: string;
  gameState: GameState;
  getSignTx: (passphrase: string) => (xdr: string) => Promise<string>;
  onCommitted: () => void;
}

const ZK_MESSAGES = [
  'COMPUTING WITNESS · POSEIDON2 HASH',
  'BUILDING CONSTRAINT SYSTEM · NOIR',
  'GENERATING BOARD HASH · BN254 FIELD',
  'SEALING COMMITMENT · SOROBAN TX',
];

export function CommitPhase({ playerAddress, contractId, gameState, getSignTx, onCommitted }: CommitPhaseProps) {
  const [board, setBoard] = useState<BoardType>(emptyBoard());
  const [status, setStatus] = useState<'placing' | 'hashing' | 'committing' | 'done' | 'waiting'>('placing');
  const [error, setError] = useState<string | null>(null);
  const [hashPreview, setHashPreview] = useState<string | null>(null);
  const [zkMsgIdx, setZkMsgIdx] = useState(0);

  const isPlayer1 = gameState.player1 === playerAddress;
  const myCommitted = isPlayer1 ? gameState.p1_committed : gameState.p2_committed;
  const opponentCommitted = isPlayer1 ? gameState.p2_committed : gameState.p1_committed;
  const shipCount = countShips(board);

  const handleCellClick = useCallback((row: number, col: number) => {
    setBoard((prev) => toggleCell(prev, row, col));
  }, []);

  const handleConfirm = async () => {
    if (shipCount !== TOTAL_SHIPS) return;
    setError(null);
    try {
      setStatus('hashing');
      let msgI = 0;
      const interval = setInterval(() => { setZkMsgIdx(++msgI % ZK_MESSAGES.length); }, 600);

      const salt = generateSalt();
      const boardHash = await computeBoardHash(board, salt);
      console.log('commit: boardHash=', boardHash.slice(0, 12) + '...', 'salt=', salt.slice(0, 10) + '...');
      setHashPreview(boardHash);
      savePlayerSecret(contractId, playerAddress, board, salt);

      setStatus('committing');
      const signTx = getSignTx(NETWORK_PASSPHRASE);
      await commitBoard(playerAddress, boardHash, signTx);
      clearInterval(interval);

      setStatus('done');
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('placing');
    }
  };

  const marks: CellMark[][] = Array.from({ length: BOARD_SIZE }, (_, row) =>
    Array.from({ length: BOARD_SIZE }, (_, col) => board[row][col] === 1 ? 'ship' : 'none'),
  );

  const isOverlay = status === 'hashing' || status === 'committing';

  // ── Already committed ──────────────────────────────────────────────────────
  if (myCommitted) {
    return (
      <div className="phase-container">
        <div className="phase-header">
          <h2>BOARD COMMITTED</h2>
          <span className="badge badge-green">◉ HASH ON-CHAIN</span>
        </div>
        <div className="panel" style={{ padding: '2rem', maxWidth: 500 }}>
          <div className="panel-corner-br" />
          <p style={{ fontFamily: 'Share Tech Mono', fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.08em', lineHeight: 1.7, marginBottom: '1.25rem' }}>
            Your board is committed on-chain. The Poseidon2 hash is in the contract — your ship positions remain secret.
          </p>
          {opponentCommitted ? (
            <div className="status-ok">◉ OPPONENT COMMITTED · BATTLE BEGINS</div>
          ) : (
            <div className="status-waiting">
              <span className="spinner" />
              <span>AWAITING OPPONENT COMMITMENT<span className="waiting-dots"><span>.</span><span>.</span><span>.</span></span></span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Placement UI ───────────────────────────────────────────────────────────
  return (
    <>
      {/* ZK Overlay */}
      <div className={`zk-overlay${isOverlay ? ' active' : ''}`}>
        <div className="zk-title">// {status === 'hashing' ? 'COMPUTING POSEIDON2 HASH' : 'SEALING COMMITMENT ON-CHAIN'}</div>
        <div className="zk-rings">
          <div className="ring ring-1" /><div className="ring ring-2" /><div className="ring ring-3" />
          <div className="ring-center" />
        </div>
        <div className="zk-status-text">{ZK_MESSAGES[zkMsgIdx]}</div>
        <div className="zk-progress"><div className="zk-progress-bar" /></div>
        <div className="zk-footnote">YOUR BOARD NEVER LEAVES THIS DEVICE</div>
      </div>

      <div className="phase-container">
        <div className="phase-header">
          <h2>DEPLOY FLEET — SECTOR ALPHA</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className={`badge ${shipCount === TOTAL_SHIPS ? 'badge-green' : 'badge-yellow'}`}>
              {shipCount}/{TOTAL_SHIPS} SHIPS
            </span>
            {opponentCommitted && <span className="badge badge-blue">OPPONENT READY</span>}
          </div>
        </div>

        <div className="commit-layout">
          {/* Board panel */}
          <div className="panel commit-grid-panel">
            <div className="panel-corner-br" />
            <div className="section-header"><h2>YOUR GRID</h2></div>
            <Board
              board={board}
              marks={marks}
              interactive={status === 'placing'}
              onCellClick={handleCellClick}
              showShips
              dotColor="blue"
            />
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="waiting-pulse">
                <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  CLICK CELLS TO PLACE SHIPS
                </span>
              </div>
              <span className={`badge ${shipCount === TOTAL_SHIPS ? 'badge-green' : 'badge-gray'}`}>
                {shipCount} / {TOTAL_SHIPS} PLACED
              </span>
            </div>
          </div>

          {/* Side panel */}
          <div className="commit-side">
            <div className="panel" style={{ padding: '1.25rem' }}>
              <div className="panel-corner-br" />
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--text-muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                DEPLOYMENT STATUS
              </div>

              <div className="stat-block sonar-stat" style={{ marginBottom: '0.75rem' }}>
                <div className="stat-label">SHIPS PLACED</div>
                <div className="stat-value">
                  {shipCount}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/{TOTAL_SHIPS}</span>
                </div>
              </div>

              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  BOARD HASH
                </div>
                <div className="hash-display">
                  {hashPreview ?? 'AWAITING COMMIT...'}
                </div>
              </div>

              <div className="divider" style={{ margin: '0.75rem 0' }} />

              <div className="zk-circuit-tag" style={{ marginBottom: '1rem' }}>
                ◉ POSEIDON2 HASH · READY
              </div>

              <button
                className="btn-primary w-full"
                disabled={shipCount !== TOTAL_SHIPS || status !== 'placing'}
                onClick={handleConfirm}
                style={{ width: '100%' }}
              >
                {shipCount === TOTAL_SHIPS ? 'COMMIT BOARD' : `PLACE ${TOTAL_SHIPS - shipCount} MORE`}
              </button>
            </div>

            {error && (
              <div className="error-msg">
                {error}
                <button className="btn-secondary" style={{ marginTop: '0.5rem', padding: '0.3rem 0.75rem', fontSize: '0.55rem' }} onClick={() => setError(null)}>
                  RETRY
                </button>
              </div>
            )}

            <div className="zk-explainer">
              <h4>WHAT HAPPENS ON COMMIT</h4>
              <ol>
                <li>Random 32-byte <code>salt</code> generated in browser.</li>
                <li><code>Poseidon2(board + salt)</code> computed via Noir circuit.</li>
                <li>Board + salt saved to <code>localStorage</code> only.</li>
                <li>Only the <code>board_hash</code> sent to Soroban.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
