/**
 * ERC-2612 permit as EIP-712 typed data (FR-API-032, ADR 2026-09-04). The subscriber signs
 * exactly `maxEscrow` for the factory as spender with a nonce and a deadline, so a captured
 * signature cannot be replayed or stretched to a larger amount.
 */
import { hexToNumber, isHex, recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface PermitTypedData {
  domain: TypedDataDomain & PermitDomain;
  types: typeof PERMIT_TYPES;
  primaryType: "Permit";
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint };
}

export function buildPermitTypedData(input: {
  domain: PermitDomain;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}): PermitTypedData {
  return {
    domain: input.domain,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: input.owner, spender: input.spender, value: input.value, nonce: input.nonce, deadline: input.deadline },
  };
}

/** Lowercase signer address, or null when the signature is not a valid 65-byte ECDSA signature. */
export async function recoverPermitSigner(td: PermitTypedData, signature: string): Promise<string | null> {
  if (!isHex(signature) || signature.length !== 132) return null;
  try {
    const addr = await recoverTypedDataAddress({ ...td, signature });
    return addr.toLowerCase();
  } catch {
    return null;
  }
}

/** `0x{r}{s}{v}` → the `(v, r, s)` triple `createWithPermit` takes. */
export function splitSignature(signature: string): { v: number; r: Hex; s: Hex } {
  if (!isHex(signature) || signature.length !== 132) throw new Error("Signature must be 65 bytes");
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  let v = hexToNumber(`0x${signature.slice(130, 132)}`);
  if (v < 27) v += 27;
  return { v, r, s };
}
