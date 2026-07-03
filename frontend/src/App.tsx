import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FileText,
  Folder,
  GraduationCap,
  Layers,
  ListChecks,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  Upload,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Logo } from "./components/Logo";
import { fetchHealth, type HealthResponse } from "./lib/api";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; data: HealthResponse }
  | { status: "error"; message: string };

const navItems = [
  { label: "Subjects", icon: Folder, active: true },
  { label: "Upload", icon: Upload },
  { label: "Chat", icon: MessageSquare },
  { label: "Study Sets", icon: Layers },
  { label: "Exam Prep", icon: GraduationCap },
  { label: "Settings", icon: Settings },
];

const upcomingTools = [
  { label: "Citation-backed chat", icon: BookOpen },
  { label: "Summaries", icon: FileText },
  { label: "MCQs", icon: ListChecks },
  { label: "Flashcards", icon: Layers },
];

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    document.title = "PageTurn — Workspace";
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    let isMounted = true;

    fetchHealth()
      .then((data) => {
        if (isMounted) {
          setHealth({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (isMounted) {
          setHealth({ status: "error", message });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const healthCopy = useMemo(() => {
    if (health.status === "loading") {
      return "Checking backend connection";
    }

    if (health.status === "error") {
      return "Backend connection unavailable";
    }

    return "Backend connection ready";
  }, [health]);

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-border bg-surface px-4 py-6 lg:block">
          <Logo />
          <nav className="mt-8 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                className={`group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                  item.active
                    ? "bg-accent-soft text-accent"
                    : "text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                }`}
                type="button"
              >
                <item.icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-medium text-text-primary">Workspace</p>
              <p className="text-xs text-text-secondary">Phase 1 skeleton</p>
            </div>
            <button
              aria-label="Toggle dark mode"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
              type="button"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            >
              {theme === "light" ? (
                <Moon aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Sun aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </header>

          <AnimatePresence mode="wait">
            <motion.section
              key="workspace"
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8"
              exit={{ opacity: 0, y: 8 }}
              initial={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <section className="rounded-lg border border-border bg-surface p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-mono text-xs font-medium uppercase text-accent">
                      Local RAG Study Assistant
                    </p>
                    <h1 className="mt-3 text-3xl font-semibold tracking-normal text-text-primary md:text-4xl">
                      Empty shell, real connection.
                    </h1>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">
                      The Phase 1 workspace is running with the design system,
                      app shell, and backend health check in place.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-alt px-4 py-3">
                    <p className="text-xs font-medium uppercase text-text-secondary">Status</p>
                    <p className="mt-1 text-sm font-medium text-text-primary">{healthCopy}</p>
                  </div>
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-lg border border-border bg-surface p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <BookOpen aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-text-primary">
                        Backend Health
                      </h2>
                      <p className="text-sm text-text-secondary">FastAPI `/health` response</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-lg border border-border bg-surface-alt p-4">
                    {health.status === "loading" && <HealthSkeleton />}
                    {health.status === "error" && (
                      <p className="text-sm font-medium text-error">{health.message}</p>
                    )}
                    {health.status === "ready" && (
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <HealthItem label="Status" value={health.data.status} />
                        <HealthItem label="Service" value={health.data.service} />
                        <HealthItem label="Version" value={health.data.version} />
                        <HealthItem
                          label="Checked"
                          value={new Date(health.data.checked_at).toLocaleString()}
                        />
                      </dl>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-border bg-surface p-5">
                  <h2 className="text-lg font-semibold text-text-primary">Phase 1 Surface</h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    {upcomingTools.map((tool) => (
                      <div
                        className="flex items-center gap-3 rounded-lg border border-border bg-surface-alt p-3"
                        key={tool.label}
                      >
                        <tool.icon aria-hidden="true" className="h-4 w-4 text-accent" />
                        <span className="text-sm font-medium text-text-primary">
                          {tool.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.section>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function HealthItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-text-secondary">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-text-primary">{value}</dd>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="space-y-2" key={index}>
          <div className="h-3 w-16 animate-pulse rounded bg-border" />
          <div className="h-4 w-32 animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  );
}
