import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import testnet from "../deployments/10143.json" with { type: "json" };
import { CHAIN, FACTORY, START_BLOCK } from "./fixtures";

/**
 * Regression guard for the 2026-09-07 break: a redeploy moved `config.yaml` to a new factory and
 * start block, but the test fixtures still hardcoded the previous deployment. Every simulated log
 * then fell below `start_block` or came from an unindexed factory, and all 21 tests failed with
 * "never reached a handler" instead of saying what had drifted.
 *
 * `deployments/10143.json` (written by `pnpm sync-abi`) is the one source; `config.yaml` is edited by
 * hand on each redeploy, and the fixtures must follow the record rather than copy it.
 */

/** The `start_block` and `StreamFactory` address of one chain in config.yaml, without a YAML dependency. */
function configFor(chainId: number): { startBlock: number; factory: string } {
  const yaml = readFileSync(new URL("../config.yaml", import.meta.url), "utf8");
  const chain = yaml.split(/^\s*- id:\s*/m).find((section) => section.startsWith(String(chainId)));
  if (!chain) throw new Error(`config.yaml has no chain ${chainId}`);
  const startBlock = chain.match(/^\s*start_block:\s*(\d+)/m)?.[1];
  const factory = chain.match(/-\s*name:\s*StreamFactory\s*\n\s*address:\s*"?(0x[0-9a-fA-F]{40})"?/)?.[1];
  if (!startBlock || !factory) throw new Error(`config.yaml chain ${chainId} is missing start_block or the StreamFactory address`);
  return { startBlock: Number(startBlock), factory };
}

describe("FR-IDX-001/031 the indexer config, the deployment record and the test fixtures agree", () => {
  it("FR_IDX_001_config_yaml_start_block_and_factory_match_the_deployment_record", () => {
    const config = configFor(CHAIN);
    expect(config.startBlock).toBe(testnet.deployedAtBlock);
    expect(config.factory.toLowerCase()).toBe(testnet.factory.toLowerCase());
  });

  it("FR_IDX_031_fixtures_simulate_on_the_deployed_factory_from_its_deployment_block", () => {
    expect(FACTORY).toBe(testnet.factory.toLowerCase());
    expect(START_BLOCK).toBe(testnet.deployedAtBlock);
  });
});
