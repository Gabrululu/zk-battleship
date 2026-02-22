import { useState, useEffect, useRef } from 'react';

const TURN_SECONDS = 300;

export type TimerUrgency = 'normal' | 'warning' | 'critical';

export interface TurnTimerResult {
  display: string;
  expired: boolean;
  urgency: TimerUrgency;
  seconds: number;
}

export function useTurnTimer(isMyTurn: boolean, turnKey: string): TurnTimerResult {
  const [seconds, setSeconds] = useState(TURN_SECONDS);
  const [expired, setExpired] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Reset whenever the turn changes
  useEffect(() => {
    setSeconds(TURN_SECONDS);
    setExpired(false);
  }, [turnKey]);

  // Count down only when it's my turn
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (!isMyTurn) return;

    intervalRef.current = setInterval(() => {
      setSeconds(prev => {
        if (prev <= 1) {
          setExpired(true);
          clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isMyTurn, turnKey]);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = `${minutes}:${secs.toString().padStart(2, '0')}`;
  const urgency: TimerUrgency = seconds < 60 ? 'critical' : seconds < 120 ? 'warning' : 'normal';

  return { display, expired, urgency, seconds };
}
