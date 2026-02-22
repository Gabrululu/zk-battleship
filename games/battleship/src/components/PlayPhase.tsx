import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Board } from './Board';
import type { CellMark } from './Board';
import { loadPlayerSecret, BOARD_SIZE } from '../utils/board';
import { fireShot, submitResponse, NETWORK_PASSPHRASE, NO_SHOT } from '../utils/contract';
import { useZKProof } from '../hooks/useZKProof';
import { useTurnTimer } from '../hooks/useTurnTimer';
import type { GameState } from '../utils/contract';
import { playFire, playHit, playMiss, playPing, playProofGenerated } from '../utils/sounds';

interface PlayPhaseProps {
  playerAddress: string;
  contractId: string;
  gameState: GameState;
  getSignTx: (passphrase: string) => (xdr: string) => Promise<string>;
}

type ShotRecord = { x: number; y: number; isHit: boolean };

const ZK_PROOF_STEPS = [
  'EXECUTING NOIR CIRCUIT',
  'GENERATING WITNESS',
  'BUILDING ULTRAHONK PROOF',
  'SUBMITTING TO SOROBAN',
];

export function PlayPhase({ playerAddress, contractId, gameState, getSignTx }: PlayPhaseProps) {
  const { generateProof, generating, error: proofError } = useZKProof();

  const [myShots, setMyShots] = useState<ShotRecord[]>([]);
  const [receivedShots, setReceivedShots] = useState<ShotRecord[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [zkStep, setZkStep] = useState(0);
  const wasGeneratingRef = useRef(false);
  const prevTurnRef = useRef<string | null>(null);

  const isPlayer1 = gameState.player1 === playerAddress;
  const myRole = isPlayer1 ? 'PLAYER 1' : 'PLAYER 2';
  const isMyTurn = gameState.turn === playerAddress;
  const hasPendingShot = gameState.pending_shot_x !== NO_SHOT;
  const needToFire = isMyTurn && !hasPendingShot;
  const needToRespond = isMyTurn && hasPendingShot;
  const signTx = getSignTx(NETWORK_PASSPHRASE);

  // Turn timer
  const turnKey = `${gameState.turn}-${gameState.pending_shot_x}-${gameState.pending_shot_y}`;
  const { display: timerDisplay, expired: timerExpired, urgency } = useTurnTimer(isMyTurn, turnKey);

  // Ping when turn becomes mine
  useEffect(() => {
    if (prevTurnRef.current !== null && gameState.turn === playerAddress && prevTurnRef.current !== playerAddress) {
      playPing();
    }
    prevTurnRef.current = gameState.turn;
  }, [gameState.turn, playerAddress]);

  // Urgency sounds
  const prevUrgencyRef = useRef<string>('normal');
  useEffect(() => {
    if (!isMyTurn) return;
    if (urgency !== prevUrgencyRef.current) {
      if (urgency === 'warning' || urgency === 'critical') playPing();
      prevUrgencyRef.current = urgency;
    }
  }, [urgency, isMyTurn]);

  // playProofGenerated when ZK overlay disappears
  useEffect(() => {
    if (wasGeneratingRef.current && !generating && !txPending) {
      playProofGenerated();
    }
    wasGeneratingRef.current = generating;
  }, [generating, txPending]);

  const hitsOnOpponent = isPlayer1 ? gameState.hits_on_p2 : gameState.hits_on_p1;
  const hitsOnMe = isPlayer1 ? gameState.hits_on_p1 : gameState.hits_on_p2;

  const attackMarks: CellMark[][] = Array.from({ length: BOARD_SIZE }, (_, row) =>
    Array.from({ length: BOARD_SIZE }, (_, col) => {
      const shot = myShots.find((s) => s.y === row && s.x === col);
      if (!shot) return selectedCell?.row === row && selectedCell?.col === col ? 'selected' : 'none';
      return shot.isHit ? 'hit' : 'miss';
    }),
  );

  const secret = loadPlayerSecret(contractId, playerAddress);
  const defenseMarks: CellMark[][] = Array.from({ length: BOARD_SIZE }, (_, row) =>
    Array.from({ length: BOARD_SIZE }, (_, col) => {
      const shot = receivedShots.find((s) => s.y === row && s.x === col);
      if (!shot) return 'none';
      return shot.isHit ? 'hit' : 'miss';
    }),
  );

  // Auto-respond when it's our turn to respond
  useEffect(() => {
    if (!needToRespond || txPending || generating) return;

    const respond = async () => {
      const x = gameState.pending_shot_x;
      const y = gameState.pending_shot_y;
      const sec = loadPlayerSecret(contractId, playerAddress);
      if (!sec) {
        setActionError('Board not found in localStorage. Did you clear browser data?');
        return;
      }
      const rawHash = isPlayer1 ? gameState.board_hash_p1 : gameState.board_hash_p2;
      const boardHash = rawHash.startsWith('0x') ? rawHash : '0x' + rawHash;
      console.log('respond: boardHash=', boardHash.slice(0, 12) + '...', 'x=', x, 'y=', y);

      try {
        setTxPending(true);
        setActionStatus('GENERATING ZK PROOF...');
        setActionError(null);

        let stepI = 0;
        const interval = setInterval(() => { setZkStep(++stepI % ZK_PROOF_STEPS.length); }, 700);

        const { proof, isHit } = await generateProof({
          board: sec.board,
          salt: sec.salt,
          boardHash,
          shotX: x,
          shotY: y,
        });
        clearInterval(interval);

        setActionStatus('SUBMITTING RESPONSE...');
        await submitResponse(playerAddress, x, y, isHit, proof, signTx);

        if (isHit) playHit(); else playMiss();
        setReceivedShots((prev) => [...prev, { x, y, isHit }]);
        setActionStatus(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
        setActionStatus(null);
      } finally {
        setTxPending(false);
      }
    };

    respond();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needToRespond, gameState.pending_shot_x, gameState.pending_shot_y]);

  const handleCellSelect = useCallback((row: number, col: number) => {
    if (!myShots.some((s) => s.y === row && s.x === col)) setSelectedCell({ row, col });
  }, [myShots]);

  const handleFire = async () => {
    if (!selectedCell || txPending) return;
    const { row, col } = selectedCell;
    playFire();
    setTxPending(true);
    setActionError(null);
    setActionStatus('FIRING...');
    try {
      await fireShot(playerAddress, col, row, signTx);
      setMyShots((prev) => [...prev, { x: col, y: row, isHit: false }]);
      setSelectedCell(null);
      setActionStatus(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setActionStatus(null);
    } finally {
      setTxPending(false);
    }
  };

  const isZkOverlay = needToRespond && (generating || txPending);

  return (
    <>
      {/* ZK Proof Overlay */}
      <div className={`zk-overlay${isZkOverlay ? ' active' : ''}`}>
        <div className="zk-title">// GENERATING ULTRAHONK PROOF</div>
        <div className="zk-rings">
          <div className="ring ring-1" /><div className="ring ring-2" /><div className="ring ring-3" />
          <div className="ring-center" />
        </div>
        <div className="zk-status-text">{ZK_PROOF_STEPS[zkStep]}</div>
        <div className="zk-progress"><div className="zk-progress-bar" /></div>
        <div className="zk-footnote">NOIR CIRCUIT · ULTRAHONK · ~2KB PROOF</div>
      </div>

      <div className="phase-container">
        <div className="phase-header">
          <h2>NAVAL ENGAGEMENT — ACTIVE</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className={`badge ${isMyTurn ? 'badge-green' : 'badge-gray'}`}>
              {isMyTurn ? '◉ YOUR TURN' : '⌛ ENEMY TURN'}
            </span>
            <span className="badge badge-blue">HITS {hitsOnOpponent}/3</span>
            <span className="badge badge-red">TAKEN {hitsOnMe}/3</span>
          </div>
        </div>

        {/* Error / status bar */}
        {(actionStatus || proofError || actionError) && (
          <div className={`status-bar ${actionError || proofError ? 'status-error' : 'status-info'}`}>
            {actionStatus && <><span className="spinner" />{actionStatus}</>}
            {(actionError || proofError) && <span>⚠ {actionError ?? proofError}</span>}
          </div>
        )}

        {/* 3-column layout */}
        <div className="play-layout">
          {/* Left — my defense board */}
          <div className="play-board-col">
            <div className="panel board-panel">
              <div className="panel-corner-br" />
              <div className="section-header"><h2>YOUR GRID</h2></div>
              <Board
                board={secret?.board}
                marks={defenseMarks}
                showShips
                dotColor="blue"
              />
            </div>
            <div className="play-stats-row">
              <div className="play-stat danger">
                <div className="ps-label">HITS TAKEN</div>
                <div className="ps-value">{hitsOnMe}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/3</span></div>
              </div>
            </div>
            <div className="board-legend">
              <span className="legend-item"><span className="legend-dot ship" /> SHIP</span>
              <span className="legend-item"><span className="legend-dot hit" /> HIT</span>
              <span className="legend-item"><span className="legend-dot miss" /> MISS</span>
            </div>
          </div>

          {/* Center — status column */}
          <div className="play-status-col">
            <div className={`turn-indicator${isMyTurn ? '' : ' enemy-turn'}`}>
              <div className="turn-label">CURRENT TURN</div>
              <div className="turn-value">{isMyTurn ? 'YOU' : 'ENEMY'}</div>
            </div>

            <div className={`timer-display ${urgency}`}>
              <div className="timer-label">
                {isMyTurn ? 'YOUR TURN EXPIRES' : 'OPPONENT TIME'}
              </div>
              <div className="timer-value">{timerDisplay}</div>
              {timerExpired && (
                <div className="timer-expired">TIME EXPIRED — OPPONENT MAY CLAIM VICTORY</div>
              )}
            </div>

            <div className="vs-badge">VS</div>

            <div className="score-display">
              <div className="score-item">
                <div className="score-num" style={{ color: 'var(--sonar)' }}>{hitsOnOpponent}</div>
                <div className="score-name">YOUR HITS</div>
              </div>
              <div className="score-item">
                <div className="score-num" style={{ color: 'var(--danger-glow)' }}>{hitsOnMe}</div>
                <div className="score-name">TAKEN</div>
              </div>
            </div>

            {needToFire && selectedCell && (
              <button className="btn-sonar" style={{ width: '100%', fontSize: '0.62rem' }} disabled={txPending} onClick={handleFire}>
                {txPending ? <><span className="spinner" /> FIRING...</> : `FIRE → ${['A','B','C','D','E'][selectedCell.col]}${selectedCell.row + 1}`}
              </button>
            )}

            {needToFire && !selectedCell && (
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textAlign: 'center', textTransform: 'uppercase' }}>
                SELECT TARGET ON ENEMY GRID
              </div>
            )}

            {needToRespond && (
              <div className="status-waiting" style={{ flexDirection: 'column', textAlign: 'center', gap: '0.5rem' }}>
                <span className="spinner" />
                <span style={{ fontSize: '0.58rem' }}>
                  INCOMING SHOT<br />
                  {['A','B','C','D','E'][gameState.pending_shot_x]}{gameState.pending_shot_y + 1}
                </span>
              </div>
            )}

            {!isMyTurn && (
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.55rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textAlign: 'center', textTransform: 'uppercase' }}>
                AWAITING ENEMY ACTION
              </div>
            )}

            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.52rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textAlign: 'center', textTransform: 'uppercase', marginTop: 'auto' }}>
              {myRole} · {playerAddress.slice(0, 6)}…{playerAddress.slice(-4)}
            </div>
          </div>

          {/* Right — attack board */}
          <div className="play-board-col">
            <div className="panel board-panel">
              <div className="panel-corner-br" />
              <div className="section-header"><h2>ENEMY GRID</h2></div>
              <Board
                marks={attackMarks}
                interactive={needToFire && !txPending}
                onCellClick={handleCellSelect}
                dotColor="red"
              />
            </div>
            <div className="play-stats-row">
              <div className="play-stat sonar">
                <div className="ps-label">CONFIRMED HITS</div>
                <div className="ps-value">{hitsOnOpponent}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/3</span></div>
              </div>
            </div>
            {needToRespond && (
              <div className="proof-steps">
                {ZK_PROOF_STEPS.map((step, i) => (
                  <div key={i} className={`proof-step${i === zkStep && isZkOverlay ? ' active' : ''}`}>
                    {i + 1}. {step}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
