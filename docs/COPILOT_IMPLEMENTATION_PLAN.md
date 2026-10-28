# Math Quiz: Detailed Copilot Implementation Specification

Prepared: 29 October 2026  
Status: planning document. Implementation and production deployment require the owner's instruction.

Save this file as docs/COPILOT_IMPLEMENTATION_PLAN.md in the actual repository. Use the prompts in section 23. Implement one authorized phase at a time and update docs/IMPLEMENTATION_PROGRESS.md after each phase.

MUST denotes a requirement. Defaults are deliberate decisions, not unanswered questions. Examples are target contracts, not claims that code already exists. Preserve working code and the owner's actual Firebase configuration.

## 1. Verified baseline and scope

This plan was grounded in axiom-quiz.zip version 4: 48 files; archive SHA-256:

~~~text
1ead9f1cd3f046f5599da9c06401eb08526acb3c544ff4256ccc09fa593571dd
~~~

The inspected application is plain HTML/CSS/native JavaScript ES modules. Its 41 existing unit tests passed while preparing the plan. Its optional Firestore emulator suite exists but was not rerun for this planning task. The live GitHub repository may have newer Copilot/user changes: reconcile it before editing.

### Current implementation

| Existing file | Actual responsibility | Required treatment |
|---|---|---|
| index.html, js/library.js | Device, bundled/GitHub and Firebase quiz library | Move catalog to quizzes.html; index becomes dashboard |
| login.html, js/account.js | Sign-in and profile in the same route | Split controllers/routes; wait for resolved Auth state |
| upload.html, js/upload.js | LaTeX/JSON import, preview, embedded images, local/cloud saves | Keep importer/preview; replace persistence and introduce problem records |
| quiz.html, js/quiz.js | Local attempts/timing, client grading/self-marking, result sync | Keep presentation; backend owns attempts/time/grading |
| js/firebase-client.js | Firebase 13.1.0 browser SDK, Auth and Firestore | Add Functions/Storage and explicit session readiness |
| js/firebase-core.js | Config validation, permission helpers, return URLs | Keep safe validation; remove unconfigured local-authoring fallback |
| js/cloud-repository.js | Direct Firestore writes of entire serialized quizzes/results | Replace normal use with callable API adapter |
| js/storage.js | IndexedDB quizzes/drafts/account-scoped attempts | Retain only behind one-time migration reader |
| js/published-catalog.js | GitHub contents API and bundled JSON discovery | Retire from normal runtime after migration |
| js/core.js | Quiz validation, bounded arithmetic, grading, shuffle/time helpers | Extract/reuse pure logic with regression coverage |
| js/parser.js | Structured LaTeX importer | Preserve supported syntax and behavior |
| js/render.js, js/math-config.js | Escaped prose/math rendering and MathJax | Preserve; adapt authorized image resolution |
| assets/mathjax.js and license | Bundled MathJax 3.2.2 | Preserve unless a tested upgrade is separately justified |
| assets/app.css | Main stylesheet, 3,636 lines in inspected archive | Split foundations/components/page styles |
| js/common.js | Shell, navigation, dialogs, guide and utilities | Extract focused components; staff-only guide |
| firebase/firestore.rules | v1 roles, quiz documents, client-reported results | Replace together with v2 backend and migration |
| scripts/build.mjs | Copies static files, generates old catalog | Copy new pages/shared code; stop publishing legacy key bundles |
| settings.html | Legacy redirect | Redirect to profile appearance |

Current Firestore layout:

~~~text
roles/{uid}
quizzes/{quizId}
quizzes/{quizId}/content/main        // serialized JSON, embedded images and keys
users/{uid}/attempts/{attemptId}     // client-reported completed results
~~~

The current 900,000-byte cloud limit belongs to the old single-content-document layout. It MUST NOT become the total quiz limit after questions/images are separated.

Already-working features include MathJax preview, typed-answer math preview, safe numeric evaluation, question/option shuffling and timer recovery. Do not describe these as new inventions or replace them casually.

### Scope

In scope: Firebase-only normal persistence; separate assets; reusable problems; teacher ownership; drafts/revisions; public/private access; applications; participant approval; trusted attempts/grading; teacher reports; answer-change history; admin activity; separate Home; role-aware navigation; bright mobile UI; migration; tests and deployment documentation.

Out of scope: AI/PDF extraction and marking, general symbolic proof checking, proctoring, payments, chat, class/organization management, native apps and framework migration.

Hosting stays GitHub Pages, Deploy from a branch, main / root. Do not introduce a custom Pages Actions workflow as a prerequisite. Backend deployment is separate.

## 2. Product decisions and defaults

### Accounts

- Guests can browse Home/public quiz overviews.
- Starting recorded attempts and requesting access require a signed-in, verified, active account.
- New accounts are students; no self-selected teacher/admin role.
- Teachers retain student capabilities and manage their own content/participants/results.
- Admins manage all content, roles, accounts and activity.
- Teachers cannot read another teacher's private bank or submissions.
- The owner teacher can inspect saved in-progress answers and saved change times. Tell students before starting.
- Demotion removes privileged access on the next backend request. Data is retained for admins.

### Quiz concepts

Keep lifecycle, draft, publication, visibility, access mode and availability distinct:

1. lifecycle: active or trashed.
2. draft: editable working content.
3. published revision: immutable student-facing snapshot.
4. visibility: private or public.
5. accessMode: approval or open.
6. availability: opening/closing dates and attempt allowance.

| Visibility | Mode | Public catalog | Participation |
|---|---|---|---|
| private | approval | Hidden | Explicitly approved users |
| public | approval | Safe overview | Approved users |
| public | open | Safe overview | Eligible signed-in users except individually blocked users |
| private | open | Invalid | Reject the combination |

New quizzes are private approval drafts with no published revision. A private quiz can be published for approved users. Students never read the working draft.

