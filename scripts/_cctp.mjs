// CCTP V1 addresses (Circle docs, verified 2026-09-07). Sui is domain 8.
// Circle pauses V1 contracts on 2026-12-01; Sui had no V2 at the time of writing.
export const SEPOLIA = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
  messageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
};
export const SUI_TESTNET = {
  domain: 8,
  messageTransmitter: "0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5",
  tokenMessengerMinter: "0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb",
  messageTransmitterState: "0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e",
  tokenMessengerMinterState: "0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2",
  usdcTreasury: "0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe",
  usdcType: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  denyList: "0x403",
};
export const IRIS_SANDBOX = "https://iris-api-sandbox.circle.com";
