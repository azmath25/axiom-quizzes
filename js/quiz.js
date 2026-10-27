import {
  $,
  $$,
  icon,
  escapeHTML,
  toast,
  showModal,
  downloadFile,
  slug,
  formatNumber,
  formatTime,
  mountQuizHeader,
} from "./common.js";
import { store, loadQuiz, attemptRecoveryKey } from "./storage.js";
import { initFirebase, getSession, watchSession } from "./firebase-client.js";
import { firebaseError } from "./firebase-core.js";
import { cloudRepository } from "./cloud-repository.js";
mountQuizHeader();
import {
  validateQuiz,
  totalPoints,
  makeAttempt,
  remainingSeconds,
  elapsedSeconds,
  gradeAttempt,
} from "./core.js";
import { latexHTML, typeset, clearMath } from "./render.js";
let originalQuiz,
  quiz,
  attempt,
  timerId,
  saveTimer,
  mathTimer,
  saveChain = Promise.resolve(),
  finishing = false,
  starting = false,
  roomActive = false,
  saveErrorShown = false,
  reviewFilter = "all";
let activeAccount = "guest",
  accountInitialized = false,
  syncTimer,
  syncMessage = "",
  syncFailed = false;
const root = $("#quiz-app"),
  id = new URLSearchParams(location.search).get("id");
