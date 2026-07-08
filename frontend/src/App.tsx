import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FileUp,
  Folder,
  GraduationCap,
  History,
  Layers,
  ListChecks,
  MessageSquare,
  Moon,
  Plus,
  Quote,
  RefreshCw,
  Send,
  Settings,
  Sun,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Logo } from "./components/Logo";
import {
  createSubject,
  fetchChatHistory,
  fetchDashboardStats,
  fetchDocuments,
  fetchGeneratedContent,
  fetchHealth,
  fetchSubjects,
  generateStudyContent,
  getDocumentFileUrl,
  getGeneratedExportUrl,
  streamChatAnswer,
  uploadDocument,
  type ChatHistorySession,
  type Citation,
  type DashboardStats,
  type DocumentRecord,
  type ExplanationMode,
  type GeneratedContent,
  type GenerationType,
  type HealthResponse,
  type Subject,
} from "./lib/api";

type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type HealthState = Loadable<HealthResponse>;
type SubjectsState = Loadable<Subject[]>;
type DocumentsState = Loadable<DocumentRecord[]>;
type DashboardStatsState = Loadable<DashboardStats>;
type ChatHistoryState = Loadable<ChatHistorySession[]>;
type GeneratedContentState = Loadable<GeneratedContent[]>;

type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

const navItems = [
  { label: "Subjects", icon: Folder, active: true },
  { label: "Upload", icon: Upload },
  { label: "Chat", icon: MessageSquare },
  { label: "Study Sets", icon: Layers },
  { label: "Exam Prep", icon: GraduationCap },
  { label: "Settings", icon: Settings },
];

const statusStyles = {
  processing: "bg-accent-soft text-accent",
  extracting: "bg-accent-soft text-accent",
  chunking: "bg-accent-soft text-accent",
  ready: "bg-accent-soft text-accent",
  failed: "bg-red-50 text-error dark:bg-red-950/30",
};

