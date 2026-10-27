import { NativeModule, requireNativeModule } from 'expo';

type BalanceCoreEvents = {
  onLedgerChanged: () => void;
};

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

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
  getAuthItem(key: string): string | null;
  setAuthItem(key: string, value: string): void;
  removeAuthItem(key: string): void;
  /** Switches the ledger file to this user's (null when signed out). */
  setActiveUser(userId: string | null): Promise<void>;
}

export default requireNativeModule<BalanceCoreModule>('BalanceCore');
