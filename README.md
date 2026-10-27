# Math quizzes

A compact, mobile-first mathematics quiz website with a navy and blue interface. Import LaTeX, preview problems with MathJax and images, set a timer, and export each quiz as **one `.quiz.json` file**. Use it locally without an account, or connect Firebase for sign-in, shared quiz uploads, and private account results. No build framework or npm runtime dependencies are required.

## Run it

For a local preview, use Node.js 24 or later:

```sh
npm start
```

Open `http://localhost:4173`. Do not open the HTML files directly with `file://`: ES modules and quiz-file fetching need an HTTP server. Alternatively use `python3 -m http.server 4173` in this folder.

```sh
npm test
npm run build
```

The optional build copies deployable files into `dist/`. Hosting needs no build: all website files are already in the project root. All paths are relative, so both a GitHub user site and a repository project site work.

## Deploy on GitHub Pages

1. Put the extracted project contents at the top level of a public GitHub repository, on `main`. `index.html` must be at the repository root.
2. Open **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
3. Choose **main**, then **/(root)**, and click **Save**.
4. Wait for GitHub's Pages deployment to finish. Your site link appears in **Settings → Pages**.

No custom workflow, Node.js installation, or build command is needed on GitHub. If you previously uploaded the Actions version, delete `.github/workflows/pages.yml` from your repository, or disable **Deploy Axiom to GitHub Pages** in the Actions tab, to stop its old build runs. Switching the Pages source does not delete an existing custom workflow.

The non-empty `.nojekyll` marker is included for plain static hosting. The website's ordinary files also work with GitHub's default processing if your browser upload skips that marker. The optional local build generates its own marker and does not depend on this hidden source file.

## Everyday workflow

1. Open **Create a quiz** and upload `.tex`, paste source, or import `.quiz.json`.
2. Check the student preview. Toggle **Show answer key** when reviewing your key.
3. Attach raster images referenced by `\includegraphics{filename.png}`. Missing files are flagged and prevent export/save. Local images may be up to 4 MB each; local quiz files may be up to 20 MB. Direct Firestore uploads are limited to 900 KB for the complete quiz, including embedded images. The upload screen explains this limit.
4. Set the title, description, subject, level, time limit, optional shuffling, backward navigation, solution visibility, and wrong-answer penalty.
5. **Save on device** adds the quiz to this browser. **Export** produces a portable file. With Firebase configured, verified teachers can **Upload quiz** as a private draft or published quiz.
6. Open the quiz, choose the time limit, and start. Answers and progress recover after a reload on the same browser. A timed attempt uses an absolute deadline, including while the tab is hidden or closed. Reopening an expired attempt submits it immediately.
7. The results show correct, incorrect, unanswered, points, percentage, time, and a question-by-question review. Written responses stay pending until self-marked. Results can be downloaded as JSON.

### Publish another quiz to all visitors

**Save on device** keeps files in this browser. It does not write to GitHub. A Firebase upload publishes to the shared Firebase catalog instead. To publish a file through GitHub:

1. Export the quiz and add it to `quizzes/`, for example `quizzes/weekly-01.quiz.json`.
2. Commit it to `main`. On a standard public `OWNER.github.io/REPOSITORY/` site, the app discovers `quizzes/*.quiz.json` through GitHub's public directory API. No catalog edit or custom build is needed. Use filenames made of letters, digits, hyphens, and underscores, and give each quiz a unique ID.
3. Once Pages has deployed, refresh the library. Discovery metadata is cached for one minute. Share `https://YOUR-SITE/quiz.html?id=YOUR-QUIZ-ID`.

Each quiz JSON embeds its images and is independent of its original LaTeX file. `index.json` is a bundled fallback catalog. If the public GitHub API is unavailable or rate-limited, the app uses that fallback. On localhost, custom domains, other hosting providers, private repositories, or a publishing branch other than `main`, maintain `quizzes/index.json` instead: run `npm run catalog` locally and upload the resulting catalog, or add its metadata entries manually. `npm start` and the optional `npm run build` also refresh the fallback catalog. No GitHub tokens are used or embedded in the website.

