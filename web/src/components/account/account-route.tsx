/**
 * Client entry for `/account`: picks the seeded identity from `?as=` while
 * the API is a mock (FR-CHK-025) and hands the page its API.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { getAccountApi, parseSeed } from "@/lib/account/client";
import { AccountPage } from "./account-page";

export function AccountRoute() {
  const params = useSearchParams();
  return <AccountPage api={getAccountApi(parseSeed(params.get("as")))} />;
}
