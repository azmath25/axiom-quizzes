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
import { parseLatex } from "./parser.js";
import {
  validateQuiz,
  totalPoints,
  imageReferences,
  resolveAsset,
  uid,
  MAX_FILE_BYTES,
} from "./core.js";
import { store, loadQuiz } from "./storage.js";
import { latexHTML, typeset, clearMath } from "./render.js";
import { initFirebase, getSession, watchSession } from "./firebase-client.js";
import { canPublish, canCreateQuiz, firebaseError } from "./firebase-core.js";
import { cloudRepository, isCloudId } from "./cloud-repository.js";
mountShell("upload");
const builderSwitch = document.createElement("div");
builderSwitch.className = "builder-switch";
builderSwitch.innerHTML =
  '<button class="active" id="builder-edit" aria-pressed="true">Edit quiz</button><button id="builder-preview" aria-pressed="false">Student preview <span id="mobile-preview-count">0</span></button>';
$(".builder-layout").before(builderSwitch);
function switchBuilder(preview) {
  document.body.classList.toggle("show-preview", preview);
  $("#builder-edit").classList.toggle("active", !preview);
  $("#builder-preview").classList.toggle("active", preview);
  $("#builder-edit").setAttribute("aria-pressed", !preview);
  $("#builder-preview").setAttribute("aria-pressed", preview);
}
$("#builder-edit").onclick = () => switchBuilder(false);
$("#builder-preview").onclick = () => switchBuilder(true);
for (const [id, name] of [
  ["upload-symbol", "upload"],
  ["code-icon", "code"],
  ["clock-icon", "clock"],
  ["image-icon", "image"],
])
  $(`#${id}`).innerHTML = icon(name);
let current = null,
  source = "",
  filename = "",
  warnings = [],
  assets = {},
  dirty = false,
  draftTimer,
  previewLimit = 30;
let currentCloudId = null,
  uploading = false;
const fieldIds = [
  "quiz-title",
  "quiz-description",
  "quiz-subject",
  "quiz-difficulty",
  "quiz-duration",
  "shuffle-questions",
  "shuffle-options",
  "allow-back",
  "show-solutions",
  "penalty",
];
const captureForm = () =>
  Object.fromEntries(
    fieldIds.map((id) => [
      id,
      $(`#${id}`).type === "checkbox" ? $(`#${id}`).checked : $(`#${id}`).value,
    ]),
  );