~~~json
{
  "durationSeconds": 1200,
  "shuffleQuestions": false,
  "shuffleOptions": false,
  "allowBack": true,
  "penalty": 0,
  "maxAttempts": 1,
  "opensAt": null,
  "closesAt": null,
  "scoreRelease": "immediate",
  "solutionRelease": "manual"
}
~~~

maxAttempts=null means unlimited. Duration 0 means untimed, but a closing date still ends the attempt. afterClose release requires a closing timestamp. Teachers may deliberately select immediate solutions for practice.

### Access decisions

- One participant record per quiz/UID.
- States: none, pending, approved, declined, revoked.
- Declined/revoked override public-open access. The open-quiz “Block” action sets revoked.
- Pending grants no questions/images.
- Declined/revoked users cannot repeatedly reapply; teacher can reopen or approve directly.
- Revocation prevents new attempts; an already active attempt may finish under its captured grant/deadline.
- Ending an active attempt is a separate explicit action.
- Unpublish/visibility/Trash changes block new starts without deleting active/completed attempts.
- Disabling an account blocks new privileged requests, including active answer saves.

### Problem reuse and history

- Problems have independent ownership and immutable revisions.
- Bank visibility is private or teachers; it is separate from quiz visibility.
- Teachers may use owned problems and problems deliberately shared with teachers.
- Only source owner/admin edits the original. Other teachers can fork with attribution.
- Published quizzes pin versions and slot-specific points.
- Source edits/unsharing/archiving do not alter previously published snapshots.
- New source selections require current reuse permission; unchanged already-authorized quiz snapshots can be republished.
- Firebase is the only normal database. Remove “On device,” “Save on device” and normal GitHub catalog fallback.
- Temporary previews/recovery are allowed but never called Saved until the server confirms.
- Exports are backups/reports, not another library.
- Trash restore defaults to private approval.
- Retain history and referenced content; hard deletion cannot silently erase students' records.

## 3. Architecture and trust boundaries

Use the existing native ES-module frontend. Add Firebase Functions 2nd gen using JavaScript ES modules and Node.js 22. Use JSDoc/shared validators instead of requiring frontend compilation.

| Component | Authority |
|---|---|
| Browser | Rendering, input, LaTeX preview, calling APIs |
| Firebase Auth | Identity and session |
| Cloud Functions | Ownership/role decisions, mutations, deadlines, grading, release, jobs |
| Firestore | Structured canonical records and audit history |
| Storage | Immutable images/source files and restricted staging uploads |
| GitHub Pages | Public static website files |

### Browser restrictions

The browser MUST NOT create authoritative scores, roles, approvals, owners, deadlines or audit records. Direct Firestore reads are limited to section 16. All other data access uses authorized backend APIs.

Student question DTOs contain statement/options/points and question-image bindings only. Exclude keys, model solutions, rubrics, solution-image IDs and internal notes. Student result DTOs apply score/solution release independently. Never return raw protected documents using object spread.

### Shared code packaging

Canonical pure code lives in root shared/. Browser modules import it relatively. scripts/sync-functions-shared.mjs copies it into functions/shared/ before backend tests/deploy. That generated mirror belongs inside the deployable Functions directory.

Server code must not depend on files outside its deployment source. Test that the mirror matches canonical files. Do not independently maintain two grading algorithms.

### Configuration

- Preserve the actual js/firebase-config.js. The supplied archive's config is empty; the user's repo may be configured.
- Add js/app-config.js for API version, Functions region and explicitly enabled local emulator settings.
- Match the actual project's region; europe-west1 is the proposed default for a new project. Keep client/server settings aligned.
- Use Firebase-managed backend credentials, never committed service-account keys.
- Missing production config shows a neutral unavailable state, not a visitor connection wizard/local fallback.
- Development uses demo-mathquiz-v2 emulators. An emulator failure must never silently call production.
- Every privileged handler reads current canonical role/account status. Admin SDK bypasses Firestore rules, so handlers need complete authorization.

## 4. Target files and concrete rewiring

Create these paths in the phase that uses them, rather than generating empty scaffolding everywhere.

~~~text
index.html                       dashboard
quizzes.html                     public/available catalog
login.html                       sign-in/register/reset
profile.html                     account/appearance
activity.html                    applications/attempts/results
teaching.html                    teacher workspace
quiz-manage.html                 Content/Access/Results/History
problems.html                    reusable bank
problem-edit.html                individual problem
upload.html                      quiz editor/import; preserve route
quiz.html                        overview/start/runner
results.html                     authorized attempt review
access.html                      private request link
admin.html                       users/activity/content/jobs
guide.html                       staff guide
settings.html                    compatibility redirect

assets/css/tokens.css
assets/css/base.css
assets/css/layout.css
assets/css/components.css
assets/css/pages/{home,catalog,account,editor,quiz,reports,admin}.css

js/app-config.js
js/firebase-client.js
js/firebase-core.js
js/core/{session,navigation,errors,format}.js
js/services/{api,assets,recovery}.js
js/components/{shell,dialog,feedback,math-content}.js
js/pages/{home,catalog,login,profile,activity,teaching,quiz-manage}.js
js/pages/{problems,problem-edit,quiz-editor,quiz,results,access,admin,guide}.js
js/migration/legacy-device.js

shared/{schema,validation,grading,numeric,latex-parser,asset-references,constants}.js

functions/package.json
functions/package-lock.json
functions/src/index.js
functions/src/config.js
functions/src/api/{accounts,problems,quizzes,access,attempts,reports,assets,admin}.js
functions/src/domain/{authorization,idempotency,publication,attempts,audit,retention}.js
functions/src/jobs/{worker,sweeper}.js
functions/src/repositories/{firestore,storage}.js
functions/shared/                generated mirror
functions/test/

firebase/{firestore.rules,firestore.indexes.json,storage.rules}
firebase/storage-cors.example.json
scripts/{sync-functions-shared,seed-emulators,migrate-v1,bootstrap-admin,verify-static}.mjs
tests/{unit,integration,rules,e2e}/
docs/{COPILOT_IMPLEMENTATION_PLAN,IMPLEMENTATION_PROGRESS,MIGRATION,OPERATIONS}.md
~~~

