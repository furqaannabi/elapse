/**
 * Site-wide constants: external links and the demo merchant used on the
 * landing page. Demo values are synthetic and labelled as such in the UI.
 */
export const links = {
  docs: "https://docs.elapse.finance",
  quickstart: "https://docs.elapse.finance/quickstart",
  github: "https://github.com/furqaannabi/elapse",
  /** Acme GPU, live (examples FRD FR-EXM-037): the example the Quickstart is built from. */
  examples: "https://examples.elapse.finance/saas/",
  dashboard: "/dashboard",
  x: "https://x.com/elapsefinance",
} as const;

/** The merchant in the demo video: a GPU rented by the second. */
export const demoProduct = {
  merchant: "Nimbus",
  name: "GPU · 4090",
  rate: "0.004",
} as const;
