"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading">
      <h1>Не удалось открыть кабинет</h1>
      <p>Попробуйте обновить страницу.</p>
      <button onClick={reset}>Повторить</button>
    </main>
  );
}
