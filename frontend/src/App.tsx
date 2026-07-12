import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FileUp,
  Folder,
  Github,
  GraduationCap,
  History,
  Layers,
  ListChecks,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Send,
  Settings,
  Sun,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Logo } from "./components/Logo";
import {
  createSubject,
  deleteAllChats,
  deleteAllGeneratedContent,
  deleteAllSubjects,
  deleteDocument,
  deleteGeneratedContent,
  deleteChatSession,
  deleteSubject,
  fetchAllGeneratedContent,
  fetchChatHistory,
  fetchDashboardStats,
  fetchDocuments,
  fetchGeneratedContent,
  fetchHealth,
  fetchLlmConfig,
  fetchSubjects,
  generateExamPrepPack,
  generateStudyContent,
  getDocumentFileUrl,
  getGeneratedExportUrl,
  predictImportantTopics,
  streamChatAnswer,
  uploadDocument,
  updateSubject,
  type ChatHistorySession,
  type Citation,
  type DashboardStats,
  type DocumentRecord,
  type ExplanationMode,
  type GeneratedContent,
  type GenerationType,
  type HealthResponse,
  type LlmConfig,
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
type LlmConfigState = Loadable<LlmConfig>;
type AppView = "subjects" | "upload" | "chat" | "studySets" | "examPrep" | "settings";
type DeleteConfirmation =
  | { kind: "subject"; subject: Subject }
  | { kind: "document"; document: DocumentRecord }
  | {
      kind: "generated";
      content: GeneratedContent;
      onDeleted?: (content: GeneratedContent) => void;
    };

type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

type StudySetCategoryFilter = GenerationType | "all";

const navItems: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "subjects", label: "Subjects", icon: Folder },
  { id: "studySets", label: "Study Sets", icon: Layers },
  { id: "examPrep", label: "Exam Prep", icon: GraduationCap },
  { id: "settings", label: "Settings", icon: Settings },
];

const studySetCategoryOptions: Array<{ value: StudySetCategoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "summary", label: "Summary" },
  { value: "mcq", label: "MCQs" },
  { value: "flashcard", label: "Flashcards" },
  { value: "short_answer", label: "Short/Long" },
  { value: "topic_prediction", label: "Topics" },
  { value: "exam_prep", label: "Exam Prep" },
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

const sidebarListScrollClass =
  "mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent";
const chatGridClass =
  "mt-5 grid h-[clamp(30rem,calc(100vh-13rem),46rem)] min-h-0 gap-4 lg:grid-cols-[18rem_1fr]";
const chatThreadScrollClass =
  "min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-surface-alt p-4 pr-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent";
const studyToolsGridClass =
  "mt-5 grid h-[clamp(30rem,calc(100vh-12rem),46rem)] min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_1fr] lg:grid-rows-1";
const studyToolsColumnScrollClass =
  "h-full min-h-0 overflow-y-auto [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent";
