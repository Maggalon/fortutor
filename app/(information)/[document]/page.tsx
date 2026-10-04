import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LEGAL_DATE,
  LEGAL_VERSION,
  legalDocuments,
  merchant,
} from "@/lib/legal";
import LegalDocument from "@/components/legal-documents";
import LegalLinks from "@/components/legal-links";

type Props = { params: Promise<{ document: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return legalDocuments.map((item) => ({ document: item.slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { document } = await params;
  const item = legalDocuments.find((page) => page.slug === document);
  if (!item) notFound();
  return {
    title: `${item.title} · For Tutor`,
    description: item.summary,
    alternates: { canonical: `${merchant.site}/${item.slug}` },
  };
}
export default async function InformationPage({ params }: Props) {
  const { document } = await params;
  const item = legalDocuments.find((page) => page.slug === document);
  if (!item) notFound();
  return (
    <div className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/">
          for tutor<span className="brand-period">.</span>
        </a>
        <a href="/">Открыть кабинет ↗</a>
      </header>
      <div className="legal-layout">
        <aside className="legal-sidebar">
          <span className="eyebrow">О СЕРВИСЕ</span>
          <nav aria-label="Информационные страницы">
            {legalDocuments.map((page) => (
              <a
                key={page.slug}
                href={`/${page.slug}`}
                aria-current={page.slug === document ? "page" : undefined}
              >
                {page.title}
              </a>
            ))}
          </nav>
        </aside>
        <main className="legal-article">
          <span className="eyebrow">FOR TUTOR · ИНФОРМАЦИЯ</span>
          <h1>{item.title}</h1>
          <p className="legal-lead">{item.summary}</p>
          <p className="legal-edition">
            Редакция от {LEGAL_DATE} · версия {LEGAL_VERSION}
          </p>
          <LegalDocument slug={item.slug} />
        </main>
      </div>
      <footer className="legal-footer">
        <p>
          {merchant.name} · самозанятый · ИНН {merchant.inn}
        </p>
        <LegalLinks />
      </footer>
    </div>
  );
}