### Existing-function changes

| Existing entry point | Target |
|---|---|
| account.js formPage/accountPage dispatch | Wait for resolved Auth, separate login/profile |
| firebase-client.js watchSession/initFirebase | Explicit authResolved/roleResolved, UID-safe subscriptions |
| firebase-core.js canCreateQuiz/canPublish | Confirmed active verified staff only |
| common.js mountShell/mountAccountNav/showGuide | Role navigation, direct profile, staff-only guide |
| upload.js parseSource/renderPreview | Preserve parser/math preview; normalize import into problems |
| upload.js performCloudUpload | Save/import/publish APIs and durable job status |
| quiz.js start/makeAttempt use | startAttempt API returns authoritative ID/order/settings |
| quiz.js tick/startTimer | Paint backend deadline; browser cannot extend it |
| quiz.js answer handlers | Version-checked saveAnswers queue |
| quiz.js finish | Flush pending saves, submitAttempt, show server state |
| quiz.js scheduleResultSync/syncResult | Remove client-generated authoritative result upload |
| quiz.js renderResults/renderReview | Released backend DTOs; no student self-marking |
| storage.js loadQuiz/getCatalog | Normal API path; old code only behind migration |

Copy the existing library into quizzes.html before replacing index.html. Keep common.js as a temporary re-export adapter during extraction. Preserve old quiz.html?id=cloud-... links.

Do not feed student DTOs into old validateQuiz: it requires keys/base64 assets. Retain validateLegacyQuizV1 for migration/import, and add separate v2 validators. Do not merely change the old schema constant to 2.

When content is paginated, use the server's totalPoints/itemCount, not the sum of currently loaded questions.

Build copies all new public pages, js/, assets/ and shared/. Exclude backend/test/migration data and legacy key bundles from dist. Root-branch hosting also exposes repository files: never commit credentials/private exports.

## 5. Conventions, types and limits

- schemaVersion=2 for new entities; preserve legacy provenance.
- Random server IDs: cloud- quizzes, prb_ problems, prv_ problem revisions, qrv_ quiz revisions, itm_ slots, att_ attempts, ast_ assets, job_ jobs.
- Preserve old cloud- IDs.
- ownerId always comes from authenticated server context.
- Timestamps are server Firestore timestamps; APIs serialize ISO-8601 UTC strings/null.
- Format scheduled times with timezone in UI.
- Mutable aggregates have integer version; stale expectedVersion fails.
- Reject unknown fields, unsafe/prototype IDs and excessive data. Never silently truncate math.
- Persist asset IDs/paths, not permanent download URLs.

| Application limit | Default |
|---|---|
| Problems per quiz | 1–500 |
| Choices | 2–12, exactly one correct |
| Statement/explanation | 30,000 characters each plus byte cap |
| Choice text | 10,000 characters |
| Accepted short answers | Up to 30, each 500 characters |
| Student short/written response | 500 / 10,000 characters |
| Problem content + grading | 250,000 UTF-8 JSON bytes |
| Any application Firestore document | Below 700,000 encoded bytes |
| Image | 4 MiB PNG/JPEG/WebP/GIF, at most 16 megapixels; no SVG/HTML |
| Source/legacy import | 20 MiB |
| Tags | 12, each 60 characters |
| Listing page | Default 25, maximum 100 |
| Question response page | Maximum 20 items and approximately 1 MiB |
| Answer-save batch | Maximum 20 changes and 256 KiB |
| Points per slot | >0 and <=1,000 |
| Duration | 0–86,400 seconds |
| Active attempt | One per quiz/student |
| Asset signed link | 120 seconds |

These are application choices, not platform maximum claims. Chunk large operations by both bytes and count.

Enums:

~~~text
Role: student | teacher | admin
AccountStatus: active | disabled
BankVisibility: private | teachers
Lifecycle: active | trashed
QuizVisibility: private | public
AccessMode: approval | open
AccessStatus: none | pending | approved | declined | revoked
RevisionState: building | ready | failed
AttemptStatus: active | submitted | timed_out | terminated | abandoned
GradeState: not_started | queued | running | pending_manual | final | failed
ScoreRelease: immediate | afterClose | manual
SolutionRelease: immediate | afterClose | manual | never
JobStatus: queued | running | succeeded | failed | cancelled
AssetStatus: awaiting_upload | processing | ready | failed | deleting
~~~

## 6. Firestore schema

The following are typed contracts. Optional fields must be explicitly declared by validators. Protected records never become client DTOs by generic spreading.

### users/{uid}

~~~ts
type UserRecord = {
  schemaVersion: 2; uid: string; displayName: string; email: string;
  emailVerified: boolean; version: number;
  createdAt: Timestamp; updatedAt: Timestamp; lastSeenAt: Timestamp;
  preferences: {theme: "light"|"dark"|"system"; textScale: 1|1.125|1.25};
  searchName: string; searchEmail: string;
};
~~~

Email/verification reflect Auth. updateProfile accepts displayName/preferences only. After provisioning, the application display name is canonical; an older provider name cannot overwrite a saved profile name. Auth profile synchronization can retry separately.

Throttle lastSeenAt updates to once per 15 minutes. It is not proof of continuous studying or online presence.

### roles/{uid}

~~~ts
type RoleRecord = {
  role: "student"|"teacher"|"admin";
  accountStatus: "active"|"disabled";
  version: number; updatedAt: Timestamp; updatedBy: string;
};
~~~

Canonical authority. Missing role safely means ordinary student until getSessionInfo provisions it. Never replace an existing legacy teacher/admin role with student.

system/accessControl contains activeAdminCount/version. Role/status changes update it transactionally to prevent removing the last active admin.

### problems/{problemId}

~~~ts
type ProblemRecord = {
  schemaVersion: 2; ownerId: string; ownerDisplayName: string;
  title: string; searchTitle: string; subject: string; difficulty: string; tags: string[];
  bankVisibility: "private"|"teachers"; lifecycle: "active"|"trashed";
  latestRevisionId: string; revisionNumber: number; version: number;
  sourceProblemId: string|null; sourceProblemRevisionId: string|null;
  createdAt: Timestamp; updatedAt: Timestamp; trashedAt: Timestamp|null;
};
~~~

