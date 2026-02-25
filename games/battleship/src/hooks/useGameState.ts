import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGameState } from '../utils/contract';
import type { GameState } from '../utils/contract';

const POLL_INTERVAL_MS = 3000;

export function useGameState() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchGameState();
      setGameState(state);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
  }, [refresh]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    startPolling();
    return stopPolling;
  }, [startPolling, stopPolling]);
  
  return { gameState, setGameState, loading, error, refresh };
}