const statusIcons = {
  processing: Clock3,
  extracting: Clock3,
  chunking: Clock3,
  ready: CheckCircle2,
  failed: AlertTriangle,
};

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => getInitialTheme());
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [subjects, setSubjects] = useState<SubjectsState>({ status: "loading" });
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsState>({ status: "loading" });
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<DocumentsState>({ status: "ready", data: [] });
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSubject = useMemo(() => {
    if (subjects.status !== "ready" || selectedSubjectId === null) {
      return null;
    }

    return subjects.data.find((subject) => subject.id === selectedSubjectId) ?? null;
  }, [selectedSubjectId, subjects]);

  useEffect(() => {
    document.title = selectedSubject
      ? `PageTurn \u2014 ${selectedSubject.name}`
      : "PageTurn \u2014 Subjects";
  }, [selectedSubject]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("pageturn-theme", theme);
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
        if (isMounted) {
          setHealth({ status: "error", message: getMessage(error) });
        }
      });

    loadSubjects();
    loadDashboardStats();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedSubjectId === null) {
      setDocuments({ status: "ready", data: [] });
      return;
    }

    let isActive = true;

    const load = () => {
      fetchDocuments(selectedSubjectId)
        .then((data) => {
          if (isActive) {
            setDocuments({ status: "ready", data });
          }
        })
        .catch((error: unknown) => {
          if (isActive) {
            setDocuments({ status: "error", message: getMessage(error) });
          }
        });
    };

    setDocuments({ status: "loading" });
    load();

    return () => {
      isActive = false;
    };
  }, [selectedSubjectId]);

  useEffect(() => {
    if (
      selectedSubjectId === null ||
      documents.status !== "ready" ||
      documents.data.every((document) => isTerminalStatus(document.upload_status))
    ) {
      return;
    }

    let isActive = true;

    const intervalId = window.setInterval(load, 1800);

    function load() {
      fetchDocuments(selectedSubjectId!)
        .then((data) => {
          if (isActive) {
            setDocuments({ status: "ready", data });
          }
        })
        .catch((error: unknown) => {
          if (isActive) {
            setDocuments({ status: "error", message: getMessage(error) });
          }
        });
    }

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [documents, selectedSubjectId]);

  function loadSubjects() {
    setSubjects({ status: "loading" });
    fetchSubjects()
      .then((data) => setSubjects({ status: "ready", data }))
      .catch((error: unknown) => setSubjects({ status: "error", message: getMessage(error) }));
  }

  function loadDashboardStats() {
    setDashboardStats({ status: "loading" });
    fetchDashboardStats()
      .then((data) => setDashboardStats({ status: "ready", data }))
      .catch((error: unknown) =>
        setDashboardStats({ status: "error", message: getMessage(error) }),
      );
  }

  async function handleCreateSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubjectError(null);

    const nextName = subjectName.trim();
    if (!nextName) {
      setSubjectError("Subject name is required.");
      return;
    }

    setIsCreatingSubject(true);
    try {
      const subject = await createSubject(nextName);
      setSubjects((current) => {
        const existing = current.status === "ready" ? current.data : [];
        return { status: "ready", data: [subject, ...existing] };
      });
      setSelectedSubjectId(subject.id);
      setSubjectName("");
      setIsSubjectModalOpen(false);
      loadDashboardStats();
    } catch (error) {
      setSubjectError(getMessage(error));
    } finally {
      setIsCreatingSubject(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file || selectedSubjectId === null) {
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const document = await uploadDocument(selectedSubjectId, file);
      setDocuments((current) => {
        const existing = current.status === "ready" ? current.data : [];
        return { status: "ready", data: [document, ...existing] };
      });
      void fetchDocuments(selectedSubjectId).then((data) => {
        setDocuments({ status: "ready", data });
      });
      void fetchSubjects().then((data) => setSubjects({ status: "ready", data }));
      loadDashboardStats();
    } catch (error) {
      setUploadError(getMessage(error));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  const healthCopy = health.status === "ready" ? "API online" : "API check";

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-border bg-surface px-4 py-6 lg:block">
          <Logo />
          <nav className="mt-8 space-y-1">
            {navItems.map((item) => (
              <button
                aria-current={item.active ? "page" : undefined}
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
              <p className="text-sm font-medium text-text-primary">
                {selectedSubject?.name ?? "Subjects"}
              </p>
              <p className="text-xs text-text-secondary">Phase 2 upload workflow</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs font-medium text-text-secondary sm:flex">
                <span className={health.status === "ready" ? "text-accent" : "text-warning"}>
                  {healthCopy}
                </span>
              </div>
              <button
                aria-label="Toggle dark mode"
                aria-pressed={theme === "dark"}
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
            </div>
          </header>

          <AnimatePresence mode="wait">
            {selectedSubject ? (
              <SubjectDetail
                documents={documents}
                isUploading={isUploading}
                key="subject-detail"
                onBack={() => {
                  setSelectedSubjectId(null);
                  loadDashboardStats();
                }}
                onRefresh={() => {
                  setDocuments({ status: "loading" });
                  fetchDocuments(selectedSubject.id)
                    .then((data) => setDocuments({ status: "ready", data }))
                    .catch((error) =>
                      setDocuments({ status: "error", message: getMessage(error) }),
                    );
                }}
                onUpload={handleUpload}
                refInput={fileInputRef}
                subject={selectedSubject}
                uploadError={uploadError}
              />
            ) : (
              <SubjectsDashboard
                key="subjects-dashboard"
                onCreate={() => setIsSubjectModalOpen(true)}
                onRefresh={() => {
                  loadSubjects();
                  loadDashboardStats();
                }}
                onSelect={setSelectedSubjectId}
                stats={dashboardStats}
                subjects={subjects}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isSubjectModalOpen && (
          <NewSubjectModal
            error={subjectError}
            isSubmitting={isCreatingSubject}
            name={subjectName}
            onChange={setSubjectName}
            onClose={() => {
              setIsSubjectModalOpen(false);
              setSubjectError(null);
            }}
            onSubmit={handleCreateSubject}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SubjectsDashboard({
  onCreate,
  onRefresh,
  onSelect,
  stats,
  subjects,
}: {
  onCreate: () => void;
  onRefresh: () => void;
  onSelect: (id: number) => void;
  stats: DashboardStatsState;
  subjects: SubjectsState;
}) {
  const statItems =
    stats.status === "ready"
      ? [
          { label: "Subjects", value: stats.data.subject_count, icon: Folder },
          { label: "Documents", value: stats.data.document_count, icon: FileText },
          { label: "Chat sessions", value: stats.data.chat_session_count, icon: MessageSquare },
          { label: "Generated sets", value: stats.data.generated_set_count, icon: BarChart3 },
        ]
      : [];

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-xs font-medium uppercase text-accent">Subjects</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">Study workspace</h1>
        </div>
        <div className="flex gap-2">
          <IconButton ariaLabel="Refresh subjects" icon={RefreshCw} onClick={onRefresh} />
          <button
            className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive"
            onClick={onCreate}
            type="button"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New Subject
          </button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        {stats.status === "loading" &&
          Array.from({ length: 4 }).map((_, index) => (
            <div className="rounded-lg border border-border bg-surface p-4" key={index}>
              <div className="h-4 w-24 rounded bg-surface-alt" />
              <div className="mt-4 h-7 w-16 rounded bg-surface-alt" />
            </div>
          ))}
        {stats.status === "error" && (
          <div className="rounded-lg border border-border bg-surface p-4 md:col-span-4">
            <p className="text-sm font-medium text-error">{stats.message}</p>
          </div>
        )}
        {statItems.map((item) => (
          <div className="rounded-lg border border-border bg-surface p-4" key={item.label}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase text-text-secondary">{item.label}</p>
              <item.icon aria-hidden="true" className="h-4 w-4 text-accent" />
            </div>
            <p className="mt-3 font-mono text-2xl text-text-primary">{item.value}</p>
          </div>
        ))}
      </section>

      {subjects.status === "loading" && <SubjectGridSkeleton />}
      {subjects.status === "error" && <ErrorPanel message={subjects.message} />}
      {subjects.status === "ready" && subjects.data.length === 0 && (
        <section className="rounded-lg border border-border bg-surface p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Folder aria-hidden="true" className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text-primary">No subjects yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
            Create a subject to group PDFs, processing status, and later chat history.
          </p>
        </section>
      )}
      {subjects.status === "ready" && subjects.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {subjects.data.map((subject) => (
            <button
              className="rounded-lg border border-border bg-surface p-5 text-left transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive"
              key={subject.id}
              onClick={() => onSelect(subject.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Folder aria-hidden="true" className="h-5 w-5" />
                </div>
                <span className="rounded-lg bg-surface-alt px-2.5 py-1 font-mono text-xs text-text-secondary">
                  {subject.document_count} docs
                </span>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-text-primary">{subject.name}</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Created {new Date(subject.created_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function SubjectDetail({
  documents,
  isUploading,
  onBack,
  onRefresh,
  onUpload,
  refInput,
  subject,
  uploadError,
}: {
  documents: DocumentsState;
  isUploading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onUpload: (file: File | undefined) => void;
  refInput: RefObject<HTMLInputElement>;
  subject: Subject;
  uploadError: string | null;
}) {
  const documentCount = documents.status === "ready" ? documents.data.length : subject.document_count;

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <button
            className="mb-4 flex items-center gap-2 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:text-text-primary"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Subjects
          </button>
          <p className="font-mono text-xs font-medium uppercase text-accent">Subject</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">{subject.name}</h1>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs font-medium uppercase text-text-secondary">Documents</p>
          <p className="mt-1 font-mono text-xl text-text-primary">{documentCount}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FileUp aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Upload PDF</h2>
              <p className="text-sm text-text-secondary">Text extraction starts immediately.</p>
            </div>
          </div>

          <input
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => onUpload(event.target.files?.[0])}
            ref={refInput}
            type="file"
          />
          <button
            className="mt-5 flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-alt p-6 text-center transition duration-150 ease-out hover:-translate-y-px hover:border-accent hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isUploading}
            onClick={() => refInput.current?.click()}
            type="button"
          >
            {isUploading ? (
              <SkeletonDot className="h-6 w-6" tone="accent" />
            ) : (
              <Upload aria-hidden="true" className="h-6 w-6 text-accent" />
            )}
            <span className="mt-3 text-sm font-medium text-text-primary">
              {isUploading ? "Uploading" : "Select PDF"}
            </span>
            <span className="mt-1 text-xs text-text-secondary">PDF only</span>
          </button>
          {uploadError && <p className="mt-3 text-sm font-medium text-error">{uploadError}</p>}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
              <p className="text-sm text-text-secondary">Processing status</p>
            </div>
            <IconButton ariaLabel="Refresh documents" icon={RefreshCw} onClick={onRefresh} />
          </div>

          <div className="mt-5">
            {documents.status === "loading" && <DocumentListSkeleton />}
            {documents.status === "error" && <ErrorPanel message={documents.message} />}
            {documents.status === "ready" && documents.data.length === 0 && (
              <div className="rounded-lg border border-border bg-surface-alt p-6 text-center">
                <FileText aria-hidden="true" className="mx-auto h-6 w-6 text-accent" />
                <p className="mt-3 text-sm font-medium text-text-primary">No documents</p>
              </div>
            )}
            {documents.status === "ready" && documents.data.length > 0 && (
              <div className="space-y-3">
                {documents.data.map((document) => (
                  <DocumentRow document={document} key={document.id} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <ChatPanel subject={subject} />
      <StudyToolsPanel subject={subject} />
    </motion.section>
  );
}

function ChatPanel({ subject }: { subject: Subject }) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<ExplanationMode>("university");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [history, setHistory] = useState<ChatHistoryState>({ status: "loading" });
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTurns([]);
    setActiveSessionId(null);
    loadHistory();
  }, [subject.id]);

  function loadHistory() {
    setHistory({ status: "loading" });
    fetchChatHistory(subject.id)
      .then((sessions) => setHistory({ status: "ready", data: sessions }))
      .catch((caughtError: unknown) =>
        setHistory({ status: "error", message: getMessage(caughtError) }),
      );
  }

  function openSession(session: ChatHistorySession) {
    setActiveSessionId(session.id);
    setTurns(
      session.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations,
      })),
    );
    setError(null);
  }

  function startNewSession() {
    setActiveSessionId(null);
    setTurns([]);
    setError(null);
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || isAnswering) {
      return;
    }

    const userTurn: ChatTurn = {
      id: Date.now(),
      role: "user",
      content: nextQuestion,
    };
    const assistantTurn: ChatTurn = {
      id: Date.now() + 1,
      role: "assistant",
      content: "",
      citations: [],
    };

    setTurns((current) => [...current, userTurn, assistantTurn]);
    setQuestion("");
    setError(null);
    setIsAnswering(true);

    try {
      await streamChatAnswer({
        subjectId: subject.id,
        question: nextQuestion,
        explanationMode: mode,
        sessionId: activeSessionId,
        onSession: (sessionId) => setActiveSessionId(sessionId),
        onToken: (text) => {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === assistantTurn.id
                ? { ...turn, content: turn.content + text }
                : turn,
            ),
          );
        },
        onCitations: (citations) => {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === assistantTurn.id ? { ...turn, citations } : turn,
            ),
          );
        },
      });
      loadHistory();
    } catch (caughtError) {
      setError(getMessage(caughtError));
      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantTurn.id
            ? { ...turn, content: "The answer stream failed before a response completed." }
            : turn,
        ),
      );
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <MessageSquare aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Chat With Notes</h2>
            <p className="text-sm text-text-secondary">Answers stream with source citations.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
            onClick={startNewSession}
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New chat
          </button>
          <div className="grid grid-cols-2 rounded-lg border border-border bg-surface-alt p-1">
            {(["simple", "university"] as ExplanationMode[]).map((option) => (
              <button
                aria-pressed={mode === option}
                className={`h-8 rounded-md px-3 text-xs font-medium transition duration-150 ease-out ${
                  mode === option ? "bg-surface text-accent" : "text-text-secondary"
                }`}
                key={option}
                onClick={() => setMode(option)}
                type="button"
              >
                {option === "simple" ? "Simple" : "University"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-lg border border-border bg-surface-alt p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-text-primary">History</p>
            </div>
            <IconButton ariaLabel="Refresh chat history" icon={RefreshCw} onClick={loadHistory} />
          </div>
          <div className="mt-3 space-y-2">
            {history.status === "loading" && <DocumentListSkeleton />}
            {history.status === "error" && <ErrorPanel message={history.message} />}
            {history.status === "ready" && history.data.length === 0 && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
                No saved chats yet.
              </p>
            )}
            {history.status === "ready" &&
              history.data.map((session) => (
                <button
                  aria-pressed={activeSessionId === session.id}
                  className={`w-full rounded-lg border p-3 text-left transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                    activeSessionId === session.id
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                  key={session.id}
                  onClick={() => openSession(session)}
                  type="button"
                >
                  <p className="line-clamp-2 text-sm font-medium text-text-primary">
                    {session.title}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {new Date(session.created_at).toLocaleString()}
                  </p>
                </button>
              ))}
          </div>
        </aside>

        <div>
          <div className="min-h-56 space-y-4 rounded-lg border border-border bg-surface-alt p-4">
            {turns.length === 0 && (
              <div className="flex h-44 items-center justify-center text-center">
                <div>
                  <Quote aria-hidden="true" className="mx-auto h-6 w-6 text-accent" />
                  <p className="mt-3 text-sm font-medium text-text-primary">
                    Ask from this subject
                  </p>
                </div>
              </div>
            )}

            {turns.map((turn) => (
              <div
                className={`max-w-3xl rounded-lg border border-border p-4 ${
                  turn.role === "user" ? "ml-auto bg-surface" : "bg-bg"
                }`}
                key={turn.id}
              >
                <p className="text-xs font-medium uppercase text-text-secondary">
                  {turn.role === "user" ? "You" : "PageTurn"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">
                  {turn.content}
                  {isAnswering && turn.role === "assistant" && turn.content && (
                    <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-accent align-middle" />
                  )}
                </p>
                {turn.citations && turn.citations.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {turn.citations.map((citation) => (
                      <a
                        className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 font-mono text-xs text-accent transition duration-150 ease-out hover:-translate-y-px hover:bg-surface hover:shadow-interactive"
                        href={getDocumentFileUrl(citation.document_id, citation.page_number)}
                        key={`${citation.document_id}-${citation.page_number}-${turn.id}`}
                        rel="noreferrer"
                        target="_blank"
                        title={citation.chunk_text}
                      >
                        <Quote aria-hidden="true" className="h-3.5 w-3.5" />
                        {citation.filename} - p.{citation.page_number}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && <p className="mt-3 text-sm font-medium text-error">{error}</p>}

          <form className="mt-4 flex flex-col gap-3 md:flex-row" onSubmit={handleAsk}>
            <input
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-alt px-3 text-sm text-text-primary outline-none transition duration-150 ease-out focus:border-accent"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question from the uploaded PDFs"
              value={question}
            />
            <button
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isAnswering || !question.trim()}
              type="submit"
            >
              {isAnswering ? (
                <SkeletonDot className="h-4 w-4" tone="light" />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
              Ask
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function StudyToolsPanel({ subject }: { subject: Subject }) {
  const [activeType, setActiveType] = useState<GenerationType>("summary");
  const [topic, setTopic] = useState("");
  const [generated, setGenerated] = useState<GeneratedContent | null>(null);
  const [generatedSets, setGeneratedSets] = useState<GeneratedContentState>({ status: "loading" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, number>>({});
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const [cardStates, setCardStates] = useState<Record<number, string>>({});

  useEffect(() => {
    setGenerated(null);
    loadGeneratedSets();
  }, [subject.id]);

  function loadGeneratedSets() {
    setGeneratedSets({ status: "loading" });
    fetchGeneratedContent(subject.id)
      .then((sets) => setGeneratedSets({ status: "ready", data: sets }))
      .catch((caughtError: unknown) =>
        setGeneratedSets({ status: "error", message: getMessage(caughtError) }),
      );
  }

  function openGeneratedSet(nextGenerated: GeneratedContent) {
    setGenerated(nextGenerated);
    setActiveType(nextGenerated.type);
    setMcqAnswers({});
    setFlippedCards({});
    setCardStates({});
    setError(null);
  }

  async function handleGenerate(type: GenerationType = activeType) {
    setActiveType(type);
    setIsGenerating(true);
    setError(null);
    setMcqAnswers({});
    setFlippedCards({});
    setCardStates({});

    try {
      const result = await generateStudyContent({
        subjectId: subject.id,
        type,
        topic,
        count: type === "summary" ? 6 : 5,
      });
      setGenerated(result);
      setGeneratedSets((current) => {
        const existing = current.status === "ready" ? current.data : [];
        return {
          status: "ready",
          data: [result, ...existing.filter((item) => item.id !== result.id)],
        };
      });
    } catch (caughtError) {
      setError(getMessage(caughtError));
    } finally {
      setIsGenerating(false);
    }
  }

  const tools = [
    { type: "summary" as const, label: "Summary", icon: FileText },
    { type: "mcq" as const, label: "MCQs", icon: ListChecks },
    { type: "flashcard" as const, label: "Flashcards", icon: Layers },
  ];

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Layers aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Study Tools</h2>
            <p className="text-sm text-text-secondary">Generate citation-backed study material.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {tools.map((tool) => (
            <button
              aria-pressed={activeType === tool.type}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                activeType === tool.type
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface text-text-secondary hover:text-text-primary"
              }`}
              key={tool.type}
              onClick={() => handleGenerate(tool.type)}
              type="button"
            >
              <tool.icon aria-hidden="true" className="h-4 w-4" />
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row">
        <input
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-alt px-3 text-sm text-text-primary outline-none transition duration-150 ease-out focus:border-accent"
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Optional topic, e.g. access rules"
          value={topic}
        />
        <button
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isGenerating}
          onClick={() => handleGenerate(activeType)}
          type="button"
        >
          {isGenerating ? (
            <SkeletonDot className="h-4 w-4" tone="light" />
          ) : (
            <Plus aria-hidden="true" className="h-4 w-4" />
          )}
          Generate
        </button>
      </div>

      {error && <p className="mt-3 text-sm font-medium text-error">{error}</p>}

      <div className="mt-5 grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-lg border border-border bg-surface-alt p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-text-primary">Generated</p>
            </div>
            <IconButton ariaLabel="Refresh generated sets" icon={RefreshCw} onClick={loadGeneratedSets} />
          </div>
          <div className="mt-3 space-y-2">
            {generatedSets.status === "loading" && <DocumentListSkeleton />}
            {generatedSets.status === "error" && <ErrorPanel message={generatedSets.message} />}
            {generatedSets.status === "ready" && generatedSets.data.length === 0 && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
                No generated sets yet.
              </p>
            )}
            {generatedSets.status === "ready" &&
              generatedSets.data.map((item) => (
                <button
                  aria-pressed={generated?.id === item.id}
                  className={`w-full rounded-lg border p-3 text-left transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                    generated?.id === item.id
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                  key={item.id}
                  onClick={() => openGeneratedSet(item)}
                  type="button"
                >
                  <p className="text-sm font-medium capitalize text-text-primary">{item.type}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                    {getGeneratedTitle(item)}
                  </p>
                  <p className="mt-2 text-xs text-text-secondary">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </button>
              ))}
          </div>
        </aside>

        <div className="rounded-lg border border-border bg-surface-alt p-4">
          {!generated && !isGenerating && (
            <div className="flex min-h-36 items-center justify-center text-center">
              <div>
                <FileText aria-hidden="true" className="mx-auto h-6 w-6 text-accent" />
                <p className="mt-3 text-sm font-medium text-text-primary">
                  Pick a study tool to generate material.
                </p>
              </div>
            </div>
          )}

          {isGenerating && <DocumentListSkeleton />}

          {generated && !isGenerating && (
            <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-medium uppercase text-text-secondary">Active set</p>
                <p className="mt-1 text-sm font-semibold capitalize text-text-primary">
                  {generated.type} - {new Date(generated.created_at).toLocaleString()}
                </p>
              </div>
              <GeneratedExportActions content={generated} subjectId={subject.id} />
            </div>
          )}

          {generated?.content_json.error && (
            <ErrorPanel message={generated.content_json.error} />
          )}

          {generated?.content_json.type === "summary" && (
            <SummaryViewer content={generated.content_json} />
          )}

          {generated?.content_json.type === "mcq" && (
            <McqViewer
              answers={mcqAnswers}
              content={generated.content_json}
              onAnswer={(questionId, optionIndex) =>
                setMcqAnswers((current) => ({ ...current, [questionId]: optionIndex }))
              }
            />
          )}

          {generated?.content_json.type === "flashcard" && (
            <FlashcardViewer
              cardStates={cardStates}
              content={generated.content_json}
              flippedCards={flippedCards}
              onFlip={(cardId) =>
                setFlippedCards((current) => ({ ...current, [cardId]: !current[cardId] }))
              }
              onState={(cardId, state) =>
                setCardStates((current) => ({ ...current, [cardId]: state }))
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}

function GeneratedExportActions({
  content,
  subjectId,
}: {
  content: GeneratedContent;
  subjectId: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:bg-surface hover:text-text-primary hover:shadow-interactive"
        href={getGeneratedExportUrl(subjectId, content.id, "markdown")}
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        Markdown
      </a>
      <a
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:bg-surface hover:text-text-primary hover:shadow-interactive"
        href={getGeneratedExportUrl(subjectId, content.id, "pdf")}
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        PDF
      </a>
    </div>
  );
}

function getGeneratedTitle(content: GeneratedContent): string {
  if (content.content_json.type === "summary") {
    return content.content_json.title;
  }

  if (content.content_json.type === "mcq") {
    return `${content.content_json.questions.length} questions`;
  }

  return `${content.content_json.cards.length} cards`;
}

function SummaryViewer({ content }: { content: Extract<GeneratedContent["content_json"], { type: "summary" }> }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-text-primary">{content.title}</h3>
      <div className="mt-4 space-y-5">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h4 className="text-sm font-semibold text-text-primary">{section.heading}</h4>
            <ul className="mt-3 space-y-2">
              {section.bullets.map((bullet) => (
                <li className="text-sm leading-6 text-text-secondary" key={bullet}>
                  {bullet}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <CitationList citations={content.citations} />
    </div>
  );
}

function McqViewer({
  answers,
  content,
  onAnswer,
}: {
  answers: Record<number, number>;
  content: Extract<GeneratedContent["content_json"], { type: "mcq" }>;
  onAnswer: (questionId: number, optionIndex: number) => void;
}) {
  return (
    <div className="space-y-4">
      {content.questions.map((question) => {
        const selected = answers[question.id];
        const isAnswered = selected !== undefined;

        return (
          <section className="rounded-lg border border-border bg-surface p-4" key={question.id}>
            <p className="text-sm font-semibold text-text-primary">
              {question.id}. {question.question}
            </p>
            <div className="mt-3 grid gap-2">
              {question.options.map((option, optionIndex) => {
                const isCorrect = optionIndex === question.correct_index;
                const isSelected = selected === optionIndex;
                const stateClass =
                  isAnswered && isCorrect
                    ? "border-accent bg-accent-soft text-accent"
                    : isAnswered && isSelected
                      ? "border-error bg-red-50 text-error dark:bg-red-950/30"
                      : "border-border bg-surface-alt text-text-primary";

                return (
                  <button
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${stateClass}`}
                    key={option}
                    onClick={() => onAnswer(question.id, optionIndex)}
                    type="button"
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {isAnswered && (
              <div className="mt-3 text-sm leading-6 text-text-secondary">
                {question.explanation}
                <CitationList citations={[question.citation]} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function FlashcardViewer({
  cardStates,
  content,
  flippedCards,
  onFlip,
  onState,
}: {
  cardStates: Record<number, string>;
  content: Extract<GeneratedContent["content_json"], { type: "flashcard" }>;
  flippedCards: Record<number, boolean>;
  onFlip: (cardId: number) => void;
  onState: (cardId: number, state: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {content.cards.map((card) => {
        const isFlipped = Boolean(flippedCards[card.id]);
        const reviewState = cardStates[card.id];

        return (
          <section className="rounded-lg border border-border bg-surface p-4" key={card.id}>
            <button
              className="min-h-36 w-full rounded-lg border border-border bg-surface-alt p-4 text-left transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive"
              onClick={() => onFlip(card.id)}
              type="button"
            >
              <p className="text-xs font-medium uppercase text-text-secondary">
                {isFlipped ? "Back" : "Front"}
              </p>
              <p className="mt-3 text-sm leading-6 text-text-primary">
                {isFlipped ? card.back : card.front}
              </p>
            </button>
            {isFlipped && <CitationList citations={[card.citation]} />}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className={`h-9 rounded-lg border text-sm font-medium transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                  reviewState === "review"
                    ? "border-warning bg-surface-alt text-warning"
                    : "border-border text-text-secondary"
                }`}
                onClick={() => onState(card.id, "review")}
                type="button"
              >
                Review it
              </button>
              <button
                className={`h-9 rounded-lg border text-sm font-medium transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                  reviewState === "known"
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-text-secondary"
                }`}
                onClick={() => onState(card.id, "known")}
                type="button"
              >
                Know it
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {citations.map((citation) => (
        <a
          className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 font-mono text-xs text-accent transition duration-150 ease-out hover:-translate-y-px hover:bg-surface hover:shadow-interactive"
          href={getDocumentFileUrl(citation.document_id, citation.page_number)}
          key={`${citation.document_id}-${citation.page_number}-${citation.chunk_text.slice(0, 16)}`}
          rel="noreferrer"
          target="_blank"
          title={citation.chunk_text}
        >
          <Quote aria-hidden="true" className="h-3.5 w-3.5" />
          {citation.filename} - p.{citation.page_number}
        </a>
      ))}
    </div>
  );
}

function DocumentRow({ document }: { document: DocumentRecord }) {
  const Icon = statusIcons[document.upload_status];

  return (
    <div className="rounded-lg border border-border bg-surface-alt p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
            <p className="truncate font-mono text-sm text-text-primary">{document.filename}</p>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            Uploaded {new Date(document.uploaded_at).toLocaleString()}
            {document.page_count ? ` · ${document.page_count} pages` : ""}
          </p>
        </div>
        <span
          className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium ${statusStyles[document.upload_status]}`}
        >
          <Icon
            aria-hidden="true"
            className="h-3.5 w-3.5"
          />
          {formatStatus(document.upload_status)}
        </span>
      </div>
      {document.error_message && (
        <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-error">
          {document.error_message}
        </p>
      )}
    </div>
  );
}

function NewSubjectModal({
  error,
  isSubmitting,
  name,
  onChange,
  onClose,
  onSubmit,
}: {
  error: string | null;
  isSubmitting: boolean;
  name: string;
  onChange: (name: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <motion.form
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-interactive"
        exit={{ opacity: 0, y: 8 }}
        initial={{ opacity: 0, y: 8 }}
        onSubmit={onSubmit}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">New Subject</h2>
            <p className="mt-1 text-sm text-text-secondary">Name the study container.</p>
          </div>
          <IconButton ariaLabel="Close modal" icon={X} onClick={onClose} />
        </div>

        <label className="mt-5 block text-sm font-medium text-text-primary" htmlFor="subject-name">
          Subject name
        </label>
        <input
          autoFocus
          className="mt-2 h-11 w-full rounded-lg border border-border bg-surface-alt px-3 text-sm text-text-primary outline-none transition duration-150 ease-out focus:border-accent"
          id="subject-name"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Knowledge-Based Systems"
          value={name}
        />

        {error && <p className="mt-3 text-sm font-medium text-error">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting && <SkeletonDot className="h-4 w-4" tone="light" />}
            Create
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function IconButton({
  ariaLabel,
  icon: Icon,
  onClick,
}: {
  ariaLabel: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
      onClick={onClick}
      type="button"
      title={ariaLabel}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function SkeletonDot({
  className,
  tone = "surface",
}: {
  className: string;
  tone?: "accent" | "light" | "surface";
}) {
  const toneClass =
    tone === "light" ? "bg-white/50" : tone === "accent" ? "bg-accent/35" : "bg-border";

  return <span aria-hidden="true" className={`animate-pulse rounded ${toneClass} ${className}`} />;
}

function SubjectGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="rounded-lg border border-border bg-surface p-5" key={index}>
          <div className="h-10 w-10 animate-pulse rounded-lg bg-border" />
          <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-border" />
          <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function DocumentListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="rounded-lg border border-border bg-surface-alt p-4" key={index}>
          <div className="h-4 w-3/5 animate-pulse rounded bg-border" />
          <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm font-medium text-error">
      {message}
    </div>
  );
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatStatus(status: DocumentRecord["upload_status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getInitialTheme(): "light" | "dark" {
  try {
    const storedTheme = window.localStorage.getItem("pageturn-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isTerminalStatus(status: DocumentRecord["upload_status"]): boolean {
  return status === "ready" || status === "failed";
}
