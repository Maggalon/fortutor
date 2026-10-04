import { legalDocuments } from "@/lib/legal";

export default function LegalLinks({ compact = false }: { compact?: boolean }) {
  const links = compact
    ? legalDocuments.filter((item) =>
        [
          "pricing",
          "requisites",
          "offer",
          "payment",
          "privacy",
          "contacts",
        ].includes(item.slug),
      )
    : legalDocuments;
  return (
    <nav className="legal-links" aria-label="Информация о сервисе и документы">
      {links.map((item) => (
        <a key={item.slug} href={`/${item.slug}`}>
          {item.title}
        </a>
      ))}
    </nav>
  );
}