function restoreForm(values) {
  for (const [id, value] of Object.entries(values || {})) {
    const el = $(`#${id}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else {
      if (
        el.tagName === "SELECT" &&
        ![...el.options].some((o) => o.value === value)
      )
        el.add(new Option(value, value));
      el.value = value;
    }
  }
  updatePresets();
}
function quizToForm(q) {
  restoreForm({
    "quiz-title": q.title,
    "quiz-description": q.description,
    "quiz-subject": q.subject,
    "quiz-difficulty": q.difficulty,
    "quiz-duration": q.durationMinutes,
    "shuffle-questions": q.settings.shuffleQuestions,
    "shuffle-options": q.settings.shuffleOptions,
    "allow-back": q.settings.allowBack,
    "show-solutions": q.settings.showSolutions,
    penalty: q.settings.penalty,
  });
}
function fromForm() {
  if (!current) throw new Error("Import some problems first.");
  const duration = Number($("#quiz-duration").value),
    penalty = Number($("#penalty").value);
  if (
    $("#quiz-duration").value === "" ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 1440
  )
    throw new Error("Set a time limit between 0 and 1440 minutes.");
  if (
    $("#penalty").value === "" ||
    !Number.isFinite(penalty) ||
    penalty < 0 ||
    penalty > 1000
  )
    throw new Error("The wrong-answer penalty must be between 0 and 1000.");
  const embeddedAssets = {};
  for (const name of imageReferences(current)) {
    const image = resolveAsset(assets, name);
    if (image) embeddedAssets[name] = image;
  }
  return validateQuiz({
    ...current,
    title: $("#quiz-title").value.trim() || "Untitled quiz",
    description: $("#quiz-description").value,
    subject: $("#quiz-subject").value,
    difficulty: $("#quiz-difficulty").value,
    durationMinutes: duration,
    assets: embeddedAssets,
    settings: {
      shuffleQuestions: $("#shuffle-questions").checked,
      shuffleOptions: $("#shuffle-options").checked,
      allowBack: $("#allow-back").checked,
      showSolutions: $("#show-solutions").checked,
      penalty,
    },
  });
}
function scheduleDraft() {
  $("#draft-status").textContent = "Saving draft…";
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      await store.saveDraft({
        quiz: current ? { ...current, assets: {} } : null,
        source,
        filename,
        warnings,
        assets,
        dirty,
        cloudId: currentCloudId,
        cloudVisibility: $("#cloud-visibility").value,
        form: captureForm(),
      });
      $("#draft-status").textContent = dirty
        ? "Source changed · build preview"
        : "Draft saved on this device";
    } catch (e) {
      $("#draft-status").textContent = "Draft not saved";
      toast(e.message, "error");
    }
  }, 650);
}
function missingAssets() {
  return current
    ? imageReferences(current).filter((name) => !resolveAsset(assets, name))
    : [];
}
function updateState() {
  $("#mobile-preview-count").textContent = current?.questions.length || 0;
  const missing = missingAssets();
  $("#save-quiz").disabled = $("#export-quiz").disabled =
    !current || dirty || missing.length > 0 || uploading;
  updateCloudState();
  if (current)
    $("#preview-summary").innerHTML =
      `<span>${current.questions.length} questions</span><span>${formatNumber(totalPoints(current))} points</span><span>${Number($("#quiz-duration").value) ? `${escapeHTML($("#quiz-duration").value)} min` : "Untimed"}</span>`;
  const all = [
    ...warnings,
    ...(dirty
      ? [
          "Your source has changed. Build the preview to include the latest edits.",
        ]
      : []),
    ...(missing.length
      ? [`Attach the missing images before saving: ${missing.join(", ")}.`]
      : []),
  ];
  $("#warnings").innerHTML = all
    .map((w) => `<div class="notice warning">${escapeHTML(w)}</div>`)
    .join("");
}
function renderPreview() {
  updateState();
  if (!current) return;
  const keys = $("#show-keys").checked,
    root = $("#preview-content");
  clearMath(root);
  root.innerHTML =
    current.questions
      .slice(0, previewLimit)
      .map(
        (q, i) =>
          `<article class="preview-question"><div class="preview-question-top"><span class="question-label"><b>${String(i + 1).padStart(2, "0")}</b> ${q.type === "choice" ? "Multiple choice" : q.answerMode === "manual" ? "Written response" : "Open answer"}</span><span class="pill">${formatNumber(q.points)} ${q.points === 1 ? "point" : "points"}</span></div><div class="problem-text">${latexHTML(q.prompt, assets)}</div>${q.type === "choice" ? `<div class="preview-options">${q.options.map((o, j) => `<div class="preview-option ${keys && o.id === q.answer ? "correct-key" : ""}"><span class="option-letter">${String.fromCharCode(65 + j)}</span><span>${latexHTML(o.text, assets)}</span>${keys && o.id === q.answer ? `<span style="margin-left:auto">${icon("check")}</span>` : ""}</div>`).join("")}</div>` : `<div class="preview-answer">${q.answerMode === "manual" ? "Write your solution here…" : "Type your answer…"}</div>`}${keys ? `<div class="preview-solution"><strong>${q.answerMode === "manual" ? "Self-marked after submission" : "Answer key"}</strong>${q.type === "open" && q.answers.length ? latexHTML(q.answers.join(" or "), assets) : ""}${q.explanation ? `<div>${latexHTML(q.explanation, assets)}</div>` : ""}</div>` : ""}</article>`,
      )
      .join("") +
    (current.questions.length > previewLimit
      ? `<button class="button secondary full-width" id="more-preview">Show more questions (${current.questions.length - previewLimit} remaining)</button>`
      : "");
  $("#more-preview")?.addEventListener("click", () => {
    previewLimit += 30;
    renderPreview();
  });
  typeset(root);
}
function showFileInfo() {
  const el = $("#file-info");
  el.hidden = !filename;
  el.innerHTML = `${icon("file")}<span>${escapeHTML(filename)}</span><span style="margin-left:auto;color:#60a78e">${icon("check")}</span>`;
}
function renderImages() {
  $("#image-list").innerHTML = Object.entries(assets)
    .map(
      ([name, data]) =>
        `<div class="image-item"><img src="${escapeHTML(data)}" alt=""><span>${escapeHTML(name)}</span><button class="icon-button" data-remove-image="${escapeHTML(name)}" aria-label="Remove ${escapeHTML(name)}">${icon("x")}</button></div>`,
    )
    .join("");
  $$("[data-remove-image]").forEach(
    (b) =>
      (b.onclick = () => {
        delete assets[b.dataset.removeImage];
        renderImages();
        renderPreview();
        scheduleDraft();
      }),
  );
}
function setSourceMode(enabled) {
  $("#source-pane").hidden = !enabled;
  $("#file-pane").hidden = enabled;
  $("#tab-source").classList.toggle("active", enabled);
  $("#tab-file").classList.toggle("active", !enabled);
  $("#tab-source").setAttribute("aria-pressed", enabled);
  $("#tab-file").setAttribute("aria-pressed", !enabled);
}
function importError(error) {
  $("#import-error").hidden = false;
  $("#import-error").textContent =
    error instanceof SyntaxError
      ? "That JSON file could not be read. Choose a valid .quiz.json export."
      : error.message;
}
function parseSource() {
  try {
    const result = parseLatex($("#source").value, {
      filename: filename || "Untitled quiz",
    });
    if (current) result.quiz.id = current.id;
    current = result.quiz;
    source = $("#source").value;
    warnings = result.warnings;
    dirty = false;
    quizToForm(current);
    $("#import-error").hidden = true;
    previewLimit = 30;
    renderPreview();
    scheduleDraft();
  } catch (e) {
    importError(e);
    dirty = true;
    updateState();
  }
}
async function importFile(file) {
  if (!file || uploading) return;
  try {
    const text = await readTextFile(file);
    if (/\.json$/i.test(file.name)) {
      current = validateQuiz(JSON.parse(text));
      source = "";
      warnings = [];
      assets = { ...current.assets };
    } else if (/\.tex$/i.test(file.name)) {
      const parsed = parseLatex(text, { filename: file.name });
      current = parsed.quiz;
      source = text;
      warnings = parsed.warnings;
    } else
      throw new Error(
        "Choose a .tex source file or an exported .quiz.json file.",
      );
    currentCloudId = null;
    filename = file.name;
    $("#source").value = source;
    dirty = false;
    quizToForm(current);
    showFileInfo();
    renderImages();
    renderPreview();
    $("#import-error").hidden = true;
    scheduleDraft();
    toast(`${current.questions.length} questions imported.`);
  } catch (e) {
    importError(e);
  }
}
async function loadExample() {
  if (uploading) return;
  try {
    const response = await fetch("./examples/starter.tex");
    if (!response.ok) throw new Error("The example could not be loaded.");
    const text = await response.text();
    const imageResponse = await fetch("./examples/triangle.png");
    if (!imageResponse.ok)
      throw new Error("The example image could not be loaded.");
    const blob = await imageResponse.blob();
    const image = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const parsed = parseLatex(text, { filename: "starter.tex" });
    current = parsed.quiz;
    currentCloudId = null;
    source = text;
    warnings = parsed.warnings;
    assets = { "triangle.png": image };
    filename = "starter.tex";
    $("#source").value = source;
    dirty = false;
    quizToForm(current);
    showFileInfo();
    renderImages();
    renderPreview();
    $("#import-error").hidden = true;
    scheduleDraft();
  } catch (e) {
    toast(e.message, "error");
  }
}
function exportQuiz() {
  try {
    if (dirty) throw new Error("Build the preview before exporting.");
    if (missingAssets().length)
      throw new Error("Attach the missing images first.");
    const q = fromForm();
    const data = JSON.stringify(q, null, 2);
    if (new Blob([data]).size > MAX_FILE_BYTES)
      throw new Error(
        "This quiz is over 20 MB. Reduce image sizes or split it into smaller quizzes.",
      );
    downloadFile(data, `${slug(q.title)}.quiz.json`);
    toast("Quiz file exported. It includes your images and settings.");
  } catch (e) {
    toast(e.message, "error");
  }
}
$("#export-quiz").onclick = exportQuiz;
$("#save-quiz").onclick = async () => {
  try {
    if (dirty || missingAssets().length) return;
    current = fromForm();
    if (new Blob([JSON.stringify(current)]).size > MAX_FILE_BYTES)
      throw new Error(
        "This quiz is over 20 MB. Reduce image sizes before saving.",
      );
    await store.saveQuiz(current);
    scheduleDraft();
    showModal({
      title: "Quiz saved on this device",
      content: `<p class="muted"><strong>${escapeHTML(current.title)}</strong> is saved in this browser. Use Upload quiz to share it with others, or export its file.</p><div class="submit-overview"><div><strong>${current.questions.length}</strong>Questions</div><div><strong>${formatNumber(totalPoints(current))}</strong>Points</div><div><strong>${current.durationMinutes || "∞"}</strong>${current.durationMinutes ? "Minutes" : "Untimed"}</div></div>`,
      actions: `<button class="button secondary" id="saved-export">${icon("download")} Export file</button><a class="button primary" href="./quiz.html?id=${encodeURIComponent(current.id)}">Try the quiz ${icon("arrow")}</a>`,
      onMount: (d) => {
        $("#saved-export", d).onclick = exportQuiz;
      },
    });
  } catch (e) {
    toast(e.message, "error");
  }
};
$("#tab-file").onclick = () => setSourceMode(false);
$("#tab-source").onclick = () => setSourceMode(true);
$("#source").oninput = () => {
  source = $("#source").value;
  dirty = true;
  updateState();
  scheduleDraft();
};
$("#parse-source").onclick = parseSource;
$("#source-file").onchange = (e) => {
  importFile(e.target.files[0]);
  e.target.value = "";
};
$$("label[role=button]").forEach((label) =>
  label.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      document.getElementById(label.htmlFor).click();
    }
  }),
);
const drop = $("#dropzone");
for (const name of ["dragenter", "dragover"])
  drop.addEventListener(name, (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  drop.addEventListener(name, (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
  });
drop.addEventListener("drop", (e) => importFile(e.dataTransfer.files[0]));
$("#load-example").onclick = $("#preview-example").onclick = loadExample;
$("#syntax-help").onclick = () =>
  document.querySelector("[data-guide]").click();
function updatePresets() {
  $$("[data-minutes]").forEach((b) =>
    b.classList.toggle(
      "active",
      Number(b.dataset.minutes) === Number($("#quiz-duration").value),
    ),
  );
}
$$("[data-minutes]").forEach(
  (b) =>
    (b.onclick = () => {
      $("#quiz-duration").value = b.dataset.minutes;
      updatePresets();
      updateState();
      scheduleDraft();
    }),
);
fieldIds.forEach((id) =>
  $(`#${id}`).addEventListener("input", () => {
    updatePresets();
    updateState();
    scheduleDraft();
  }),
);
$("#show-keys").onchange = renderPreview;
$("#image-files").onchange = async (e) => {
  for (const file of e.target.files) {
    try {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        throw new Error(`${file.name}: use PNG, JPG, WebP, or GIF.`);
      if (file.size > 4 * 1024 * 1024)
        throw new Error(`${file.name}: reduce this image below 4 MB.`);
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("Image could not be read."));
        r.readAsDataURL(file);
      });
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error(`${file.name} is not a readable image.`));
        img.src = data;
      });
      assets[file.name] = data;
    } catch (error) {
      toast(error.message, "error");
    }
  }
  e.target.value = "";
  renderImages();
  renderPreview();
  scheduleDraft();
};
$("#discard-draft").onclick = () =>
  showModal({
    title: "Start a fresh draft?",
    content:
      '<p class="muted">Your current draft will be cleared. Quizzes already saved in your library will stay there.</p>',
    actions:
      '<button class="button secondary" id="keep-draft">Keep editing</button><button class="button primary" id="clear-draft">Fresh start</button>',
    onMount: (d, close) => {
      $("#keep-draft", d).onclick = close;
      $("#clear-draft", d).onclick = async () => {
        try {
          clearTimeout(draftTimer);
          await store.clearDraft();
          location.href = "./upload.html";
        } catch (e) {
          toast(e.message, "error");
        }
      };
    },
  });
