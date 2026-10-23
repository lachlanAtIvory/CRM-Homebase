import { CORE, CORE_ORDER, UPSELLS } from "./quote-config";

/**
 * What Agent Ivory sells, as the application form lists it.
 *
 * This is derived from the Quote Builder's configuration (quote-config.ts), so
 * a product renamed or added there shows up in the application form with no
 * second list to keep in step. A product's key is the Quote Builder's own id:
 * "inbound" / "dm" / "outbound" for the core products, and an add-on's id
 * ("treatment", "recall", "guru"...) for the add-ons.
 *
 * Applications made before the new offerings used the old `products` table's
 * keys ("agent_ivory", "webchat"...). Those aren't here; the form looks them up
 * from that table so an old application still reads properly.
 */

export type OfferingGroup = "core" | "rev" | "eff";

export type Offering = {
  key: string;
  label: string;
  desc: string;
  group: OfferingGroup;
};

export const OFFERING_GROUP_LABEL: Record<OfferingGroup, string> = {
  core: "Core products",
  rev: "Revenue add-ons",
  eff: "Efficiency add-ons",
};

export const OFFERINGS: Offering[] = [
  ...CORE_ORDER.map((key): Offering => ({ key, label: CORE[key].label, desc: CORE[key].desc, group: "core" })),
  ...UPSELLS.map((u): Offering => ({ key: u.id, label: u.name, desc: u.desc, group: u.group })),
];

const BY_KEY = new Map(OFFERINGS.map((o) => [o.key, o]));

export function findOffering(key: string): Offering | undefined {
  return BY_KEY.get(key);
}

/** True for a key from the current offerings (as opposed to an old-catalogue key). */
export function isOfferingKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** The offerings in display order, grouped. */
export function offeringGroups(): { group: OfferingGroup; label: string; items: Offering[] }[] {
  return (["core", "rev", "eff"] as OfferingGroup[]).map((group) => ({
    group,
    label: OFFERING_GROUP_LABEL[group],
    items: OFFERINGS.filter((o) => o.group === group),
  }));
}
