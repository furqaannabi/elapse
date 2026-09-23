# docs-site — docs.elapse.finance

Mintlify site; the pages live in `site/`. Spec: [`docs/specs/docs-site-frd.md`](../docs/specs/docs-site-frd.md).

`ci/surface-check.ts` keeps three lists honest: `@elapse/sdk`'s methods against the SDKs page and
the synced OpenAPI file, and `@elapse/react`'s exports against the React page. It reads the React
package's export list rather than importing it — a second copy of React in this project crashes
`mintlify validate`. `pnpm sync-snippets` writes every code sample from its source, including the
React page's, which come from `examples/saas/src/web/mount.tsx`.

```sh
pnpm install
pnpm dev             # mintlify on :3333
pnpm sync-snippets   # copies code snippets from examples/saas and the SDK, and openapi.json from api/, into site/
pnpm check           # snippets in sync, SDK surface matches the docs, mintlify validate, broken links
pnpm test            # vitest over the pages and snippets
```

Snippets are never hand-edited in `site/snippets/`; change the source and rerun the sync. Mintlify builds from `furqaannabi/elapse` on every push to `master`; nothing here is deployed by hand.
