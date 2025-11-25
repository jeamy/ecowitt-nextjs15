import type { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import path from "path";
import { promises as fs } from "fs";

let dbInstance: DuckDBInstance | null = null;

/**
 * Gets the singleton DuckDB instance.
 * @returns {Promise<DuckDBInstance>}
 */
export async function getDuckDB(): Promise<DuckDBInstance> {
  if (dbInstance) return dbInstance;

  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "weather.duckdb");

  const api = await import("@duckdb/node-api");
  // Use cached instance to avoid double-attaching same DB
  dbInstance = await api.DuckDBInstance.fromCache(dbPath, { threads: "4" }); // Increased threads slightly
  return dbInstance;
}

/**
 * Gets a NEW DuckDB connection.
 * IMPORTANT: You MUST close this connection when done!
 * Prefer using `withConn` instead.
 */
export async function getDuckConn(): Promise<DuckDBConnection> {
  const db = await getDuckDB();
  return (await db.connect()) as DuckDBConnection;
}

/**
 * Executes a callback with a managed DuckDB connection.
 * Automatically closes the connection after the callback completes or fails.
 */
export async function withConn<T>(callback: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const conn = await getDuckConn();
  try {
    return await callback(conn);
  } finally {
    try {
      (conn as any).close();
    } catch (e) {
      console.error("[DuckDB] Failed to close connection:", e);
    }
  }
}

