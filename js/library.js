import {
  $,
  $$,
  mountShell,
  icon,
  escapeHTML,
  toast,
  showModal,
  downloadFile,
  slug,
  formatNumber,
  readTextFile,
} from "./common.js";
import { store, getCatalog, loadQuiz, resetCatalog } from "./storage.js";
import { validateQuiz, totalPoints } from "./core.js";
import { getSession, watchSession } from "./firebase-client.js";
import { canPublish, canCreateQuiz, firebaseError } from "./firebase-core.js";
import { cloudRepository } from "./cloud-repository.js";
mountShell("library");
$("#new-icon").innerHTML = icon("plus");
$("#search-icon").innerHTML = icon("search");
$("#footer-file").innerHTML = icon("file");
let quizzes = [],
  filter = "all",
  attempts = [],
  generation = 0,
  authSignature = "";
function metadata(quiz) {
  return {
    ...quiz,
    source: "device",
    local: true,
    hasLocal: true,
    questionCount: quiz.questions.length,
    points: totalPoints(quiz),
    openCount: quiz.questions.filter((q) => q.type === "open").length,
    choiceCount: quiz.questions.filter((q) => q.type === "choice").length,
  };
}
function updateConnection(session) {
  $("#my-uploads-tab").hidden = !canPublish(session);
  if (filter === "uploads" && !canPublish(session)) {
    filter = "all";
    $$("[data-filter]").forEach((button) =>
      button.classList.toggle("active", button.dataset.filter === "all"),
    );
  }
  $$("[data-author-only]").forEach((el) => {
    el.hidden = !canCreateQuiz(session);
  });
}
function mergeEntries(local, repository, cloud = []) {
  const localIds = new Set(local.map((q) => q.id)),
    combined = new Map();
  for (const q of repository)
    combined.set(q.id, {
      ...q,
      source: "repository",
      local: false,
      status: "published",
      hasLocal: localIds.has(q.id),
    });
  for (const q of local) combined.set(q.id, q);
  for (const q of cloud)
    combined.set(q.id, { ...q, hasLocal: localIds.has(q.id) });
  quizzes = [...combined.values()];
  $("#all-count").textContent = quizzes.length;
  $("#library-stats").innerHTML = [
    [quizzes.length, "Quizzes"],
    [quizzes.reduce((sum, q) => sum + q.questionCount, 0), "Questions"],
    [attempts.filter((a) => a.submittedAt).length, "Completed"],
  ]
    .map(
      ([n, label]) =>
        `<div class="stat-item"><div><div class="stat-value">${n}</div><div class="stat-label">${label}</div></div></div>`,
    )
    .join("");
  render();
}
async function refresh() {
  const run = ++generation,
    session = getSession();
  updateConnection(session);
  const results = await Promise.allSettled([
    getCatalog(),
    store.quizzes(),
    store.attempts(),
  ]);
  if (run !== generation) return;
  const repo = results[0].status === "fulfilled" ? results[0].value : [],
    local =
      results[1].status === "fulfilled"
        ? results[1].value.map(metadata).reverse()
        : [];
  attempts = results[2].status === "fulfilled" ? results[2].value : [];
  results.forEach((result) => {
    if (result.status === "rejected") toast(result.reason.message, "error");
  });
  mergeEntries(local, repo);
  $("#cloud-catalog-feedback").hidden = true;
  if (session.status !== "ready") return;
  try {
    const repository = await cloudRepository();
    const [published, own] = await Promise.all([
      repository.listPublished(),
      session.user ? repository.listOwn() : Promise.resolve([]),
    ]);
    if (run !== generation) return;
    mergeEntries(local, repo, [...published, ...own]);
  } catch (error) {
    if (run !== generation) return;
    $("#cloud-catalog-feedback").hidden = false;
    $("#cloud-catalog-feedback").innerHTML =
      `<div class="notice warning">Shared quizzes could not be loaded. Try refreshing the page.</div>`;
  }
}
function render() {
  const search = $("#search").value.toLowerCase().trim(),
    session = getSession();
  const visible = quizzes.filter((q) => {
    const matches =
      filter === "all" ||
      (filter === "mine" && q.hasLocal) ||
      (filter === "published" &&
        q.source !== "device" &&
        q.status !== "draft") ||
      (filter === "uploads" &&
        q.source === "firebase" &&
        q.ownerId === session.user?.uid);
    return (
      matches &&
      [q.title, q.description, q.subject, q.difficulty]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  });
  $("#quiz-count").textContent =
    `${visible.length} ${visible.length === 1 ? "quiz" : "quizzes"}`;
  $("#quiz-grid").innerHTML = visible.length
    ? visible
        .map((q) => {
          const attempt = attempts.find((a) => a.quizId === q.id),
            source =
              q.source === "firebase"
                ? q.status === "draft"
                  ? "Private draft"
                  : "Published"
                : q.source === "repository"
                  ? "Published"
                  : "On device";
          return `<article class="quiz-card source-${q.source}"><div class="card-content"><div class="card-meta"><span class="badge">${escapeHTML(q.subject)}</span><span class="badge ${q.status === "draft" ? "amber" : q.source === "firebase" ? "green" : "gray"}">${source}</span></div><h3>${escapeHTML(q.title)}</h3>${q.description ? `<p class="card-description">${escapeHTML(q.description)}</p>` : ""}<div class="card-details"><span>${icon("file")}${q.questionCount} ${q.questionCount === 1 ? "question" : "questions"}</span><span>${icon("clock")}${q.durationMinutes ? `${q.durationMinutes} min` : "Untimed"}</span><span>${formatNumber(q.points)} pts</span></div><div class="card-bottom"><a class="button primary compact" href="./quiz.html?id=${encodeURIComponent(q.id)}">${attempt?.submittedAt ? "View result" : attempt ? "Continue" : "Start quiz"} ${icon("arrow")}</a><span class="card-type">${q.choiceCount && q.openCount ? "Mixed" : q.choiceCount ? "Multiple choice" : "Open answer"}</span><button class="icon-button" data-menu="${escapeHTML(q.id)}" aria-label="Options for ${escapeHTML(q.title)}">${icon("dots")}</button></div></div></article>`;
        })
        .join("")
    : `<div class="empty-library"><h3>${search ? "No matching quizzes" : "No quizzes in this view"}</h3><p>${search ? "Try a different title or subject." : "There are no quizzes here yet."}</p>${canCreateQuiz(session) ? `<a class="button primary" href="./upload.html">${icon("plus")} Upload quiz</a>` : ""}</div>`;
  $$("[data-menu]").forEach(
    (button) => (button.onclick = () => menu(button.dataset.menu)),
  );
}
function menu(id) {
  const meta = quizzes.find((q) => q.id === id),
    session = getSession(),
    ownCloud =
      meta.source === "firebase" &&
      meta.ownerId === session.user?.uid &&
      canPublish(session);
  showModal({
    title: meta.title,
    content: `<div class="card-menu-actions"><a class="button secondary" href="./quiz.html?id=${encodeURIComponent(id)}">${icon("arrow")} Open quiz</a>${canCreateQuiz(session) ? `<a class="button secondary" href="./upload.html?edit=${encodeURIComponent(id)}">${icon("settings")} ${meta.local || ownCloud ? "Edit quiz" : "Copy and edit"}</a>` : ""}<button class="button secondary" id="download-quiz">${icon("download")} Export quiz file</button>${ownCloud ? `<button class="button secondary" id="change-visibility">${icon("eye")} ${meta.status === "draft" ? "Publish quiz" : "Make private"}</button><button class="button danger" id="delete-cloud-quiz">${icon("trash")} Delete quiz</button>` : ""}${meta.hasLocal ? `<button class="button danger" id="remove-device-quiz">${icon("trash")} Remove device copy</button>` : ""}</div>`,
    onMount: (dialog, close) => {
      $("#download-quiz", dialog).onclick = async () => {
        try {
          const quiz = validateQuiz(await loadQuiz(id));
          downloadFile(quiz, `${slug(quiz.title)}.quiz.json`);
          close();
        } catch (e) {
          toast(firebaseError(e), "error");
        }
      };
      $("#change-visibility", dialog)?.addEventListener("click", async () => {
        try {
          await (
            await cloudRepository()
          ).setStatus(id, meta.status === "draft" ? "published" : "draft");
          close();
          await refresh();
          toast("Quiz visibility updated.");
        } catch (e) {
          toast(firebaseError(e), "error");
        }
      });
      $("#delete-cloud-quiz", dialog)?.addEventListener("click", () => {
        close();
        confirmDelete(meta, true);
      });
      $("#remove-device-quiz", dialog)?.addEventListener("click", () => {
        close();
        confirmDelete(meta, false);
      });
    },
  });
}
function confirmDelete(meta, cloud) {
  showModal({
    title: cloud ? "Delete this quiz?" : "Remove the device copy?",
    content: `<p class="muted">${escapeHTML(meta.title)}${cloud ? " will be removed from the shared library." : " and its local attempt will be removed from this browser."}</p>`,
    actions:
      '<button class="button secondary" id="cancel-delete">Cancel</button><button class="button danger" id="confirm-delete">Delete</button>',
    onMount: (dialog, close) => {
      $("#cancel-delete", dialog).onclick = close;
      $("#confirm-delete", dialog).onclick = async () => {
        try {
          if (cloud) {
            await (await cloudRepository()).removeQuiz(meta.id);
          } else {
            await store.deleteQuiz(meta.id);
            await store.clearAttempt(meta.id);
          }
          close();
          await refresh();
          toast(cloud ? "Quiz deleted." : "Device copy removed.");
        } catch (e) {
          toast(firebaseError(e), "error");
        }
      };
    },
  });
}
$$("[data-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      filter = button.dataset.filter;
      $$("[data-filter]").forEach((b) =>
        b.classList.toggle("active", b === button),
      );
      render();
    }),
);
$("#search").oninput = render;
$("#refresh-quizzes").onclick = () => {
  resetCatalog();
  refresh();
};
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
    !$("#app-modal")
  ) {
    event.preventDefault();
    $("#search").focus();
  }
});
$("#import-json").onclick = () => $("#json-file").click();
$("#json-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const quiz = validateQuiz(JSON.parse(await readTextFile(file)));
    await store.saveQuiz(quiz);
    await refresh();
    toast("Quiz imported to this device.");
  } catch (error) {
    toast(
      error instanceof SyntaxError
        ? "Choose a valid .quiz.json file."
        : error.message,
      "error",
    );
  } finally {
    event.target.value = "";
  }
};
watchSession((session) => {
  updateConnection(session);
  const signature = `${session.status}:${session.user?.uid || "guest"}:${session.role}`;
  if (signature !== authSignature) {
    authSignature = signature;
    refresh().catch((e) => toast(e.message, "error"));
  }
});