Listing record contains neither keys nor full statement bodies.

### problems/{problemId}/revisions/{problemRevisionId}

~~~ts
type ProblemRevision = {
  schemaVersion: 2; revisionNumber: number; createdBy: string; createdAt: Timestamp;
  type: "choice"|"open"; answerMode: "auto"|"manual";
  statementLatex: string;
  options: Array<{id: string; textLatex: string}>;
  defaultPoints: number;
  questionAssetBindings: Record<string, string>; // filename -> assetId
  source: {importJobId: string|null; sourceAssetId: string|null;
           originalQuestionId: string|null};
  contentHash: string;
};
~~~

options is empty for open questions. Revision is immutable. Hash is server-computed over canonical validated content.

Protected grading is at .../revisions/{problemRevisionId}/grading/main:

~~~ts
type ProblemGrading = {
  gradingVersion: 1; correctOptionId: string|null;
  acceptedAnswers: string[]; tolerance: number;
  explanationLatex: string; rubricLatex: string;
  solutionAssetBindings: Record<string, string>;
  createdAt: Timestamp;
};
~~~

Sharing one problem does not expose the entire original .tex file, which may include other private problems/keys.

### quizzes/{quizId}

~~~ts
type QuizRecord = {
  schemaVersion: 2; ownerId: string; ownerDisplayName: string;
  title: string; searchTitle: string; description: string;
  subject: string; difficulty: string;
  lifecycle: "active"|"trashed"; visibility: "private"|"public";
  accessMode: "approval"|"open";
  opensAt: Timestamp|null; closesAt: Timestamp|null; maxAttempts: number|null;
  publishedRevisionId: string|null;
  draftVersion: number; version: number; publishingJobId: string|null;
  createdAt: Timestamp; updatedAt: Timestamp;
  publishedAt: Timestamp|null; trashedAt: Timestamp|null;
};
~~~

Root controls discovery/new starts. Revision controls content/grading of existing attempts. Root title is a management label; public overviews/catalog use the published revision, never an unpublished draft title.

### quizzes/{quizId}/drafts/current and draftItems/{itemId}

~~~ts
type QuizSettings = {
  durationSeconds: number; shuffleQuestions: boolean; shuffleOptions: boolean;
  allowBack: boolean; penalty: number;
  scoreRelease: "immediate"|"afterClose"|"manual";
  solutionRelease: "immediate"|"afterClose"|"manual"|"never";
};
type QuizDraft = {
  version: number; title: string; description: string;
  subject: string; difficulty: string;
  itemOrder: string[]; settings: QuizSettings;
  updatedAt: Timestamp; updatedBy: string;
};
type DraftItem = {
  itemId: string; problemId: string; problemRevisionId: string;
  points: number; reuseFromQuizRevisionId: string|null;
};
~~~

DraftItem records live at quizzes/{quizId}/draftItems/{itemId}. Reuse provenance is server-derived. Slot IDs identify appearances, not problems: one problem can appear twice with two slots/answers.

Save bounded changed items and version the draft. Do not rewrite 500 unchanged documents on every keystroke.

### quizzes/{quizId}/revisions/{quizRevisionId}

~~~ts
type QuizRevision = {
  schemaVersion: 2; state: "building"|"ready"|"failed";
  revisionNumber: number; publicationJobId: string; sourceDraftVersion: number;
  title: string; description: string; subject: string; difficulty: string;
  settings: QuizSettings; itemOrder: string[];
  itemCount: number; totalPoints: number; manifestHash: string;
  createdBy: string; createdAt: Timestamp; readyAt: Timestamp|null;
};
~~~

Student-facing immutable snapshots live at .../items/{itemId}: statement, options, type, answer mode, question asset bindings and effective points. Teacher attribution references are stored but omitted from student DTOs.

Protected key snapshots live separately at .../grading/{itemId}: correct option/accepted answers/tolerance/model solution/rubric/solution bindings/grading version.

This materialization preserves quizzes if the original bank owner later unshares/deletes their listing.

### catalog/{quizId}

~~~ts
type CatalogEntry = {
  quizId: string; title: string; searchTitle: string; description: string;
  ownerDisplayName: string; subject: string; difficulty: string;
  durationSeconds: number; questionCount: number; totalPoints: number;
  accessMode: "open"|"approval";
  opensAt: Timestamp|null; closesAt: Timestamp|null;
  publishedRevisionId: string; updatedAt: Timestamp;
};
~~~

Exists only for active public quizzes with a ready publication. Catalog/root changes commit together. No student identities, keys, notes or owner email.

### quizzes/{quizId}/participants/{uid}

~~~ts
type Participant = {
  quizId: string; quizOwnerId: string; uid: string;
  accessStatus: "none"|"pending"|"approved"|"declined"|"revoked";
  requestMessage: string; requestedAt: Timestamp|null;
  decidedAt: Timestamp|null; decidedBy: string|null; decisionReason: string;
  attemptCount: number; extraAttempts: number;
  activeAttemptId: string|null; latestAttemptId: string|null;
  version: number; updatedAt: Timestamp;
};
~~~

Do not reset counts by deleting participants. Grant additional allowance through an audited command.

joinLinks/{sha256(token)} stores quizId/creator/createdAt/expiresAt/revokedAt. Generate 32 random bytes, base64url encode; store only hash. Default expiry 30 days. Link allows applying, never self-approval.

### attempts/{attemptId}

