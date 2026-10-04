import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "For Tutor · Кабинет преподавателя",
  description:
    "Расписание, домашние задания, оплаты и отчеты для частных преподавателей.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
