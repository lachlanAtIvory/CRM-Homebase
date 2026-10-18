"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { playReminderDing } from "@/lib/sounds";
import { planReminders, reminderText, type Reminder } from "@/lib/hq/callback-reminders";

const POLL_MS = 30_000;
const STORE_KEY = "callbackReminders.fired.v1";

/**
 * Background component that nudges the person who promised a callback: a
 * toast, a chime, a desktop notification (if they've allowed those) and a
 * count in the browser tab's title, wherever they are in the CRM.
 *
 * Renders nothing. Mounted once in the dashboard layout for anyone with the
 * Call List. Polls every 30 seconds and when the tab comes back into view.
 */
export function CallbackReminders() {
  const fired = useRef<Set<string>>(new Set());
  const baseTitle = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Remember what has already fired, so a reload doesn't repeat it (keep the last 200).
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
      if (Array.isArray(saved)) fired.current = new Set(saved.slice(-200));
    } catch { /* private mode: fine, just may repeat after a reload */ }
    const remember = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify([...fired.current].slice(-200))); } catch { /* ignore */ }
    };

    function setTitleCount(count: number) {
      if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\) callback[s]? due · /, "");
      document.title = count > 0 ? `(${count}) callback${count === 1 ? "" : "s"} due · ${baseTitle.current}` : baseTitle.current;
    }

    async function check() {
      // One check at a time, so a slow response can't make two overlapping checks fire the same reminder twice.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/call-leads/reminders", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { reminders: Reminder[] };
        const { actions, dueCount } = planReminders(data.reminders ?? [], Date.now(), fired.current);
        setTitleCount(dueCount);

        for (const a of actions) {
          fired.current.add(a.key);
          const { title, body } = reminderText(a);
          const open = () => { window.location.href = `/call-list?lead=${a.lead.id}`; };

          toast(a.kind === "soon" ? `⏰ ${title}` : `📞 ${title}`, {
            description: body,
            duration: a.kind === "soon" ? 12_000 : 60_000,
            action: { label: "Open", onClick: open },
          });
          playReminderDing();

          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification(title, { body, icon: "/favicon.ico", tag: `callback-${a.lead.id}` });
              n.onclick = () => { window.focus(); open(); n.close(); };
            } catch { /* some browsers only allow notifications from a service worker */ }
          }
        }
        if (actions.length) remember();
      } catch { /* offline or a blip: try again next time */ }
      finally { inFlight.current = false; }
    }

    check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, []);

  return null;
}
