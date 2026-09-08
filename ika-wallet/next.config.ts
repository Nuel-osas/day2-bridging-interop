import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["@ika.xyz/sdk", "@ika.xyz/ika-wasm", "@mysten/sui"] };
export default nextConfig;
