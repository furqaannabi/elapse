/**
 * `<TxLink hash>` (FR-RCT-023): a transaction, shown the way a person can actually check it —
 * the two ends of the hash and a link to the chain's explorer.
 *
 * No default component renders this (BR-RCT-001). A subscriber should not have to learn what a
 * transaction is to buy something; a merchant who wants to show proof places it themselves, and
 * `<Meter proof>` is that choice made for them in one place.
 */
import { explorerUrl } from "./explorer";

export function TxLink({ hash, chainId = 10143, className }: { hash: string; chainId?: number; className?: string }) {
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  return (
    <a
      className={className ?? "elapse-tx"}
      href={explorerUrl(hash, chainId)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
    >
      {short}
    </a>
  );
}