function showError(message) {
  root.innerHTML = `<div class="setup-wrap panel"><div class="panel-body"><h2>Quiz unavailable</h2><p class="muted" style="margin:12px 0 20px">${escapeHTML(message)}</p><a class="button primary" href="./index.html">${icon("back")} Back to library</a></div></div>`;
}
function saveFailure(error) {
  if (!saveErrorShown) {
    toast(
      error.message || "Progress could not be saved in this browser.",
      "error",
    );
    saveErrorShown = true;
  }
  if ($("#save-state"))
    $("#save-state").textContent = "Browser save unavailable";
}
function queueSave() {
  const snapshot = structuredClone(attempt);
  const accountUid = getSession().user?.uid || null;
  saveChain = saveChain
    .catch(() => {})
    .then(() => store.saveAttempt(snapshot, accountUid));
  saveChain.catch(saveFailure);
  return saveChain;
}
function persist(immediate = false) {
  if (
    accountInitialized &&
    (getSession().user?.uid || "guest") !== activeAccount
  )
    return Promise.resolve();
  // A small synchronous recovery record protects typing between IndexedDB saves.
  try {
    localStorage.setItem(
      attemptRecoveryKey(quiz.id),
      JSON.stringify({
        id: attempt.id,
        answers: attempt.answers,
        flags: attempt.flags,
        current: attempt.current,
        furthest: attempt.furthest,
        manualScores: attempt.manualScores,
        submittedAt: attempt.submittedAt,
        timedOut: attempt.timedOut,
      }),
    );
  } catch (e) {
    saveFailure(
      new Error(
        "Live recovery is unavailable. Keep this tab open until the quiz is complete.",
      ),
    );
  }
  clearTimeout(saveTimer);
  if (immediate) return queueSave();
  saveTimer = setTimeout(queueSave, 500);
}
function recover(saved) {
  try {
    const live = JSON.parse(
      localStorage.getItem(attemptRecoveryKey(saved.quizId)) ||
        (!getSession().user
          ? localStorage.getItem(`axiom-live-${saved.quizId}`)
          : null),
    );
    if (live?.id === saved.id) {
      for (const field of [
        "answers",
        "flags",
        "current",
        "furthest",
        "manualScores",
        "submittedAt",
        "timedOut",
      ])
        if (live[field] !== undefined) saved[field] = live[field];
    }
  } catch {}
  return saved;
}
function renderSetup() {
  roomActive = false;
  quiz = originalQuiz;
  document.title = `${quiz.title} · Math quizzes`;
  const inProgress = attempt && !attempt.submittedAt,
    completed = attempt?.submittedAt;
  const durations = [
    ...new Set([quiz.durationMinutes, 0, 10, 20, 30, 45, 60, 90, 120]),
  ].sort((a, b) => a - b);
  clearMath(root);
  root.innerHTML = `<div class="setup-wrap"><section class="setup-card"><span class="badge">${escapeHTML(quiz.subject)} · ${escapeHTML(quiz.difficulty)}</span><h1>${escapeHTML(quiz.title)}</h1>${quiz.description ? `<p>${escapeHTML(quiz.description)}</p>` : ""}<div class="setup-metrics"><div><strong>${quiz.questions.length}</strong><small>QUESTIONS</small></div><div><strong>${formatNumber(totalPoints(quiz))}</strong><small>POINTS</small></div><div><strong>${quiz.questions.every((q) => q.type === "open") ? "Open" : quiz.questions.some((q) => q.type === "open") ? "Mixed" : "Choice"}</strong><small>FORMAT</small></div></div>${inProgress ? `<div class="resume-notice"><strong>Attempt in progress</strong><p>${Object.values(attempt.answers).filter((a) => String(a).trim()).length} answers saved. ${attempt.deadline ? "The original timer is still running." : ""}</p></div>` : ""}<div class="setup-settings"><div><strong>Time limit</strong><small>Choose untimed to remove the limit</small></div><label class="setup-time-select"><span class="sr-only">Time limit</span><select id="start-duration">${durations.map((n) => `<option value="${n}" ${n === quiz.durationMinutes ? "selected" : ""}>${n ? `${n} minutes` : "Untimed"}${n === quiz.durationMinutes ? " · default" : ""}</option>`).join("")}</select></label></div><div class="setup-notes"><div class="setup-note">${icon("save")} Progress is saved on this device.</div><div class="setup-note">${icon("clock")} Answers submit automatically when time expires.</div><div class="setup-note">${icon("list")} ${quiz.settings.allowBack ? "You can revisit questions before submitting." : "Forward only: previous questions cannot be revisited."}</div>${quiz.settings.penalty ? `<div class="setup-note">${icon("info")} Wrong-answer penalty: ${formatNumber(quiz.settings.penalty)} points. Unanswered questions earn zero.</div>` : ""}${quiz.questions.some((q) => q.answerMode === "manual") ? `<div class="setup-note">${icon("info")} Written responses need self-marking after submission.</div>` : ""}</div><div class="setup-actions">${inProgress ? `<button class="button primary" id="resume-quiz">Resume ${icon("arrow")}</button><button class="button secondary" id="fresh-attempt">New attempt</button>` : `<button class="button primary" id="start-quiz">${completed ? "Start new attempt" : "Start quiz"} ${icon("arrow")}</button>`}</div></section></div>`;
  if (inProgress) {
    $("#resume-quiz").onclick = () => {
      quiz = validateQuiz(attempt.quizSnapshot);
      roomActive = true;
      renderRoom();
      tick();
    };
    $("#fresh-attempt").onclick = () =>
      showModal({
        title: "Replace the current attempt?",
        content:
          '<p class="muted">A new attempt replaces your current answers and starts a new timer.</p>',
        actions:
          '<button class="button secondary" id="keep-attempt">Cancel</button><button class="button primary" id="replace-attempt">Start new attempt</button>',
        onMount: (dialog, close) => {
          $("#keep-attempt", dialog).onclick = close;
          $("#replace-attempt", dialog).onclick = () => {
            close();
            start();
          };
        },
      });
  } else $("#start-quiz").onclick = start;
}
async function start() {
  if (starting) return;
  starting = true;
  const minutes = Number($("#start-duration").value);
  quiz = originalQuiz;
  attempt = makeAttempt(quiz, { durationMinutes: minutes });
  finishing = false;
  roomActive = true;
  try {
    await persist(true);
  } catch {}
  renderRoom();
  startTimer();
  starting = false;
}
function startTimer() {
  clearInterval(timerId);
  timerId = setInterval(tick, 1000);
  tick();
}
function tick() {
  if (!attempt || attempt.submittedAt || finishing) return;
  const left = remainingSeconds(attempt);
  if (left !== null && left <= 0) {
    finish(true);
    return;
  }
  const time = $("#time-remaining");
  if (time) {
    time.textContent =
      left === null ? formatTime(elapsedSeconds(attempt)) : formatTime(left);
    $("#timer").classList.toggle("low", left !== null && left <= 60);
  }
}
function answered(qid) {
  return String(attempt.answers[qid] ?? "").trim() !== "";
}
function canAnswer() {
  if (attempt.submittedAt || finishing) return false;
  if (remainingSeconds(attempt) === 0) {
    finish(true);
    return false;
  }
  return true;
}
function navHTML() {
  const count = attempt.order.filter(answered).length;
  return `<h2>Question overview</h2><p class="answered-counter">${count} of ${attempt.order.length} answered</p><div class="mini-progress"><span style="width:${(100 * count) / attempt.order.length}%"></span></div><div class="number-grid">${attempt.order.map((qid, i) => `<button data-jump="${i}" class="${i === attempt.current ? "current " : ""}${answered(qid) ? "answered " : ""}${attempt.flags.includes(qid) ? "flagged" : ""}" ${!quiz.settings.allowBack && (i < attempt.current || i > attempt.current + 1) ? "disabled" : ""} ${i === attempt.current ? 'aria-current="step"' : ""} aria-label="Question ${i + 1}${answered(qid) ? ", answered" : ""}${attempt.flags.includes(qid) ? ", flagged" : ""}">${i + 1}</button>`).join("")}</div><div class="nav-legend"><span><i class="legend-square"></i>Answered</span><span><i class="legend-square flagged"></i>Flagged for review</span></div>`;
}
function updateNav() {
  const el = $("#question-nav");
  if (el) {
    el.innerHTML = navHTML();
    $$("[data-jump]", el).forEach(
      (b) => (b.onclick = () => navigate(Number(b.dataset.jump))),
    );
  }
}
function renderRoom() {
  clearMath(root);
  const left = remainingSeconds(attempt);
  root.innerHTML = `<section class="room-top"><div><div class="eyebrow">QUIZ IN PROGRESS</div><h1>${escapeHTML(quiz.title)}</h1></div><div class="timer" id="timer">${icon("clock")}<div><small>${left === null ? "TIME ELAPSED" : "TIME REMAINING"}</small><strong id="time-remaining" role="timer">${formatTime(left === null ? elapsedSeconds(attempt) : left)}</strong></div></div></section><div class="room-layout"><aside class="question-nav" id="question-nav" aria-label="Question navigation"></aside><section class="room-column"><div id="question-slot"></div><div class="question-actions"><button class="button secondary" id="previous-question">${icon("back")} Previous</button><div class="question-actions-right"><button class="button ghost" id="submit-early">Finish quiz</button><button class="button primary" id="next-question">Next question ${icon("arrow")}</button></div></div><p class="room-footnote"><span class="status-dot"></span><span id="save-state">${saveErrorShown ? "Browser save unavailable" : "Your progress is saved on this device"}</span></p></section></div>`;
  updateNav();
  renderQuestion();
  tick();
}
function currentQuestion() {
  return quiz.questions.find((q) => q.id === attempt.order[attempt.current]);
}
function renderQuestion() {
  const q = currentQuestion(),
    value = attempt.answers[q.id] ?? "",
    last = attempt.current === attempt.order.length - 1,
    slot = $("#question-slot");
  clearMath(slot);
  slot.innerHTML = `<div class="progress-caption"><strong>Question ${attempt.current + 1}</strong><span>of ${attempt.order.length}</span><span class="badge gray">${q.type === "choice" ? "MULTIPLE CHOICE" : q.answerMode === "manual" ? "WRITTEN RESPONSE" : "OPEN ANSWER"}</span></div><article class="question-card"><div class="question-card-top"><span class="badge">${formatNumber(q.points)} ${q.points === 1 ? "point" : "points"}</span><button class="flag-button ${attempt.flags.includes(q.id) ? "active" : ""}" id="flag-question" aria-pressed="${attempt.flags.includes(q.id)}">${icon("flag")} ${attempt.flags.includes(q.id) ? "Flagged" : "Flag for later"}</button></div><div class="problem-text" id="problem-statement">${latexHTML(q.prompt, quiz.assets)}</div>${
    q.type === "choice"
      ? `<fieldset class="answer-options" style="border:0;padding:0"><legend class="sr-only">Choose one answer</legend>${(
          attempt.optionOrder[q.id] || q.options.map((o) => o.id)
        )
          .map((oid, j) => {
            const o = q.options.find((v) => v.id === oid);
            return `<label class="answer-option ${value === o.id ? "selected" : ""}"><input type="radio" name="answer" value="${escapeHTML(o.id)}" ${value === o.id ? "checked" : ""}><span class="option-letter">${String.fromCharCode(65 + j)}</span><span class="problem-text">${latexHTML(o.text, quiz.assets)}</span><span class="choice-check" aria-hidden="true"></span></label>`;
          })
          .join("")}</fieldset>`
      : `<div class="open-answer-wrap"><label for="open-answer">${q.answerMode === "manual" ? "Your solution" : "Your answer"}</label>${q.answerMode === "manual" ? `<textarea id="open-answer" maxlength="10000" placeholder="Explain your reasoning. You can use $LaTeX$ for mathematics.">${escapeHTML(value)}</textarea>` : `<input id="open-answer" type="text" inputmode="text" maxlength="500" autocomplete="off" spellcheck="false" placeholder="e.g. 3/2, sqrt(2), or a text answer" value="${escapeHTML(value)}">`}<p class="field-help">${q.answerMode === "manual" ? "You’ll assign points to this response after submission." : "Supports fractions, decimals, powers, and roots. Use a dot for decimals."}</p><div class="open-math-preview" id="answer-preview" aria-hidden="true"></div></div>`
  }<button class="text-button clear-answer" id="clear-answer" ${value ? "" : "hidden"}>Clear answer</button></article>`;
  $("#flag-question").onclick = () => {
    const at = attempt.flags.indexOf(q.id);
    if (at < 0) attempt.flags.push(q.id);
    else attempt.flags.splice(at, 1);
    persist();
    updateNav();
    const b = $("#flag-question");
    b.classList.toggle("active", at < 0);
    b.setAttribute("aria-pressed", at < 0);
    b.innerHTML = `${icon("flag")} ${at < 0 ? "Flagged" : "Flag for later"}`;
  };
  $$("input[name=answer]").forEach(
    (r) =>
      (r.onchange = () => {
        if (!canAnswer()) return;
        attempt.answers[q.id] = r.value;
        $$(".answer-option").forEach((o) =>
          o.classList.toggle("selected", o.contains(r)),
        );
        $("#clear-answer").hidden = false;
        persist();
        updateNav();
      }),
  );
  if (q.type === "open") {
    $("#open-answer").oninput = (e) => {
      if (!canAnswer()) return;
      attempt.answers[q.id] = e.target.value;
      $("#clear-answer").hidden = !e.target.value;
      persist();
      updateNav();
      clearTimeout(mathTimer);
      mathTimer = setTimeout(() => renderAnswerPreview(q), 250);
    };
    renderAnswerPreview(q);
  }
  $("#clear-answer").onclick = () => {
    delete attempt.answers[q.id];
    persist();
    updateNav();
    renderQuestion();
  };
  $("#previous-question").disabled =
    attempt.current === 0 || !quiz.settings.allowBack;
  $("#previous-question").onclick = () => navigate(attempt.current - 1);
  $("#next-question").innerHTML = last
    ? `Submit quiz ${icon("check")}`
    : `Next question ${icon("arrow")}`;
  $("#next-question").onclick = () =>
    last ? confirmSubmit() : navigate(attempt.current + 1);
  $("#submit-early").onclick = confirmSubmit;
  $("#submit-early").hidden = last;
  typeset(slot);
}
function renderAnswerPreview(q) {
  const el = $("#answer-preview");
  if (!el || q.id !== currentQuestion().id) return;
  const value = String(attempt.answers[q.id] || "");
  clearMath(el);
  el.hidden =
    !value || (q.answerMode === "manual" && !/\$|\\\(|\\\[/.test(value));
  if (el.hidden) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    q.answerMode === "manual"
      ? latexHTML(value, quiz.assets)
      : value
        ? latexHTML(`\\(${value.replace(/\$/g, "")}\\)`, quiz.assets)
        : "";
  typeset(el);
}
function navigate(index) {
  if (!canAnswer()) return;
  if (index < 0 || index >= attempt.order.length) return;
  if (
    !quiz.settings.allowBack &&
    (index < attempt.current || index > attempt.current + 1)
  )
    return;
  attempt.current = index;
  attempt.furthest = Math.max(attempt.furthest, index);
  persist();
  updateNav();
  renderQuestion();
  if (innerWidth <= 600)
    $("#question-slot").scrollIntoView({ block: "start", behavior: "instant" });
}
function confirmSubmit() {
  tick();
  if (attempt.submittedAt || finishing) return;
  const count = attempt.order.filter(answered).length,
    skipped = attempt.order.length - count;
  showModal({
    title: "Submit quiz?",
    content: `<p class="muted">Submit your answers to see your score and question-by-question results.${skipped ? ` You have ${skipped} unanswered ${skipped === 1 ? "question" : "questions"}.` : ""}</p><div class="submit-overview"><div><strong>${count}</strong>Answered</div><div><strong>${skipped}</strong>Unanswered</div><div><strong>${attempt.flags.length}</strong>Flagged</div></div>`,
    actions:
      '<button class="button secondary" id="continue-solving">Keep solving</button><button class="button primary" id="confirm-submit">Submit quiz</button>',
    onMount: (d, close) => {
      $("#continue-solving").onclick = close;
      $("#confirm-submit").onclick = () => {
        close();
        finish(false);
      };
    },
  });
}
async function finish(timedOut) {
  if (finishing || attempt.submittedAt) return;
  finishing = true;
  clearInterval(timerId);
  clearTimeout(saveTimer);
  $("#app-modal")?.close();
  timedOut = timedOut || remainingSeconds(attempt) === 0;
  quiz = validateQuiz(attempt.quizSnapshot);
  attempt.submittedAt =
    timedOut && attempt.deadline ? attempt.deadline : Date.now();
  attempt.timedOut = Boolean(timedOut);
  roomActive = false;
  renderResults();
  try {
    await persist(true);
  } catch {}
  finishing = false;
  scheduleResultSync();
}
function renderResults() {
  clearInterval(timerId);
  roomActive = false;
  clearMath(root);
  const g = gradeAttempt(quiz, attempt),
    percentage = Math.max(
      0,
      Math.min(100, Math.round((100 * g.score) / g.possible)),
    );
  const counters = [
    ["correct", g.correct, "Correct", "check"],
    ["incorrect", g.incorrect, "Incorrect", "x"],
    ["skipped", g.skipped, "Unanswered", "list"],
    ...(g.pending ? [["pending", g.pending, "To self-mark", "clock"]] : []),
    ...(g.partial ? [["pending", g.partial, "Partial credit", "trophy"]] : []),
  ];
  root.innerHTML = `<div class="results-wrap"><section class="results-heading"><div><h1>Results</h1><p>${escapeHTML(quiz.title)}</p></div>${attempt.timedOut ? '<span class="badge amber">Time limit reached</span>' : ""}</section>${g.pending ? `<div class="notice warning" style="margin-bottom:16px">${g.pending} written ${g.pending === 1 ? "response needs" : "responses need"} self-marking. The score below is provisional.</div>` : ""}<section class="results-score" aria-label="Quiz score"><div class="score-ring" style="--progress:${percentage}%"><span>${percentage}%<small>${g.pending ? "PROVISIONAL" : "SCORE"}</small></span></div><div class="score-detail"><h2>${formatNumber(g.score)} <span>/ ${formatNumber(g.possible)} points</span></h2><p>${g.pending ? "Assign points to the written responses below." : `${g.correct} correct, ${g.incorrect} incorrect, ${g.skipped} unanswered.`}</p><div class="result-time">${icon("clock")} ${formatTime(elapsedSeconds(attempt))} time taken${quiz.settings.penalty ? ` · −${formatNumber(quiz.settings.penalty)} per wrong answer` : ""}</div></div></section><section class="result-counters" aria-label="Result breakdown">${counters.map(([status, count, label, name]) => `<div class="result-counter"><span class="counter-dot ${status}">${icon(name)}</span><div><strong>${count}</strong><small>${label}</small></div></div>`).join("")}</section><div id="result-sync" class="result-sync"></div><div class="results-buttons"><button class="button primary" id="retake">${icon("refresh")} New attempt</button><button class="button secondary" id="download-results">${icon("download")} Export result</button><a class="button secondary" href="./index.html">${icon("grid")} Quizzes</a></div><div class="review-heading"><h2>Review answers</h2><label><span class="sr-only">Filter results</span><select id="review-filter"><option value="all">All questions</option><option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="skipped">Unanswered</option><option value="pending">To self-mark</option><option value="partial">Partial credit</option></select></label></div><div class="review-list" id="review-list"></div>${quiz.settings.showSolutions ? "" : '<p class="results-footer">Answer keys and solutions are hidden for this quiz.</p>'}</div>`;
  $("#retake").onclick = () => {
    syncMessage = "";
    renderSetup();
    window.scrollTo({ top: 0 });
  };
  $("#download-results").onclick = exportResults;
  $("#review-filter").value = reviewFilter;
  $("#review-filter").onchange = (event) => {
    reviewFilter = event.target.value;
    renderReview();
  };
  renderReview();
  updateSyncMessage();
}
function resultSignature() {
  return `${attempt.submittedAt}:${JSON.stringify(attempt.manualScores || {})}`;
}
function updateSyncMessage() {
  const el = $("#result-sync");
  if (!el) return;
  el.classList.toggle("error", syncFailed);
  if (!getSession().user) {
    el.textContent = "Result saved on this device.";
    return;
  }
  el.innerHTML = `<span>${escapeHTML(syncMessage || (attempt.cloudSyncedSignature === resultSignature() ? "Result saved to your account." : "Result saved on this device."))}</span>${syncFailed ? '<button class="text-button" id="retry-result-sync">Retry sync</button>' : ""}`;
  $("#retry-result-sync")?.addEventListener("click", () => syncResult());
}
function scheduleResultSync() {
  if (!getSession().user || !attempt?.submittedAt) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncResult(), 500);
}
async function syncResult() {
  const owner = getSession().user?.uid;
  if (!owner || !attempt?.submittedAt) return;
  const attemptId = attempt.id,
    signature = resultSignature(),
    snapshot = structuredClone(attempt),
    quizSnapshot = structuredClone(quiz);
  syncMessage = "Saving result to your account…";
  syncFailed = false;
  updateSyncMessage();
  try {
    await (await cloudRepository()).saveResult(quizSnapshot, snapshot, owner);
    if (attempt.id !== attemptId || getSession().user?.uid !== owner) return;
    attempt.cloudSyncedSignature = signature;
    syncMessage = "Result saved to your account.";
    persist();
  } catch (error) {
    if (attempt.id !== attemptId || getSession().user?.uid !== owner) return;
    syncMessage = `Saved on this device. Account sync failed: ${firebaseError(error)}`;
    syncFailed = true;
  }
  updateSyncMessage();
}
function renderReview() {
  const results = gradeAttempt(quiz, attempt).results,
    el = $("#review-list");
  clearMath(el);
  const visible = attempt.order
    .map((qid, index) => ({
      q: quiz.questions.find((q) => q.id === qid),
      r: results.find((r) => r.questionId === qid),
      index,
    }))
    .filter(({ r }) => reviewFilter === "all" || r.status === reviewFilter);
  el.innerHTML = visible.length
    ? visible
        .map(({ q, r, index }) => {
          const value = attempt.answers[q.id],
            yourAnswer =
              q.type === "choice"
                ? q.options.find((o) => o.id === value)?.text
                : value;
          const key =
            q.type === "choice"
              ? q.options.find((o) => o.id === q.answer)?.text
              : q.answers.join(" or ");
          const labels = {
            correct: "Correct",
            incorrect: "Incorrect",
            skipped: "Unanswered",
            pending: "Self-mark",
            partial: "Partial",
          };
          return `<details class="review-item" ${["incorrect", "pending", "partial"].includes(r.status) ? "open" : ""}><summary><span class="review-title">Question ${index + 1}</span><span class="review-status ${r.status}">${labels[r.status]}</span><span class="review-points">${formatNumber(r.awarded)} / ${formatNumber(q.points)} pts</span>${icon("chevron", "chevron-icon")}</summary><div class="review-body"><div class="problem-text">${latexHTML(q.prompt, quiz.assets)}</div><div class="review-answers"><div><h4>Your ${q.answerMode === "manual" ? "response" : "answer"}</h4><div class="problem-text">${yourAnswer ? latexHTML(String(yourAnswer), quiz.assets) : "No answer given"}</div></div>${quiz.settings.showSolutions && q.answerMode !== "manual" ? `<div><h4>Correct answer</h4><div class="problem-text">${latexHTML(key, quiz.assets)}</div></div>` : ""}</div>${quiz.settings.showSolutions && q.explanation ? `<div class="review-explanation"><strong>${q.answerMode === "manual" ? "Solution / marking guide" : "Solution"}</strong><div class="problem-text">${latexHTML(q.explanation, quiz.assets)}</div></div>` : ""}${q.answerMode === "manual" && value ? `<div class="manual-mark"><label for="mark-${escapeHTML(q.id)}">Your points (0–${formatNumber(q.points)})</label><input type="number" id="mark-${escapeHTML(q.id)}" min="0" max="${q.points}" step="any" value="${attempt.manualScores[q.id] ?? ""}" placeholder="—"><button class="button secondary" data-mark="${escapeHTML(q.id)}">${r.status === "pending" ? "Assign points" : "Update points"}</button></div>` : ""}</div></details>`;
        })
        .join("")
    : '<div class="notice">No questions match this filter.</div>';
  $$("[data-mark]", el).forEach(
    (b) =>
      (b.onclick = () => {
        const q = quiz.questions.find((q) => q.id === b.dataset.mark),
          input = document.getElementById(`mark-${q.id}`),
          value = Number(input.value);
        if (
          input.value === "" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > q.points
        ) {
          toast(
            `Assign a score between 0 and ${formatNumber(q.points)}.`,
            "error",
          );
          return;
        }
        attempt.manualScores[q.id] = value;
        persist();
        syncMessage = "";
        renderResults();
        scheduleResultSync();
      }),
  );
  typeset(el);
}
function exportResults() {
  const graded = gradeAttempt(quiz, attempt);
  downloadFile(
    {
      schemaVersion: 1,
      quizId: quiz.id,
      quizTitle: quiz.title,
      attemptId: attempt.id,
      startedAt: new Date(attempt.startedAt).toISOString(),
      submittedAt: new Date(attempt.submittedAt).toISOString(),
      timedOut: attempt.timedOut,
      timeTakenSeconds: elapsedSeconds(attempt),
      summary: {
        correct: graded.correct,
        incorrect: graded.incorrect,
        unanswered: graded.skipped,
        pending: graded.pending,
        partial: graded.partial,
        points: graded.score,
        possiblePoints: graded.possible,
      },
      questions: attempt.order.map((qid) => {
        const q = quiz.questions.find((q) => q.id === qid),
          r = graded.results.find((r) => r.questionId === qid);
        return {
          questionId: qid,
          prompt: q.prompt,
          answer: attempt.answers[qid] ?? null,
          ...r,
          possiblePoints: q.points,
        };
      }),
    },
    `${slug(quiz.title)}-results.json`,
  );
  toast("Your results are downloaded.");
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
window.addEventListener("pagehide", () => {
  if (attempt) persist(true);
});
document.addEventListener("keydown", (e) => {
  if (
    !roomActive ||
    $("#app-modal") ||
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
  )
    return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    navigate(attempt.current + 1);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    navigate(attempt.current - 1);
  }
});
async function init() {
  await initFirebase();
  activeAccount = getSession().user?.uid || "guest";
  accountInitialized = true;
  if (!id) {
    showError(
      "Choose a quiz from your library, or upload a LaTeX problem set to create one.",
    );
    return;
  }
  try {
    const loaded = await Promise.allSettled([
      loadQuiz(id),
      store.getAttempt(id),
    ]);
    const saved = loaded[1].status === "fulfilled" ? loaded[1].value : null;
    if (loaded[0].status === "fulfilled")
      originalQuiz = validateQuiz(loaded[0].value);
    else if (saved?.quizSnapshot)
      originalQuiz = validateQuiz(saved.quizSnapshot);
    else throw loaded[0].reason;
    quiz = originalQuiz;
    if (saved) {
      attempt = recover(saved);
      quiz = validateQuiz(attempt.quizSnapshot);
    }
    document.title = `${quiz.title} · Math quizzes`;
    if (attempt?.submittedAt) {
      renderResults();
      if (attempt.cloudSyncedSignature !== resultSignature())
        scheduleResultSync();
    } else if (attempt && remainingSeconds(attempt) === 0) await finish(true);
    else {
      renderSetup();
      if (attempt) startTimer();
    }
  } catch (e) {
    showError(e.message);
  }
}
watchSession((session) => {
  const scope = session.user?.uid || "guest";
  if (accountInitialized && scope !== activeAccount) {
    clearInterval(timerId);
    clearTimeout(saveTimer);
    clearTimeout(syncTimer);
    location.reload();
  }
});
init();
