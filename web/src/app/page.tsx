/**
 * Landing page (elapse.dev). Server Component; the hero is the only
 * client island.
 *
 * Reading order: the meter you can cancel → install → three steps →
 * the monthly lie → the event catalog → tariff → Stripe-shaped close.
 *
 * Maps to: design brief Surface 1; surface brief .impeccable/surfaces.
 */
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MeterVsMonth } from "@/components/landing/meter-vs-month";
import { EventCatalog } from "@/components/landing/event-catalog";
import { Tariff } from "@/components/landing/tariff";
import { StripeShaped } from "@/components/landing/stripe-shaped";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <MeterVsMonth />
        <EventCatalog />
        <Tariff />
        <StripeShaped />
      </main>
      <SiteFooter />
    </>
  );
}
