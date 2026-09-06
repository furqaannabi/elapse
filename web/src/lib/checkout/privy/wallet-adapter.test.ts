import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, recoverTypedDataAddress } from "viem";
import { subscriberWalletFrom, type RequestOnlyProvider } from "./wallet-adapter";

/** A provider that signs locally with a throwaway key, standing in for Privy's embedded wallet. */
function fakeProvider(pk: `0x${string}`): RequestOnlyProvider {
  const account = privateKeyToAccount(pk);
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return "0x279f";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account.address];
      if (method === "personal_sign") return account.signMessage({ message: { raw: params![0] as `0x${string}` } });
      if (method === "eth_signTypedData_v4") {
        const td = JSON.parse(params![1] as string);
        return account.signTypedData({ ...td, message: { ...td.message, value: BigInt(td.message.value), nonce: BigInt(td.message.nonce), deadline: BigInt(td.message.deadline) }, domain: { ...td.domain, chainId: Number(td.domain.chainId) } });
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

const permit = {
  domain: { name: "Mock USD", version: "1", chainId: 10143, verifyingContract: "0xb162dfde7073eb1b4dd6279efcd0568e9c09a21c" },
  types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Permit" as const,
  message: { owner: "", spender: "0x656fa8b348981602acf36fad07804e806cc15d5b", value: "14400000", nonce: "0", deadline: "1757000600" },
};

describe("subscriberWalletFrom", () => {
  it("signs the permit as EIP-712 so the API recovers the wallet", async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const w = subscriberWalletFrom({ address: account.address, getEthereumProvider: async () => fakeProvider(pk) }, 10143);
    const td = { ...permit, message: { ...permit.message, owner: account.address } };
    const sig = await w.signTypedData(td);
    const signer = await recoverTypedDataAddress({
      domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` }, types: td.types, primaryType: "Permit",
      message: { owner: account.address, spender: td.message.spender as `0x${string}`, value: 14_400_000n, nonce: 0n, deadline: 1_757_000_600n }, signature: sig,
    });
    expect(signer).toBe(account.address);
  });

  it("signs 32 raw bytes with personal_sign so the contract's cancelDigest recovers the wallet", async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const w = subscriberWalletFrom({ address: account.address, getEthereumProvider: async () => fakeProvider(pk) }, 10143);
    const raw = ("0x" + "ee".repeat(32)) as `0x${string}`;
    const sig = await w.signMessage(raw);
    expect(await recoverMessageAddress({ message: { raw }, signature: sig })).toBe(account.address);
  });
});
