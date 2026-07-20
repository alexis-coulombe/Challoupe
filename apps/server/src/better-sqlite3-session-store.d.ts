declare module 'better-sqlite3-session-store' {
  import type session from 'express-session';

  interface SqliteStoreOptions {
    client: unknown;
    expired?: { clear?: boolean; intervalMs?: number };
  }

  export default function SqliteStoreFactory(
    s: typeof session
  ): new (options: SqliteStoreOptions) => session.Store;
}
