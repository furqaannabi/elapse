/**
 * Local development only: `bun run seed-merchant [email]`. Creates the merchant
 * if needed (with publishable keys per mode) and prints one fresh sk_test key.
 * Refuses in production; the dashboard is the only way to mint keys there.
 */
import { createApiKey, listApiKeys } from "../src/db/api-keys";
import { sql } from "../src/db/client";
import { createMerchant, findMerchantByEmail } from "../src/db/merchants";

if (process.env.NODE_ENV === "production") {
  console.error("seed-merchant refuses to run in production.");
  process.exit(1);
}
const email = (process.argv[2] ?? "dev@elapse.local").toLowerCase();
let merchant = await findMerchantByEmail(email);
if (!merchant) {
  merchant = await createMerchant({ name: email.split("@")[0]!, email });
  for (const livemode of [false, true]) await createApiKey({ merchantId: merchant.id, kind: "pk", livemode, name: "default", actor: "system:seed" });
}
const { plaintext } = await createApiKey({ merchantId: merchant.id, kind: "sk", livemode: false, name: `seed ${new Date().toISOString().slice(0, 10)}`, actor: "system:seed" });
const pk = (await listApiKeys(merchant.id, false)).find((k) => k.kind === "pk")!.plaintext;
console.log(`merchant   ${merchant.id}  (${email})`);
console.log(`pk_test    ${pk}`);
console.log(`sk_test    ${plaintext}   ← shown once; put it in ELAPSE_SECRET_KEY`);
await sql.close();
