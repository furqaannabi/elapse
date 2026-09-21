/** The few contract functions the API calls or reads. Kept minimal on purpose; the full ABIs live in contracts/out. */
export const factoryAbi = [
  { type: "function", name: "settleBatch", stateMutability: "nonpayable", inputs: [{ name: "streams", type: "address[]" }], outputs: [] },
  {
    type: "function",
    name: "createWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "subscriber", type: "address" },
      { name: "token", type: "address" },
      { name: "ratePerSecond", type: "uint256" },
      { name: "maxEscrow", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "stream", type: "address" }],
  },
  {
    // FR-CON-019: funds the stream and leaves it Created; the merchant starts it when ready.
    type: "function",
    name: "createWithPermitNoStart",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "subscriber", type: "address" },
      { name: "token", type: "address" },
      { name: "ratePerSecond", type: "uint256" },
      { name: "maxEscrow", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "stream", type: "address" }],
  },
] as const;

export const permitTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  /** MockUSD only (testnet): anyone may mint. */
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const streamAbi = [
  { type: "function", name: "relayNonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // FR-CON-055: party or keeper, so the relayer can start on the merchant's behalf.
  { type: "function", name: "start", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // FR-CON-074: party or keeper, so a merchant can bill only while its resource is working.
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "resume", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "settledSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "merchant", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "subscriber", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "event", name: "Settled", inputs: [{ name: "seconds_", type: "uint256", indexed: false }, { name: "amount", type: "uint256", indexed: false }, { name: "fee", type: "uint256", indexed: false }] },
  { type: "event", name: "StreamCanceled", inputs: [{ name: "at", type: "uint256", indexed: false }, { name: "secondsElapsed", type: "uint256", indexed: false }, { name: "amountSettled", type: "uint256", indexed: false }, { name: "amountRefunded", type: "uint256", indexed: false }] },
  {
    type: "function",
    name: "cancelFor",
    stateMutability: "nonpayable",
    inputs: [{ name: "deadline", type: "uint256" }, { name: "signature", type: "bytes" }],
    outputs: [],
  },
] as const;
