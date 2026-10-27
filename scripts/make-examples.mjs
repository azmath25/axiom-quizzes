import { readFile, writeFile } from "node:fs/promises";
import { parseLatex } from "../js/parser.js";
import { totalPoints } from "../js/core.js";
const root = new URL("../", import.meta.url);
const image = `data:image/png;base64,${(await readFile(new URL("examples/triangle.png", root))).toString("base64")}`;
const items = [];
for (const [source, id] of [
  ["starter.tex", "olympiad-warmup"],
  ["algebra.tex", "algebra-essentials"],
  ["geometry.tex", "geometry-perspective"],
]) {
  const { quiz } = parseLatex(
    await readFile(new URL(`examples/${source}`, root), "utf8"),
  );
  quiz.id = id;
  if (source !== "algebra.tex") quiz.assets = { "triangle.png": image };
  const file = `${id}.quiz.json`;
  await writeFile(
    new URL(`quizzes/${file}`, root),
    JSON.stringify(quiz, null, 2) + "\n",
  );
  const { title, description, subject, difficulty, durationMinutes } = quiz;
  items.push({
    id,
    file,
    title,
    description,
    subject,
    difficulty,
    durationMinutes,
    questionCount: quiz.questions.length,
    points: totalPoints(quiz),
    openCount: quiz.questions.filter((q) => q.type === "open").length,
    choiceCount: quiz.questions.filter((q) => q.type === "choice").length,
  });
}
await writeFile(
  new URL("quizzes/index.json", root),
  JSON.stringify({ schemaVersion: 1, quizzes: items }, null, 2) + "\n",
);
console.log("Generated 3 self-contained practice quizzes.");