async function init() {
  const edit = new URLSearchParams(location.search).get("edit");
  try {
    if (edit) {
      await initFirebase();
      current = validateQuiz(await loadQuiz(edit));
      const local = await store.getQuiz(edit);
      if (isCloudId(edit) && getSession().status === "ready") {
        const meta = await (await cloudRepository()).metadata(edit);
        if (meta.ownerId === getSession().user?.uid) {
          currentCloudId = edit;
          $("#cloud-visibility").value = meta.status;
        }
      }
      if (!local && !currentCloudId) {
        current.id = uid();
        current.title += " (copy)";
      }
      assets = { ...current.assets };
      filename = `${slug(current.title)}.quiz.json`;
      quizToForm(current);
      showFileInfo();
      renderImages();
      renderPreview();
      scheduleDraft();
    } else {
      const draft = await store.getDraft();
      if (draft) {
        current = draft.quiz;
        source = draft.source || "";
        filename = draft.filename || "";
        warnings = draft.warnings || [];
        assets = draft.assets || {};
        dirty = Boolean(draft.dirty);
        if (draft.cloudId && isCloudId(draft.cloudId)) {
          await initFirebase();
          if (getSession().user) {
            try {
              const meta = await (
                await cloudRepository()
              ).metadata(draft.cloudId);
              if (meta.ownerId === getSession().user.uid) {
                currentCloudId = draft.cloudId;
                $("#cloud-visibility").value =
                  draft.cloudVisibility || meta.status;
              }
            } catch {
              /* A removed or inaccessible upload becomes a new local draft. */
            }
          }
        }
        $("#source").value = source;
        restoreForm(draft.form);
        showFileInfo();
        renderImages();
        renderPreview();
        if (dirty) setSourceMode(true);
        $("#draft-status").textContent = dirty
          ? "Source changed · build preview"
          : "Draft restored";
      }
    }
  } catch (e) {
    toast(e.message, "error");
  }
}
init().finally(() => {
  $("#main").inert = false;
});

