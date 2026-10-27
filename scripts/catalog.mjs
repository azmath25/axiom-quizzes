import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateQuiz,
  totalPoints,
  imageReferences,
  resolveAsset,
  MAX_FILE_BYTES,
} from "../js/core.js";
export async function generateCatalog() {
  const folder = fileURLToPath(new URL("../quizzes/", import.meta.url));
  let previous = [];
  try {
    previous = JSON.parse(
      await readFile(path.join(folder, "index.json"), "utf8"),
    ).quizzes.map((q) => q.id);
  } catch {}
  const files = (await readdir(folder))
    .filter((name) => name.endsWith(".quiz.json"))
    .sort();
  const ids = new Set(),
    quizzes = [];
  for (const file of files) {
    if (!/^[a-zA-Z0-9_-]+\.quiz\.json$/.test(file))
      throw new Error(
        `${file}: use a filename with letters, numbers, underscores, and hyphens.`,
      );
    const source = await readFile(path.join(folder, file), "utf8");
    if (Buffer.byteLength(source) > MAX_FILE_BYTES)
      throw new Error(`${file}: quiz exceeds 20 MB.`);
    const q = validateQuiz(JSON.parse(source));
    if (ids.has(q.id))
      throw new Error(
        `${file}: duplicate quiz ID ${q.id}. Give each quiz its own ID.`,
      );
    ids.add(q.id);
    const missing = imageReferences(q).filter(
      (name) => !resolveAsset(q.assets, name),
    );
    if (missing.length)
      throw new Error(
        `${file}: missing embedded images: ${missing.join(", ")}.`,
      );
    const { id, title, description, subject, difficulty, durationMinutes } = q;
    quizzes.push({
      id,
      file,
      title,
      description,
      subject,
      difficulty,
      durationMinutes,
      questionCount: q.questions.length,
      points: totalPoints(q),
      openCount: q.questions.filter((q) => q.type === "open").length,
      choiceCount: q.questions.filter((q) => q.type === "choice").length,
    });
  }
  quizzes.sort((a, b) => {
    const ai = previous.indexOf(a.id),
      bi = previous.indexOf(b.id);
    return (ai < 0 ? 1e6 : ai) - (bi < 0 ? 1e6 : bi);
  });
  await writeFile(
    path.join(folder, "index.json"),
    JSON.stringify({ schemaVersion: 1, quizzes }, null, 2) + "\n",
  );
  return quizzes;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(`Catalog ready: ${(await generateCatalog()).length} quizzes.`);
