import { NativeModule, requireNativeModule } from 'expo';

type BalanceCoreEvents = {
  onLedgerChanged: () => void;
};

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export type AiKind = 'income' | 'expense' | 'transfer' | 'ad_or_other';

export type InstalledApp ={ package: string; label: string; icon: string | null };

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
  /** Switches the ledger file to this user's (null when signed out). */
  setActiveUser(userId: string | null): Promise<void>;
}

export default requireNativeModule<BalanceCoreModule>('BalanceCore');
