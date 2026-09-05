/**
 * Relayed cancel authorisation (contracts FR-CON-017). A party signs, EIP-191 personal-sign,
 * the 32 bytes `keccak256(abi.encode("ElapseCancel", chainid, stream, nonce, deadline))`; the
 * relayer submits `cancelFor(deadline, signature)` and pays the gas. The per-stream nonce is
 * read from the chain so a captured signature cannot be replayed.
 */
import { encodeAbiParameters, hashMessage, isHex, keccak256, recoverMessageAddress, type Address, type Hex } from "viem";

export function cancelInnerHash(input: { chainId: number; stream: Address | string; nonce: bigint; deadline: bigint }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      ["ElapseCancel", BigInt(input.chainId), input.stream as Address, input.nonce, input.deadline],
    ),
  );
}

/** What the contract's `cancelDigest` computes; useful for tests and debugging. */
export function cancelDigest(inner: Hex): Hex {
  return hashMessage({ raw: inner });
}

/** Lowercase signer of an EIP-191 signature over `inner`, or null if malformed. */
export async function recoverCancelSigner(inner: Hex, signature: string): Promise<string | null> {
  if (!isHex(signature) || signature.length !== 132) return null;
  try {
    return (await recoverMessageAddress({ message: { raw: inner }, signature })).toLowerCase();
  } catch {
    return null;
  }
}
