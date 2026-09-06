/**
 * Wraps a Privy embedded wallet as the page's `SubscriberWallet`. Signing goes through the
 * wallet's EIP-1193 provider via viem, so typed data (the permit) and raw 32-byte messages
 * (the cancel authorisation) both work without Privy's confirmation modal: Face ID already
 * confirmed the person, and the copy on our screen says what is being authorised.
 */
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import type { PermitPayload, SubscriberWallet } from "../real-api";
import { chainFor } from "./chains";

/** viem's `custom()` transport needs only a JSON-RPC `request`; Privy types its provider more loosely than viem. */
export type RequestOnlyProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export interface EmbeddedWalletLike {
  address: string;
  getEthereumProvider(): Promise<RequestOnlyProvider>;
}

export function subscriberWalletFrom(wallet: EmbeddedWalletLike, chainId: number): SubscriberWallet {
  const address = wallet.address as `0x${string}`;
  const client = async () => createWalletClient({ account: address, chain: chainFor(chainId), transport: custom((await wallet.getEthereumProvider()) as unknown as EIP1193Provider) });
  return {
    address,
    async signTypedData(td: PermitPayload) {
      const c = await client();
      return c.signTypedData({
        account: address,
        domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
        types: td.types,
        primaryType: "Permit",
        message: {
          owner: td.message.owner as `0x${string}`,
          spender: td.message.spender as `0x${string}`,
          value: BigInt(td.message.value),
          nonce: BigInt(td.message.nonce),
          deadline: BigInt(td.message.deadline),
        },
      });
    },
    async signMessage(raw) {
      const c = await client();
      return c.signMessage({ account: address, message: { raw } });
    },
  };
}
