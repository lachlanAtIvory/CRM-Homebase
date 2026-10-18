/**
 * Checks when callback reminders fire (src/lib/hq/callback-reminders.ts): shortly before, at the time,
 * and every 15 minutes while overdue; never twice; and who a callback belongs to.
 *
 * Run from the repo root:  npx tsx scripts/checks/callback-reminders.check.ts
 */
import { fetchMyReminders, planReminders, reminderText, type Reminder } from "../../src/lib/hq/callback-reminders";

let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

const T = new Date("2026-10-20T01:00:00Z").getTime();
const min = (n: number) => T + n * 60000;
const lead = (id: string, offsetMin: number): Reminder => ({ id, business_name: `Clinic ${id}`, phone: "(07) 5555 1234", callback_at: new Date(min(offsetMin)).toISOString() });
const plan = (rs: Reminder[], now: number, fired: string[] = []) => planReminders(rs, now, new Set(fired));
const kinds = (r: ReturnType<typeof plan>) => r.actions.map((a) => `${a.lead.id}:${a.kind}`);

eq("10 minutes before: nothing yet", kinds(plan([lead("a", 10)], T)), []);
eq("5 minutes before: a heads-up", kinds(plan([lead("a", 5)], T)), ["a:soon"]);
eq("...saying 5 minutes", plan([lead("a", 5)], T).actions[0].minutes, 5);
eq("2 minutes before: still the heads-up (rounds up)", plan([lead("a", 2)], T).actions[0].minutes, 2);
eq("30 seconds before says at least 1 minute", plan([lead("a", 0.5)], T).actions[0].minutes, 1);
eq("exactly due: 'due now'", kinds(plan([lead("a", 0)], T)), ["a:due"]);
eq("3 minutes late: 'due' (first time)", kinds(plan([lead("a", -3)], T)), ["a:due"]);
eq("due counts in the tab title", [plan([lead("a", -3)], T).dueCount, plan([lead("a", 3)], T).dueCount], [1, 0]);

// never twice
const first = plan([lead("a", 4)], T);
eq("the heads-up isn't repeated once fired", kinds(plan([lead("a", 4)], T, [first.actions[0].key])), []);
eq("...but 'due' still fires later", kinds(plan([lead("a", 4)], min(5), [first.actions[0].key])), ["a:due"]);
const dueKey = `${lead("a", 0).id}|${lead("a", 0).callback_at}|due`;
eq("due isn't repeated straight away", kinds(plan([lead("a", 0)], min(2), [dueKey])), []);
eq("overdue nudge at 15 minutes", kinds(plan([lead("a", 0)], min(15), [dueKey])), ["a:overdue"]);
eq("...saying how late", plan([lead("a", 0)], min(16), [dueKey]).actions[0].minutes, 16);
const over1 = `${lead("a", 0).id}|${lead("a", 0).callback_at}|over1`;
eq("next nudge only at 30 minutes", [kinds(plan([lead("a", 0)], min(20), [dueKey, over1])), kinds(plan([lead("a", 0)], min(31), [dueKey, over1]))], [[], ["a:overdue"]]);
const all = ["due", "over1", "over2", "over3", "over4"].map((k) => `${lead("a", 0).id}|${lead("a", 0).callback_at}|${k}`);
eq("it stops nagging after four nudges", kinds(plan([lead("a", 0)], min(90), all)), []);
eq("a callback 4 hours late doesn't pop up (but still counts)", [kinds(plan([lead("a", -240)], T)), plan([lead("a", -240)], T).dueCount], [[], 1]);
eq("a callback exactly 3 hours late still does", kinds(plan([lead("a", -179)], T)), ["a:due"]);
eq("rescheduling gives a fresh reminder (the key includes the time)", kinds(plan([lead("a", 4)], T, [`a|${new Date(min(-60)).toISOString()}|due`])), ["a:soon"]);
eq("junk time is ignored", kinds(plan([{ id: "x", business_name: "X", phone: null, callback_at: "nope" }], T)), []);
const many = plan([lead("a", -3), lead("b", 4), lead("c", 30), lead("d", -200)], T);
eq("several at once: only the right ones act, all overdue ones counted", [kinds(many), many.dueCount], [["a:due", "b:soon"], 2]);
eq("text: heads-up", reminderText({ key: "k", kind: "soon", minutes: 5, lead: lead("a", 5) }), { title: "Callback in 5 min", body: "Clinic a · (07) 5555 1234" });
eq("text: due", reminderText({ key: "k", kind: "due", minutes: 0, lead: lead("a", 0) }).title, "Callback due now");
eq("text: overdue", reminderText({ key: "k", kind: "overdue", minutes: 30, lead: lead("a", 0) }).title, "Callback 30 min overdue");
eq("text: no phone", reminderText({ key: "k", kind: "due", minutes: 0, lead: { ...lead("a", 0), phone: null } }).body, "Clinic a");

// ── whose callbacks: the query asks for the right owner
const queries: string[] = [];
function fakeDb(rows: Record<string, unknown>[], failOwner = false) {
  let awaited = 0;
  const q: Record<string, any> = {
    select() { return q; }, eq() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; },
    or(expr: string) { queries.push(expr); return q; },
    then(res: any) { return Promise.resolve(failOwner && awaited++ === 0 ? { data: null, error: { message: 'column "callback_by" does not exist' } } : { data: rows, error: null }).then(res); },
  };
  return { from: () => q } as any;
}
(async () => {
  await fetchMyReminders(fakeDb([]), { email: "Jan@Agentivory.com", isManager: false });
  eq("a caller only gets callbacks they promised (email lower-cased)", queries.at(-1), "callback_by.eq.jan@agentivory.com");
  await fetchMyReminders(fakeDb([]), { email: "ryan@agentivory.com", isManager: true });
  eq("a manager also gets older callbacks that have no owner", queries.at(-1), "callback_by.eq.ryan@agentivory.com,callback_by.is.null");
  const before = queries.length;
  await fetchMyReminders(fakeDb([]), { email: "bad,email)@x.com", isManager: false });
  eq("a strange email never reaches the filter string", queries.length, before);
  const rows = [{ id: "1", business_name: "B", phone: null, callback_at: "2026-10-20T01:00:00Z" }];
  eq("returns the rows", (await fetchMyReminders(fakeDb(rows), { email: "a@b.co", isManager: true })).length, 1);
  queries.length = 0;
  const fallback = await fetchMyReminders(fakeDb(rows, true), { email: "a@b.co", isManager: true });
  eq("before the migration (no callback_by column) it falls back instead of failing", fallback.length, 1);
  console.log(`\n${passes} passed, ${fails} failed`);
})();
