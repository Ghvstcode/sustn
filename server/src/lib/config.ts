import "dotenv/config";

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

export const config = {
    port: Number(process.env.PORT ?? "3001"),
    serverUrl: requireEnv("SERVER_URL"),
    appDeepLinkScheme: process.env.APP_DEEP_LINK_SCHEME ?? "sustn",
    github: {
        clientId: requireEnv("GITHUB_CLIENT_ID"),
        clientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
    },
    databaseUrl: requireEnv("DATABASE_URL"),
} as const;
