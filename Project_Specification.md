# PageTurn AI — Complete Feature, Design & Technical Specification

**A local, source-cited RAG study assistant.**
Author: Sameer Ahmed | BSAI, SZABIST Karachi
Repo target: `github.com/SameerAhmedAI/PageTurn-ai`

> This document is the single source of truth for the build. It replaces the original brainstorm doc. Every phase below is a self-contained, independently committable milestone — finish a phase, verify it works, `git commit` + `git push`, then move to the next. Do not start Phase 2 until Phase 1 runs end-to-end.

---

## 0. Non-Negotiable Ground Rules

Before any code: these apply across every phase, every screen, every commit.

1. **No AI-slop visual design.** No purple-to-pink gradients, no glassmorphism-by-default, no generic "AI startup" hero sections, no emoji used as icons. If it looks like a Loveable/v0 template, redo it.
2. **One real icon library.** Use [Lucide](https://lucide.dev/) (React: `lucide-react`) throughout — never emoji, never mixed icon sets.
3. **One typeface family, two weights max per context.** Specified in §2.
4. **Every page has a browser tab title + favicon.** No default Vite/React tab titles ("React App").
5. **Every phase must run and be demoable on its own** before moving forward. If Phase 3 can't show a working RAG answer in the terminal or a bare UI, it isn't done.
6. **Commit at the end of every phase**, tagged `phase-1`, `phase-2`, etc. This is what makes the GitHub history itself a portfolio artifact — a recruiter can see incremental, disciplined engineering instead of one giant squash commit.

---

## 1. Product Overview

**PageTurn AI** lets a student upload their own lecture PDFs, notes, and slides, then ask questions that are answered strictly from that material — with the exact page and file cited under every answer, so the student can verify it rather than trust it blindly.

It is not a general chatbot wrapper. The core engineering is a full **Retrieval-Augmented Generation (RAG) pipeline**: PDF → text extraction → chunking → embeddings → vector store → semantic retrieval → LLM generation → citation surfacing.

**One-line pitch:** A privacy-first study assistant that answers only from your own notes, and shows you exactly where every answer came from.

---

## 2. Design System (mandatory — read before writing any CSS)

### 2.1 Why this section exists
Default AI-generated UIs converge on the same look: dark background, purple/blue gradient accents, glass cards, generic rounded-everything. That look is now a tell for "vibe-coded, unreviewed." This spec locks in a distinct, defensible design system instead.

### 2.2 Typography
- **Primary font:** [Inter](https://fonts.google.com/specimen/Inter) — UI text, body, navigation.
- **Monospace font:** [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — used only for: source citations, page numbers, code-like metadata (file names, chunk IDs).
- Load both via `@fontsource/inter` and `@fontsource/jetbrains-mono` (npm packages) — not a runtime Google Fonts CDN call, so the app still looks correct offline (matches the privacy-first positioning).
- Weight usage: 400 (body), 500 (labels/buttons), 600 (headings only). Never use 700+ — it reads as generic marketing-site bold.

### 2.3 Color System
Light theme as default, with a dark mode toggle (not dark-only — dark-only is itself becoming an AI-slop signal).

```css
/* Light mode */
--color-bg:            #FAFAF8;   /* warm off-white, not pure white */
--color-surface:       #FFFFFF;
--color-surface-alt:   #F1F0EC;   /* card backgrounds */
--color-border:        #E4E2DB;
--color-text-primary:  #1C1C1A;
--color-text-secondary:#6B6A63;
--color-accent:        #2B5D4E;   /* deep forest green — study/focus association, NOT purple/blue */
--color-accent-hover:  #234B3F;
--color-accent-soft:   #E4EEE9;   /* accent tint for badges/highlights */
--color-warning:       #B8722E;   /* muted amber, for "weak topic" flags */
--color-error:         #B33A3A;

/* Dark mode */
--color-bg-dark:            #16171A;
--color-surface-dark:       #1E2023;
--color-surface-alt-dark:   #26282C;
--color-border-dark:        #34363B;
--color-text-primary-dark:  #EDEDEA;
--color-text-secondary-dark:#9B9A94;
--color-accent-dark:        #5EAE95;
```

**Rule:** accent color is used sparingly — primary buttons, active nav item, citation badges. It is never used as a full-page gradient background.

### 2.4 Logo & Favicon
- Simple wordmark, not an icon-heavy logo: **"PageTurn"** in Inter 600, with a small superscript-style citation mark (¹) rendered in the accent color as the "AI" replacement — visually ties the name to the citation feature.
- Favicon: a 32×32 and 180×180 (apple-touch-icon) version of just the citation mark "¹" in a rounded square, accent-green background, off-white mark. Generate as SVG first, export to PNG/ICO.
- Browser tab title format: `PageTurn — {Page Name}` e.g. `PageTurn — Computer Vision`, not just `PageTurn`.

### 2.5 Layout Principles
- Sidebar + content layout (not top-nav-only) — matches the "workspace" mental model of a study tool, not a marketing site.
- Navbar/sidebar always shows: logo mark + "PageTurn" wordmark, never logo-only.
- Cards: 1px solid border (`--color-border`), 8px radius, no drop shadow by default — shadow only appears on hover (`0 4px 12px rgba(0,0,0,0.06)`), signaling interactivity rather than decorating everything.
- Consistent 8px spacing scale (8/16/24/32/48px) — no arbitrary padding values.

### 2.6 Motion / Animation Rules
Simple and purposeful, never decorative-for-its-own-sake:
- **Hover states:** 150ms ease-out on all interactive elements (buttons, cards, nav items) — subtle `translateY(-1px)` + shadow appearance, not scale/glow effects.
- **Page transitions:** 200ms fade + 8px slide-up on route change (use Framer Motion `AnimatePresence`). No slide-from-side, no bounce easing.
- **Loading states:** skeleton screens (matching final layout shape) for content loads >300ms; a slim top-of-page progress bar (like GitHub's) for background actions (uploading, embedding). Never a centered spinner as the only feedback — it gives no sense of progress.
- **Streaming answers:** LLM responses stream token-by-token with a blinking cursor, not "typed out" character-by-character artificially slowed — actual stream from the backend.

### 2.7 Icons
`lucide-react` only. Suggested mapping:
- Upload → `Upload`
- Subject/folder → `Folder`
- Chat → `MessageSquare`
- Source citation → `Quote` or `BookOpen`
- MCQ mode → `ListChecks`
- Flashcards → `Layers`
- Exam mode → `GraduationCap`
- Settings → `Settings`
- Weak topic flag → `AlertTriangle`

---

## 3. Feature Specification (What Each Feature Does)

### 3.1 Document Upload
**What it does:** User uploads PDF(s) into a specific subject. File is stored, a processing job starts, and UI shows live status (Uploading → Extracting → Chunking → Embedding → Ready).
**Not included in v1:** DOCX/PPTX upload, batch upload >10 files at once, OCR for scanned PDFs (flagged clearly as a limitation, not silently failed).

### 3.2 Subject Management
**What it does:** Subjects are top-level containers (e.g. "Knowledge-Based Systems"). Each subject has its own documents, chat history, and generated study material. This is what gives the app structure over a single flat "chat with a PDF" tool.

### 3.3 Chat With Notes (core RAG loop)
**What it does:** User asks a natural-language question scoped to a subject. System retrieves the top-k most relevant chunks from that subject's documents, sends them + the question to the LLM, streams back an answer, and displays citations (file name + page number) beneath it, each clickable to jump to that page in an inline PDF viewer.
**Explanation modes:** Simple / University-level — same retrieval, different system prompt controlling vocabulary and depth.

### 3.4 Study Tools (generation modes)
All of these reuse the same retrieval step, just with a different generation prompt and different output rendering:
- **Summary generation** — condenses retrieved chunks into a structured summary (headings + bullet points).
- **MCQ generation** — generates N multiple-choice questions from a topic/subject, each tagged with its source chunk so the "why is this the answer" is always traceable.
- **Short/long question generation** — exam-style Q&A pairs.
- **Flashcard generation** — front/back pairs, exportable, with a simple spaced-repetition-style "know it / review it" tap interaction (no full SRS algorithm in v1 — flag as future work).

### 3.5 Exam Preparation Pack (v2 feature — not MVP)
Combines summary + MCQs + short questions + a "predicted important topics" list (based on chunk frequency/density across the subject) into a single exportable document.

### 3.6 Source-Based Answers (cross-cutting requirement)
**Not a separate feature** — a constraint on every generation feature. Every LLM call that produces study content must carry forward chunk metadata (file, page) so it can be rendered as a citation. If a feature can't cite its source, it doesn't ship.

### 3.7 Chat History & Export
Chat sessions persist per subject. Generated study material (summaries, flashcard sets, MCQ sets) can be exported as Markdown or PDF.

### Explicitly cut from v1 (documented, not silently dropped)
Viva practice mode, weak-topic identification, encrypted local storage, multi-user auth — all listed in the original brainstorm doc, all deferred to a "Future Work" section in the README. Shipping a focused v1 beats a half-working feature-complete version.

---

## 4. Technical Architecture

### 4.1 Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | You already know this from CASETRACK/GazeAware — no new tooling risk |
| Styling | Tailwind CSS (custom theme tokens from §2.3) | Fast, but tokens prevent "default Tailwind look" |
| Animation | Framer Motion | Handles §2.6 requirements cleanly |
| Backend | FastAPI (Python) | Matches your existing stack; async support fits streaming |
| Relational DB | SQLite (dev) → PostgreSQL (optional prod) | Subjects, documents, chat history, users |
| Vector DB | ChromaDB (local, embedded) | Simplest local-first vector store, no separate server process |
| PDF parsing | PyMuPDF (`fitz`) | Fastest, gives page-level text + coordinates |
| Embeddings | `nomic-embed-text` via Ollama, fallback: `sentence-transformers/all-MiniLM-L6-v2` | Keeps fully-local option, MiniLM as CPU-friendly fallback |
| LLM | Ollama (Llama 3.1 8B or Qwen2.5 7B) **+ Groq API fallback** | Local-first for the privacy pitch; Groq fallback removes the "recruiter can't run it" demo risk (you already used Groq in GazeAware) |

### 4.2 High-Level Data Flow
```
[Upload PDF] → FastAPI receives file → saved to /storage/{subject_id}/{doc_id}.pdf
    → PyMuPDF extracts text per page
    → Chunker splits into ~500-word chunks w/ 50-word overlap, tagged {doc_id, page, subject_id}
    → Embedding model converts each chunk to a vector
    → ChromaDB stores {vector, chunk_text, metadata}
    → status updated to "ready" in SQLite

[User asks question] → FastAPI /chat endpoint
    → question embedded
    → ChromaDB similarity search (top-k, filtered by subject_id)
    → retrieved chunks + question → prompt template → LLM (Ollama or Groq)
    → response streamed back to frontend via SSE
    → citations (from chunk metadata) sent alongside/after stream
    → chat turn saved to SQLite
```

### 4.3 Database Schema (SQLite/Postgres)
```sql
subjects(id, name, created_at)
documents(id, subject_id, filename, upload_status, page_count, uploaded_at)
chat_sessions(id, subject_id, created_at)
chat_messages(id, session_id, role, content, created_at)
citations(id, message_id, document_id, page_number, chunk_text)
generated_content(id, subject_id, type[summary|mcq|flashcard], content_json, created_at)
```

### 4.4 ChromaDB Collection Structure
One collection per subject (`subject_{id}`) — keeps retrieval scoped without needing metadata filtering on every query, and makes "delete a subject" trivially mean "drop a collection."

### 4.5 API Endpoints (FastAPI)
```
POST   /subjects                     create subject
GET    /subjects                     list subjects
POST   /subjects/{id}/documents      upload PDF
GET    /subjects/{id}/documents      list documents + status
POST   /subjects/{id}/chat           ask question (SSE stream response)
GET    /subjects/{id}/chat/history   fetch past messages
POST   /subjects/{id}/generate       body: {type: mcq|summary|flashcard, topic?}
GET    /subjects/{id}/export/{content_id}  export as md/pdf
```

---

## 5. Development Phases

Each phase = one milestone branch → merge to `main` → tag → push. Do not skip verification steps.

---

### **Phase 1 — Project Skeleton**
**Goal:** Empty but working full-stack app, deployed locally, connected front-to-back.

**Backend:**
- FastAPI app with `/health` endpoint
- CORS configured for local Vite dev server
- Folder structure: `app/main.py`, `app/routers/`, `app/models/`, `app/services/`

**Frontend:**
- Vite + React + TS scaffold
- Tailwind configured with the custom theme from §2.3
- Fonts installed (`@fontsource/inter`, `@fontsource/jetbrains-mono`)
- Favicon + tab title set (§2.4)
- Sidebar + top bar shell (no real content yet — nav items are placeholders)
- One working fetch call from frontend to backend `/health`, rendered on screen

**Verify before committing:** `npm run dev` + `uvicorn app.main:app --reload` both run, and the frontend visibly displays a successful response from the backend.

**Commit:** `git tag phase-1`

---

### **Phase 2 — Subjects & PDF Upload**
**Goal:** Create subjects, upload PDFs, see live processing status. No RAG yet.

**Backend:**
- SQLite + SQLAlchemy models: `Subject`, `Document`
- `POST /subjects`, `GET /subjects`
- `POST /subjects/{id}/documents` — accepts multipart file, saves to disk, creates `Document` row with `status=processing`
- PyMuPDF text extraction runs as a background task (FastAPI `BackgroundTasks`), sets `status=ready` when done, `status=failed` with an error message if extraction fails (e.g. scanned PDF with no text layer)

**Frontend:**
- Subjects dashboard: grid of subject cards (icon, name, doc count)
- "New Subject" modal
- Subject detail page: upload dropzone + document list showing per-file status badges with the loading-state pattern from §2.6

**Verify:** Upload a real lecture PDF from your own SZABIST courses (KBS/NLP notes) — confirm text extraction actually works on your real material, not just a clean test PDF. This is the check called out earlier: test with your real files now, before the architecture is harder to change.

**Commit:** `git tag phase-2`

---

### **Phase 3 — RAG Pipeline (the core engineering)**
**Goal:** Ask a question, get an answer sourced from the uploaded PDF, with citations.

**Backend:**
- Chunking service: 500-word chunks, 50-word overlap, tagged with `{doc_id, page, subject_id}`
- Embedding service: Ollama `nomic-embed-text` primary, `sentence-transformers` fallback if Ollama unreachable
- ChromaDB integration: one collection per subject, chunks embedded and stored right after extraction succeeds (extend the Phase 2 background task)
- Retrieval service: given a query, embed it, `collection.query(top_k=5)`
- LLM service: prompt template that forces the model to answer **only** from provided context and say "not found in provided material" if the retrieved chunks don't cover it (critical — this is what prevents hallucination and is the actual technical differentiator worth talking about in an interview)
- `POST /subjects/{id}/chat` — SSE streaming endpoint, Ollama primary / Groq fallback (env var toggle)
- Citations attached to the response using chunk metadata

**Frontend:**
- Chat interface (per §"Chat Interface Layout" pattern): message list, streaming response with blinking cursor, citation chips below each AI message (file name in JetBrains Mono, page number, click to open PDF at that page)
- Simple/University explanation mode toggle

**Verify:** Ask a question you know the answer to from your own notes; confirm the citation actually points to the correct page. Then ask something **not** in the document and confirm it says so instead of making something up.

**Commit:** `git tag phase-3`

---

### **Phase 4 — Study Tools**
**Goal:** Summary, MCQ, and flashcard generation, all citation-backed.

**Backend:**
- `POST /subjects/{id}/generate` with `type` param
- Separate prompt templates per type, all consuming the same retrieval step from Phase 3
- Structured output: force LLM to return JSON (see `structured_outputs` pattern) for MCQs/flashcards so the frontend can render them as real UI components, not raw markdown text
- `generated_content` table stores results for later retrieval/export

**Frontend:**
- Study tool buttons in the subject view (icons from §2.7: `ListChecks`, `Layers`, `FileText`)
- MCQ viewer: one question at a time, select answer, reveal correct + citation
- Flashcard viewer: flip animation (respecting §2.6 — 150-200ms, no bounce), "know it / review it" tap
- Summary viewer: structured headings/bullets, not a wall of text

**Verify:** Generate an MCQ set from real lecture content and manually check 3-4 questions against the source PDF for accuracy.

**Commit:** `git tag phase-4`

---

### **Phase 5 — History, Export & Dashboard Polish**
**Goal:** Persistence and the main dashboard becomes real (not placeholder stats).

**Backend:**
- `GET /subjects/{id}/chat/history`
- `GET /subjects/{id}/export/{content_id}` — Markdown export always; PDF export via a simple HTML→PDF render (e.g. `weasyprint` or reuse the `pdf` skill pattern if scripting outputs)

**Frontend:**
- Real dashboard stats (subjects count, docs count, chat sessions, generated sets) wired to actual DB counts
- Chat history sidebar per subject (past sessions, resumable)
- Export buttons on generated content

**Verify:** Full user flow works cold: create subject → upload → chat → generate MCQs → export → reload the app → history persists.

**Commit:** `git tag phase-5`

---

### **Phase 6 — Dark Mode, Animations Pass, Accessibility**
**Goal:** The design system from §2 is actually fully implemented, not just partially.

- Dark mode toggle wired to the `--color-*-dark` tokens
- Full hover-state pass on every interactive element
- Page transition wrapper (`AnimatePresence`) applied across all routes
- Loading skeletons replace any remaining bare spinners
- Keyboard navigation check (tab order, focus rings using accent color, not browser default blue)
- Responsive check at 768px (tablet) minimum — doesn't need to be fully mobile-optimized for v1, but shouldn't break

**Commit:** `git tag phase-6`

---

### **Phase 7 — Portfolio Readiness**
**Goal:** Repo is recruiter-ready.

- README with: problem statement, architecture diagram (can reuse §4.2 as ASCII or redraw as an image), tech stack table, setup instructions, screenshots, demo GIF/video link
- `.env.example` documenting required vars (Ollama host, Groq API key fallback, etc.)
- Explicit "Limitations" and "Future Work" sections in README (scanned-PDF/OCR gap, no viva mode yet, no SRS algorithm yet — turns cut features into a roadmap, not a hidden gap)
- Clean commit history check — squash any "wip" / "fix typo" noise commits if needed, but keep the phase tags intact
- LinkedIn post draft + portfolio case study writeup (both already have solid material from the original brainstorm doc — the Portfolio Case Study Format there is fine, just update the project name to PageTurn AI)

**Commit:** `git tag phase-7` → this is your "done" state.

---

## 6. Repo & GitHub Workflow

```
main                — always deployable, one merge per completed phase
phase/1-skeleton    — work branch for Phase 1
phase/2-upload      — work branch for Phase 2
...
```

Suggested commit message pattern per phase: `feat(phase-2): PDF upload + processing status`. Keeps history scannable and shows structured engineering discipline — this is itself something worth pointing to if a recruiter opens your commit log.

---

## 7. What NOT to Build in v1 (explicit scope guard)

Revisit this list before adding anything not already specified above. If it's not in Phases 1–7, it doesn't go in until v1 ships:

- Viva/oral practice mode
- Weak-topic auto-identification
- OCR for scanned PDFs
- Multi-user accounts / auth
- Encrypted local storage
- Mobile-native app
- Full spaced-repetition algorithm for flashcards

Each of these is legitimate — they just don't belong in a 6-7 phase MVP. Listing them in the README as "Future Work" costs nothing and shows product judgment.
