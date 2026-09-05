import { describe, it, expect } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildPermitTypedData, recoverPermitSigner, splitSignature } from "../src/chain/permit";

const FACTORY = "0x2A27160FC556819f2b3D293bbFA0aac5360E3C40";
const TOKEN = "0x003ac9aaC1d5d7d69B5F9727144dBaee2e867BA5";

describe("FR-API-032 permit payload", () => {
  it("FR_API_032_builds_an_ERC2612_typed_data_payload_bound_to_the_cap", () => {
    const td = buildPermitTypedData({
      domain: { name: "Mock USD", version: "1", chainId: 10143, verifyingContract: TOKEN },
      owner: "0x2222222222222222222222222222222222222222",
      spender: FACTORY,
      value: 14_400_000n,
      nonce: 0n,
      deadline: 1_757_000_600n,
    });
    expect(td.primaryType).toBe("Permit");
    expect(td.types.Permit.map((f) => f.name)).toEqual(["owner", "spender", "value", "nonce", "deadline"]);
    expect(td.message).toEqual({ owner: "0x2222222222222222222222222222222222222222", spender: FACTORY, value: 14_400_000n, nonce: 0n, deadline: 1_757_000_600n });
    // The wire form carries uint256s as decimal strings (BR-API-004).
    const wire = JSON.parse(JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(wire.message.value).toBe("14400000");
    expect(wire.domain.chainId).toBe(10143); // wallets take the domain chainId as a JSON number
  });

  it("FR_API_032_recovers_the_signer_and_rejects_a_different_wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey()); // throwaway, test-only
    const td = buildPermitTypedData({
      domain: { name: "Mock USD", version: "1", chainId: 10143, verifyingContract: TOKEN },
      owner: account.address,
      spender: FACTORY,
      value: 14_400_000n,
      nonce: 3n,
      deadline: 1_757_000_600n,
    });
    const signature = await account.signTypedData(td);
    expect(await recoverPermitSigner(td, signature)).toBe(account.address.toLowerCase());
    const other = privateKeyToAccount(generatePrivateKey());
    expect(await recoverPermitSigner(td, await other.signTypedData(td))).not.toBe(account.address.toLowerCase());
    const { v, r, s } = splitSignature(signature);
    expect([27, 28]).toContain(Number(v));
    expect(r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("FR_API_032_a_malformed_signature_is_rejected_not_thrown", async () => {
    const td = buildPermitTypedData({
      domain: { name: "Mock USD", version: "1", chainId: 10143, verifyingContract: TOKEN },
      owner: "0x2222222222222222222222222222222222222222", spender: FACTORY, value: 1n, nonce: 0n, deadline: 1n,
    });
    expect(await recoverPermitSigner(td, "0xdeadbeef")).toBeNull();
    expect(() => splitSignature("0x12")).toThrow();
  });
});
