import { useState, useCallback } from 'react';

export interface FreighterApi {
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string, opts: { networkPassphrase: string }): Promise<string>;
  isConnected(): Promise<boolean>;
}

declare global {
  interface Window {
    freighter?: FreighterApi;
  }
}

export interface StellarState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export function useStellar() {
  const [state, setState] = useState<StellarState>({
    address: null,
    connected: false,
    connecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      if (!window.freighter) {
        throw new Error(
          'Freighter wallet not found. Please install the Freighter browser extension.',
        );
      }
      const isConnected = await window.freighter.isConnected();
      if (!isConnected) {
        throw new Error('Freighter is not connected. Please unlock your wallet.');
      }
      const address = await window.freighter.getPublicKey();
      setState({ address, connected: true, connecting: false, error: null });
    } catch (err) {
      setState({
        address: null,
        connected: false,
        connecting: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, connected: false, connecting: false, error: null });
  }, []);

  /** Returns a signTransaction function bound to the current network */
  const getSignTx = useCallback(
    (networkPassphrase: string) =>
      async (xdr: string): Promise<string> => {
        if (!window.freighter) throw new Error('Freighter not available');
        return window.freighter.signTransaction(xdr, { networkPassphrase });
      },
    [],
  );

  return { ...state, connect, disconnect, getSignTx };
}
