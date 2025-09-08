import type { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import path from "path";
import { promises as fs } from "fs";

let conn: DuckDBConnection | null = null;

export async function getDuckConn(): Promise<DuckDBConnection> {
  if (conn) return conn;
  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "weather.duckdb");
  // Use cached instance to avoid double-attaching same DB
  const api = await import("@duckdb/node-api");
  const instance: DuckDBInstance = await api.DuckDBInstance.fromCache(dbPath, { threads: "4" });
  conn = (await instance.connect()) as DuckDBConnection;
  return conn;
}