~~~ts
type Attempt = {
  schemaVersion: 2;
  studentId: string; studentDisplayName: string; studentEmail: string;
  quizId: string; quizOwnerId: string; quizRevisionId: string; quizTitle: string;
  ordinal: number; attemptKind: "standard"|"retry_incorrect";
  sourceAttemptId: string|null;
  status: "active"|"submitted"|"timed_out"|"terminated"|"abandoned";
  gradeState: "not_started"|"queued"|"running"|"pending_manual"|"final"|"failed";
  startedAt: Timestamp; deadlineAt: Timestamp|null; closedAtSnapshot: Timestamp|null;
  submittedAt: Timestamp|null; finalizedAt: Timestamp|null; lastSavedAt: Timestamp|null;
  currentFrontier: number;
  uiState: {currentIndex: number; flaggedItemIds: string[]; version: number};
  order: string[]; optionOrder: Record<string, string[]>;
  settingsSnapshot: QuizSettings;
  answeredCount: number; answerVersion: number; gradeVersion: number;
  scoreReleasedAt: Timestamp|null; solutionsReleasedAt: Timestamp|null;
  terminationReason: string|null;
  provenance: "server_v2"|"legacy_client_v1";
  totals: {
    score: number|null; possible: number; percentage: number|null;
    correct: number; incorrect: number; skipped: number; pending: number; partial: number;
  };
};
~~~

Never return raw Attempt to student. Serialize a released DTO.

Current answers: attempts/{attemptId}/answers/{itemId}:

~~~ts
type SavedAnswer = {
  value: string; revision: number; updatedAt: Timestamp;
  lastRequestId: string; updatedBy: string;
};
~~~

History: .../answers/{itemId}/changes/{changeId} contains value/revision/savedAt/actorId/requestId. Immutable, server-timestamped saved revisions.

Grades: attempts/{attemptId}/grades/{itemId}:

~~~ts
type ItemGrade = {
  status: "correct"|"incorrect"|"skipped"|"pending"|"partial";
  awarded: number; possible: number; manualPoints: number|null;
  gradedBy: string; gradingVersion: number;
  feedbackLatex: string; updatedAt: Timestamp; version: number;
};
~~~

manualPoints is teacher input 0..possible; awarded is effective contribution after penalty. They may differ for a zero manual mark. Grade corrections append .../gradeEvents/{eventId} with before/after, actor, reason, time.

### assets/{assetId}

~~~ts
type Asset = {
  ownerId: string; kind: "image"|"source"; originalName: string;
  declaredContentType: string; expectedBytes: number;
  status: "awaiting_upload"|"processing"|"ready"|"failed"|"deleting";
  stagingPath: string; storagePath: string|null; generation: string|null;
  contentType: string|null; sizeBytes: number|null; sha256: string|null;
  width: number|null; height: number|null;
  expiresAt: Timestamp; createdAt: Timestamp; readyAt: Timestamp|null;
  referenceCount: number; version: number;
};
~~~

assets/{assetId}/refs/{deterministicRefId} records targetType/targetId/targetRevisionId/createdAt. Create/remove refs and touch the asset root transactionally so new refs cannot race deletion. A counter alone is insufficient.

### Jobs, audit and supporting data

~~~ts
type Job = {
  kind: string; requestedBy: string; requestId: string; targetId: string;
  status: "queued"|"running"|"succeeded"|"failed"|"cancelled";
  input: object; // validated immutable references, no executable input
  progress: {processed: number; total: number; stage: string};
  processedCursor: string|null; leaseOwner: string|null; leaseExpiresAt: Timestamp|null;
  retryCount: number; createdAt: Timestamp; updatedAt: Timestamp; completedAt: Timestamp|null;
  result: object; // IDs/counts/hashes, no permanent URLs
  error: {reason: string; message: string; retryable: boolean}|null;
};
~~~

| Path | Purpose |
|---|---|
| jobs/{jobId} | Durable resumable work |
| auditEvents/{eventId} | Server event: actorId/actorRoleAtTime/action/targetType/targetId/quizId/quizOwnerId/affectedUserId/changedFields/requestId/occurredAt |
| users/{uid}/notifications/{id} | Event-derived in-app notification/readAt |
| operations/{uid}/requests/{requestId} | action/inputHash/status/resource/job IDs/timestamps |
| system/accessControl | Last-active-admin counter/version |
| usage/{uid} | Reserved/finalized bytes and quota |
| rateLimits/{bucketId} | Server-owned action limits |
| migrationRuns/{runId} | Source hashes/mappings/status/errors/rollback metadata |

Audit feeds never contain full answers, tokens or signed URLs. Details stay in protected resource histories.

Default teacher upload budget is 1 GiB finalized plus reserved bytes; admin-configurable application cap, not a Firebase free quota.

## 7. Storage lifecycle and image authorization

### Paths

~~~text
staging/{uid}/{assetId}/original
assets/{ownerId}/{assetId}/image.{png,jpg,webp}
sources/{ownerId}/{assetId}/original.tex
exports/{requesterUid}/{jobId}/results.csv
exports/{requesterUid}/{jobId}/quiz-backup.zip
~~~

Server chooses extensions from decoded bytes. User filenames never choose arbitrary paths.

### Upload algorithm

1. createAssetUpload checks current verified active staff, rate/byte budget; reserves bytes and creates awaiting_upload record.
2. Return exact staging path, assetId and one-hour expiry.
3. Browser uploads with uploadBytesResumable; show actual transferred bytes.
4. finalizeAssetUpload verifies ownership/reservation, actual size/type/signature/dimensions and computes checksum.
5. Decode/re-encode using a pinned maintained decoder such as sharp. Preserve mathematical PNG labels losslessly. Flatten animated GIFs with a visible conversion notice.
6. Write immutable final object, strip permanent download-token metadata, set private cache metadata.
7. Mark ready with canonical generation/path/dimensions/bytes/hash; adjust quota and write one asset.uploaded event.
8. Ready assets may enter saved publications. Failures stay recoverable; never claim success with missing assets.

No SVG/HTML, arbitrary external URL fetching or TeX execution. Source .tex remains owner/admin-only.

### Asset links

getAssetLinks accepts:

~~~ts
{
  context: {
    kind: "problem"|"quiz_draft"|"attempt"|"result"|"source";
    id: string; revisionId: string|null;
  };
  assetIds: string[]; // at most 20
}
~~~

