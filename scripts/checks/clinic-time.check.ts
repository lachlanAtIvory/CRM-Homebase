/**
 * Checks the clinic local-time helper (src/lib/hq/clinic-time.ts): working out the state from an
 * address or phone number, and how far behind Sydney that is in summer and winter.
 *
 * Run from the repo root:  npx tsx scripts/checks/clinic-time.check.ts
 */
import { clinicClockForSlot, clinicTime, diffLabel, guessState, minutesFromSydney, stateForPostcode } from "../../src/lib/hq/clinic-time";

let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };
const st = (a?: string | null, p?: string | null) => guessState(a, p);

// ── state from an address
eq("state + postcode", st("1 Main St, Helensvale QLD 4212"), { state: "QLD", how: "address" });
eq("mixed case", st("Shop 3, 22 George St, Parramatta Nsw 2150"), { state: "NSW", how: "address" });
eq("with full stop and comma", st("12 Smith Rd, Perth WA., 6000"), { state: "WA", how: "address" });
eq("Level 2, 5 Pitt St, Sydney NSW", st("Level 2, 5 Pitt St, Sydney NSW"), { state: "NSW", how: "address" });
eq("trailing 'Australia'", st("1 Collins St, Melbourne VIC 3000, Australia"), { state: "VIC", how: "address" });
eq("full state name", st("14 Rundle Mall, Adelaide, South Australia"), { state: "SA", how: "address" });
eq("full state name: Western Australia isn't mistaken for Australia", st("Fremantle, Western Australia 6160"), { state: "WA", how: "address" });
eq("Northern Territory", st("Mitchell St, Darwin NT 0800"), { state: "NT", how: "address" });
eq("Tasmania", st("Salamanca Place, Hobart TAS 7000"), { state: "TAS", how: "address" });
eq("ACT", st("Canberra Centre, Canberra ACT 2601"), { state: "ACT", how: "address" });
eq("the LAST state wins (a street named for another)", st("1 Victoria St, Brisbane QLD 4000"), { state: "QLD", how: "address" });
eq("a street called 'WA' type word in the middle does not beat the real ending", st("12 NT Road, Cairns QLD 4870"), { state: "QLD", how: "address" });
eq("postcode only", st("Shop 4, Westfield, 6000"), { state: "WA", how: "postcode" });
eq("postcode only: Gold Coast", st("Helensvale 4212"), { state: "QLD", how: "postcode" });
// ── postcode ranges
for (const [c, s] of [[2000, "NSW"], [2600, "ACT"], [2618, "ACT"], [2619, "NSW"], [2900, "ACT"], [3000, "VIC"], [4000, "QLD"], [5000, "SA"], [6000, "WA"], [7000, "TAS"], [800, "NT"], [872, "NT"], [200, "ACT"], [1234, "NSW"], [8000, "VIC"], [9000, "QLD"]] as const) eq(`postcode ${c}`, stateForPostcode(c), s);
eq("postcode outside Australia's ranges", stateForPostcode(100), null);
// ── phone fallback
eq("07 -> QLD (from the phone)", st(null, "(07) 5555 1234"), { state: "QLD", how: "phone" });
eq("+61 7 -> QLD", st("", "+61 7 5555 1234"), { state: "QLD", how: "phone" });
eq("02 -> NSW", st(undefined, "02 9953 1234"), { state: "NSW", how: "phone" });
eq("03 -> VIC", st(null, "03 9000 1234"), { state: "VIC", how: "phone" });
eq("08 is too mixed (WA, SA, NT) -> unknown", st(null, "08 9000 1234"), null);
eq("a mobile tells us nothing", st(null, "0412 345 678"), null);
eq("1300 tells us nothing", st(null, "1300 123 456"), null);
eq("nothing at all", st(null, null), null);
eq("the address beats the phone", st("Perth WA 6000", "(07) 5555 1234"), { state: "WA", how: "address" });
eq("a useless address falls through to the phone", st("somewhere", "(07) 5555 1234"), { state: "QLD", how: "phone" });

