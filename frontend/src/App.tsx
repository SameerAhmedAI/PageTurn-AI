import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  FileUp,
  Folder,
  GraduationCap,
  Layers,
  Loader2,
  MessageSquare,
  Moon,
  Plus,
  RefreshCw,
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
  fetchDocuments,
  fetchHealth,
  fetchSubjects,
  uploadDocument,
  type DocumentRecord,
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
  ready: "bg-accent-soft text-accent",
  failed: "bg-red-50 text-error dark:bg-red-950/30",
};

const statusIcons = {
  processing: Clock3,
  extracting: Loader2,
  ready: CheckCircle2,
  failed: AlertTriangle,
};

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [subjects, setSubjects] = useState<SubjectsState>({ status: "loading" });
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
                onBack={() => setSelectedSubjectId(null)}
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
                onRefresh={loadSubjects}
                onSelect={setSelectedSubjectId}
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
  subjects,
}: {
  onCreate: () => void;
  onRefresh: () => void;
  onSelect: (id: number) => void;
  subjects: SubjectsState;
}) {
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
              <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-accent" />
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
    </motion.section>
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
            className={`h-3.5 w-3.5 ${document.upload_status === "extracting" ? "animate-spin" : ""}`}
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
            {isSubmitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
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

function isTerminalStatus(status: DocumentRecord["upload_status"]): boolean {
  return status === "ready" || status === "failed";
}