function updateCloudState() {
  const session = getSession(),
    ready = canPublish(session),
    allowed = canCreateQuiz(session);
  $(".cloud-panel").hidden = !ready;
  $("#publish-quiz").hidden = !ready;
  $(".builder-layout").hidden = !allowed;
  $(".builder-switch").hidden = !allowed;
  $(".heading-actions").hidden = !allowed;
  $(".page-top").hidden = !allowed;
  const gate = $("#upload-access");
  gate.hidden = allowed;
  if (!allowed) {
    const checking = session.status === "connecting" || session.roleLoading;
    gate.innerHTML = checking
      ? '<div class="panel-body"><p>Checking upload access…</p></div>'
      : `<div class="panel-body"><h2>${session.user ? "Upload access required" : "Sign in to upload"}</h2><p class="muted" style="margin:12px 0 18px">${session.status === "error" ? "Account access is temporarily unavailable. Try again later." : session.user ? (!session.user.emailVerified && ["teacher", "admin"].includes(session.role) ? "Verify your email before uploading quizzes." : "Upload permission has not been enabled for your account.") : "Upload access is available to approved accounts."}</p><a class="button primary" href="./login.html?returnTo=${encodeURIComponent(location.pathname + location.search)}">${session.user ? "Open account" : "Sign in"}</a></div>`;
  }
  $("#cloud-state-label").textContent = uploading ? "Saving…" : "Ready";
  $("#cloud-state-label").className = "badge green";
  $("#cloud-permission").textContent =
    "Images are included in the quiz. Choose who can see it.";
  $("#publish-quiz").disabled =
    !ready || !current || dirty || missingAssets().length > 0 || uploading;
  $("#publish-quiz").textContent = currentCloudId
    ? "Update quiz"
    : "Upload quiz";
  $("#cloud-visibility").disabled = uploading;
}
watchSession(updateCloudState);
$("#publish-quiz").onclick = () => {
  try {
    const quiz = fromForm(),
      status = $("#cloud-visibility").value;
    if (!canPublish(getSession()))
      throw new Error("A verified teacher account is required.");
    showModal({
      title: currentCloudId ? "Update this quiz?" : "Upload this quiz?",
      content: `<p class="muted"><strong>${escapeHTML(quiz.title)}</strong> · ${quiz.questions.length} questions · ${formatNumber(totalPoints(quiz))} points</p><div class="notice">${status === "published" ? "The quiz will be published in the shared library." : "The quiz will be saved as a private draft, visible only to your account."}</div>`,
      actions:
        '<button class="button secondary" id="cancel-publish">Cancel</button><button class="button primary" id="confirm-publish">Upload quiz</button>',
      onMount: (dialog, close) => {
        $("#cancel-publish", dialog).onclick = close;
        $("#confirm-publish", dialog).onclick = () => {
          close();
          performCloudUpload(quiz, status);
        };
      },
    });
  } catch (error) {
    toast(firebaseError(error), "error");
  }
};
async function performCloudUpload(quiz, status) {
  if (uploading) return;
  uploading = true;
  updateState();
  switchBuilder(false);
  $$(".builder-controls > section:not(.cloud-panel)").forEach((section) => {
    section.inert = true;
  });
  $("#cloud-upload-progress").hidden = false;
  $("#cloud-upload-result").innerHTML = "";
  if (innerWidth <= 800)
    $(".cloud-panel").scrollIntoView({ block: "start", behavior: "instant" });
  try {
    const result = await (
      await cloudRepository()
    ).uploadQuiz({
      quiz,
      status,
      existingId: currentCloudId,
    });
    current = { ...quiz, id: result.id };
    currentCloudId = result.id;
    scheduleDraft();
    $("#cloud-upload-result").innerHTML =
      `<div class="notice">${status === "published" ? "Quiz published." : "Private draft saved."} <a class="text-button" href="./quiz.html?id=${encodeURIComponent(result.id)}">Open quiz →</a></div>`;
    toast(status === "published" ? "Quiz published." : "Private draft saved.");
  } catch (error) {
    $("#cloud-upload-result").innerHTML =
      `<div class="notice error">${escapeHTML(firebaseError(error))}</div>`;
  } finally {
    uploading = false;
    $("#cloud-upload-progress").hidden = true;
    $$(".builder-controls > section:not(.cloud-panel)").forEach((section) => {
      section.inert = false;
    });
    updateState();
  }
}
