# School Buddy — Web

> **Foundation update:** See the [web/mobile feature tracker](../docs/FEATURE_TRACKER.md) and [deployment notes](../docs/IMPLEMENTATION_NOTES.md). New provisioning uses trusted **app metadata** for roles/schools; ordinary User Metadata no longer grants roles. Earlier provisioning descriptions below are historical. Apply migrations 0020–0025 with the updated server routes.


The Next.js (App Router) companion to the root Expo app. Same Supabase project, same product, same admin-provisioned accounts — teachers and students sign in here from a browser instead of the mobile app.

## Included

- Next.js 16 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS v4 (CSS-based theme in `app/globals.css`, tokens mirror the mobile app's `constants/theme.ts`)
- Supabase auth via `@supabase/ssr` — cookie-based sessions shared between Server Components, Client Components, and `proxy.ts`
- `proxy.ts` (Next 16's renamed `middleware.ts`) protects all authenticated routes and refreshes the session cookie on every request
- A persistent left sidebar (`components/Sidebar.tsx`) with role-specific nav — Classes/Students/Assignments for teachers, Subjects/Assignments for students, Teachers/Students account management for admins
- Live admin account management — create teacher/student accounts, restrict/unrestrict, reset passwords — via protected Route Handlers using the Supabase service-role key
- Same basic pages as mobile: home, sign in, forgot password, dashboard and settings, plus a web join-guidance page for school-managed account provisioning
- Role dashboards include live KPIs, animated charts, attention/progress panels and accessible data fallbacks. `/signup` explains the secure school-managed invitation flow; it does not create unverified public accounts.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the same Supabase project URL/anon key used by the root app
npm run dev
```

Runs on http://localhost:3000.

## Environment variables

Next.js requires the `NEXT_PUBLIC_` prefix (not Expo's `EXPO_PUBLIC_`), so this app has its own `.env.local` even though it points at the same Supabase project as the root app:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only — required for admin account management (create/restrict/reset-password).
# Find it in Supabase Dashboard -> Project Settings -> API -> service_role secret.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server-only — powers AI Chat and material extraction (Classes > a subject's
# Materials section). Get a key at https://aistudio.google.com/apikey.
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash
```

## Project structure

```text
web/
  app/
    page.tsx              Single-page marketing home, sign-in link in the header
    login/                Sign in
    forgot-password/      Password reset request
    (app)/                 Authenticated route group, shares the Sidebar layout
      layout.tsx            Fetches user+profile, renders Sidebar + children
      dashboard/            Dispatches to a role-specific dashboard component
      classes/               List of Classes — admin/VP manage school-wide, teacher sees their own (read-only)
      classes/[id]/           Class detail — Students/Subjects/Materials tabs, admin/VP-only (teacher redirected to their subject)
      classes/[id]/subjects/[classId]/   One subject offering — read-only roster + assignments + schedule + materials
      students/               Teacher-only — real aggregate roster (read-only)
      students/[id]/          One student — info, their assignments/grades, performance stats
      subjects/               Student-only — real enrolled subject offerings
      assignments/            Real assignments, teacher (all classes + create) or student (read-only)
      assignments/[id]/        Assignment detail — student submits/sees grade, teacher views roster + grades
      admin/teachers/, admin/students/   Admin-only — live account management
      timetable/               Real weekly schedule grid
      ai-chat/                 Full-page AI chat, every role
      performance/             Real graded-submission history + summary stats, teacher/student only
      exams/                 Exam schedules — teacher draft/publish/cancel, student view, staff oversight
      learning-videos/        YouTube/Vimeo lessons — teacher publish, student watch/progress, staff oversight
      settings/              Signed-in email, role, sign out
    api/admin/
      create-user/route.ts    POST — create a teacher/student account
      set-restricted/route.ts POST — ban/unban via Supabase admin API
      set-password/route.ts   POST — set a new password directly
    api/materials/extract/route.ts   POST — Gemini extraction for one uploaded material
    api/assignments/generate/route.ts   POST — Gemini-drafts an MCQ test from selected materials (not saved yet)
    api/submissions/submit/route.ts     POST — records a submission; auto-grades MCQ tests server-side
    api/chat/route.ts                POST — AI Chat, proxies to Gemini
  components/
    Sidebar.tsx              Role-specific left nav (placeholders included in the nav shape)
    ComingSoon.tsx            Shared placeholder page content
    AiChat.tsx                Full-page chat UI, used by app/(app)/ai-chat
    dashboard/               Admin/Teacher/StudentDashboard — real data
    classes/                 ClassesList, ClassGroupDetail (tabs), RosterManager, ClassAssignments, ClassSchedule
    curriculum/SubjectMaterials.tsx   Upload form + materials list, scoped to one subject offering
    assignments/              NewAssignmentForm, GenerateAssignmentForm (AI draft + review + publish), AssignmentDetail (student submit / teacher grade), AssignmentListItem, AssignmentsPageClient
    admin/AccountsTable.tsx   Create/restrict/reset-password UI, used by admin/teachers|students
    ConfigNotice.tsx, SignOutButton.tsx
  constants/                Product configuration
  lib/
    errors.ts               Shared error-message helper
    supabase/
      client.ts             Browser Supabase client
      server.ts              Server Component / Server Action Supabase client (cookie-based, RLS-respecting)
      admin.ts                Service-role client — server-only, bypasses RLS, used only by api/admin/*
      require-admin.ts        Route Handler guard — verifies caller's own session has role='admin'
      profile.ts             getUserAndProfile() — user + role, used across (app) pages
      proxy.ts               Session refresh + route protection, used by proxy.ts
    classGroups.ts           fetchTeacherClassGroups() / fetchSchoolClassGroups() — groups subject offerings by Class, roster counted once per Class
  proxy.ts                   Next.js Proxy entry point (runs on every request)
```

## Commands

```bash
npm run dev         # Start the dev server
npm run build        # Production build
npm run start         # Run the production build
npm run lint            # ESLint
npm run typecheck        # Strict TypeScript checks
```

## Roles

Every account has one of four roles — `admin`, `vice_principal`, `teacher`, or `student` — stored in the shared `public.profiles` table (see `../supabase/migrations/0001_roles.sql`, widened by `0013_vice_principal.sql`), not in Supabase's `user_metadata` (which the signed-in user can edit themselves, so it isn't trustworthy for authorization). `/dashboard` renders a different component (`components/dashboard/{Admin,Teacher,Student}Dashboard.tsx`) based on `profile.role`, fetched via `getUserAndProfile()` — `vice_principal` renders `AdminDashboard`, same as `admin`.

**`vice_principal` is "admin-lite"** — a real second-in-command role, not just a label. Mechanism (`0013_vice_principal.sql`):

- A new `is_staff(uid)` helper (`role in ('admin', 'vice_principal')`) replaces `is_admin()` on every "view everything" RLS policy across the schema (profiles, classes, enrollments, assignments, schedule, materials, answer keys, submissions) — so a VP genuinely sees all classes/rosters/grades school-wide, the same as admin, via plain RLS-respecting queries.
- `requireAdmin()` (`lib/supabase/require-admin.ts`) — despite the name, now accepts `admin` or `vice_principal` — gates the three account-management routes below, so a VP can create/restrict teacher & student accounts and reset their passwords exactly like an admin.
- What a VP does **not** get: the class_groups update/delete policies (renaming or deleting a whole Class — genuinely destructive, cascades through its roster/subjects/assignments/materials) stay `is_admin()`-only, not widened to `is_staff()`. And `set-restricted`/`set-password` explicitly check the *target* account's role when the caller is a VP, rejecting the request if the target is `admin` — there's no UI surface for this today (no page lists admin accounts, for either role), but the route itself now enforces it rather than just relying on there being no button for it.

To promote someone to `admin` or `vice_principal`, still run SQL directly (the in-app account creation flow only issues `teacher`/`student` accounts, deliberately — granting elevated rights isn't a button click):

```sql
update public.profiles set role = 'admin' where email = 'someone@school.edu';
-- or: set role = 'vice_principal'
```

### Admin account management

`/admin/teachers` and `/admin/students` (open to `admin` and `vice_principal`) list accounts by role (via the `is_staff()`-gated "admins view all profiles" RLS policy) and let either:

- **Create** a teacher or student account — calls `POST /api/admin/create-user`, which uses `auth.admin.createUser(...)` server-side. The existing `handle_new_user` trigger creates the matching `profiles` row. For a new **teacher**, the form has an optional "Subject they teach" field — this is the *only* place a subject ever gets created (teachers can't create their own anymore, see **Classes, roster, and assignments** below). Uses the service-role client to insert the `subjects` row (the normal RLS insert policy requires `teacher_id = auth.uid()` of the *creator*, which wouldn't hold here — the admin/VP is acting on someone else's behalf); non-fatal if it fails (e.g. the subject name already exists for another teacher) — the account is still created, just without that shortcut. **Not built yet**: there's no way to add/change a subject for a teacher *after* onboarding — skip that field here and there's currently no other UI to fix it later.
- **Restrict / unrestrict** — `POST /api/admin/set-restricted` bans/unbans via `auth.admin.updateUserById(..., { ban_duration })`, and mirrors the flag onto `profiles.restricted` (added in `supabase/migrations/0002_account_management.sql`) so the list can display it without another privileged call.
- **Set password** — `POST /api/admin/set-password` sets a new password directly (shown once in the UI, handed off out-of-band) — no email flow, matching how accounts are created.

All three routes call `requireAdmin()` (`lib/supabase/require-admin.ts`) first, which checks the *caller's own* cookie-based session has `profiles.role` of `admin` or `vice_principal`, before using the service-role client (`lib/supabase/admin.ts`) to act on someone else's account. This is web-only for now — the mobile app has no server to hold the service-role key, so it shows the same oversight dashboard but no live account-management screens yet.

## Classes, roster, and assignments

Two levels: a **Class** (`class_groups`, e.g. "Class 9") holds the shared student roster; each **subject offering** within it (`classes`, e.g. "Class 9 · Maths") has its own teacher, period, room, assignments, and materials. Added by `../supabase/migrations/0009_class_groups.sql` on top of `0003_schools_classes.sql` (`schools`, `classes`, `enrollments`, `assignments`, plus RLS and helper functions `is_teacher()`/`current_school_id()` mirroring `is_admin()`). This replaced an earlier one-level model where each class row had its own roster — two subjects for the same physical group of students used to show up as duplicate, confusingly-named rows ("Class 9" twice) with separate rosters; existing same-named classes were auto-merged into one shared Class during the migration.

**A subject has exactly one teacher, school-wide** (`../supabase/migrations/0012_subject_teacher.sql`) — the real-world shape is one teacher per subject spread across several classes (the Maths teacher teaches Maths to Class 9, 10, and 11), not several teachers per class. `subjects.teacher_id` is set once, at teacher onboarding (see **Admin account management** above). A DB trigger (`sync_class_teacher_from_subject`, fires before every insert/update of `classes.subject_id`) keeps `classes.teacher_id` permanently mirroring it, so `owns_class()`, `owns_class_group()`, and every existing "my classes" query across both apps needed **zero changes** — they already read `classes.teacher_id`, which is now just always correct.

**Class structure is admin/VP-only** (`../supabase/migrations/0015_admin_controls_classes.sql`) — a teacher has exactly one subject, so there's nothing for them to structurally manage: they don't create Classes, attach a subject to one, manage the roster, or delete a Class. That's all admin/VP now (VP gets the operational/reversible parts — creating a Class, assigning a subject to it, managing the roster; deleting a Class stays strictly admin-only, since it cascades through the roster/subjects/assignments/materials). A teacher's `/classes` list is read-only and links straight to their own subject's page (`/classes/[id]/subjects/[classId]`) — skipping the Class-management view entirely, since there's nothing for them to do there. That page (`/classes/[id]`, `components/classes/ClassGroupDetail.tsx`) still has its full **Students** (roster)/**Subjects**/**Materials** tabs and "Delete class" — just gated to admin/VP now; a teacher who lands on it (e.g. a stale link) gets redirected straight to their own subject page instead.

Both "New class" (`/classes`) and "Assign subject" (a Class's **Subjects** tab) let admin/VP pick **several** subjects at once via checkboxes — each becomes its own `classes` row (one insert per subject, same period/room applied to all of them), so setting up a Class with Maths + Science + English is one submit instead of three round trips. The Subjects tab's picker also excludes subjects already assigned to that Class, so there's no way to double-assign one by accident.

A teacher's remaining scope, unchanged: materials, assignments/tests, and grading for their one subject — plus a read-only view of the roster, shown directly on their subject's own page. Students see their real enrolled subjects (`/subjects`) and assignments — RLS scopes both automatically (`is_enrolled()` resolves through a subject offering's `class_group_id`), no extra query filtering needed.

Since a teacher only ever has one subject, their own `/classes` list and dashboard "Your classes" section no longer repeat that subject's name on every row (it was always the same word) — the subject now shows once, as a subtitle under the teacher's name on the dashboard banner (`DashboardBanner`'s `subtitle` prop, e.g. "Mathematics teacher"). Admin/VP's `/classes` (where a Class can have several subjects/teachers) is unchanged.

`/students` (teacher-only) lists everyone across the teacher's classes; clicking one now goes to `/students/[id]` — that student's info, every assignment from this teacher's subject with their submission status/grade, and the same average-score/pass-rate stats as **Performance** below, scoped to just that student. The page verifies the student shares a class with the signed-in teacher (via `enrollments`/`classes.teacher_id`) before showing anything, independent of whatever RLS already allows.

Also added a lightweight multi-tenant foundation: every `profiles` row now has a `school_id`, backfilled to one default school (`School Buddy Academy`). There's no "manage schools" UI yet — single-tenant behavior today, correct shape for later.

**Deliberately out of scope this pass**: assigning to an individual student or a group (assignments always target the whole class), and any submission/grading subsystem — an assignment is a record with a due date, not yet tracked per student.

### Class schedules

Backed by `../supabase/migrations/0006_class_schedule.sql` (`class_schedule`: `class_id`, `day_of_week` 1–7, `start_time`, `end_time`; RLS reuses the `owns_class()`/`is_enrolled()` helpers from `0003_schools_classes.sql`). A teacher still sets a class's meeting times from its detail page (`components/classes/ClassSchedule.tsx`, a "Schedule" section alongside Roster/Assignments). The standalone `/timetable` weekly-grid page is retired — a student's own schedule now renders inline on **Subjects** (`/subjects`), grouped by matching start/end time and showing each line as e.g. "Mon, Wed · 9:00 AM–10:00 AM" below that subject's details, rather than as a separate page to check.

### Materials

Teacher-only (web only for now — mobile has no upload UI). Each subject offering's own page (`/classes/[id]/subjects/[classId]`) has a **Materials** section where a teacher uploads class material (PDF or image) tagged with a title + chapter, backed by `../supabase/migrations/0007_materials.sql` (`materials` table + a private `materials` Storage bucket, both RLS-scoped via `owns_class()`). Previously lived on a standalone `/curriculum` page with a class picker in the upload form — retired now that materials live inside the subject they belong to, one less place to look. The upload flow (`components/curriculum/SubjectMaterials.tsx`):

1. Browser uploads the file straight to Storage (`supabase.storage.from('materials').upload(...)`) — no Next.js body-size limit involved.
2. Inserts a `materials` row (`status: 'pending'`) and one `material_files` row per file (`../supabase/migrations/0016_material_files.sql` — a material can be one PDF, or several images treated as sequential pages of the same document; `materials` itself only holds title/chapter/status/extracted content, never file paths).
3. Calls `POST /api/materials/extract` with the material's id, which downloads every one of its files server-side (service-role client) and sends them all to Gemini in a single multimodal request — one image gets the single-document prompt, several images get a "these are sequential pages, combine them" prompt — asking for one combined extracted text + summary as JSON. The row is updated to `status: 'extracted'` (with the result) or `'failed'` (with an error message), synchronously — the client awaits this call directly, no polling.

The upload form accepts either one PDF (capped at 15MB, with a clear error above that) or several images selected/dragged together (capped at 25MB combined) — picking a PDF alongside images, or more than one PDF, is rejected client-side with an explanatory message.

A teacher can also attach a **YouTube video URL** to a material (`../supabase/migrations/0027_material_video_links.sql` — `materials.video_url`, a `check` constraint restricting it to `youtube.com`/`youtu.be` links, validated client-side via a new `isYoutubeUrl()` in `shared/domain/learning.ts` alongside the existing `isSafeVideoUrl()`/`getVideoEmbedUrl()` helpers the separate Learning Videos feature already used). Files are no longer mandatory — a material can now be video-only (no files, `status` set straight to `'extracted'` since there's nothing to OCR), file-only (unchanged), or both. The one existing material card gained its first edit action: "Edit video" reveals an inline input to change or clear just the video link; title/chapter remain create-only, same as before.

A Class's **Materials** tab (`/classes/[id]`) still shows a read-only rollup of everything uploaded across all of that Class's subjects, for a quick cross-subject scan.

AI Chat can now retrieve keyword-matched excerpts from extracted materials for admin/VP and the material's teacher. Students access materials only through **Guided lessons** (see AI Chat below) — scoped to their own enrolled class and never via free-text search. Search is lexical rather than vector/semantic retrieval and page references are unavailable because extraction does not retain page boundaries.

### AI-generated tests

From a subject offering's Assignments section (`/classes/[id]/subjects/[classId]`, `components/assignments/GenerateAssignmentForm.tsx`), "Generate with AI" lets a teacher pick from that subject's extracted materials + a question count/difficulty, and `POST /api/assignments/generate` asks Gemini for a multiple-choice test (title, description, 4-option questions with one correct answer each, plus a short explanation of why) built only from that material's extracted text. Nothing is saved yet at this point — the teacher reviews and can edit every question, option, the correct answer, and the explanation before a separate "Publish" step writes it.

Picking a difficulty (Easy/Medium/Expert) pre-fills a **guidance textarea** (`DIFFICULTY_GUIDANCE` in `components/assignments/types.ts`) describing what that difficulty should mean — a teacher can edit or extend it with their own instructions before generating; whatever's in the box at submit time goes straight into the Gemini prompt in place of a bare difficulty label. It's a one-off per generation, not saved anywhere.

Publishing does two inserts (`../supabase/migrations/0010_assignment_generation.sql`): the `assignments` row gets `questions` (prompt + options only — **no correct answers**) and `pass_score` (minimum correct count to pass), while the correct answers *and explanations* go into a separate `assignment_answer_keys` table (`assignment_id`, `answers: [{id, correct_index, explanation}]`) with **no student-facing RLS policy at all** — row-level security is per-row, not per-column, so keeping answers in their own table is what actually stops a student from reading them (e.g. via `select('*')` on assignments), not just hiding the field in the UI. A teacher can review this any time after publishing too, via the "Show answers" toggle on the assignment's detail page (`AssignmentDetail.tsx`) — not just during the initial review-before-publish step. Manually-created assignments (the existing "New assignment" form) are unaffected — `questions`/`pass_score` stay null for those.

**Generate with AI** also has a second mode: a pill toggle at the top switches between **Multiple choice** (the flow above) and **Written response**, since a rubric only makes sense for manually-graded freeform work — an MCQ test is already auto-graded off its answer key, so a rubric on one would never actually be used. "Written response" deliberately isn't "essay" — the prompt tells Gemini that freeform only means *no single right answer to auto-check*, not that it must be prose, and to pick whatever format a teacher of that subject would actually assign (a short problem set with shown work for maths/science-type material, an essay or short-answer response for literature/history/civics-type material). In freeform mode, `POST /api/assignments/generate` asks Gemini for one assignment prompt (title + description) plus a proposed grading rubric (3–5 criteria with point values summing to a clean total, e.g. 10/20/25) built from the same selected materials — same difficulty guidance, language, and rate limit as MCQ mode, just a different prompt and response shape (`{title, description, rubric}` instead of `{title, description, questions}`). The review step reuses the same rubric editor the manual form already has (add/edit/remove criteria and their points) before publishing writes an `assignments` row with `assessment_type: 'homework'`, the edited `rubric`, and no `questions`/`pass_score`/answer key — graded manually afterward the same way any other freeform submission is, via the rubric-aware `GradeForm` in `AssignmentDetail.tsx`.

### Submissions & grading

Web-only for now (matches Materials/AI-generation/admin — mobile still just shows the read-only assignments list). Every assignment row (`components/assignments/AssignmentListItem.tsx`) now links to `/assignments/[id]` (`app/(app)/assignments/[id]/page.tsx`), backed by `../supabase/migrations/0011_submissions.sql` (`submissions` table: `assignment_id`, `student_id`, `answers`, `score`, `max_score`, `passed`, `status`, `feedback`; one row per student per assignment, no resubmitting once created). The page renders one of two views (`components/assignments/AssignmentDetail.tsx`) depending on who's looking:

- **Student**: if the assignment has `questions` (an AI-generated test), answer each question and submit — `POST /api/submissions/submit` grades it immediately server-side by comparing answers against `assignment_answer_keys` (the only place that table is ever read; students have no RLS access to it at all, so this comparison *must* happen server-side). A plain assignment (no `questions`) just takes a freeform text answer and sits as `'submitted'` until a teacher grades it. Either way, once a submission exists the student sees their result (score + pass/fail once graded, or "awaiting grade").
- **Teacher**: sees the Class's shared roster (via `enrollments.class_group_id`, same as the Students tab) with each student's submission status, and can open a submission to set/edit a grade and feedback (`GradeForm`, a plain RLS-respecting update) — including re-scoring an auto-graded MCQ submission if needed.

**Rubric-based grading** (`../supabase/migrations/0017_rubric_grading.sql`) — only applies to freeform assignments (MCQ is already objectively auto-graded). A teacher can optionally add a rubric when creating a plain assignment (`NewAssignmentForm.tsx` — a list of criteria, each with its own point value, defined fresh per-assignment; no reusable templates yet). When an assignment has one, `GradeForm` swaps the single score/out-of pair for one number input per criterion, auto-summing to the total (`assignments.rubric`, `submissions.rubric_scores`); the student's view shows the same per-criterion breakdown once graded, not just the total.

**Assignment status** (`../supabase/migrations/0018_assignment_status.sql`, `assignments.status`: `active` / `ended` / `cancelled`, default `active`) — shown as a badge everywhere an assignment appears (list rows, the detail page). An `active` assignment auto-reads as `ended` once its due date passes (computed wherever status is checked — `getEffectiveStatus()` in `components/assignments/types.ts` — not a background job), and a teacher can also override it directly from the assignment's detail page: **End now** (closes it early), **Reopen** (only meaningful past due — clears the due date too, since otherwise it'd just read as ended again immediately), **Cancel** (soft — voids it, excluded from Performance and hidden from the student's active work, but kept in the database), or **Delete permanently** (hard delete, with a confirmation — cascades to its submissions and answer key). `POST /api/submissions/submit` rejects a submission once an assignment isn't effectively `active`, server-side, not just in the UI.

A student's own grade/pass-fail is gated behind the assignment actually being `ended` — a submission graded early still just shows "awaiting results" to that student until then (teachers always see real grades right away, on the assignment page and on **Performance**/the student detail page above). This gate is enforced in both places a score could otherwise leak: the assignment detail page and **Performance**'s own student-branch query.

**Not built yet**: no per-question breakdown shown to the student after grading an MCQ test (just the total score), and no reusable rubric templates (a rubric is retyped for each assignment that wants one).

### Performance

`/performance` (`app/(app)/performance/page.tsx`), teacher and student only — reads straight from `submissions`, no new tables. A student sees their own graded-submission history plus average score % and pass rate; a teacher sees the same across every class they teach, plus a per-class average, relying entirely on the existing "Teachers view submissions for own classes" RLS policy to scope the query (no explicit class filter needed). Rubric-graded submissions contribute to these averages the same as any other, since rubric grading still writes a plain `score`/`max_score`/`passed` on the submission. Web-only for now, and admin/VP don't get a version yet — this is v1 (a list + summary stats); a full students × assignments gradebook grid is a natural v2 on the same data.

A cancelled assignment's submissions never enter this page's numbers, for either role. On the student branch specifically, a submission whose assignment hasn't effectively ended yet is treated as "awaiting" rather than showing its real score — same grade-visibility gate as the assignment detail page (see **Submissions & grading** above), applied here too so a score can't leak through the aggregate view before the assignment ends.

Migration `0024_submission_result_release.sql` enforces that boundary in PostgreSQL rather than relying on the UI. Students cannot directly select their active/cancelled submission rows. `get_my_submissions()` returns their submission state while replacing score, pass/fail, feedback, grader and rubric result fields with `null` until the assignment is explicitly ended or its active due date has passed. Teacher/admin read policies remain unchanged.

### AI Chat

AI Chat is a read-only, role-aware assistant. A structured planning call selects from an allowlist of school topics, and the database function in `0022_grounded_chat.sql` retrieves only records permitted for the signed-in role and school. It supports teacher/student account summaries where permitted, classes, subjects, assignment dates/status, and staff-only material excerpts. It deliberately excludes grades, submissions, answer keys, credentials, attendance, arbitrary SQL, and write actions.

Every reply includes server-verified source metadata. The UI labels it as school sources, school sources plus general knowledge, general knowledge not verified against school data, or insufficient evidence. Source cards show a saved record snapshot or material excerpt, retrieval time, known limitations, and an internal link. The model supplies source IDs only; it cannot supply URLs. Unknown citations and unsupported school-only claims fail closed to an insufficient-evidence response. These sources are evidence, not an accuracy percentage.

The route uses two structured Gemini calls: retrieval planning and grounded answering. Evidence metadata is persisted in `ai_chat_messages.grounding`, so chat history preserves the original basis instead of silently re-querying current records. Material retrieval is keyword-based and returns at most five excerpts. Record snapshots are capped at 50 rows while carrying the exact visible-record count and an incomplete-list warning.

`/ai-chat` calls `POST /api/chat`, which requires server-only `GEMINI_API_KEY` and `GEMINI_MODEL` values in `.env.local`. The route accepts either a same-origin session cookie or a mobile `Authorization: Bearer <supabase access token>` header and validates both through the same adapter. **Its sidebar link is currently hidden for students only** (unlinked, not removed — the route, component, and guided-lesson flow below are all still live and reachable directly) now that **Discussions** (below) covers that role's AI use case; admin/vice_principal/teacher all keep the link, since Discussions is student-facing only and teachers still use AI Chat for general school queries.

Every assistant reply also gets a **Listen** button (`window.speechSynthesis`) that reads it aloud using the voice selected in Settings or AI Chat. English, Hindi and Telugu recognition/output follow the app language. The composer microphone performs review-before-send dictation. **Voice Beta** runs a hands-free listen → send → speak loop with live browser transcription when available and server transcription as a fallback. This remains a turn-based prototype rather than a streaming model-to-model Live API session, and speech quality depends on voices installed in the browser/operating system.

Replies render through `react-markdown` (compact custom component overrides sized for a chat bubble) instead of showing raw `**`/`#`/`---` as literal text — Gemini formats longer answers with Markdown by default, regardless of language. Before a reply reaches `SpeechSynthesisUtterance`, `lib/markdown.ts`'s `stripMarkdownForSpeech()` strips that same formatting, so **Listen** doesn't pronounce symbols like "asterisk asterisk". `/api/chat`'s `systemInstruction` also asks Gemini for lighter formatting suited to a small chat bubble in the first place, as a first line of defense.

Conversations are persisted (`../supabase/migrations/0019_ai_chat_history.sql` — `ai_chat_sessions`, `ai_chat_messages`, both RLS-scoped to `user_id = auth.uid()`). The last active conversation is remembered per signed-in user and restored on return; an explicitly selected blank draft remains blank until its first message. History supports search, Today/Yesterday/Older grouping, rename and delete. The client still resends the full message array to Gemini every turn (capped at 60 messages) — `POST /api/chat` additionally writes just the newest user message + reply to the DB each call, creating a session on the first message of a new chat and returning its id for later turns. Session management uses RLS-protected browser reads/updates/deletes, while migration `0021` restricts message rows to reads and leaves message writes to authenticated server routes.

**Guided lessons** (student-only, `../supabase/migrations/0026_guided_lessons.sql`) keep a student's chat anchored to their own curriculum instead of open-ended search. From `/ai-chat`, a student picks one of their enrolled subjects (`classes.id`), then optionally one of the chapters their teacher has actually published (the distinct `materials.chapter` values among that class's extracted uploads) — or continues with just the subject picked if none exist yet. Picking either opens a three-pane layout: a **materials** pane on the left (that chapter's extracted materials, with an inline PDF/image preview via a signed Storage URL — `materials`/`material_files`/the `materials` Storage bucket all gained new RLS policies scoping student `select` access to their own enrolled classes, since students previously had none at all), the chat in the middle, and a **videos** pane on the right — an embedded YouTube player (via `getVideoEmbedUrl()`, `shared/domain/learning.ts`) for every material in scope that has a teacher-attached `video_url` (see Materials above), or an empty state when none do. This replaced an earlier AI-notes pane (each material's `summary`) with teacher-curated video instead. `class_id`/`chapter` are stored on the `ai_chat_sessions` row so reopening a past guided lesson restores the same three-pane view; a plain dashboard-originated chat has neither set and opens as before.

Picking a subject is **mandatory** for any new conversation a student starts directly on `/ai-chat` — landing there with nothing restored, or pressing "New chat", opens the subject/chapter picker automatically, and the composer (attach/dictate/send, and the text input itself) stays disabled until a subject is chosen or an existing conversation is opened. History is exempt from this gate — a student can always open a past session (guided or plain) from **History** regardless, since it already carries its own context (or deliberately has none). The dashboard's free-form Lessons landing is also exempt, by design — a draft handed off from there sends immediately without requiring a subject first.

Evidence retrieval for a guided lesson skips the usual topic-planning Gemini call entirely — `chat_school_context` (`web/lib/ai/grounded-chat.ts`) is called directly with the selected `class_id`/`chapter`, deterministically returning every extracted material in that exact scope rather than hoping a free-text search matches the student's phrasing. The final answering prompt also gets an extra guardrail clause in this mode, instructing the model to stay strictly within the selected chapter and redirect off-topic questions back to it rather than answering them.

### Discussions

A separate feature from both AI Chat and Assignments (`../supabase/migrations/0028_discussions.sql` — `discussions`, `discussion_targets`, `discussion_threads`, `discussion_messages`), for pushing a curriculum topic to students as refresher/prep work before a formal assessment, with an AI-generated readiness report for the teacher afterward. It is this app's first per-student-targeted feature — Assignments/Exams/Learning Videos all remain whole-class only, by design; this doesn't change them.

From `/discussions`, a teacher picks a class, a title/chapter, existing extracted materials (checkbox multi-select, same data as the Materials section above), optional reference links (`{label, url}`, added via a label+URL pair and an "Add" button — pressing Enter in either field also adds it, rather than submitting the whole form), and instructions — with an optional **Draft with AI** button (`POST /api/discussions/draft`) that drafts the instructions from the selected materials, always reviewed/edited before publishing, never auto-published. The teacher then targets either the **whole class** or **specific students** (a new checkbox roster picker, querying `enrollments` the same way `RosterManager.tsx` does), and publishes (or saves as a draft). A link that's a YouTube/Vimeo URL (via `getVideoEmbedUrl()`, same helper as material `video_url`) renders as an embedded player in the student's Videos pane alongside any material videos — any other link renders as a plain "Open ↗" row.

A targeted student sees it on their own `/discussions` list and opens a two-pane view (`DiscussionChat.tsx`) — materials/links on the left (reusing the guided-lesson materials-preview pattern above, including inline video embeds), an AI chat on the right. Unlike AI Chat, the system prompt here (`web/lib/ai/discussion-chat.ts`) is deliberately **Socratic** — it asks follow-up questions and has the student explain ideas in their own words rather than just answering outright, since the transcript is later analyzed for understanding. A persistent "Are you done?" control plus a one-time idle-triggered modal (after 5 minutes of inactivity) both lead to **Submit discussion** (`POST /api/discussions/[id]/submit`); once submitted, the thread locks and can't be continued.

On submit, `generateDiscussionReport()` (`web/lib/ai/discussion-report.ts`) analyzes the full transcript into a readiness level (`needs_support`/`developing`/`on_track`/`strong`), a curiosity/engagement level, a summary, and strengths/gaps — plus an objectively computed `durationMinutes` (wall-clock time from first message to submission, not finer-grained active-time, since there's no tab-visibility tracking in this app). **This report is teacher-only and structurally unreachable by the student** — `discussion_threads` has no student-facing RLS select policy at all; a student reads their own thread only through `get_my_discussion_thread()`, a `security definer` function whose return type simply omits the `report` column, mirroring the masking technique `get_my_submissions()` already uses for grade-release gating. The teacher's discussion detail page lists every target student with a readiness/status badge, and opening one shows their full transcript + report, plus a **"Create a follow-up discussion for this student"** button that pre-fills a new, per-student-targeted discussion from there — deliberately another Discussion, never an Assignment, since Assignments remain untouched by this feature end to end.

**Status lifecycle** (`../supabase/migrations/0030_discussion_lifecycle_and_fixes.sql`) mirrors assignments' exactly (`getEffectiveDiscussionStatus()`, `shared/domain/discussions.ts`, the same two-layer pattern as assignments' own `getEffectiveStatus()`): `draft` → `published` → effectively `ended` once an optional `due_at` passes, or a teacher can End now / Cancel / Reopen / Reactivate / Delete permanently directly from the discussion's detail page, same controls as `AssignmentDetail.tsx`. Once effectively ended, `POST /api/discussions/[id]/message` rejects new messages (409) and the student's chat composer hides — the "Are you done?"/Submit control stays available even then, so a student mid-conversation when a teacher ends it can still submit what they have for a report, just can't add more to it.

Two RLS bugs surfaced and fixed post-launch, both the same underlying trap: a table's own policy inline-subquerying a *different* RLS-protected table whose policy (or, in the second case, whose simple absence of a student policy) blocks the read — `owns_class()`/`is_enrolled()` avoid this by being `security definer` functions, whose internal queries run as the function owner and bypass RLS entirely, so every cross-table check here now goes through its own such function instead of an inline subquery: (1) creating a discussion targeted at specific students threw "infinite recursion detected in policy for relation discussions" — `discussions`' student policy and `discussion_targets`' policies subquery each other directly; fixed via `owns_discussion()`/`is_discussion_target()` (`0029_fix_discussion_target_recursion.sql`). (2) A student's own chat history silently vanished on page reload — `discussion_messages`' student policy inline-subqueried `discussion_threads`, which has no student select policy at all (intentional, so `report` can never leak), so the subquery always saw zero rows; fixed via `owns_discussion_thread()` (`0030`, same migration as the status lifecycle above).

### Multi-language support

English, Hindi, and Telugu, UI chrome only (`messages/*.json`) — nav labels, dashboards, auth screens, Settings, AI Chat, and the full Assignments/Classes/Students/Timetable/Materials/Roster surface (including the create/generate forms and their sub-components); teacher-authored content, materials, and AI output are never translated — AI-generated content (chat replies, generated test questions) instead gets a language directive passed to Gemini via `systemInstruction` on the `generateContent` call (`/api/chat`, `/api/assignments/generate`), since a static dictionary can never cover text that's generated fresh each time.

Runs on **[next-intl](https://next-intl.dev)**, cookie-driven with no URL-based locale routing (an internal tool, not SEO-facing, so `next-intl`'s "without i18n routing" mode — see `i18n/request.ts`, which reads the `school-buddy-language` cookie and falls back to `en`). `components/LanguageProvider.tsx`'s `useLanguage()` and `lib/i18n/server.ts`'s `getServerT()` are kept as the app's stable call-site API (every component still does `const { t } = useLanguage()` / `const t = await getServerT()`) — they're thin wrappers over next-intl's own `useTranslations()`/`getTranslations()`, so migrating off the previous hand-rolled dictionary system touched zero of the ~25 files that call `t()`, only the provider/config layer. Switching language in **Settings** still writes the same cookie and calls `router.refresh()`; next-intl's `getRequestConfig` re-reads it on the next render.

A missing translation key throws loudly in development (`i18n/request.ts`'s `onError`) instead of silently rendering nothing — in production it falls back to the English string and logs a warning instead of crashing a real user's page. The actual build-time safety net is `npm run i18n:check` (`scripts/sync-i18n.mjs`, run from the repo root) — it fails if any locale is missing a key that `en.json` has, or if web's and mobile's copies of a locale have drifted; `npm run i18n:sync` copies `web/messages/*.json` (canonical) over `constants/i18n/*.json` (mobile's copy) to fix drift. Mobile runs the same JSON files through i18next instead (see root `README.md`'s Multi-language section) — ICU-style `{param}` interpolation is shared between both, but next-intl's ICU plural syntax (`{count, plural, one {...} other {...}}`) currently only works on web; mobile would need the separate `i18next-icu` plugin to match, not installed yet.

Not yet covered: admin-only account-management screens (`/admin/teachers`, `/admin/students`) and the newest Exams/Learning Videos management screens. Adding a language means adding a new `messages/<locale>.json`, running `npm run i18n:sync`, and adding the locale to `lib/i18n/index.ts`'s `Language` type/`LANGUAGE_LABELS` (and mirroring both in `constants/i18n/index.ts` and `lib/i18n.ts` on mobile) — no paid translation-management service is wired up; that's a deliberate future decision, not a blocker (the libraries themselves — next-intl, i18next — are free regardless of that choice).

### AI usage boundaries

Every AI-calling route (`/api/chat`, `/api/materials/extract`, `/api/assignments/generate`) is rate-limited per user (`lib/aiRateLimit.ts`, backed by `../supabase/migrations/0014_ai_rate_limits.sql`'s `ai_requests` table — a DB table rather than an in-memory counter so the limit holds across serverless instances/cold starts). Limits: chat 20 messages / 5 min, extraction and test generation 10 / hour each (a call to either is far more expensive — multimodal input or long-context generation — than one chat turn). Exceeding a limit returns `429` with a plain-English message; the client's existing error handling just displays it, no special UI needed.

This exists because the UI disabling a button while a request is in flight is a client-side nicety, not a real boundary — a direct API call with a valid session bypasses it entirely. `/api/chat` also hard-caps conversation length (60 messages) — it resends the full history every turn, so an unbounded conversation means unbounded per-turn cost.

## Notes

- Accounts are created by an administrator through `/admin/teachers` or `/admin/students`. Migration `0021_ownership_and_provisioning.sql` deliberately stops trusting ordinary user metadata for roles; manual privileged provisioning must set trusted app metadata or update the profile through a trusted SQL/admin process. There is no self-serve sign-up flow.
- Exams and Learning Videos are web-first MVP features backed by `0025_exams_and_learning_videos.sql`. Native screens are still planned.
- Replace `app/favicon.ico` with a real icon when branding assets are ready.
