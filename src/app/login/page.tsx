import { LoginButton } from "./login-button";

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "That Google account isn't authorised to access this app.",
  missing_code: "Sign-in was cancelled or the link expired. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? `Sign-in error: ${error}`)
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Agent Ivory CRM
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Internal dashboard</p>
        </div>

        {errorMessage && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <LoginButton />
      </div>
    </main>
  );
}
