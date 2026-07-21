import { SALES_BIBLE } from "@/lib/hq/sales-bible";
import { BibleReader } from "./bible-reader";

/**
 * The Sales Bible — the full Agent Ivory playbook as a searchable reader.
 *
 * Content source of truth: src/content/sales-bible.md (edit it, run
 * `node scripts/sync-bible.mjs`, commit). The same text powers the Guru's
 * brain, so the playbook and the trainer can never drift apart.
 */
export default function SalesBiblePage() {
  return <BibleReader markdown={SALES_BIBLE} />;
}