Authenticate, authorize the context, verify each asset is referenced there, and return generation-pinned read-only V4 signed URLs valid 120 seconds. Active attempts receive question assets only. Solutions require result-release permission.

Never sign arbitrary client storagePath input. Sharing one problem does not permit downloading its full original source file.

This central policy avoids trying to fit enrollment/version/release logic into Storage's small cross-service rule lookup budget. Existing signed links may remain usable until expiry; new links are denied after access loss. Previously downloaded bytes cannot be recalled.

Keep URLs in memory only, refresh when needed, omit from database/logs/recovery. Use no-referrer. Configure necessary CORS origins for downloads/canvas/export; origins do not include GitHub repository paths.

Inject AssetUrlSigner. Production signs real links; emulator-only adapter supports tests without cloud credentials. It must be unreachable in production. Verify real IAM/signing/CORS in a test project.

### Cleanup

Expired unreferenced staging objects are swept and reservations released. Ready objects cannot be overwritten. Mark deleting only after transactional ref checks; new refs reject deleting assets. Use object generation preconditions. Missing objects are successful retry cases.

Retain assets needed by snapshots/attempts/history. No broad lifecycle deletion of all final assets. Deleting a Firestore parent does not automatically delete subcollections or Storage objects.

## 8. Permission policy

Implement/test central predicates before wiring screens:

~~~text
requireUser
requireVerifiedActiveUser
requireTeacher
requireAdmin
canManageQuiz
canReadProblem
canReuseProblemRevision
canRequestAccess
canStartAttempt
canReadAttempt
canSaveAnswers
canGradeAttempt
canRevealScore
canRevealSolutions
canReadAssetInContext
~~~

Context comes from validated Auth plus current roles/{uid}; client flags are never authority.

### Authoritative start policy

~~~text
require verified active caller
load quiz and ready published revision
reject trashed/unpublished quiz
reject before opening or at/after closing
load participant, default none/count zero
reject declined/revoked even when public-open
require approved when private or approval mode
if activeAttemptId is live: return it, do not increment
if active attempt expired: close it, return ATTEMPT_EXPIRED
compute allowance = maxAttempts + extraAttempts, unless unlimited
reject exhausted allowance
allocate one attempt and increment counter atomically
~~~

Teacher preview creates no student attempt. Taking someone else's quiz follows ordinary admission.

| Action | Student | Teacher | Admin |
|---|---|---|---|
| Public overview | Yes, also guest | Yes | Yes |
| Apply/start | According to policy | Same policy | Same for recorded attempts |
| Released own result | Yes | Yes | Yes |
| Create/edit problems | No | Own | All |
| Shared teacher bank | No | Read/reuse | All |
| Edit another original | No | No | Yes |
| Manage quiz/access/results | No | Own quizzes | All |
| Saved answer/history | Own attempt | Own quiz's attempts | All through admin APIs |
| Roles/disable/global activity | No | No | Yes |
| Guide app entry/route | No | Yes | Yes |

Private IDs without grant/link produce generic unavailable responses. Valid private application link exposes only minimal application title/teacher summary, never questions/participants/keys.

Guide restriction is UI/route behavior. Public GitHub source is not a secrecy boundary for static documentation. Sensitive quiz data is backend-protected.

## 9. Callable API contracts

Use Firebase httpsCallable through js/services/api.js. Do not replace these with unauthenticated ad-hoc HTTP routes.

Every request has apiVersion:2. Explicit mutations also have requestId (UUID created once per user action and reused on retries). getSessionInfo's deterministic UID-keyed self-provisioning is the exception.

~~~json
{
  "apiVersion": 2,
  "requestId": "3cb5d514-a76f-4c6c-8b39-a22ed055cf09",
  "quizId": "cloud-exampleQuiz01234567",
  "expectedVersion": 4
}
~~~

Success envelope:

~~~json
{
  "apiVersion": 2,
  "serverTime": "2026-10-29T12:00:00.000Z",
  "data": {"version": 5}
}
~~~

Use HttpsError with stable details.reason, not English-message parsing. Reasons: AUTH_REQUIRED, EMAIL_UNVERIFIED, ACCOUNT_DISABLED, ROLE_REQUIRED, RESOURCE_UNAVAILABLE, VERSION_CONFLICT, INVALID_FIELDS, ACCESS_PENDING, ACCESS_DECLINED, ACCESS_REVOKED, QUIZ_NOT_OPEN, QUIZ_CLOSED, ATTEMPT_LIMIT, ATTEMPT_EXPIRED, ATTEMPT_FROZEN, ASSET_NOT_READY, QUOTA_EXCEEDED, RATE_LIMITED.

Map to unauthenticated/permission-denied/not-found/invalid-argument/aborted/failed-precondition/resource-exhausted/unavailable. A conflict returns actualVersion/expectedVersion.

Listings accept limit/cursor, return items/nextCursor. Validate opaque cursors and reapply all authorization filters. Cursors never grant access.

### Retry contract

operations/{uid}/requests/{requestId} stores action/inputHash/status/resource/job IDs. Same ID+input returns the same result; same ID+different input fails. Generate IDs outside retrying transactions. No external uploads/notifications inside transaction callbacks. Database audit/notification IDs are deterministic.

Long operations return durable job IDs. Do not expire receipts while jobs can still retry. Keep deterministic resource mappings for create/import/start operations.

### Accounts and dashboard

| Function | Input after envelope | Output data |
|---|---|---|
| getSessionInfo | none | Profile, role/status, capabilities, API version |
| updateProfile | displayName/preferences patch, expectedVersion | Updated allowed fields/version |
| getDashboard | none | Scoped real counts and <=5 recent items/section |
| listMyNotifications | limit/cursor | Own notifications |
| markNotificationRead | notificationId | readAt |
| listUsers | Admin role/status/search/limit/cursor | Minimal user summaries |
| setUserRole | Admin targetUid/role/expectedVersion/reason | New role/version |
| setAccountStatus | Admin targetUid/status/expectedVersion/reason | New status/version |