## LaTeX format

Start with `examples/starter.tex` and `examples/triangle.png`, or use **Load example** to load both automatically.

```tex
\quiztitle{Algebra practice}
\quizdescription{A short warm-up.}
\quizsubject{Algebra}
\quizdifficulty{Foundation}
\quiztime{20} % minutes; 0 = untimed

\begin{problem}[points=2]
What is $2^5$?
\begin{choices}
  \choice $16$
  \correctchoice $32$
  \choice $64$
\end{choices}
\begin{solution}
$2^5=32$.
\end{solution}
\end{problem}

\begin{problem}[points=3,tolerance=0.000001]
Find the positive root of $x^2=2$.
\answer{sqrt(2)}
\accepted{\sqrt{2}}
\end{problem}

\begin{problem}[points=5,mode=manual]
Prove that $\sqrt{2}$ is irrational.
\begin{solution}
Provide a model solution or a marking rubric here.
\end{solution}
\end{problem}
```

- Both `problem` and `exercise` environments work. Optional points can also be written as `[3]` or `\points{3}`.
- Standard exam-class `\begin{questions}\question[2]…` works, with `\choice` and `\CorrectChoice`. See `examples/exam-format.tex`.
- A first, top-level `enumerate` list can be imported as open questions. Nested lists remain part of their problem statement.
- Multiple-choice questions have exactly one correct option, marked by `\correctchoice` / `\CorrectChoice`, or by `\answer{B}` / `\answer{2}` after the choices.
- Open-answer aliases are separated by `|`: `\answer{No|Impossible}`. `\accepted{…}` adds aliases.
- `\begin{solution}…\end{solution}` or `\explanation{…}` provides feedback.
- Missing open-answer keys become self-marked responses and generate a warning. They are never falsely marked by AI.
- Math supports `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`, AMS environments inside math, and common commands. The bundled MathJax 3.2.2 needs no external CDN or fonts. `\R`, `\N`, `\Z`, `\Q`, and `\C` are configured.
- Prose supports `\textbf`, `\textit`, `\emph`, `\underline`, `\texttt`, paragraphs, basic lists, and `\includegraphics`. PNG, JPG, WebP, and GIF are supported, including images inside choices or solutions. Filenames are case-sensitive; matching basenames and extensionless references work.
- This is a structured importer, not a full TeX compiler. TikZ, packages, custom macro definitions, `\input`, arbitrary document layouts, multipart exam questions, and multi-select scoring are not compiled. Export diagrams as images and convert custom markup to the supported syntax.

## Grading

Numeric answers are evaluated by a bounded arithmetic parser; input is never executed as JavaScript. It supports fractions, decimal/scientific notation, `+ - * / ^`, parentheses, `pi`, `e`, `sqrt`, `abs`, `sin`, `cos`, `tan`, `ln`, and `log`. Basic LaTeX `\frac`, `\sqrt`, `\pi`, `\cdot`, and `\times` are supported. Use explicit multiplication for general expressions. Powers associate to the right and bind more tightly than unary minus.

An answer is numerically correct when `abs(actual - expected) <= tolerance * max(1, abs(expected))`. The default tolerance is `0.000001`. Use `tolerance=0` for exact numeric comparison. Non-numeric accepted text ignores case, whitespace, surrounding math delimiters, and simple formatting. **Symbolic algebra is not automatically proved equivalent**; list accepted forms or use self-marking. Written proofs support any score between 0 and the question's maximum, including partial credit. If a wrong-answer penalty is set, zero-mark responses receive it; skipped or pending responses do not.

The percentage is bounded to 0–100; the point total can be negative with penalties. Until written responses are marked, the displayed total is provisional. Hiding solutions suppresses the model answers and explanations in the result UI, while retaining scores.

## Accounts and upload access

Firebase is configured **once in `js/firebase-config.js`**, by the site owner. The app connects automatically. Visitors see ordinary Sign in / Create account forms; there is no Firebase connection screen, device configuration, or settings wizard.

