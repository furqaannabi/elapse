# Envio HyperIndex

Index `StreamStarted`, `StreamCanceled`, `Settled` on Monad. Effect API POSTs to the platform ingest URL — not the merchant. Merchant webhooks are signed and retried by `worker/`.
