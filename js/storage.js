import { readPublishedCatalog } from "./published-catalog.js";
import { getSession } from "./firebase-client.js";
import { isCloudId, cloudRepository } from "./cloud-repository.js";
/** Device files and account-scoped local attempts; cloud quizzes use the Firebase repository. */
const DB_NAME = "axiom-quiz-v1";
const databases = new Map();
function open(name = DB_NAME) {
  if (!databases.has(name))
    databases.set(
      name,
      new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          for (const [name, keyPath] of [
            ["quizzes", "id"],
            ["attempts", "quizId"],
            ["drafts", "id"],
          ])
            request.result.createObjectStore(name, { keyPath });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            new Error(
              "Browser storage is unavailable. Allow site storage to save quizzes and progress.",
            ),
          );
      }),
    );
  return databases.get(name);
}
async function transaction(store, method, value, accountUid) {
  const uid = accountUid === undefined ? getSession().user?.uid : accountUid;
  const db = await open(
    store === "attempts" && uid ? `mathquiz-attempts-${uid}` : DB_NAME,
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      store,
      method === "get" || method === "getAll" ? "readonly" : "readwrite",
    );
    const request = tx.objectStore(store)[method](value);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(
        new Error(
          tx.error?.name === "QuotaExceededError"
            ? "Browser storage is full. Export the quiz file and remove unused quizzes."
            : "Could not save browser data. Export your quiz before leaving.",
        ),
      );
    tx.onabort = () =>
      reject(new Error("The save was interrupted. Please try again."));
  });
}
export const store = {
  quizzes: () => transaction("quizzes", "getAll"),
  getQuiz: (id) => transaction("quizzes", "get", id),
  saveQuiz: (quiz) => transaction("quizzes", "put", quiz),
  deleteQuiz: (id) => transaction("quizzes", "delete", id),
  attempts: () => transaction("attempts", "getAll"),
  getAttempt: (quizId) => transaction("attempts", "get", quizId),
  saveAttempt: (attempt, accountUid) =>
    transaction("attempts", "put", attempt, accountUid),
  clearAttempt: (quizId) => transaction("attempts", "delete", quizId),
  getDraft: () => transaction("drafts", "get", "current"),
  saveDraft: (draft) =>
    transaction("drafts", "put", { ...draft, id: "current" }),
  clearDraft: () => transaction("drafts", "delete", "current"),
};
let catalog;
export function resetCatalog() {
  catalog = null;
}
export function attemptRecoveryKey(quizId) {
  return `mathquiz-live-${getSession().user?.uid || "guest"}-${quizId}`;
}
export async function getCatalog() {
  if (!catalog) catalog = await readPublishedCatalog();
  return catalog;
}
export async function loadQuiz(id) {
  if (isCloudId(id) && getSession().status !== "unconfigured")
    return (await cloudRepository()).loadQuiz(id);
  const local = await store.getQuiz(id);
  if (local) return local;
  const items = await getCatalog(),
    item = items.find((q) => q.id === id);
  if (!item)
    throw new Error(
      "Quiz not found. Import its .quiz.json file on the upload page.",
    );
  // Repository paths stay inside quizzes/, including on GitHub project Pages.
  if (!/^[a-zA-Z0-9_-]+\.quiz\.json$/.test(item.file))
    throw new Error("Invalid catalog filename.");
  const response = await fetch(`./quizzes/${item.file}`, { cache: "no-cache" });
  if (!response.ok) throw new Error("This quiz file could not be loaded.");
  return response.json();
}
