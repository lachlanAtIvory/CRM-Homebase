import { signOut } from "@/lib/actions";

/**
 * Shown to someone who is on the team but has no sections switched on yet.
 * (Anyone not on the team at all is sent back to the sign-in page instead.)
 */
export default function NoAccessPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/20 p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm ring-1 ring-foreground/5">
        <h1 className="text-lg font-bold">You're in, but there's nothing to see yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is set up, but no sections have been switched on for you. Ask Ryan or Lachlan to turn on what you need, then refresh this page.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <a href="/" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97]">Refresh</a>
          <form action={signOut}>
            <button type="submit" className="rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40">Sign out</button>
          </form>
        </div>
      </div>
    </main>
  );
}
