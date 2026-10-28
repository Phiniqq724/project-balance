import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { BalanceCore } from './ledger';
import type { AiKeyInfo, AiProvider } from '../../modules/balance-core/src/BalanceCoreModule';

/** Your own Gemini, OpenAI or Claude key. It lives encrypted on this phone; JS only sees which provider and the last four characters. */

export const PROVIDER_LABEL: Record<AiProvider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };

/** "Gemini · ••••1234" */
export function keyLabel(info: AiKeyInfo): string {
  return `${PROVIDER_LABEL[info.provider]} · ••••${info.last4}`;
}

/** What went wrong saving a key, in a few words. */
export function keyError(error: unknown): string {
  switch ((error as { code?: string } | null)?.code) {
    case 'ERR_UNKNOWN_KEY':
      return 'Not a Gemini, OpenAI or Claude key.';
    case 'ERR_BAD_KEY':
      return 'That key was rejected.';
    case 'ERR_NO_CREDIT':
      return 'That key is out of credit.';
    default:
      return "Couldn't check it. Try again.";
  }
}

/** The saved key, kept current when the native side changes it (a pass that finds it rejected, a removal). */
export function useAiKey(): [AiKeyInfo | null, () => void] {
  const [info, setInfo] = useState(() => BalanceCore.aiKeyInfo());
  const refresh = useCallback(() => setInfo(BalanceCore.aiKeyInfo()), []);
  useEffect(() => {
    const ledger = BalanceCore.addListener('onLedgerChanged', refresh);
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      ledger.remove();
      app.remove();
    };
  }, [refresh]);
  return [info, refresh];
}
