declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface Database {
    pragma(pragma: string): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }

  interface DatabaseConstructor {
    new (filename: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
