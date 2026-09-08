export const GET = async () => Response.json({ googleClientId: process.env.GOOGLE_CLIENT_ID ?? null, network: "testnet" });
