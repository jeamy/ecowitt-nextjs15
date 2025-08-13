// Note: avoid strict typing here so we can use keys supported by the current Next version
const nextConfig = {
  // Ensure native DuckDB modules are treated as externals in the server runtime
  // Note: experimental.serverComponentsExternalPackages was moved in Next.js
  // Use serverExternalPackages instead (see below).
  // For runtimes that honor this key (Next 14/15), also externalize at the server layer
  // If unsupported, Next will ignore it harmlessly
  serverExternalPackages: [
    "@duckdb/node-api",
    "@duckdb/node-bindings",
  ],
  // Fallback for Webpack-based builds (non-Turbopack): mark these as commonjs externals
  webpack: (config: any, { isServer }: { isServer: boolean }) => {
    if (isServer) {
      const externals = config.externals || [];
      // Externalize base packages
      externals.push({
        "@duckdb/node-api": "commonjs @duckdb/node-api",
        "@duckdb/node-bindings": "commonjs @duckdb/node-bindings",
      });
      // Externalize platform-specific native bindings e.g. @duckdb/node-bindings-linux-x64/duckdb.node
      externals.push((
        { request }: { request?: string },
        callback: (err?: any, result?: string) => void
      ) => {
        if (request && /^@duckdb\/node-bindings-[^/]+\/duckdb\.node$/.test(request)) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      });
      config.externals = externals;
    }
    return config;
  },
};

export default nextConfig;
