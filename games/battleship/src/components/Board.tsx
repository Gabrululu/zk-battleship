import React from 'react';
import type { Board as BoardType } from '../utils/board';
import { BOARD_SIZE } from '../utils/board';

export type CellMark = 'none' | 'ship' | 'hit' | 'miss' | 'selected' | 'sunk';

interface BoardProps {
  board?: BoardType;
  marks?: CellMark[][];
  interactive?: boolean;
  onCellClick?: (row: number, col: number) => void;
  showShips?: boolean;
  label?: string;
  dotColor?: 'blue' | 'green' | 'red';
  size?: 'normal' | 'small';
}

const COL_LABELS = ['A', 'B', 'C', 'D', 'E'];

const CELL_CLASS: Record<CellMark, string> = {
  none: 'cell-water',
  ship: 'cell-ship',
  hit: 'cell-hit',
  miss: 'cell-miss',
  selected: 'cell-selected',
  sunk: 'cell-sunk',
};

export function Board({
  board,
  marks,
  interactive = false,
  onCellClick,
  showShips = false,
  label,
  dotColor = 'blue',
  size = 'normal',
}: BoardProps) {
  const cellSize = size === 'small' ? 34 : 48;
  const gap = 3;
  const colTemplate = `20px repeat(${BOARD_SIZE}, ${cellSize}px)`;

  return (
    <div className="board-wrapper">
      {label && (
        <div className="board-label">
          <div className={`board-dot board-dot-${dotColor}`} />
          {label}
        </div>
      )}

      {/* Column labels row */}
      <div style={{ display: 'grid', gridTemplateColumns: colTemplate, gap, marginBottom: gap }}>
        <div />
        {COL_LABELS.map(l => (
          <div key={l} className="board-coord-label">{l}</div>
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: BOARD_SIZE }, (_, row) => {
        return (
          <div key={row} style={{ display: 'grid', gridTemplateColumns: colTemplate, gap, marginBottom: gap }}>
            <div className="board-coord-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {row + 1}
            </div>
            {Array.from({ length: BOARD_SIZE }, (_, col) => {
              const mark = marks?.[row]?.[col] ?? 'none';
              const hasShip = showShips && board?.[row]?.[col] === 1;
              let cls = CELL_CLASS[mark];
              if (mark === 'none' && hasShip) cls = 'cell-ship';
              const isClickable = interactive && mark === 'none' && !hasShip && onCellClick != null;

              return (
                <div
                  key={col}
                  className={`board-cell ${cls}${isClickable ? ' cell-clickable' : ''}`}
                  style={{ width: cellSize, height: cellSize }}
                  onClick={() => isClickable && onCellClick?.(row, col)}
                  title={`${COL_LABELS[col]}${row + 1}`}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
