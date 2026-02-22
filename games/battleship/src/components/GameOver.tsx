import React, { useState, useEffect } from 'react';
import { Board } from './Board';
import type { CellMark } from './Board';
import { loadPlayerSecret, BOARD_SIZE } from '../utils/board';
import type { GameState } from '../utils/contract';
import { playVictory, playDefeat } from '../utils/sounds';

interface GameOverProps {
  playerAddress: string;
  contractId: string;
  gameState: GameState;
  onNewGame: () => void;
}

export function GameOver({ playerAddress, contractId, gameState, onNewGame }: GameOverProps) {
  const [showBoard, setShowBoard] = useState(false);

  const isWinner = gameState.winner === playerAddress;

  useEffect(() => {
    if (isWinner) playVictory(); else playDefeat();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isP1 = gameState.player1 === playerAddress;
  const secret = loadPlayerSecret(contractId, playerAddress);

  const myHits = isP1 ? gameState.hits_on_p2 : gameState.hits_on_p1;
  const theirHits = isP1 ? gameState.hits_on_p1 : gameState.hits_on_p2;

  const revealMarks: CellMark[][] = Array.from({ length: BOARD_SIZE }, (_, row) =>
    Array.from({ length: BOARD_SIZE }, (_, col) =>
      secret?.board[row][col] === 1 ? 'ship' : 'none',
    ),
  );

  return (
    <div className="gameover-container">
      {/* Badge */}
      <div className="gameover-badge">
        {isWinner ? '// MISSION ACCOMPLISHED' : '// FLEET DESTROYED'}
      </div>

      {/* Big title */}
      <div className={`gameover-title ${isWinner ? 'win' : 'lose'}`}>
        {isWinner ? 'VICTORY' : 'DEFEAT'}
      </div>

      <div style={{
        fontFamily: 'Share Tech Mono',
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}>
        {isWinner
          ? 'All enemy ships neutralized. ZK proofs verified.'
          : 'Your fleet was eliminated. All proofs verified on-chain.'}
      </div>

      {/* Stats row */}
      <div className="gameover-stats">
        <div className="gameover-stat">
          <div className="gstat-val" style={{ color: isWinner ? 'var(--sonar)' : 'var(--plasma-glow)' }}>{myHits}</div>
          <div className="gstat-label">HITS LANDED</div>
        </div>
        <div className="gameover-stat">
          <div className="gstat-val" style={{ color: 'var(--danger-glow)' }}>{theirHits}</div>
          <div className="gstat-label">HITS TAKEN</div>
        </div>
        <div className="gameover-stat">
          <div className="gstat-val" style={{ fontSize: '1.1rem', color: 'var(--text-dim)' }}>
            {gameState.winner.slice(0, 6)}…
          </div>
          <div className="gstat-label">WINNER</div>
        </div>
      </div>

      {/* ZK proof summary */}
      <div className="proof-summary">
        ◉ ULTRAHONK PROOFS VERIFIED ON STELLAR TESTNET<br />
        Every hit/miss response was backed by a ZK proof verified on-chain.<br />
        No player could lie about shot results without the contract rejecting the transaction.<br />
        CIRCUIT: Noir · HASH: Poseidon2 · PROOF SYSTEM: UltraHonk
      </div>

      {/* Reveal board */}
      {secret && (
        <div className="panel" style={{ padding: '1.25rem', width: '100%' }}>
          <div className="panel-corner-br" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showBoard ? '1rem' : 0 }}>
            <div style={{ fontFamily: 'Orbitron', fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              REVEAL YOUR FLEET
            </div>
            <button className="btn-secondary" style={{ padding: '0.3rem 0.85rem', fontSize: '0.55rem' }}
              onClick={() => setShowBoard(v => !v)}>
              {showBoard ? 'HIDE' : 'REVEAL POSITIONS'}
            </button>
          </div>
          {showBoard && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <p style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em', lineHeight: 1.7, textAlign: 'center' }}>
                These were your actual ship positions. Your opponent never saw them —<br />
                only the Poseidon2 hash was on-chain.
              </p>
              <Board board={secret.board} marks={revealMarks} showShips dotColor="blue" />
              <div className="code-block" style={{ textAlign: 'left' }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: '0.3rem', fontSize: '0.55rem', letterSpacing: '0.15em' }}>COMMIT SALT</div>
                {secret.salt}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn-sonar" onClick={onNewGame}>
          NEW ENGAGEMENT
        </button>
        <a
          href={`https://stellar.expert/explorer/testnet/contract/${import.meta.env.VITE_CONTRACT_ID}`}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          <button className="btn-secondary">VIEW ON STELLAR EXPLORER</button>
        </a>
      </div>
    </div>
  );
}
