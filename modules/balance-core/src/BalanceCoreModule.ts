import { NativeModule, requireNativeModule } from 'expo';

type BalanceCoreEvents = {
  onLedgerChanged: () => void;
};

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export type AiKind = 'income' | 'expense' | 'transfer' | 'ad_or_other';

export type InstalledApp = { package: string; label: string; icon: string | null };

declare class BalanceCoreModule extends NativeModule<BalanceCoreEvents> {
  hasNotificationAccess(): boolean;
  openNotificationAccessSettings(): void;
  appLabel(pkg: string): string | null;
  installedApps(): Promise<InstalledApp[]>;
  query(sql: string, args?: SqlValue[]): Promise<Row[]>;
  setTransactionCategory(id: number, categoryId: string | null): Promise<void>;
  setTransactionTransfer(id: number, isTransfer: boolean): Promise<void>;
  saveCategory(id: string | null, name: string, keywords: string): Promise<string>;
  deleteCategory(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  reprocessAll(): Promise<void>;
  refreshWidgets(): Promise<void>;
  /** Turns AI review on or off and re-reads every notification. */
  setAiReview(on: boolean): Promise<void>;
  aiSuggest(
    rawId: number,
    kind: AiKind,
    direction: 'in' | 'out',
    amount: number,
    counterparty: string | null,
    confidence: number
  ): Promise<void>;
  aiFailed(rawId: number): Promise<void>;
  /** The user's answer; 'ad_or_other' = not a transaction. Anything else is logged as given. */
  aiResolve(rawId: number, kind: AiKind, direction: 'in' | 'out', amount: number, counterparty: string | null): Promise<void>;
  getAuthItem(key: string): string | null;
  setAuthItem(key: string, value: string): void;
  removeAuthItem(key: string): void;
  /**
   * Switches the ledger file to this user's, or to the phone-only ledger with `LOCAL_OWNER` (null: nothing chosen).
   * local -> user merges the phone-only ledger into the user's; user -> local carries the user's ledger over.
   */
  setActiveUser(userId: string | null): Promise<void>;
  /** Whose ledger is open: a user id, `LOCAL_OWNER`, or null. Kept natively so the listener and widgets agree. */
  activeUser(): string | null;
  /** Adds cloud rows this ledger lacks, once per ledger and user. Resolves false if already done or the owner changed. */
  mergeFromCloud(
    userId: string,
    categories: CloudCategoryRow[],
    transactions: CloudTransactionRow[],
    selfNames: string | null
  ): Promise<boolean>;
  /** Credential Manager "Sign in with Google". Rejects with code ERR_CANCELLED, ERR_NO_ACCOUNT or ERR_GOOGLE_SIGN_IN. */
  signInWithGoogle(serverClientId: string): Promise<{ idToken: string; nonce: string }>;
}

export const LOCAL_OWNER = 'local';

export type CloudCategoryRow = { id: string; name: string; keywords: string; position: number };
export type CloudTransactionRow = {
  id: string;
  source: string;
  direction: 'in' | 'out';
  amount: number;
  counterparty: string | null;
  bankCategory: string | null;
  categoryId: string | null;
  categoryLocked: boolean;
  isTransfer: boolean;
  transferLocked: boolean;
  pairId: string | null;
  /** Epoch milliseconds. */
  occurredAt: number;
};

export default requireNativeModule<BalanceCoreModule>('BalanceCore');