Provision missing student/profile records safely. Never make the first visitor admin. Never accept role/emailVerified/quota in updateProfile.

### Problems

| Function | Input | Output |
|---|---|---|
| listProblems | view mine/shared, title prefix, subject/difficulty/tag, lifecycle, page | Bank listings |
| getProblem | problemId, optional revisionId | Authorized content/key revision |
| createProblem | metadata, content, grading | problemId/revisionId/version |
| saveProblemRevision | problemId, expectedVersion, metadata/content/grading | New immutable revision/version |
| setProblemSharing | problemId/visibility/expectedVersion | Updated listing |
| forkProblem | problemId/revisionId/optional title | Owned fork + attribution |
| trashProblem / restoreProblem | problemId/expectedVersion | Lifecycle/version |
| listProblemRevisions | problemId/page | Revision summaries |

metadata accepts title/subject/difficulty/tags/bankVisibility. content accepts type/answerMode/statementLatex/options/defaultPoints/questionAssetBindings. grading accepts the fields in section 6. Ownership/provenance comes from the server.

### Quiz and import

| Function | Input | Output |
|---|---|---|
| listPublicQuizzes | title prefix/subject/page | Safe catalog; guest allowed |
| listAvailableQuizzes | page | Approved available quizzes for caller |
| getQuizOverview | quizId, optional joinToken | Safe overview and eligibility reason |
| listMyQuizzes | lifecycle/visibility/title prefix/page | Owned management list |
| getQuizDraft | quizId | Draft metadata/order/refs/versions |
| getQuizDraftItems | quizId/itemIds <=20 | Bounded author preview with keys |
| listQuizRevisions | quizId/page | Owned/admin history |
| previewQuizRevision | quizId/revisionId/itemIds/includeKeys | Staff preview, no student attempt |
| createQuiz | optional title | Private empty quiz/root+draft version |
| saveQuizDraft | quizId/expectedDraftVersion/patch/upsertItems/removeItemIds/itemOrder | New version/item ID mappings |
| publishQuiz | quizId/expectedDraftVersion/expectedVersion | Publication job ID |
| getJob | jobId | Authorized status/progress/result/error |
| setQuizAccessPolicy | quizId/expectedVersion/visibility/mode/window/maxAttempts | New effective root policy/version |
| unpublishQuiz | quizId/expectedVersion | Cleared live pointer; history retained |
| duplicateQuiz | quizId/source draft or published/expectedVersion | New private owned quiz |
| trashQuiz / restoreQuiz | quizId/expectedVersion | Lifecycle/version; restore private |
| createImportJob | name/sourceAssetId/schema/itemCount | Import job |
| importProblemBatch | jobId/batchKey/records | Stable item/problem/revision mappings |
| finishImportJob | jobId/metadata/settings/order | Private quiz or updated draft |
| exportQuizBackup | quizId/optional revisionId | Authorized ZIP job |

saveQuizDraft changes <=20 items per call; a 500-ID reorder array is allowed. New slots use clientKey; existing slots use itemId. Server allocates new IDs and returns itemIdMap. itemOrder can refer to new clientKeys from that request. Serialize editor saves using returned versions.

~~~json
{
  "apiVersion": 2,
  "requestId": "20d5f413-9d71-4209-b61b-2f9a08adb9bc",
  "quizId": "cloud-exampleQuiz01234567",
  "expectedDraftVersion": 3,
  "patch": {"title": "Geometry practice", "settings": {"durationSeconds": 1800}},
  "upsertItems": [
    {
      "clientKey": "new_slot_1",
      "problemId": "prb_exampleProblem01234567",
      "problemRevisionId": "prv_exampleRevision01234567",
      "points": 3
    }
  ],
  "removeItemIds": [],
  "itemOrder": ["itm_existingItem01234567", "new_slot_1"]
}
~~~

Return draftVersion:4, normalized order and the allocated mapping. Client reuseFromQuizRevisionId is not proof; derive reuse provenance on server.

Import records contain importItemKey/originalQuestionId/content/grading/points/bindings. Retries in one job reuse mappings. Identify errors by item/field. Partial batch processing must be explicitly resumable, never silently half-succeed.

### Applications and participants

| Function | Input | Output |
|---|---|---|
| createJoinLink | quizId/optional expiry | Raw token once + expiry |
| revokeJoinLink | quizId/link ID or hash | Revocation |
| resolveJoinLink | token | Minimal application overview |
| requestQuizAccess | quizId or token/message <=500 | Participant state/version |
| listMyApplications | page | Own requests and safe summaries |
| listAccessRequests | quizId/status/page | Owner/admin requests |
| decideQuizAccess | quizId/targetUid/approve-decline-revoke-reopen/expectedVersion/reason | Updated participant |
| bulkDecideQuizAccess | quizId/<=25 decisions | Per-user success/conflict |
| lookupParticipant | quizId/exactEmail | Minimal registered-account match |
| grantQuizAccess | quizId/targetUid/reason | Approved participant |
| addAttemptAllowance | quizId/targetUid/delta/expectedVersion/reason | New extra allowance |

Check quiz ownership before email lookup. No full user directory for teachers. In-app notifications only; no automatic email.

### Attempts

| Function | Input | Output |
|---|---|---|
| startAttempt | quizId/optional sourceAttemptId for retry | Attempt ID/order/settings/deadline |
| getAttempt | attemptId | Authorized redacted state/own saved answers |
| getAttemptQuestions | attemptId/<=20 itemIds | Allowed statements/options/asset IDs |
| saveAnswers | attemptId/changes/expectedAnswerVersion | Confirmed answer versions/times |
| navigateAttempt | attemptId/targetIndex | Accepted frontier |
| saveAttemptUiState | attemptId/index/flags/expectedUiVersion | UI-state version, no frontier bypass |
| submitAttempt | attemptId | Frozen status/grading job |
| abandonAttempt | attemptId | Abandoned, allowance consumed |
| endActiveAttempt | quizId/attemptId/reason | Teacher/admin termination |
| listMyAttempts | optional quiz/status/page | Release-filtered summaries |
| getAttemptResult | attemptId/page | Released summary/review items or awaiting release |
| getAnswerHistory | attemptId/itemId/page | Authorized saved changes |

