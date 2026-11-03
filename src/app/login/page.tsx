import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getUser()) redirect("/procurement");
  // The page must render even when the database is unreachable, so the problem is visible instead of a crash.
  let demoMode = false;
  let dbError = false;
  try {
    demoMode = (await getSettings()).demoMode;
  } catch (e) {
    dbError = true;
    console.error("[login] database unreachable:", (e as Error).message);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo height={110} />
        </div>
        {dbError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
            The server can't reach the database, so sign-in won't work yet. Administrator: open <code>/api/health</code> for details.
          </p>
        )}
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Sign in to Procurement</h1>
          <p className="mb-4 text-sm text-muted">Use your NYATI account.</p>
          <LoginForm />
        </div>
        {demoMode && (
          <div className="card mt-4 p-4 text-xs text-muted">
            <div className="mb-2 font-semibold text-brand-800">Demo accounts (password: <code>nyati123</code>)</div>
            <ul className="space-y-1">
              <li><code>buyer@nyati.in</code> — Procurement Manager</li>
              <li><code>approver@nyati.in</code> — Approver (Project Head)</li>
              <li><code>finance@nyati.in</code> — Approver (Finance)</li>
              <li><code>site@nyati.in</code> — Site / Store Engineer</li>
            </ul>
            <p className="mt-2">Admin: use the password set with <code>npm run create-admin</code>.</p>
          </div>
        )}
      </div>
    </main>
  );
}
