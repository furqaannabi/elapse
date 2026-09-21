/**
 * Relayed action authorisations (contracts FR-CON-017 cancel, FR-CON-018 pause/resume). A party
 * signs, EIP-191 personal-sign, the 32 bytes `keccak256(abi.encode(tag, chainid, stream, nonce,
 * deadline))` where the tag names the action, so a signed pause can never be submitted as a
 * resume or a cancel; the relayer submits `<action>For(deadline, signature)` and pays the gas.
 * The per-stream `relayNonce` is read from the chain so a captured signature cannot be replayed.
 */
import { encodeAbiParameters, hashMessage, isHex, keccak256, recoverMessageAddress, type Address, type Hex } from "viem";

/** FR-CON-018 withdrawn 2026-09-20: pause and resume are no longer relayed for anyone. */
export type RelayAction = "cancel";

const TAG: Record<RelayAction, string> = { cancel: "ElapseCancel" };

export function relayInnerHash(action: RelayAction, input: { chainId: number; stream: Address | string; nonce: bigint; deadline: bigint }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [TAG[action], BigInt(input.chainId), input.stream as Address, input.nonce, input.deadline],
    ),
  );
}

export function cancelInnerHash(input: { chainId: number; stream: Address | string; nonce: bigint; deadline: bigint }): Hex {
  return relayInnerHash("cancel", input);
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
