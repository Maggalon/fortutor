import test from "node:test";
import strict from "node:assert/strict";
import { plainReportText } from "../lib/reports";

test("Parent reports remove Markdown headings and emphasis while retaining paragraphs and facts", () => {
  strict.equal(
    plainReportText(
      "## **Как прошли занятия**\r\n\r\nПроведено **2 занятия**.\r\n\r\n__Что получается__\r\nОценка: *8 из 10*.\r\n\r\n### Над чем поработать\r\nПовторить `x = 2 * 3`.\r\n\r\n**Следующий шаг**\r\nРешить _уравнения_.",
    ),
    "Как прошли занятия\n\nПроведено 2 занятия.\n\nЧто получается\nОценка: 8 из 10.\n\nНад чем поработать\nПовторить x = 2 * 3.\n\nСледующий шаг\nРешить уравнения.",
  );
});

test("Parent reports preserve links, list items and text inside Markdown blocks", () => {
  strict.equal(
    plainReportText(
      "```text\nСледующий шаг\n```\n\n> Повторить материал.\n- [Задание](https://example.org/task)\n* Проверить ~~лишние~~ знаки.\n\n---",
    ),
    "Следующий шаг\n\nПовторить материал.\n• Задание (https://example.org/task)\n• Проверить лишние знаки.",
  );
  const plain = "Оценка: 8 из 10.\n\nПример: 2 * 3 = 6; exercise_id = 1.";
  strict.equal(plainReportText(plain), plain);
});