const generatedListScrollClass =
  "mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent";

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => getInitialTheme());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => getInitialSidebarCollapsed());
  const [activeView, setActiveView] = useState<AppView>("subjects");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [subjects, setSubjects] = useState<SubjectsState>({ status: "loading" });
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsState>({ status: "loading" });
  const [allGeneratedSets, setAllGeneratedSets] = useState<GeneratedContentState>({ status: "loading" });
  const [llmConfig, setLlmConfig] = useState<LlmConfigState>({ status: "loading" });
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<DocumentsState>({ status: "ready", data: [] });
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStudyGenerating, setIsStudyGenerating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingSubjectId, setDeletingSubjectId] = useState<number | null>(null);
  const [documentDeleteError, setDocumentDeleteError] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSubject = useMemo(() => {
    if (subjects.status !== "ready" || selectedSubjectId === null) {
      return null;
    }

    return subjects.data.find((subject) => subject.id === selectedSubjectId) ?? null;
  }, [selectedSubjectId, subjects]);

  useEffect(() => {
    if (activeView === "subjects" && selectedSubject) {
      document.title = `PageTurn \u2014 ${selectedSubject.name}`;
      return;
    }

    document.title = `PageTurn \u2014 ${getViewLabel(activeView)}`;
  }, [activeView, selectedSubject]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("pageturn-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("pageturn-sidebar-collapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

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
    loadAllGeneratedSets();
    loadLlmConfig();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeView === "studySets") {
      loadAllGeneratedSets();
    }
    if (activeView === "settings") {
      loadLlmConfig();
    }
  }, [activeView]);

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

  function loadAllGeneratedSets() {
    setAllGeneratedSets({ status: "loading" });
    fetchAllGeneratedContent()
      .then((data) => setAllGeneratedSets({ status: "ready", data }))
      .catch((error: unknown) =>
        setAllGeneratedSets({ status: "error", message: getMessage(error) }),
      );
  }

  function loadLlmConfig() {
    setLlmConfig({ status: "loading" });
    fetchLlmConfig()
      .then((data) => setLlmConfig({ status: "ready", data }))
      .catch((error: unknown) => setLlmConfig({ status: "error", message: getMessage(error) }));
  }

  function handleNav(view: AppView) {
    setActiveView(view);
    if (view === "subjects") {
      setSelectedSubjectId(null);
    }
  }

  function openSubject(subjectId: number) {
    setSelectedSubjectId(subjectId);
    setActiveView("subjects");
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

  function handleDeleteSubject(subject: Subject) {
    setDeleteConfirmation({ kind: "subject", subject });
  }

  async function handleRenameSubject(subjectId: number, name: string): Promise<void> {
    const updatedSubject = await updateSubject(subjectId, name);
    setSubjects((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        data: current.data.map((subject) =>
          subject.id === updatedSubject.id ? updatedSubject : subject,
        ),
      };
    });
  }

  async function performDeleteSubject(subject: Subject) {
    setDeleteError(null);
    setDeletingSubjectId(subject.id);

    try {
      await deleteSubject(subject.id);
      setSubjects((current) => {
        if (current.status !== "ready") {
          return current;
        }
        return {
          status: "ready",
          data: current.data.filter((item) => item.id !== subject.id),
        };
      });
      if (selectedSubjectId === subject.id) {
        setSelectedSubjectId(null);
        setDocuments({ status: "ready", data: [] });
      }
      loadDashboardStats();
    } catch (error) {
      setDeleteError(getMessage(error));
    } finally {
      setDeletingSubjectId(null);
    }
  }

  function handleDeleteDocument(document: DocumentRecord) {
    setDeleteConfirmation({ kind: "document", document });
  }

  function handleDeleteGeneratedContent(
    content: GeneratedContent,
    onDeleted?: (content: GeneratedContent) => void,
  ) {
    setDeleteConfirmation({ kind: "generated", content, onDeleted });
  }

  async function performDeleteDocument(document: DocumentRecord) {
    setDocumentDeleteError(null);
    setDeletingDocumentId(document.id);

    try {
      await deleteDocument(document.subject_id, document.id);
      setDocuments((current) => {
        if (current.status !== "ready") {
          return current;
        }
        return {
          status: "ready",
          data: current.data.filter((item) => item.id !== document.id),
        };
      });
      void fetchSubjects().then((data) => setSubjects({ status: "ready", data }));
      loadDashboardStats();
    } catch (error) {
      setDocumentDeleteError(getMessage(error));
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function performDeleteGeneratedContent(
    content: GeneratedContent,
    onDeleted?: (content: GeneratedContent) => void,
  ) {
    await deleteGeneratedContent(content.subject_id, content.id);
    setAllGeneratedSets((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        data: current.data.filter((item) => item.id !== content.id),
      };
    });
    onDeleted?.(content);
    loadDashboardStats();
  }

  async function handleDeleteAllSubjects(): Promise<string> {
    const result = await deleteAllSubjects();
    setSelectedSubjectId(null);
    setDocuments({ status: "ready", data: [] });
    setSubjects({ status: "ready", data: [] });
    setAllGeneratedSets({ status: "ready", data: [] });
    loadSubjects();
    loadDashboardStats();
    return result.detail;
  }

  async function handleDeleteAllChats(): Promise<string> {
    const result = await deleteAllChats();
    loadDashboardStats();
    return result.detail;
  }

  async function handleDeleteAllGeneratedContent(): Promise<string> {
    const result = await deleteAllGeneratedContent();
    setAllGeneratedSets({ status: "ready", data: [] });
    loadAllGeneratedSets();
    loadDashboardStats();
    return result.detail;
  }

  async function confirmDelete() {
    const pendingDelete = deleteConfirmation;
    setDeleteConfirmation(null);

    if (!pendingDelete) {
      return;
    }

    if (pendingDelete.kind === "subject") {
      await performDeleteSubject(pendingDelete.subject);
      return;
    }

    if (pendingDelete.kind === "generated") {
      await performDeleteGeneratedContent(pendingDelete.content, pendingDelete.onDeleted);
      return;
    }

    await performDeleteDocument(pendingDelete.document);
  }

  const hasProcessingDocuments =
    documents.status === "ready" &&
    documents.data.some((document) => !isTerminalStatus(document.upload_status));
  const isBackgroundActionActive = isUploading || hasProcessingDocuments || isStudyGenerating;
  const healthCopy = health.status === "ready" ? "API online" : "API check";

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopProgressBar active={isBackgroundActionActive} />
      <div className="flex min-h-screen">
        <aside
          className={`hidden shrink-0 border-r border-border bg-surface py-6 transition-[width,padding] duration-200 ease-out lg:flex lg:flex-col ${
            isSidebarCollapsed ? "w-[68px] px-3" : "w-72 px-4"
          }`}
        >
          <div
            className={`flex ${
              isSidebarCollapsed
                ? "flex-col items-center gap-3"
                : "items-center justify-between gap-3"
            }`}
          >
            <Logo compact={isSidebarCollapsed} />
            <button
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-accent hover:shadow-interactive"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              type="button"
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>
          <nav className={`space-y-1 ${isSidebarCollapsed ? "mt-6" : "mt-8"}`}>
            {navItems.map((item) => (
              <button
                aria-current={activeView === item.id ? "page" : undefined}
                aria-label={isSidebarCollapsed ? item.label : undefined}
                key={item.label}
                className={`group flex h-11 w-full items-center rounded-lg text-sm font-medium transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                  activeView === item.id
                    ? "bg-accent-soft text-accent"
                    : "text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0" : "gap-3 px-3 text-left"}`}
                onClick={() => handleNav(item.id)}
                title={isSidebarCollapsed ? item.label : undefined}
                type="button"
              >
                <item.icon aria-hidden="true" className="h-4 w-4" />
                {!isSidebarCollapsed && <span>{item.label}</span>}
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
                {activeView === "subjects" && selectedSubject ? selectedSubject.name : getViewLabel(activeView)}
              </p>
              <p className="text-xs text-text-secondary">PageTurn AI workspace</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs font-medium text-text-secondary sm:flex">
                <span className={health.status === "ready" ? "text-accent" : "text-warning"}>
                  {healthCopy}
                </span>
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            {activeView === "subjects" && selectedSubject ? (
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
                onDeleteDocument={handleDeleteDocument}
                onRenameSubject={handleRenameSubject}
                onUpload={handleUpload}
                refInput={fileInputRef}
                subject={selectedSubject}
                deleteError={documentDeleteError}
                deletingDocumentId={deletingDocumentId}
                uploadError={uploadError}
              />
            ) : activeView === "subjects" ? (
              <SubjectsDashboard
                key="subjects-dashboard"
                onCreate={() => setIsSubjectModalOpen(true)}
                onRefresh={() => {
                  loadSubjects();
                  loadDashboardStats();
                }}
                deleteError={deleteError}
                deletingSubjectId={deletingSubjectId}
                onDelete={handleDeleteSubject}
                onRename={handleRenameSubject}
                onSelect={openSubject}
                stats={dashboardStats}
                subjects={subjects}
              />
            ) : activeView === "upload" ? (
              <SubjectPickerPage
                actionLabel="Upload documents"
                description="Upload is subject-scoped. Pick a subject first, then use its upload panel."
                emptyMessage="Create a subject before uploading documents."
                icon={Upload}
                key="upload-page"
                onSelect={openSubject}
                onSubjects={() => handleNav("subjects")}
                subjects={subjects}
                title="Select a subject to upload documents"
              />
            ) : activeView === "chat" ? (
              <SubjectPickerPage
                actionLabel="Open chat"
                description="Chat is grounded in one subject's indexed documents. Pick a subject to continue."
                emptyMessage="Create a subject before chatting with notes."
                icon={MessageSquare}
                key="chat-page"
                onSelect={openSubject}
                onSubjects={() => handleNav("subjects")}
                subjects={subjects}
                title="Select a subject to chat"
              />
            ) : activeView === "studySets" ? (
              <StudySetsOverview
                generatedSets={allGeneratedSets}
                key="study-sets-page"
                onDeleteGenerated={handleDeleteGeneratedContent}
                onRefresh={loadAllGeneratedSets}
                onSelectSubject={openSubject}
                onSubjects={() => handleNav("subjects")}
                subjects={subjects}
              />
            ) : activeView === "examPrep" ? (
              selectedSubject ? (
                <ExamPrepPage
                  key={`exam-prep-page-${selectedSubject.id}`}
                  onBack={() => setSelectedSubjectId(null)}
                  onDeleteGenerated={handleDeleteGeneratedContent}
                  onGenerationChange={setIsStudyGenerating}
                  subject={selectedSubject}
                />
              ) : (
                <SubjectPickerPage
                  actionLabel="Exam prep"
                  description="Exam prep starts with predicted important topics for one subject. Pick a subject to choose the focus areas."
                  emptyMessage="Create a subject before preparing an exam pack."
                  icon={GraduationCap}
                  key="exam-prep-picker"
                  onSelect={(subjectId) => {
                    setSelectedSubjectId(subjectId);
                    setActiveView("examPrep");
                  }}
                  onSubjects={() => handleNav("subjects")}
                  subjects={subjects}
                  title="Select a subject for exam prep"
                />
              )
            ) : (
              <SettingsPage
                key="settings-page"
                llmConfig={llmConfig}
                onDeleteAllChats={handleDeleteAllChats}
                onDeleteAllGeneratedContent={handleDeleteAllGeneratedContent}
                onDeleteAllSubjects={handleDeleteAllSubjects}
                onRefresh={loadLlmConfig}
                onToggleTheme={() =>
                  setTheme((current) => (current === "light" ? "dark" : "light"))
                }
                theme={theme}
              />
            )}
          </AnimatePresence>
          <MainFooter />
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

      <AnimatePresence>
        {deleteConfirmation && (
          <ConfirmDialog
            cancelLabel="Cancel"
            confirmLabel="Delete"
            isDangerous
            message={getDeleteConfirmationMessage(deleteConfirmation)}
            onCancel={() => setDeleteConfirmation(null)}
            onConfirm={confirmDelete}
            title={getDeleteConfirmationTitle(deleteConfirmation)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TopProgressBar({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          animate={{ opacity: 1, scaleX: 0.92 }}
          className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-accent"
          exit={{
            opacity: 0,
            scaleX: 1,
            transition: { duration: 0.18, ease: "easeOut" },
          }}
          initial={{ opacity: 1, scaleX: 0 }}
          style={{ boxShadow: "0 0 8px var(--color-accent)" }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}

function MainFooter() {
  return (
    <footer className="shrink-0 border-t border-border bg-surface/80 px-3 py-2">
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4 whitespace-nowrap text-[11px] leading-none sm:text-xs">
        <div aria-hidden="true" />
        <div className="min-w-0 text-center">
          <span className="mr-1 text-text-secondary">
            An open-source, citation-first study assistant.
          </span>
          <span className="font-medium text-text-primary">PageTurn © 2026</span>
        </div>
        <div className="flex justify-end">
          <a
            aria-label="PageTurn AI on GitHub"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-accent-hover"
            href="https://github.com/SameerAhmedAI/PageTurn-AI"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github aria-hidden="true" className="h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

function ConfirmDialog({
  cancelLabel,
  confirmLabel,
  isDangerous,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDangerous: boolean;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      onMouseDown={onCancel}
      role="dialog"
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-interactive"
        exit={{ opacity: 0, y: 8 }}
        initial={{ opacity: 0, y: 8 }}
        onMouseDown={(event) => event.stopPropagation()}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <div className="flex items-start gap-3">
          {isDangerous && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-error dark:bg-red-950/30">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary" id="confirm-dialog-title">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary" id="confirm-dialog-message">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`h-10 rounded-lg px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
              isDangerous ? "bg-error" : "bg-accent hover:bg-accent-hover"
            }`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function getDeleteConfirmationTitle(deleteConfirmation: DeleteConfirmation): string {
  if (deleteConfirmation.kind === "subject") {
    return `Delete ${deleteConfirmation.subject.name}?`;
  }

  if (deleteConfirmation.kind === "document") {
    return `Delete ${deleteConfirmation.document.filename}?`;
  }

  return `Delete this ${getGeneratedDeleteLabel(deleteConfirmation.content)}?`;
}

function getDeleteConfirmationMessage(deleteConfirmation: DeleteConfirmation): string {
  if (deleteConfirmation.kind === "subject") {
    return "This will permanently delete all documents, chat history, and generated content.";
  }

  if (deleteConfirmation.kind === "document") {
    return "This will remove it and its content from chat/search.";
  }

  return "This cannot be undone.";
}

function getGeneratedDeleteLabel(content: GeneratedContent): string {
  const payload = getGeneratedPayload(content);

  if (content.type === "summary") {
    return "Summary";
  }

  if (content.type === "mcq") {
    const questionCount = getArrayLength(payload, "questions");
    return `MCQ set (${questionCount} ${questionCount === 1 ? "question" : "questions"})`;
  }

  if (content.type === "topic_prediction") {
    const topicCount = getArrayLength(payload, "topics");
    return `Predicted topics (${topicCount} ${topicCount === 1 ? "topic" : "topics"})`;
  }

  if (content.type === "short_answer") {
    const questionCount = getArrayLength(payload, "questions");
    return `Short/long question set (${questionCount} ${questionCount === 1 ? "question" : "questions"})`;
  }

  if (content.type === "exam_prep") {
    const topicCount = getArrayLength(payload, "topics_covered");
    return `Exam prep pack (${topicCount} ${topicCount === 1 ? "topic" : "topics"})`;
  }

  const cardCount = getArrayLength(payload, "cards");
  return `Flashcard set (${cardCount} ${cardCount === 1 ? "card" : "cards"})`;
}

function SubjectsDashboard({
  deleteError,
  deletingSubjectId,
  onDelete,
  onCreate,
  onRefresh,
  onRename,
  onSelect,
  stats,
  subjects,
}: {
  deleteError: string | null;
  deletingSubjectId: number | null;
  onDelete: (subject: Subject) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onRename: (subjectId: number, name: string) => Promise<void>;
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
      {deleteError && <ErrorPanel message={deleteError} />}
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
            <SubjectCard
              deletingSubjectId={deletingSubjectId}
              key={subject.id}
              onDelete={onDelete}
              onRename={onRename}
              onSelect={onSelect}
              subject={subject}
            />
          ))}
        </div>
      )}
    </motion.section>
  );
}

function SubjectCard({
  deletingSubjectId,
  onDelete,
  onRename,
  onSelect,
  subject,
}: {
  deletingSubjectId: number | null;
  onDelete: (subject: Subject) => void;
  onRename: (subjectId: number, name: string) => Promise<void>;
  onSelect: (id: number) => void;
  subject: Subject;
}) {
  const [isEditingName, setIsEditingName] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive">
      <div className="flex items-start justify-between gap-4">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelect(subject.id)}
          type="button"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Folder aria-hidden="true" className="h-5 w-5" />
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-lg bg-surface-alt px-2.5 py-1 font-mono text-xs text-text-secondary">
            {subject.document_count} docs
          </span>
          <button
            aria-label={`Rename ${subject.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-accent hover:shadow-interactive"
            onClick={() => setIsEditingName(true)}
            title={`Rename ${subject.name}`}
            type="button"
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            aria-label={`Delete ${subject.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:border-error hover:text-error hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-60"
            disabled={deletingSubjectId === subject.id}
            onClick={() => onDelete(subject)}
            title={`Delete ${subject.name}`}
            type="button"
          >
            {deletingSubjectId === subject.id ? (
              <SkeletonDot className="h-4 w-4" tone="accent" />
            ) : (
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <div className="mt-4">
        <InlineSubjectNameEditor
          className="text-lg font-semibold text-text-primary"
          isEditing={isEditingName}
          onEditingChange={setIsEditingName}
          onRename={onRename}
          subject={subject}
        />
        <button
          className="mt-2 block text-left text-sm text-text-secondary transition duration-150 ease-out hover:text-text-primary"
          onClick={() => onSelect(subject.id)}
          type="button"
        >
          Created {new Date(subject.created_at).toLocaleDateString()}
        </button>
      </div>
    </div>
  );
}

function InlineSubjectNameEditor({
  className,
  isEditing,
  onEditingChange,
  onRename,
  subject,
}: {
  className: string;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
  onRename: (subjectId: number, name: string) => Promise<void>;
  subject: Subject;
}) {
  const [draftName, setDraftName] = useState(subject.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shouldSkipBlurSave = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(subject.name);
    }
  }, [isEditing, subject.name]);

  useEffect(() => {
    if (isEditing) {
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isEditing]);

  async function save() {
    if (isSaving) {
      return;
    }

    const nextName = draftName.trim();
    if (!nextName) {
      setError("Subject name is required.");
      inputRef.current?.focus();
      return;
    }

    if (nextName === subject.name) {
      setError(null);
      onEditingChange(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onRename(subject.id, nextName);
      onEditingChange(false);
    } catch (caughtError) {
      setError(getMessage(caughtError));
      inputRef.current?.focus();
    } finally {
      setIsSaving(false);
    }
  }

  function cancel() {
    shouldSkipBlurSave.current = true;
    setDraftName(subject.name);
    setError(null);
    onEditingChange(false);
  }

  if (!isEditing) {
    return (
      <button
        className={`block max-w-full text-left transition duration-150 ease-out hover:text-accent ${className}`}
        onClick={() => onEditingChange(true)}
        title={`Rename ${subject.name}`}
        type="button"
      >
        {subject.name}
      </button>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        aria-label="Subject name"
        className={`min-h-10 w-full rounded-lg border border-border bg-surface-alt px-3 py-1 text-text-primary outline-none transition duration-150 ease-out focus:border-accent ${className}`}
        disabled={isSaving}
        maxLength={120}
        onBlur={() => {
          if (shouldSkipBlurSave.current) {
            shouldSkipBlurSave.current = false;
            return;
          }
          void save();
        }}
        onChange={(event) => {
          setDraftName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        ref={inputRef}
        value={draftName}
      />
      {error && <p className="mt-1 text-xs font-medium text-error">{error}</p>}
    </div>
  );
}

function SubjectPickerPage({
  actionLabel,
  description,
  emptyMessage,
  icon: Icon,
  onSelect,
  onSubjects,
  subjects,
  title,
}: {
  actionLabel: string;
  description: string;
  emptyMessage: string;
  icon: LucideIcon;
  onSelect: (id: number) => void;
  onSubjects: () => void;
  subjects: SubjectsState;
  title: string;
}) {
  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div>
        <p className="font-mono text-xs font-medium uppercase text-accent">{actionLabel}</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
      </div>

      {subjects.status === "loading" && <SubjectGridSkeleton />}
      {subjects.status === "error" && <ErrorPanel message={subjects.message} />}
      {subjects.status === "ready" && subjects.data.length === 0 && (
        <section className="rounded-lg border border-border bg-surface p-8 text-center">
          <Icon aria-hidden="true" className="mx-auto h-7 w-7 text-accent" />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">{emptyMessage}</h2>
          <button
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive"
            onClick={onSubjects}
            type="button"
          >
            <Folder aria-hidden="true" className="h-4 w-4" />
            Subjects
          </button>
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
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </div>
                <span className="rounded-lg bg-surface-alt px-2.5 py-1 font-mono text-xs text-text-secondary">
                  {subject.document_count} docs
                </span>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-text-primary">{subject.name}</h2>
              <p className="mt-2 text-sm text-text-secondary">{actionLabel}</p>
            </button>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function StudySetsOverview({
  generatedSets,
  onDeleteGenerated,
  onRefresh,
  onSelectSubject,
  onSubjects,
  subjects,
}: {
  generatedSets: GeneratedContentState;
  onDeleteGenerated: (content: GeneratedContent) => void;
  onRefresh: () => void;
  onSelectSubject: (id: number) => void;
  onSubjects: () => void;
  subjects: SubjectsState;
}) {
  const [categoryFilter, setCategoryFilter] = useState<StudySetCategoryFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const subjectNames = new Map(
    subjects.status === "ready" ? subjects.data.map((subject) => [subject.id, subject.name]) : [],
  );
  const subjectOptions = subjects.status === "ready" ? subjects.data : [];
  const selectedSubjectId = subjectFilter === "all" ? null : Number(subjectFilter);
  const selectedSubjectName =
    selectedSubjectId === null ? null : subjectNames.get(selectedSubjectId) ?? `Subject ${selectedSubjectId}`;
  const filteredGeneratedSets =
    generatedSets.status === "ready"
      ? generatedSets.data.filter((item) => {
          const matchesCategory = categoryFilter === "all" || item.type === categoryFilter;
          const matchesSubject = selectedSubjectId === null || item.subject_id === selectedSubjectId;
          return matchesCategory && matchesSubject;
        })
      : [];

  useEffect(() => {
    if (subjectFilter === "all" || subjects.status !== "ready") {
      return;
    }

    const selectedId = Number(subjectFilter);
    if (!subjects.data.some((subject) => subject.id === selectedId)) {
      setSubjectFilter("all");
    }
  }, [subjectFilter, subjects]);

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
          <p className="font-mono text-xs font-medium uppercase text-accent">Study Sets</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">Generated study content</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Previously generated summaries, MCQs, flashcards, short/long questions, predicted topics, and exam prep packs across all subjects.
          </p>
        </div>
        <IconButton ariaLabel="Refresh study sets" icon={RefreshCw} onClick={onRefresh} />
      </div>

      {generatedSets.status === "loading" && <DocumentListSkeleton />}
      {generatedSets.status === "error" && <ErrorPanel message={generatedSets.message} />}
      {generatedSets.status === "ready" && generatedSets.data.length > 0 && (
        <>
          <section className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase text-text-secondary">Category</p>
                <div className="mt-2 grid grid-cols-2 rounded-lg border border-border bg-surface-alt p-1 sm:flex">
                  {studySetCategoryOptions.map((option) => (
                    <button
                      aria-pressed={categoryFilter === option.value}
                      className={`h-9 rounded-md px-3 text-sm font-medium transition duration-150 ease-out ${
                        categoryFilter === option.value
                          ? "bg-surface text-accent shadow-interactive"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                      key={option.value}
                      onClick={() => setCategoryFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-0 lg:w-72">
                <label className="text-xs font-medium uppercase text-text-secondary" htmlFor="study-set-subject-filter">
                  Subject
                </label>
                <div className="relative mt-2">
                  <select
                    className="h-10 w-full appearance-none rounded-lg border border-border bg-surface-alt px-3 pr-9 text-sm font-medium text-text-primary outline-none transition duration-150 ease-out focus:border-accent"
                    id="study-set-subject-filter"
                    onChange={(event) => setSubjectFilter(event.target.value)}
                    value={subjectFilter}
                  >
                    <option value="all">All Subjects</option>
                    {subjectOptions.map((subject) => (
                      <option key={subject.id} value={String(subject.id)}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                  />
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-text-secondary">
              Showing {filteredGeneratedSets.length} of {generatedSets.data.length} study sets
            </p>
          </section>

          {filteredGeneratedSets.length === 0 ? (
            <section className="rounded-lg border border-border bg-surface p-8 text-center">
              <Layers aria-hidden="true" className="mx-auto h-7 w-7 text-accent" />
              <h2 className="mt-4 text-lg font-semibold text-text-primary">
                {getStudySetFilterEmptyTitle(categoryFilter, selectedSubjectName)}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
                Adjust the filters or select a subject to generate more study content.
              </p>
            </section>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredGeneratedSets.map((item) => (
                <GeneratedOverviewCard
                  item={item}
                  key={item.id}
                  onDelete={onDeleteGenerated}
                  onSelectSubject={onSelectSubject}
                  subjectName={subjectNames.get(item.subject_id) ?? `Subject ${item.subject_id}`}
                />
              ))}
            </div>
          )}
        </>
      )}
      {generatedSets.status === "ready" && generatedSets.data.length === 0 && (
        <section className="rounded-lg border border-border bg-surface p-8 text-center">
          <Layers aria-hidden="true" className="mx-auto h-7 w-7 text-accent" />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">No study sets yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
            Select a subject to generate summaries, MCQs, flashcards, short/long questions, predicted topics, or exam prep packs.
          </p>
          <button
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive"
            onClick={onSubjects}
            type="button"
          >
            <Folder aria-hidden="true" className="h-4 w-4" />
            Subjects
          </button>
        </section>
      )}
    </motion.section>
  );
}

function GeneratedOverviewCard({
  item,
  onDelete,
  onSelectSubject,
  subjectName,
}: {
  item: GeneratedContent;
  onDelete: (content: GeneratedContent) => void;
  onSelectSubject: (id: number) => void;
  subjectName: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive">
      <div className="flex items-start justify-between gap-3">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelectSubject(item.subject_id)}
          type="button"
        >
          <p className="text-xs font-medium uppercase text-text-secondary">{subjectName}</p>
          <h2 className="mt-2 text-sm font-semibold text-text-primary">{getGeneratedTypeLabel(item.type)}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{getGeneratedTitle(item)}</p>
          <p className="mt-3 text-xs text-text-secondary">
            {new Date(item.created_at).toLocaleString()}
          </p>
        </button>
        <button
          aria-label={`Delete ${getGeneratedDeleteLabel(item)}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:border-error hover:text-error hover:shadow-interactive"
          onClick={() => onDelete(item)}
          title={`Delete ${getGeneratedDeleteLabel(item)}`}
          type="button"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function getStudySetFilterEmptyTitle(
  categoryFilter: StudySetCategoryFilter,
  subjectName: string | null,
): string {
  const categoryLabel =
    categoryFilter === "summary"
      ? "summaries"
      : categoryFilter === "mcq"
        ? "MCQs"
        : categoryFilter === "flashcard"
          ? "flashcards"
          : categoryFilter === "short_answer"
            ? "short/long questions"
            : categoryFilter === "topic_prediction"
              ? "predicted topics"
              : categoryFilter === "exam_prep"
                ? "exam prep packs"
                : "study sets";

  return subjectName
    ? `No ${categoryLabel} found for ${subjectName}`
    : `No ${categoryLabel} found`;
}

function ExamPrepPage({
  onBack,
  onDeleteGenerated,
  onGenerationChange,
  subject,
}: {
  onBack: () => void;
  onDeleteGenerated: (
    content: GeneratedContent,
    onDeleted?: (content: GeneratedContent) => void,
  ) => void;
  onGenerationChange: (active: boolean) => void;
  subject: Subject;
}) {
  const [topicSet, setTopicSet] = useState<GeneratedContent | null>(null);
  const [generatedSets, setGeneratedSets] = useState<GeneratedContentState>({ status: "loading" });
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [isPredicting, setIsPredicting] = useState(false);
  const [isGeneratingPack, setIsGeneratingPack] = useState(false);
  const [examPrepPack, setExamPrepPack] = useState<GeneratedContent | null>(null);
  const [examPrepAnswers, setExamPrepAnswers] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  const topicContent = isTopicPredictionGeneratedContent(topicSet) ? topicSet.content_json : null;
  const selectedTopics = topicContent
    ? topicContent.topics.filter((topic) => selectedTopicIds.has(topic.id))
    : [];
  const selectedTopicCount = topicContent
    ? selectedTopics.length
    : 0;
  const selectedChunkIds = getSelectedChunkIdsFromTopics(selectedTopics);
  const canGeneratePack = Boolean(topicContent) && selectedTopicCount > 0 && selectedChunkIds.length > 0;

  useEffect(() => {
    loadTopicPredictions();
  }, [subject.id]);

  useEffect(() => {
    onGenerationChange(isPredicting || isGeneratingPack);
    return () => onGenerationChange(false);
  }, [isGeneratingPack, isPredicting, onGenerationChange]);

  function loadTopicPredictions() {
    setGeneratedSets({ status: "loading" });
    setError(null);
    fetchGeneratedContent(subject.id)
      .then((sets) => {
        setGeneratedSets({ status: "ready", data: sets });
        const latestTopicSet = sets.find(isTopicPredictionGeneratedContent) ?? null;
        const latestExamPrepPack = sets.find(isExamPrepGeneratedContent) ?? null;
        setTopicSet(latestTopicSet);
        setExamPrepPack(latestExamPrepPack);
        setExamPrepAnswers({});
        resetSelectedTopics(latestTopicSet);
      })
      .catch((caughtError: unknown) => {
        setGeneratedSets({ status: "error", message: getMessage(caughtError) });
        setTopicSet(null);
        setExamPrepPack(null);
        setExamPrepAnswers({});
        setSelectedTopicIds(new Set());
      });
  }

  function resetSelectedTopics(nextTopicSet: GeneratedContent | null) {
    if (!isTopicPredictionGeneratedContent(nextTopicSet)) {
      setSelectedTopicIds(new Set());
      return;
    }

    setSelectedTopicIds(new Set(nextTopicSet.content_json.topics.map((topic) => topic.id)));
  }

  async function handlePredictTopics() {
    setIsPredicting(true);
    setError(null);

    try {
      const result = await predictImportantTopics(subject.id);
      setTopicSet(result);
      resetSelectedTopics(result);
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
      setIsPredicting(false);
    }
  }

  function toggleTopic(topicId: number) {
    setSelectedTopicIds((current) => {
      const next = new Set(current);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  }

  async function handleGenerateExamPrepPack() {
    if (!canGeneratePack) {
      setError(
        selectedTopicCount > 0
          ? "Regenerate predicted topics first so each topic includes source chunk IDs."
          : "Select at least one topic before generating an exam prep pack.",
      );
      return;
    }

    setIsGeneratingPack(true);
    setError(null);
    setExamPrepAnswers({});

    try {
      console.info("Generating exam prep pack", {
        selected_chunk_ids: selectedChunkIds,
        selected_topics: selectedTopics.map((topic) => topic.name),
      });
      const result = await generateExamPrepPack({
        subjectId: subject.id,
        selectedChunkIds,
        selectedTopics,
      });
      setExamPrepPack(result);
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
      setIsGeneratingPack(false);
    }
  }

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
            Exam Prep
          </button>
          <p className="font-mono text-xs font-medium uppercase text-accent">Exam Prep</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">{subject.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Generate quick study materials or build a focused exam prep pack from predicted topics.
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <p className="font-mono text-xs font-medium uppercase text-accent">Section A</p>
          <h2 className="mt-2 text-2xl font-semibold text-text-primary">Quick Study Tools</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
            Generate individual summaries, MCQs, flashcards, predicted topics, or short/long questions.
          </p>
        </div>
        <StudyToolsPanel
          clearSignal={0}
          onDeleteGenerated={onDeleteGenerated}
          onGenerationChange={onGenerationChange}
          subject={subject}
        />
      </section>

      <div className="border-t border-border pt-6">
        <p className="font-mono text-xs font-medium uppercase text-accent">Section B</p>
        <h2 className="mt-2 text-2xl font-semibold text-text-primary">Exam Prep Pack</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
          Select predicted topics, then generate a combined summary, MCQs, and short/long question pack.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <GraduationCap aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Topic picker</h2>
              <p className="text-sm text-text-secondary">
                {topicContent
                  ? `${selectedTopicCount} of ${topicContent.topics.length} topics selected`
                  : "Predict topics to start building an exam pack."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {topicContent && (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isPredicting}
                onClick={handlePredictTopics}
                type="button"
              >
                {isPredicting ? (
                  <SkeletonDot className="h-4 w-4" tone="accent" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                Regenerate Topics
              </button>
            )}
            {!topicContent && (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isPredicting || generatedSets.status === "loading"}
                onClick={handlePredictTopics}
                type="button"
              >
                {isPredicting ? (
                  <SkeletonDot className="h-4 w-4" tone="light" />
                ) : (
                  <Target aria-hidden="true" className="h-4 w-4" />
                )}
                Predict Topics
              </button>
            )}
          </div>
        </div>

        <div className="mt-5">
          {generatedSets.status === "loading" && <DocumentListSkeleton />}
          {generatedSets.status === "error" && <ErrorPanel message={generatedSets.message} />}
          {error && <ErrorPanel message={error} />}
          {isGeneratingPack && (
            <div className="mb-4 rounded-lg border border-border bg-surface-alt p-4 text-sm leading-6 text-text-secondary">
              <p className="font-semibold text-text-primary">Generating exam prep pack</p>
              <p className="mt-1">
                This includes a summary, MCQs, and short-answer questions, so it may take a few minutes.
              </p>
            </div>
          )}
          {generatedSets.status === "ready" && !topicContent && !isPredicting && (
            <div className="rounded-lg border border-border bg-surface-alt p-8 text-center">
              <Target aria-hidden="true" className="mx-auto h-7 w-7 text-accent" />
              <h3 className="mt-4 text-lg font-semibold text-text-primary">No predicted topics yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
                Generate a topic prediction set for this subject, then choose which topics to focus on.
              </p>
            </div>
          )}
          {isPredicting && <DocumentListSkeleton />}
          {topicContent && (
            <div className="space-y-3">
              {topicContent.topics.map((topic) => {
                const isSelected = selectedTopicIds.has(topic.id);

                return (
                  <label
                    className={`block rounded-lg border p-4 transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                      isSelected
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-surface-alt"
                    }`}
                    key={topic.id}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        checked={isSelected}
                        className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                        onChange={() => toggleTopic(topic.id)}
                        type="checkbox"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
                            <Target aria-hidden="true" className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-text-primary">{topic.name}</h3>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">{topic.reason}</p>
                            <CitationList citations={topic.citations} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-text-secondary">
              {topicContent
                ? `${selectedTopicCount} of ${topicContent.topics.length} topics selected`
                : "No topics selected yet"}
            </p>
            {topicContent && selectedTopicCount > 0 && selectedChunkIds.length === 0 && (
              <p className="mt-1 text-xs font-medium text-warning">
                Regenerate topics once so this picker can attach source chunk IDs.
              </p>
            )}
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-70"
            disabled={!canGeneratePack || isGeneratingPack}
            onClick={handleGenerateExamPrepPack}
            title={
              canGeneratePack
                ? "Generate a combined summary, MCQs, and short/long question pack."
                : "Select topics with source chunk IDs before generating."
            }
            type="button"
          >
            {isGeneratingPack ? (
              <SkeletonDot className="h-4 w-4" tone="light" />
            ) : (
              <GraduationCap aria-hidden="true" className="h-4 w-4" />
            )}
            Generate Exam Prep Pack
          </button>
        </div>
      </section>

      {isExamPrepGeneratedContent(examPrepPack) && (
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-text-secondary">Latest exam prep pack</p>
              <h2 className="mt-1 text-lg font-semibold text-text-primary">{examPrepPack.content_json.title}</h2>
            </div>
            <GeneratedExportActions content={examPrepPack} subjectId={subject.id} />
          </div>
          <ExamPrepViewer
            answers={examPrepAnswers}
            content={examPrepPack.content_json}
            onAnswer={(questionId, optionIndex) =>
              setExamPrepAnswers((current) => ({ ...current, [questionId]: optionIndex }))
            }
          />
        </section>
      )}
    </motion.section>
  );
}

function getSelectedChunkIdsFromTopics(
  topics: Extract<GeneratedContent["content_json"], { type: "topic_prediction" }>["topics"],
): number[] {
  const selected = new Set<number>();

  for (const topic of topics) {
    for (const sourceChunkId of topic.source_chunk_ids ?? []) {
      const match = /^chunk_(\d+)$/.exec(sourceChunkId);
      if (match) {
        selected.add(Number(match[1]));
      }
    }

    for (const citation of topic.citations) {
      if (typeof citation.chunk_id === "number") {
        selected.add(citation.chunk_id);
      }
    }
  }

  return [...selected].sort((left, right) => left - right);
}

function SettingsPage({
  llmConfig,
  onDeleteAllChats,
  onDeleteAllGeneratedContent,
  onDeleteAllSubjects,
  onRefresh,
  onToggleTheme,
  theme,
}: {
  llmConfig: LlmConfigState;
  onDeleteAllChats: () => Promise<string>;
  onDeleteAllGeneratedContent: () => Promise<string>;
  onDeleteAllSubjects: () => Promise<string>;
  onRefresh: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
}) {
  type DataStorageAction = "subjects" | "chats" | "generated";

  const [pendingAction, setPendingAction] = useState<DataStorageAction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const actions: Record<
    DataStorageAction,
    {
      label: string;
      description: string;
      confirmTitle: string;
      confirmMessage: string;
      handler: () => Promise<string>;
    }
  > = {
    subjects: {
      label: "Delete all subjects",
      description: "Permanently delete every subject, document, chat, and generated study set.",
      confirmTitle: "Delete all subjects?",
      confirmMessage:
        "Delete ALL subjects? This will permanently erase everything in your workspace and cannot be undone.",
      handler: onDeleteAllSubjects,
    },
    chats: {
      label: "Delete all chats",
      description:
        "Permanently delete all chat sessions and messages across every subject, keeping subjects, documents, and generated study sets intact.",
      confirmTitle: "Delete all chats?",
      confirmMessage: "Delete ALL chat history across every subject? This cannot be undone.",
      handler: onDeleteAllChats,
    },
    generated: {
      label: "Delete all study sets",
      description:
        "Permanently delete all generated summaries, MCQs, flashcards, and exam prep packs across every subject, keeping subjects, documents, and chat history intact.",
      confirmTitle: "Delete all study sets?",
      confirmMessage: "Delete ALL generated study sets across every subject? This cannot be undone.",
      handler: onDeleteAllGeneratedContent,
    },
  };
  const pendingActionDetails = pendingAction ? actions[pendingAction] : null;

  async function confirmDataStorageAction() {
    if (!pendingActionDetails) {
      return;
    }

    setIsDeleting(true);
    setStatusMessage(null);
    try {
      const message = await pendingActionDetails.handler();
      setStatusMessage({ type: "success", message });
      setPendingAction(null);
    } catch (error) {
      setStatusMessage({ type: "error", message: getMessage(error) });
    } finally {
      setIsDeleting(false);
    }
  }

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
          <p className="font-mono text-xs font-medium uppercase text-accent">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">Workspace settings</h1>
        </div>
        <IconButton ariaLabel="Refresh LLM settings" icon={RefreshCw} onClick={onRefresh} />
      </div>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Appearance</h2>
            <p className="mt-1 text-sm text-text-secondary">Theme preference for this browser.</p>
          </div>
          <button
            aria-pressed={theme === "dark"}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
            onClick={onToggleTheme}
            type="button"
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Moon aria-hidden="true" className="h-4 w-4" />
            )}
            {theme === "dark" ? "Use light mode" : "Use dark mode"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Data & Storage</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Destructive workspace cleanup actions. These changes cannot be undone.
          </p>
        </div>

        {statusMessage && (
          <div
            className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${
              statusMessage.type === "success"
                ? "border-accent-soft bg-accent-soft text-accent"
                : "border-red-100 bg-red-50 text-error dark:border-red-950/40 dark:bg-red-950/30"
            }`}
          >
            {statusMessage.message}
          </div>
        )}

        <div className="mt-5 divide-y divide-border rounded-lg border border-border">
          <DataStorageActionRow
            description={actions.subjects.description}
            disabled={isDeleting}
            label={actions.subjects.label}
            onDelete={() => setPendingAction("subjects")}
          />
          <DataStorageActionRow
            description={actions.chats.description}
            disabled={isDeleting}
            label={actions.chats.label}
            onDelete={() => setPendingAction("chats")}
          />
          <DataStorageActionRow
            description={actions.generated.description}
            disabled={isDeleting}
            label={actions.generated.label}
            onDelete={() => setPendingAction("generated")}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text-primary">LLM provider</h2>
        <p className="mt-1 text-sm text-text-secondary">Read-only configuration loaded by the backend.</p>
        <div className="mt-5">
          {llmConfig.status === "loading" && <DocumentListSkeleton />}
          {llmConfig.status === "error" && <ErrorPanel message={llmConfig.message} />}
          {llmConfig.status === "ready" && (
            <dl className="grid gap-3 md:grid-cols-2">
              <SettingValue label="Ollama host" value={llmConfig.data.ollama_host} />
              <SettingValue label="Ollama model" value={llmConfig.data.ollama_model} />
              <SettingValue
                label="Groq fallback"
                value={llmConfig.data.groq_configured ? "Configured" : "Not configured"}
              />
              <SettingValue label="Groq model" value={llmConfig.data.groq_model} />
            </dl>
          )}
        </div>
      </section>

      <AnimatePresence>
        {pendingActionDetails && (
          <ConfirmDialog
            cancelLabel="Cancel"
            confirmLabel={isDeleting ? "Deleting..." : "Delete"}
            isDangerous
            message={pendingActionDetails.confirmMessage}
            onCancel={() => {
              if (!isDeleting) {
                setPendingAction(null);
              }
            }}
            onConfirm={confirmDataStorageAction}
            title={pendingActionDetails.confirmTitle}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function DataStorageActionRow({
  description,
  disabled,
  label,
  onDelete,
}: {
  label: string;
  description: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 bg-surface px-4 py-4 first:rounded-t-lg last:rounded-b-lg md:flex-row md:items-center md:justify-between">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
      </div>
      <button
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-error px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        disabled={disabled}
        onClick={onDelete}
        type="button"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        Delete
      </button>
    </div>
  );
}

function SettingValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-4">
      <dt className="text-xs font-medium uppercase text-text-secondary">{label}</dt>
      <dd className="mt-2 break-words font-mono text-sm text-text-primary">{value}</dd>
    </div>
  );
}

function SubjectDetail({
  deleteError,
  deletingDocumentId,
  documents,
  isUploading,
  onBack,
  onDeleteDocument,
  onRenameSubject,
  onRefresh,
  onUpload,
  refInput,
  subject,
  uploadError,
}: {
  deleteError: string | null;
  deletingDocumentId: number | null;
  documents: DocumentsState;
  isUploading: boolean;
  onBack: () => void;
  onDeleteDocument: (document: DocumentRecord) => void;
  onRenameSubject: (subjectId: number, name: string) => Promise<void>;
  onRefresh: () => void;
  onUpload: (file: File | undefined) => void;
  refInput: RefObject<HTMLInputElement>;
  subject: Subject;
  uploadError: string | null;
}) {
  const documentCount = documents.status === "ready" ? documents.data.length : subject.document_count;
  const [isEditingName, setIsEditingName] = useState(false);

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
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
            <InlineSubjectNameEditor
              className="text-3xl font-semibold text-text-primary"
              isEditing={isEditingName}
              onEditingChange={setIsEditingName}
              onRename={onRenameSubject}
              subject={subject}
            />
            {!isEditingName && (
              <button
                aria-label={`Rename ${subject.name}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-accent hover:shadow-interactive"
                onClick={() => setIsEditingName(true)}
                title={`Rename ${subject.name}`}
                type="button"
              >
                <Pencil aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>
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
            {deleteError && <ErrorPanel message={deleteError} />}
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
                  <DocumentRow
                    document={document}
                    isDeleting={deletingDocumentId === document.id}
                    key={document.id}
                    onDelete={onDeleteDocument}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <ChatPanel subject={subject} />
    </motion.section>
  );
}

function ChatPanel({ clearSignal = 0, subject }: { clearSignal?: number; subject: Subject }) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<ExplanationMode>("university");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [history, setHistory] = useState<ChatHistoryState>({ status: "loading" });
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<ChatHistorySession | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const lastClearSignalRef = useRef(clearSignal);

  useEffect(() => {
    setTurns([]);
    setActiveSessionId(null);
    setPendingDeleteSession(null);
    setDeletingSessionId(null);
    loadHistory();
  }, [subject.id]);

  useEffect(() => {
    if (lastClearSignalRef.current === clearSignal) {
      return;
    }

    lastClearSignalRef.current = clearSignal;
    setTurns([]);
    setActiveSessionId(null);
    setPendingDeleteSession(null);
    setDeletingSessionId(null);
    setError(null);
    loadHistory();
  }, [clearSignal]);

  useEffect(() => {
    const messageThread = messageThreadRef.current;
    if (!messageThread) {
      return;
    }

    messageThread.scrollTop = messageThread.scrollHeight;
  }, [turns, isAnswering]);

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

  async function confirmDeleteSession() {
    if (!pendingDeleteSession) {
      return;
    }

    const sessionToDelete = pendingDeleteSession;
    setPendingDeleteSession(null);
    setDeletingSessionId(sessionToDelete.id);
    setError(null);

    try {
      await deleteChatSession(subject.id, sessionToDelete.id);
      setHistory((current) => {
        if (current.status !== "ready") {
          return current;
        }

        return {
          status: "ready",
          data: current.data.filter((session) => session.id !== sessionToDelete.id),
        };
      });

      if (activeSessionId === sessionToDelete.id) {
        startNewSession();
      }
    } catch (caughtError) {
      setError(getMessage(caughtError));
    } finally {
      setDeletingSessionId(null);
    }
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
    <>
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

      <div className={chatGridClass}>
        <aside className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-surface-alt p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-text-primary">History</p>
            </div>
            <IconButton ariaLabel="Refresh chat history" icon={RefreshCw} onClick={loadHistory} />
          </div>
          <div className={sidebarListScrollClass}>
            {history.status === "loading" && <DocumentListSkeleton />}
            {history.status === "error" && <ErrorPanel message={history.message} />}
            {history.status === "ready" && history.data.length === 0 && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
                No saved chats yet.
              </p>
            )}
            {history.status === "ready" &&
              history.data.map((session) => (
                <div
                  className={`group flex items-start gap-2 rounded-lg border p-2 transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                    activeSessionId === session.id
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                  key={session.id}
                >
                  <button
                    aria-label={`Open chat session ${session.title}`}
                    aria-pressed={activeSessionId === session.id}
                    className="min-w-0 flex-1 rounded-md p-1 text-left"
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
                  <button
                    aria-label={`Delete chat session ${session.title}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:border-error hover:text-error hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={deletingSessionId === session.id}
                    onClick={() => setPendingDeleteSession(session)}
                    title="Delete chat session"
                    type="button"
                  >
                    {deletingSessionId === session.id ? (
                      <SkeletonDot className="h-3.5 w-3.5" tone="surface" />
                    ) : (
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
          </div>
        </aside>

        <div className="flex h-full min-h-0 flex-col">
          <div className={chatThreadScrollClass} ref={messageThreadRef}>
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
      <AnimatePresence>
        {pendingDeleteSession && (
          <ConfirmDialog
            cancelLabel="Cancel"
            confirmLabel="Delete"
            isDangerous
            message="Delete this chat session? This cannot be undone."
            onCancel={() => setPendingDeleteSession(null)}
            onConfirm={confirmDeleteSession}
            title="Delete chat session?"
          />
        )}
      </AnimatePresence>
    </>
  );
}

function StudyToolsPanel({
  clearSignal,
  onDeleteGenerated,
  onGenerationChange,
  subject,
}: {
  clearSignal: number;
  onDeleteGenerated: (
    content: GeneratedContent,
    onDeleted?: (content: GeneratedContent) => void,
  ) => void;
  onGenerationChange: (active: boolean) => void;
  subject: Subject;
}) {
  const [activeType, setActiveType] = useState<GenerationType>("summary");
  const [topic, setTopic] = useState("");
  const [generated, setGenerated] = useState<GeneratedContent | null>(null);
  const [generatedSets, setGeneratedSets] = useState<GeneratedContentState>({ status: "loading" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, number>>({});
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const [cardStates, setCardStates] = useState<Record<number, string>>({});
  const lastClearSignalRef = useRef(clearSignal);

  useEffect(() => {
    setGenerated(null);
    loadGeneratedSets();
  }, [subject.id]);

  useEffect(() => {
    if (lastClearSignalRef.current === clearSignal) {
      return;
    }

    lastClearSignalRef.current = clearSignal;
    setGenerated(null);
    setGeneratedSets({ status: "ready", data: [] });
    setMcqAnswers({});
    setFlippedCards({});
    setCardStates({});
    setError(null);
    loadGeneratedSets();
  }, [clearSignal]);

  useEffect(() => {
    onGenerationChange(isGenerating);
    return () => onGenerationChange(false);
  }, [isGenerating, onGenerationChange]);

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

  function handleGeneratedDeleted(deletedContent: GeneratedContent) {
    setGeneratedSets((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        data: current.data.filter((item) => item.id !== deletedContent.id),
      };
    });

    if (generated?.id === deletedContent.id) {
      setGenerated(null);
      setMcqAnswers({});
      setFlippedCards({});
      setCardStates({});
    }
  }

  function requestGeneratedDelete(content: GeneratedContent) {
    onDeleteGenerated(content, handleGeneratedDeleted);
  }

  async function handleGenerate(type: GenerationType = activeType) {
    setActiveType(type);
    setIsGenerating(true);
    setError(null);
    setMcqAnswers({});
    setFlippedCards({});
    setCardStates({});

    try {
      const result =
        type === "topic_prediction"
          ? await predictImportantTopics(subject.id)
          : await generateStudyContent({
              subjectId: subject.id,
              type,
              topic,
              count: type === "summary" || type === "short_answer" ? 6 : 5,
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
    { type: "short_answer" as const, label: "Short/Long Questions", icon: GraduationCap },
    { type: "topic_prediction" as const, label: "Predicted Topics", icon: Target },
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

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-alt px-3 text-sm text-text-primary outline-none transition duration-150 ease-out focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
          disabled={activeType === "topic_prediction"}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={
            activeType === "topic_prediction"
              ? "Predicted topics use the entire subject"
              : "Optional topic, e.g. access rules"
          }
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

      <div className={studyToolsGridClass}>
        <aside className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-surface-alt p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-text-primary">Generated</p>
            </div>
            <IconButton ariaLabel="Refresh generated sets" icon={RefreshCw} onClick={loadGeneratedSets} />
          </div>
          <div className={generatedListScrollClass}>
            {generatedSets.status === "loading" && <DocumentListSkeleton />}
            {generatedSets.status === "error" && <ErrorPanel message={generatedSets.message} />}
            {generatedSets.status === "ready" && generatedSets.data.length === 0 && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
                No generated sets yet.
              </p>
            )}
            {generatedSets.status === "ready" &&
              generatedSets.data.map((item) => (
                <div
                  className={`rounded-lg border p-3 transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive ${
                    generated?.id === item.id
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      aria-pressed={generated?.id === item.id}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openGeneratedSet(item)}
                      type="button"
                    >
                      <p className="text-sm font-medium text-text-primary">{getGeneratedTypeLabel(item.type)}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                        {getGeneratedTitle(item)}
                      </p>
                      <p className="mt-2 text-xs text-text-secondary">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </button>
                    <button
                      aria-label={`Delete ${getGeneratedDeleteLabel(item)}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:border-error hover:text-error hover:shadow-interactive"
                      onClick={() => requestGeneratedDelete(item)}
                      title={`Delete ${getGeneratedDeleteLabel(item)}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </aside>

        <div className={`rounded-lg border border-border bg-surface-alt p-4 pr-2 ${studyToolsColumnScrollClass}`}>
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
                <p className="mt-1 text-sm font-semibold text-text-primary">
                  {getGeneratedTypeLabel(generated.type)} - {new Date(generated.created_at).toLocaleString()}
                </p>
              </div>
              <GeneratedExportActions content={generated} subjectId={subject.id} />
            </div>
          )}

          {generated && getGeneratedError(generated) && (
            <ErrorPanel message={getGeneratedError(generated) ?? "This generated set could not be displayed."} />
          )}

          {isSummaryGeneratedContent(generated) && (
            <SummaryViewer content={generated.content_json} />
          )}

          {isMcqGeneratedContent(generated) && (
            <McqViewer
              answers={mcqAnswers}
              content={generated.content_json}
              onAnswer={(questionId, optionIndex) =>
                setMcqAnswers((current) => ({ ...current, [questionId]: optionIndex }))
              }
            />
          )}

          {isFlashcardGeneratedContent(generated) && (
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

          {isShortAnswerGeneratedContent(generated) && (
            <ShortAnswerViewer content={generated.content_json} />
          )}

          {isTopicPredictionGeneratedContent(generated) && (
            <TopicPredictionViewer content={generated.content_json} />
          )}

          {isExamPrepGeneratedContent(generated) && (
            <ExamPrepViewer
              answers={mcqAnswers}
              content={generated.content_json}
              onAnswer={(questionId, optionIndex) =>
                setMcqAnswers((current) => ({ ...current, [questionId]: optionIndex }))
              }
            />
          )}

          {generated &&
            !getGeneratedError(generated) &&
            !isRenderableGeneratedContent(generated) && (
              <ErrorPanel message="This saved study set uses an older or incomplete format and cannot be displayed." />
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
  const payload = getGeneratedPayload(content);
  const error = getStringField(payload, "error");

  if (error) {
    return error;
  }

  const payloadType = getStringField(payload, "type") ?? content.type;

  if (payloadType === "summary") {
    const title = getStringField(payload, "title");
    const sectionCount = getArrayLength(payload, "sections");

    if (title) {
      return title;
    }

    return sectionCount === 1 ? "1 summary section" : `${sectionCount} summary sections`;
  }

  if (payloadType === "mcq") {
    const questionCount = getArrayLength(payload, "questions");
    return questionCount === 1 ? "1 question" : `${questionCount} questions`;
  }

  if (payloadType === "flashcard") {
    const cardCount = getArrayLength(payload, "cards");
    return cardCount === 1 ? "1 card" : `${cardCount} cards`;
  }

  if (payloadType === "short_answer") {
    const questionCount = getArrayLength(payload, "questions");
    return questionCount === 1 ? "1 short/long question" : `${questionCount} short/long questions`;
  }

  if (payloadType === "topic_prediction") {
    const topicCount = getArrayLength(payload, "topics");
    return topicCount === 1 ? "1 predicted topic" : `${topicCount} predicted topics`;
  }

  if (payloadType === "exam_prep") {
    const topicCount = getArrayLength(payload, "topics_covered");
    return topicCount === 1 ? "Exam prep pack for 1 topic" : `Exam prep pack for ${topicCount} topics`;
  }

  return "Saved study set";
}

function getGeneratedTypeLabel(type: GenerationType): string {
  if (type === "mcq") {
    return "MCQs";
  }

  if (type === "topic_prediction") {
    return "Predicted Topics";
  }

  if (type === "short_answer") {
    return "Short/Long Questions";
  }

  if (type === "exam_prep") {
    return "Exam Prep Pack";
  }

  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getGeneratedPayload(content: GeneratedContent | null): Record<string, unknown> {
  if (!content?.content_json || typeof content.content_json !== "object") {
    return {};
  }

  return content.content_json as Record<string, unknown>;
}

function getStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getArrayLength(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return Array.isArray(value) ? value.length : 0;
}

function getGeneratedError(content: GeneratedContent | null): string | null {
  return getStringField(getGeneratedPayload(content), "error");
}

function isSummaryGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "summary" }>;
} {
  const payload = getGeneratedPayload(content);
  return getStringField(payload, "type") === "summary" && Array.isArray(payload.sections);
}

function isMcqGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "mcq" }>;
} {
  const payload = getGeneratedPayload(content);
  return getStringField(payload, "type") === "mcq" && Array.isArray(payload.questions);
}

function isFlashcardGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "flashcard" }>;
} {
  const payload = getGeneratedPayload(content);
  return getStringField(payload, "type") === "flashcard" && Array.isArray(payload.cards);
}

function isShortAnswerGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "short_answer" }>;
} {
  const payload = getGeneratedPayload(content);
  return getStringField(payload, "type") === "short_answer" && Array.isArray(payload.questions);
}

function isTopicPredictionGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "topic_prediction" }>;
} {
  const payload = getGeneratedPayload(content);
  return getStringField(payload, "type") === "topic_prediction" && Array.isArray(payload.topics);
}

function isExamPrepGeneratedContent(
  content: GeneratedContent | null,
): content is GeneratedContent & {
  content_json: Extract<GeneratedContent["content_json"], { type: "exam_prep" }>;
} {
  const payload = getGeneratedPayload(content);
  return (
    getStringField(payload, "type") === "exam_prep" &&
    Array.isArray(payload.topics_covered) &&
    payload.summary !== null &&
    typeof payload.summary === "object" &&
    payload.mcqs !== null &&
    typeof payload.mcqs === "object" &&
    payload.short_answer_questions !== null &&
    typeof payload.short_answer_questions === "object"
  );
}

function isRenderableGeneratedContent(content: GeneratedContent | null): boolean {
  return (
    isSummaryGeneratedContent(content) ||
    isMcqGeneratedContent(content) ||
    isFlashcardGeneratedContent(content) ||
    isShortAnswerGeneratedContent(content) ||
    isTopicPredictionGeneratedContent(content) ||
    isExamPrepGeneratedContent(content)
  );
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const questionCount = content.questions.length;
  const activeIndex = Math.min(currentIndex, Math.max(questionCount - 1, 0));
  const question = content.questions[activeIndex];
  const answeredCount = content.questions.filter((item) => answers[item.id] !== undefined).length;

  useEffect(() => {
    setCurrentIndex(0);
  }, [content]);

  useEffect(() => {
    if (currentIndex >= questionCount && questionCount > 0) {
      setCurrentIndex(questionCount - 1);
    }
  }, [currentIndex, questionCount]);

  if (!question) {
    return <ErrorPanel message="This MCQ set does not contain any questions." />;
  }

  const selected = answers[question.id];
  const isAnswered = selected !== undefined;
  const selectedCorrectly = selected === question.correct_index;
  const isFirstQuestion = activeIndex === 0;
  const isLastQuestion = activeIndex === questionCount - 1;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-text-secondary">
            Question {activeIndex + 1} of {questionCount}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {answeredCount} of {questionCount} answered
          </p>
        </div>
        <div className="flex gap-1.5" aria-label="MCQ progress">
          {content.questions.map((item, index) => {
            const isCurrent = index === activeIndex;
            const isComplete = answers[item.id] !== undefined;
            const progressClass = isCurrent
              ? "bg-accent"
              : isComplete
                ? "bg-accent/55"
                : "bg-border";

            return (
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={`h-2 w-8 rounded-full transition-colors ${progressClass}`}
                key={item.id}
                title={`Question ${index + 1}${isComplete ? " answered" : ""}`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-base font-semibold leading-7 text-text-primary">{question.question}</p>
        <div className="mt-4 grid gap-2">
          {question.options.map((option, optionIndex) => {
            const isCorrect = optionIndex === question.correct_index;
            const isSelected = selected === optionIndex;
            const stateClass =
              isAnswered && isCorrect
                ? "border-accent bg-accent-soft text-accent"
                : isAnswered && isSelected
                  ? "border-error bg-red-50 text-error dark:bg-red-950/30"
                  : "border-border bg-surface-alt text-text-primary hover:-translate-y-px hover:shadow-interactive";

            return (
              <button
                aria-pressed={isSelected}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition duration-150 ease-out disabled:cursor-default ${stateClass}`}
                disabled={isAnswered}
                key={option}
                onClick={() => onAnswer(question.id, optionIndex)}
                type="button"
              >
                <span>{option}</span>
                {isAnswered && isCorrect && <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />}
                {isAnswered && isSelected && !isCorrect && <X aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {isAnswered && (
        <div
          className={`mt-4 rounded-lg border p-4 ${
            selectedCorrectly
              ? "border-accent bg-accent-soft"
              : "border-error bg-red-50 dark:bg-red-950/30"
          }`}
        >
          <p className={`text-sm font-semibold ${selectedCorrectly ? "text-accent" : "text-error"}`}>
            {selectedCorrectly ? "Correct answer" : "Correct answer revealed"}
          </p>
          <p className="mt-2 text-sm leading-6 text-text-primary">
            {question.options[question.correct_index]}
          </p>
          {question.explanation && (
            <p className="mt-3 text-sm leading-6 text-text-secondary">{question.explanation}</p>
          )}
          <CitationList citations={[question.citation]} />
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isFirstQuestion}
          onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </button>
        <p className="text-center text-xs text-text-secondary">
          {isAnswered ? "Review the citation, then continue." : "Choose an answer to continue."}
        </p>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-px hover:bg-accent-hover hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!isAnswered || isLastQuestion}
          onClick={() => setCurrentIndex((index) => Math.min(index + 1, questionCount - 1))}
          type="button"
        >
          Next
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </section>
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
              aria-label={isFlipped ? "Show flashcard front" : "Show flashcard back"}
              className="w-full text-left [perspective:1000px]"
              onClick={() => onFlip(card.id)}
              type="button"
            >
              <motion.div
                animate={{ rotateY: isFlipped ? 180 : 0 }}
                className="grid rounded-lg transition duration-150 ease-out hover:-translate-y-px hover:shadow-interactive"
                style={{ transformStyle: "preserve-3d" }}
                transition={{ duration: 0.18, ease: "easeInOut", type: "tween" }}
              >
                <div
                  className="min-h-36 rounded-lg border border-border bg-surface-alt p-4"
                  style={{
                    backfaceVisibility: "hidden",
                    gridArea: "1 / 1",
                    WebkitBackfaceVisibility: "hidden",
                  }}
                >
                  <p className="text-xs font-medium uppercase text-text-secondary">Front</p>
                  <p className="mt-3 text-sm leading-6 text-text-primary">{card.front}</p>
                </div>
                <div
                  className="min-h-36 rounded-lg border border-border bg-surface-alt p-4"
                  style={{
                    backfaceVisibility: "hidden",
                    gridArea: "1 / 1",
                    transform: "rotateY(180deg)",
                    WebkitBackfaceVisibility: "hidden",
                  }}
                >
                  <p className="text-xs font-medium uppercase text-text-secondary">Back</p>
                  <p className="mt-3 text-sm leading-6 text-text-primary">{card.back}</p>
                </div>
              </motion.div>
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

function ShortAnswerViewer({
  content,
}: {
  content: Extract<GeneratedContent["content_json"], { type: "short_answer" }>;
}) {
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setRevealedQuestionIds(new Set());
  }, [content]);

  if (content.questions.length === 0) {
    return <ErrorPanel message="This short/long question set does not contain any questions." />;
  }

  function toggleAnswer(questionId: number) {
    setRevealedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {content.questions.map((question) => {
        const isRevealed = revealedQuestionIds.has(question.id);
        const isLong = question.difficulty === "long";

        return (
          <section className="rounded-lg border border-border bg-surface p-4" key={question.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <span
                  className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    isLong
                      ? "bg-warning/15 text-warning"
                      : "bg-accent-soft text-accent"
                  }`}
                >
                  {isLong ? "Long" : "Short"}
                </span>
                <p className="mt-3 text-base font-semibold leading-7 text-text-primary">
                  {question.question}
                </p>
              </div>
              <button
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:text-text-primary hover:shadow-interactive"
                onClick={() => toggleAnswer(question.id)}
                type="button"
              >
                {isRevealed ? "Hide Answer" : "Reveal Answer"}
              </button>
            </div>

            {isRevealed && (
              <div className="mt-4 rounded-lg border border-border bg-surface-alt p-4">
                <p className="text-xs font-medium uppercase text-text-secondary">Answer guide</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">
                  {question.answer_guide}
                </p>
                <CitationList citations={[question.citation]} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TopicPredictionViewer({
  content,
}: {
  content: Extract<GeneratedContent["content_json"], { type: "topic_prediction" }>;
}) {
  if (content.topics.length === 0) {
    return <ErrorPanel message="This topic prediction set does not contain any topics." />;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-text-primary">{content.title}</h3>
      <div className="mt-4 space-y-3">
        {content.topics.map((topic) => (
          <section className="rounded-lg border border-border bg-surface p-4" key={topic.id}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Target aria-hidden="true" className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-text-primary">{topic.name}</h4>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{topic.reason}</p>
                <CitationList citations={topic.citations} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ExamPrepViewer({
  answers,
  content,
  onAnswer,
}: {
  answers: Record<number, number>;
  content: Extract<GeneratedContent["content_json"], { type: "exam_prep" }>;
  onAnswer: (questionId: number, optionIndex: number) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface-alt p-4">
        <div className="flex items-center gap-2">
          <Target aria-hidden="true" className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Topics Covered</h3>
        </div>
        {content.topics_covered.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">
            No matching saved topic metadata was found for this pack.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {content.topics_covered.map((topic) => (
              <section className="rounded-lg border border-border bg-surface p-3" key={topic.id}>
                <h4 className="text-sm font-semibold text-text-primary">{topic.name}</h4>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{topic.reason}</p>
                <CitationList citations={topic.citations} />
              </section>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <FileText aria-hidden="true" className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Summary</h3>
        </div>
        <SummaryViewer content={content.summary} />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <ListChecks aria-hidden="true" className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">MCQs</h3>
        </div>
        <McqViewer answers={answers} content={content.mcqs} onAnswer={onAnswer} />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <GraduationCap aria-hidden="true" className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Short/Long Questions</h3>
        </div>
        <ShortAnswerViewer content={content.short_answer_questions} />
      </section>
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

function DocumentRow({
  document,
  isDeleting,
  onDelete,
}: {
  document: DocumentRecord;
  isDeleting: boolean;
  onDelete: (document: DocumentRecord) => void;
}) {
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
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium ${statusStyles[document.upload_status]}`}
          >
            <Icon
              aria-hidden="true"
              className="h-3.5 w-3.5"
            />
            {formatStatus(document.upload_status)}
          </span>
          <button
            aria-label={`Delete ${document.filename}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition duration-150 ease-out hover:-translate-y-px hover:border-error hover:text-error hover:shadow-interactive disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting}
            onClick={() => onDelete(document)}
            title={`Delete ${document.filename}`}
            type="button"
          >
            {isDeleting ? (
              <SkeletonDot className="h-3.5 w-3.5" tone="accent" />
            ) : (
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
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

function getViewLabel(view: AppView): string {
  const item = navItems.find((navItem) => navItem.id === view);
  return item?.label ?? "Subjects";
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

function getInitialSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem("pageturn-sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

function isTerminalStatus(status: DocumentRecord["upload_status"]): boolean {
  return status === "ready" || status === "failed";
}
