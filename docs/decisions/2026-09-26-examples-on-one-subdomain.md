# Both examples live on one subdomain, under path prefixes
2026-09-26 · Decided by Furqaan · accepted

## Context
`examples/saas` (Acme GPU) and `examples/lambda` (Northwind) needed a public home on the EC2 host that already runs the API behind nginx, so judges can use them without cloning anything. Both served every page, asset and API call from the root of their own origin: about twenty root-absolute paths across their HTML and bundled JavaScript, and both bundles were named `/web.js` and `/web.css`. Two options were weighed: nested subdomains (`saas.examples.elapse.finance`), which needs no code change, or one host with a path per example (`examples.elapse.finance/saas/`), which needs every browser-side path made relative. An nginx `sub_filter` rewrite could not cover it, because the JavaScript builds its paths at runtime (`` fetch(`/${what}`) ``).

## Decision
One host, `examples.elapse.finance`, with `/saas/` and `/lambda/` proxied to the two servers and the prefix stripped, and a root page linking both. The examples become prefix-safe: every URL the browser requests is relative, so each works identically at `/` and under any prefix ending in `/`. Server routes do not change. `BASE_URL` carries the prefix, so `success_url`, webhook URLs and the Elapse window's `frame-ancestors` all follow from it.

## Consequences
One DNS record and one certificate. The examples run under any prefix for anyone who clones them, and local development is unchanged. The two merchants share one origin, so neither may rely on origin-scoped storage as its own (BR-EXM-011). A page must be reached with its trailing slash, which nginx enforces with a redirect. Whether `/lambda/` is exposed without authentication — it runs arbitrary JavaScript with outbound internet — is left open for Furqaan (examples FRD, Undecided 6).

Specs: [examples-frd](../specs/examples-frd.md) FR-EXM-036/037, BR-EXM-011 · [examples-lambda-frd](../specs/examples-lambda-frd.md) FR-EXM-159.