Use Firebase Authentication for accounts and Firestore for quiz content, its embedded images, metadata, and private completed results. No Cloud Storage bucket, CORS configuration, or Storage rules are used in this version. Read [FIREBASE-SETUP.md](FIREBASE-SETUP.md) for the one-time owner setup.

Every new account is an ordinary student account. Upload access is separate: create `roles/USER_UID` with a string field `role: "teacher"` in Firestore Console, verify the account's email, then refresh the account page. That same account can now upload and manage its own quizzes. Delete the role document to revoke access; the server denies writes immediately, and a refreshed page hides Upload. Accounts cannot give themselves permission.

Once connected, only verified, approved accounts see Upload controls. A direct visit to the upload page checks the same permission. Everyone can take published quizzes; private drafts are owner-only. Completed results are private to the signed-in account. No configuration or permission editing is exposed to ordinary users.

The shipped configuration is empty because the project values have not been provided yet. Until configured, local creation, MathJax previews, file exports, and quizzes remain usable. Sign-in and online uploads are inactive.

### Firestore upload size

A full quiz bundle may be up to **900 KB** for online publishing, including images. This keeps its content document below Firestore's 1 MiB limit. Use small diagrams or split image-heavy quizzes. Larger quiz files still work locally and can be exported or published through GitHub as before.

A quiz has one metadata document and one content document. They commit atomically, so a failed upload cannot publish incomplete content or overwrite half an existing quiz. Export still produces one `.quiz.json` file per quiz. The catalog reads only metadata and fetches the content when a quiz is opened.

## Architecture

- `index.html` / `js/library.js`: searchable device, repository, and Firebase quiz collections.
- `upload.html` / `js/upload.js`: LaTeX import, preview, embedded images, timing, exports, device drafts, and Firebase uploads.
- `quiz.html` / `js/quiz.js`: navigation, timers, recovery, results, self-marking, and result syncing.
- `login.html` / `js/account.js`: account forms, profile, verification, and results.
- `js/firebase-client.js`: lazy-loaded Firebase browser SDK, authentication, and role state.
- `js/cloud-repository.js`: Firestore quiz metadata, content documents, and private completed results.
- `firebase/`: one Firestore rule set and optional index exemptions.
- `js/parser.js`, `js/core.js`, `js/render.js`: structured LaTeX import, validation/scoring, and safe MathJax rendering. The quiz format can also be the output of a later AI/PDF selection tool.
- `js/storage.js`: IndexedDB device data and account-scoped local attempts.
- `js/published-catalog.js`: GitHub Pages publication discovery with a bundled fallback.
- `quizzes/`: one JSON per bundled quiz plus its metadata catalog.

This is a **practice quiz app**. Answer keys are embedded in quiz files, scoring runs in the browser, and account results are self-reported. Hiding answers in the interface does not make the keys secret. Secure graded exams would require trusted server-side keys, grading, timing, and submissions. The AI/PDF problem-selection system is a later task and is not implemented here.

## Verification

`npm test` runs 41 dependency-free checks for parsing, grading, timers, configuration, redirects, permissions, atomic Firestore uploads, failed writes, and private result paths.

For the optional security-rule suite, install the test tools locally and run the emulators (requires Java 17+ for the pinned emulator tool):

```sh
npm install --no-save --package-lock=false firebase-tools@13.35.1 @firebase/rules-unit-testing@6.0.0 firebase@13.1.0
npx firebase emulators:exec --project demo-mathquiz --only firestore "node tests/firebase-rules.mjs"
```

This runs 34 checks against the Firestore rules using a disposable demo project, without touching a real Firebase project. The website needs none of these npm packages to run.

## Third-party component

MathJax 3.2.2 is distributed under the Apache License 2.0. See `assets/MATHJAX-LICENSE.txt`. Firebase 13.1.0 is loaded from Google’s CDN only after configuration is provided. Firebase is subject to its service terms and usage charges. No Firebase requests are made in the default unconfigured state.
