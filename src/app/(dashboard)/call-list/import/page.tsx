import { ImportForm } from "./import-form";
import { ManageList } from "./manage-list";

/**
 * Import leads into the Call List from the scraped Google Sheet, and manage
 * what's already there (fill in websites, delete leads).
 * TODO(roles): manager-only once roles ship.
 */
export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ImportForm />
      <ManageList />
    </div>
  );
}
