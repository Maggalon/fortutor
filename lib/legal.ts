export const LEGAL_VERSION = "2026-10-04-v1";
export const LEGAL_DATE = "4 октября 2026 года";
export const merchant = {
  name: "Новицкий Георгий Станиславович",
  status: "Самозанятый, плательщик налога на профессиональный доход (НПД)",
  inn: "280131530657",
  city: "Москва",
  address: "Россия, г. Москва, ул. Весенняя, д. 10",
  email: "harr1ngtonb@yandex.ru",
  phone: "+7 (924) 581-83-00",
  phoneHref: "tel:+79245818300",
  telegram: "@maggalon",
  telegramUrl: "https://t.me/maggalon",
  site: "https://for-tutor.com",
};
export const legalDocuments = [
  {
    slug: "requisites",
    title: "Реквизиты",
    summary: "Исполнитель, статус, адрес и контактные данные.",
  },
  {
    slug: "offer",
    title: "Публичная оферта",
    summary:
      "Условия предоставления доступа к платформе For Tutor по подписке.",
  },
  {
    slug: "terms",
    title: "Пользовательское соглашение",
    summary:
      "Правила работы преподавателей, учеников и родителей с платформой.",
  },
  {
    slug: "payment",
    title: "Оплата и возврат",
    summary:
      "Как оплатить подписку, отключить автопродление и запросить возврат.",
  },
  {
    slug: "pricing",
    title: "Тариф и подключение",
    summary: "14 дней бесплатно без карты, затем 1190 ₽ за календарный месяц.",
  },
  {
    slug: "contacts",
    title: "Контакты и поддержка",
    summary: "Обращения по работе сервиса, подписке и персональным данным.",
  },
  {
    slug: "privacy",
    title: "Политика обработки персональных данных",
    summary: "Какие данные обрабатываются, для чего и кому передаются.",
  },
  {
    slug: "consent",
    title: "Согласие на обработку персональных данных",
    summary: "Отдельный документ о согласии пользователя и порядке его отзыва.",
  },
  {
    slug: "cookies",
    title: "Cookie и localStorage",
    summary: "Техническая сессия входа и сохранение выбранной темы интерфейса.",
  },
] as const;
export type LegalSlug = (typeof legalDocuments)[number]["slug"];