// ── how far behind Sydney (the zones follow real daylight saving)
const SUMMER = new Date("2026-10-20T01:00:00Z");   // 12:00 Sydney (AEDT)
const WINTER = new Date("2026-06-16T02:00:00Z");   // 12:00 Sydney (AEST)
const z = (zone: string, d: Date) => minutesFromSydney(zone, d);
eq("summer: QLD 1 hour behind", z("Australia/Brisbane", SUMMER), -60);
eq("summer: WA 3 hours behind", z("Australia/Perth", SUMMER), -180);
eq("summer: SA half an hour behind", z("Australia/Adelaide", SUMMER), -30);
eq("summer: NT an hour and a half behind", z("Australia/Darwin", SUMMER), -90);
eq("summer: Victoria and Tasmania the same", [z("Australia/Melbourne", SUMMER), z("Australia/Hobart", SUMMER)], [0, 0]);
eq("winter: QLD the same as Sydney", z("Australia/Brisbane", WINTER), 0);
eq("winter: WA 2 hours behind", z("Australia/Perth", WINTER), -120);
eq("winter: SA half an hour behind", z("Australia/Adelaide", WINTER), -30);
eq("winter: NT only half an hour behind (Sydney is off daylight saving too)", z("Australia/Darwin", WINTER), -30);
eq("labels", [diffLabel(0), diffLabel(-30), diffLabel(-60), diffLabel(-90), diffLabel(-120), diffLabel(-180)], ["same time as Sydney", "30 minutes behind Sydney", "1 hour behind Sydney", "1½ hours behind Sydney", "2 hours behind Sydney", "3 hours behind Sydney"]);

// ── the line shown on screen
let c = clinicTime({ address: "1 Main St, Helensvale QLD 4212" }, new Date("2026-10-20T01:00:00Z"))!;   // Tue 11:00 in QLD
eq("QLD in summer: 11:00 am Tue, 1 hour behind, open", [c.clock, c.day, c.diffLabel, c.hours, c.state], ["11:00 am", "Tue", "1 hour behind Sydney", "open", "QLD"]);
eq("summary text", c.summary, "11:00 am Tue in QLD (1 hour behind Sydney) · usually open");
c = clinicTime({ address: "Fremantle WA 6160" }, new Date("2026-10-20T01:00:00Z"))!;                    // 09:00 WA Tue
eq("WA: 9:00 am, 3 hours behind", [c.clock, c.diffLabel, c.hours], ["9:00 am", "3 hours behind Sydney", "open"]);
c = clinicTime({ address: "Fremantle WA 6160" }, new Date("2026-10-19T22:30:00Z"))!;                    // Tue 09:30 Sydney = Tue 06:30 WA
eq("WA at 9:30 am Sydney is 6:30 am there: usually closed", [c.clock, c.hours, c.summary.endsWith("usually closed now")], ["6:30 am", "after-hours", true]);
c = clinicTime({ address: "Parramatta NSW 2150" }, new Date("2026-10-20T01:00:00Z"))!;
eq("NSW: same as Sydney", [c.diff, c.summary], [0, "12:00 pm Tue (NSW, same as Sydney) · usually open"]);
c = clinicTime({ address: "Parramatta NSW 2150" }, new Date("2026-10-24T01:00:00Z"))!;                   // Saturday
eq("Saturday: weekend", [c.hours, c.summary.endsWith("weekend: many clinics are closed")], ["weekend", true]);
c = clinicTime({ address: "Parramatta NSW 2150" }, new Date("2026-10-20T08:00:00Z"))!;                   // Tue 19:00 Sydney
eq("evening: after hours", c.hours, "after-hours");
c = clinicTime({ phone: "(07) 5555 1234" }, new Date("2026-10-20T01:00:00Z"))!;
eq("a state guessed from the phone is flagged with a '?'", c.summary.includes("in QLD?"), true);
eq("unknown state -> no line at all", clinicTime({ address: "somewhere", phone: "0412 345 678" }), null);

// ── what a booking time is at the clinic
eq("QLD clinic: a 9:30 am Sydney slot is 8:30 am there", clinicClockForSlot({ address: "Helensvale QLD 4212" }, "2026-10-20T22:30:00.000Z"), { clock: "8:30 am", state: "QLD" });
eq("WA clinic: 2:00 pm Sydney is 11:00 am there", clinicClockForSlot({ address: "Perth WA 6000" }, "2026-10-21T03:00:00.000Z"), { clock: "11:00 am", state: "WA" });
eq("same zone as Sydney: nothing to say", clinicClockForSlot({ address: "Parramatta NSW 2150" }, "2026-10-21T03:00:00.000Z"), null);
eq("QLD in winter is the same as Sydney: nothing to say", clinicClockForSlot({ address: "Helensvale QLD 4212" }, "2026-06-16T02:00:00.000Z"), null);
eq("unknown clinic: nothing to say", clinicClockForSlot({ address: "somewhere" }, "2026-10-21T03:00:00.000Z"), null);
eq("bad time: nothing to say", clinicClockForSlot({ address: "Perth WA 6000" }, "nope"), null);

console.log(`\n${passes} passed, ${fails} failed`);
