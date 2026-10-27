import { canCreateQuiz } from "./firebase-core.js";
import { initFirebase, getSession, watchSession } from "./firebase-client.js";
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [
  ...root.querySelectorAll(selector),
];
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  plus: "M12 5v14 M5 12h14",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 6l-6 6 6 6",
  check: "M5 12l4 4L19 6",
  x: "M6 6l12 12 M18 6L6 18",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  book: "M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3z M21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h5z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  chevron: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  image: "M3 3h18v18H3z M3 16l6-6 12 11 M16 7h.01",
  code: "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  flag: "M5 22V3 M5 3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  refresh: "M20 7a9 9 0 1 0 1 10 M20 2v6h-6",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  trophy:
    "M8 3h8v6a4 4 0 0 1-8 0z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 13v6 M8 21h8",
  dots: "M5 12h.01 M12 12h.01 M19 12h.01",
  list: "M9 6h12 M9 12h12 M9 18h12 M3 6h.01 M3 12h.01 M3 18h.01",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2 M7 3v6h10V3 M7 21v-8h10v8",
};
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
}
export function mountAccountNav(container) {
  if (!container) return;
  watchSession((session) => {
    const name =
      session.user?.displayName ||
      session.user?.email?.split("@")[0] ||
      "Account";
    container.innerHTML = `<a class="account-link" href="./login.html">${session.user ? `<span class="user-initial">${escapeHTML(name[0].toUpperCase())}</span>${escapeHTML(name.slice(0, 20))}` : "Sign in"}</a>`;
  });
  initFirebase();
}
export function mountShell(page) {
  const shell = $("#shell");
  if (!shell) return;
  shell.innerHTML = `<header class="site-header"><div class="header-inner"><a class="app-title" href="./index.html">Math quizzes</a><nav class="header-nav" aria-label="Main navigation"><a class="${page === "library" ? "active" : ""}" href="./index.html">${icon("grid")} Quizzes</a><a class="${page === "upload" ? "active" : ""}" href="./upload.html" data-author-only hidden>${icon("plus")} Upload quiz</a><button data-guide>${icon("book")} LaTeX guide</button></nav><div class="account-controls" id="account-nav"></div></div></header><nav class="mobile-nav" aria-label="Mobile navigation"><a class="${page === "library" ? "active" : ""}" href="./index.html">${icon("grid")}<span>Quizzes</span></a><a class="${page === "upload" ? "active" : ""}" href="./upload.html" data-author-only hidden>${icon("plus")}<span>Upload</span></a><button data-guide>${icon("book")}<span>Guide</span></button><a class="${page === "account" ? "active" : ""}" href="./login.html">${icon("settings")}<span>Account</span></a></nav>`;
  $$("[data-guide]").forEach((button) =>
    button.addEventListener("click", showGuide),
  );
  watchSession((session) => {
    $$("[data-author-only]").forEach((el) => {
      el.hidden = !canCreateQuiz(session);
    });
  });
  mountAccountNav($("#account-nav"));
}
export function mountQuizHeader() {
  const header = $("#quiz-header");
  if (!header) return;
  header.innerHTML = `<a class="app-title" href="./index.html">Math quizzes</a><a class="button ghost compact" href="./index.html" id="exit-quiz">Quizzes ${icon("back")}</a><div class="account-controls" id="quiz-account-nav"></div>`;
  mountAccountNav($("#quiz-account-nav"));
}
export function toast(message, type = "success") {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === "error" ? "info" : "check")}<span>${escapeHTML(message)}</span>`;
  host.append(el);
  setTimeout(() => el.remove(), 6000);
}
export function showModal({
  title,
  content,
  actions = "",
  onMount,
  wide = false,
}) {
  $("#app-modal")?.remove();
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "app-modal";
  dialog.className = wide ? "modal modal-wide" : "modal";
  dialog.innerHTML = `<div class="modal-heading"><h2>${escapeHTML(title)}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon("x")}</button></div><div class="modal-body">${content}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ""}`;
  const close = () => dialog.close();
  $("[data-close]", dialog).onclick = close;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        close();
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    previous?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  onMount?.(dialog, close);
  return dialog;
}
export function downloadFile(data, filename, type = "application/json") {
  const blob = new Blob(
    [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const slug = (value) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "math-quiz";
export const formatNumber = (n) =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(3)).toString();
export const formatTime = (seconds) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
export async function readTextFile(file) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Use a file smaller than 20 MB.");
  return file.text();
}
export function showGuide() {
  showModal({
    title: "LaTeX format",
    wide: true,
    content: `<p class="muted">Upload a <strong>.tex</strong> file or paste your source. Math between <code>$…$</code>, <code>\\(…\\)</code>, and <code>\\[…\\]</code> is rendered with MathJax.</p><div class="guide-grid"><div><h3>Multiple choice</h3><pre>\\begin{problem}[points=2]
What is $2^5$?
\\begin{choices}
  \\choice $16$
  \\correctchoice $32$
  \\choice $64$
\\end{choices}
\\begin{solution}
$2^5=32$.
\\end{solution}
\\end{problem}</pre></div><div><h3>Open answer</h3><pre>\\begin{problem}[points=3]
Find $x$ if $3x+2=11$.
\\answer{3}
\\accepted{3.0|6/2}
\\end{problem}

\\begin{problem}[points=5,mode=manual]
Prove that $\\sqrt{2}$ is irrational.
\\begin{solution}
Your marking rubric goes here.
\\end{solution}
\\end{problem}</pre></div></div><h3>Details that travel with the file</h3><pre>\\quiztitle{Algebra essentials}
\\quizdescription{A quick check of the fundamentals.}
\\quizsubject{Algebra}
\\quiztime{20} % minutes; 0 = untimed

% Add an image in any problem or solution:
\\includegraphics[width=0.8\\linewidth]{triangle.png}</pre><p class="muted">Attach referenced PNG, JPG, WebP, or GIF images on the upload page. They are embedded in the exported quiz file. <code>exercise</code>, exam-class <code>questions</code>, and a top-level <code>enumerate</code> list are also supported. Each multiple-choice problem has one correct option.</p><div class="notice">Open answers accept equivalent numeric expressions (fractions, powers, roots, π) and text aliases. Symbolic algebra and written proofs require accepted answers or self-marking. TikZ and custom TeX macros need conversion before import.</div>`,
    actions: `<a class="button secondary" href="./examples/starter.tex" download>${icon("download")} Download template</a><button class="button primary" id="guide-done">Close ${icon("check")}</button>`,
    onMount: (d, close) => {
      $("#guide-done", d).onclick = close;
    },
  });
}