~~~json
{
  "apiVersion": 2,
  "requestId": "7a5f1af5-9998-43e7-aaf8-875208842d24",
  "attemptId": "att_exampleAttempt01234567",
  "expectedAnswerVersion": 7,
  "changes": [
    {"itemId": "itm_existingItem01234567", "value": "3/2", "expectedRevision": 2}
  ]
}
~~~

Response confirms answerVersion:8, item revision:3 and savedAt. No answer key or client-selected deadline.

Attempt input never accepts authoritative score/correctCount/ownerId/startedAt/deadline/manualScores/quizSnapshot.

### Reports, grading, administration

| Function | Input | Output |
|---|---|---|
| listQuizAttempts | quiz/revision/student/status/date/page filters | Owner/admin summary page |
| getTeacherAttempt | attemptId/page | Authorized answers/grades/detail |
| saveManualGrade | attemptId/itemId/points/feedback/reason/expectedGradeVersion | New grade/totals versions |
| releaseResults | quizId/<=25 attempts or revision-scope job/score+solution flags | Release results/job |
| getQuizStatistics | quizId/revisionId | Revision-aware summary/asOf |
| exportQuizResults | quizId/revision/filters | CSV job |
| listActivity | Admin actor/role-at-time/quiz/action/date/page | Redacted events |
| getAdminAttempt | attemptId/page | Full authorized detail + read audit |
| getAdminUserActivity | targetUid/page | User events |
| adminListContent | quiz/problem, owner/lifecycle/visibility/search/page | Admin management list |

All exports enforce ownership. Escape CSV formula-like cells. Admin detail reads emit an event; global feed contains no full answers.

### Assets

| Function | Input | Output |
|---|---|---|
| createAssetUpload | kind/name/contentType/expectedBytes | Asset ID/staging path/expiry |
| finalizeAssetUpload | assetId | Ready metadata or processing job |
| cancelAssetUpload | assetId | Cleanup/cancellation status |
| getAssetLinks | Authorized context + <=20 assetIds | Temporary URLs/expiry |

getJob reauthorizes by job kind. A demoted/disabled owner cannot use an old privileged export job to bypass access loss.

## 10. Publication, reuse and jobs

### Publish algorithm

1. Require current owner/admin and expected root/draft versions.
2. Validate metadata, 1–500 slots, unique slot IDs, points, types, release settings.
3. Transactionally reserve a building revision/job and capture exact draft/version. Set publishingJobId; initial implementation rejects further draft edits while publishing.
4. Resolve pinned sources and check current ownership/sharing or an existing owned authorized snapshot. Capture reuse permission at job acceptance.
5. Verify all question/solution assets ready; reserve refs/leases.
6. Copy immutable statement/key snapshots in bounded chunks, targeting <4 MiB per database batch.
7. Compute counts/points/manifest hash from written data.
8. Final transaction rechecks actor privileges/lifecycle/job lease/version. Mark ready, switch published pointer/catalog, clear job flag and append one publication event.
9. New starts use the new revision only after step 8.
10. Failure retains previous live pointer/catalog; durable job can retry/cancel.

Storage uploads plus database writes are not one cross-service transaction. Staging/finalization/final-pointer activation prevent incomplete publications.

### Reuse/retention

Draft updates never mutate a publication. Offer “New source version available” explicitly. Attempts use pinned quizRevisionId.

Existing snapshots remain usable after bank sharing is withdrawn. Duplicating such an owned quiz can fork its authorized snapshots into newly owned private problem records, retaining attribution/assets; it cannot claim ownership of the original.

Hard deletion rejects retained references. Administrative retention purges are separately approved, not a Trash side effect.

### Job worker

Kinds: publish_quiz, finalize_asset, grade_attempt, export_results, export_quiz, cleanup, migrate_v1, account_auth_sync.

Use leaseOwner/leaseExpiresAt/processedCursor and deterministic output IDs. Triggers can repeat or arrive out of order. Scheduled sweeper retries abandoned leases and queued work.

Publication input is immutable; grading freezes answers first. Exports report asOf and included count. A job must not expose partial grading as a final result.

## 11. Attempts, timing, saves and grading

### Allocation

In one transaction read quiz/revision/participant, evaluate section 8, allocate attempt, increment counter and set activeAttemptId. Generate random question/option order server-side.

~~~text
durationDeadline = start + duration, or infinity if untimed
closingDeadline = current quiz closing time, or infinity
deadlineAt = minimum, or null if both infinite
~~~

Capture settings/closing date in attempt. Later settings affect new attempts only. Teacher termination remains explicit.

### Saves

Client debounce approximately 800ms, minimum one second between ordinary saves; flush on blur/navigation/submit when possible.

Server transaction:

1. Read attempt and affected answers before writes.
2. Require caller is student owner, active account, active attempt, now strictly before deadline.
3. Enforce frontier when backward navigation is disabled.
4. Validate option ID or text bounds against pinned content.
5. Compare overall answerVersion and each expectedRevision.
6. Unchanged value returns existing version without history.
7. Real change writes current answer + immutable saved change + attempt count/version/time + redacted event.
8. Return confirmed savedAt/revisions.

Client clocks never determine acceptance. Second-tab conflicts do not silently overwrite.

saveAttemptUiState validates all flag IDs and position, cannot advance restricted frontier, and does not change score/deadline/allowance/answer version.

### Submit and timeout

Freeze root in a transaction before grading. Saves also touch root, so races serialize. Duplicate submit returns existing status/job.

At/after deadline, freeze timed_out using deadline as effective submittedAt and grade last server-confirmed answers. No late recovery text is silently accepted.

Enforce expiry on every operation and with a scheduled sweep when browser is closed. Display countdown using serverTime/
