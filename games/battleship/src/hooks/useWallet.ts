import { useState, useCallback, useEffect } from 'react';
import { StellarWalletsKit, Networks, KitEventType } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { NETWORK_PASSPHRASE } from '../utils/contract';

// ── Init kit once (static class — singleton by design) ─────────────────────

const freighterMod = new FreighterModule();
const xbullMod = new xBullModule();
const albedoMod = new AlbedoModule();
const lobstrMod = new LobstrModule();

// Use locally served icons (public/wallet-icons/) to avoid broken CDN images
freighterMod.productIcon = '/wallet-icons/freighter.png';
xbullMod.productIcon = '/wallet-icons/xbull.png';
albedoMod.productIcon = '/wallet-icons/albedo.png';
lobstrMod.productIcon = '/wallet-icons/lobstr.png';

StellarWalletsKit.init({
  network: Networks.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [freighterMod, xbullMod, albedoMod, lobstrMod],
});

export interface WalletState {
  connected: boolean;
  address: string | null;
  walletId: string | null;
  connecting: boolean;
  error: string | null;
}

export interface UseWallet {
  state: WalletState;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
  // compat shim — same shape App.tsx / GameLobby.tsx already use
  connected: boolean;
  address: string | null;
  connecting: boolean;
  error: string | null;
  getSignTx: (passphrase: string) => (xdr: string) => Promise<string>;
}

const INITIAL: WalletState = {
  connected: false,
  address: null,
  walletId: null,
  connecting: false,
  error: null,
};

export function useWallet(): UseWallet {
  const [state, setState] = useState<WalletState>(INITIAL);

  // Listen for kit state changes (address updates, disconnects)
  useEffect(() => {
    const offState = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (ev) => {
      const addr = ev.payload.address ?? null;
      setState((s) => ({
        ...s,
        connected: !!addr,
        address: addr,
      }));
    });

    const offDisconnect = StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      setState(INITIAL);
    });

    const offWallet = StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (ev) => {
      setState((s) => ({ ...s, walletId: ev.payload.id ?? null }));
    });

    return () => {
      offState();
      offDisconnect();
      offWallet();
    };
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const { address } = await StellarWalletsKit.authModal();
      setState((s) => ({
        ...s,
        connected: true,
        address,
        connecting: false,
        error: null,
      }));
    } catch (err) {
      // User closed the modal — not a real error
      const msg = err instanceof Error ? err.message : String(err);
      const isCancel = msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('close');
      setState((s) => ({
        ...s,
        connecting: false,
        error: isCancel ? null : msg,
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    StellarWalletsKit.disconnect().catch(() => {});
    setState(INITIAL);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: state.address ?? undefined,
    });
    return signedTxXdr;
  }, [state.address]);

  // Compat shim: getSignTx(passphrase) => (xdr) => Promise<string>
  // The passphrase arg is ignored — kit uses the one set at init time.
  const getSignTx = useCallback(
    (_passphrase: string) => async (xdr: string): Promise<string> => {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: state.address ?? undefined,
      });
      return signedTxXdr;
    },
    [state.address],
  );

  return {
    state,
    connect,
    disconnect,
    signTransaction,
    // flat compat props
    connected: state.connected,
    address: state.address,
    connecting: state.connecting,
    error: state.error,
    getSignTx,
  };
}
