// Demo EcoCon configuration.
// Copy this file to `eco.ts` and fill in your Ecowitt API credentials.
// IMPORTANT: Do NOT commit your real keys. The repo's .gitignore excludes `eco.ts`.
// Docs: https://doc.ecowitt.net/web/#/apiv3en?page_id=17

class EcoCon {
  private static instance: EcoCon;

  private readonly config = {
    applicationKey: "YOUR_APPLICATION_KEY_HERE",
    apiKey: "YOUR_API_KEY_HERE",
    mac: "AA:BB:CC:DD:EE:FF",
    server: "api.ecowitt.net"
  };

  private constructor() {}

  public static getInstance(): EcoCon {
    if (!EcoCon.instance) {
      EcoCon.instance = new EcoCon();
    }
    return EcoCon.instance;
  }

  public setServer(server: string): void {
    this.config.server = server;
  }

  public getConfig(): Readonly<typeof this.config> {
    return this.config;
  }
}

export default EcoCon;
