# Локальная разработка

## 1. Среда

Node.js 24, pnpm 12.4.2; Docker с Compose v2 для PostgreSQL и Redis. Используйте `pnpm-lock.yaml` без перегенерации другой версией pnpm.

```sh
npm install -g pnpm@12.4.2
pnpm install --frozen-lockfile
pnpm dev
```

Приложение: `http://localhost:3000`. По умолчанию development без `DATABASE_URL` использует демо. `.data/database.json` хранит тестовые данные, `.data/uploads` — загруженные файлы. Для чистой демонстрации остановите web и переименуйте `.data` в `.data-backup`, затем запустите снова. Не используйте этот режим для рабочих данных.

Демонстрационные аккаунты: `anna@fortutor.demo` и `sasha@fortutor.demo`, пароль `ForTutor2026!`. Быстрые кнопки входа доступны только в development/demo. На реальном PostgreSQL база начинает работу пустой: сначала зарегистрируйте преподавателя.

## 2. Полный локальный стек

```sh
docker compose up -d --wait
```

Создайте `.env.local` на основе `.env.example`, затем установите:

```dotenv
DEMO_MODE=false
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://fortutor:fortutor_local_only@localhost:55432/fortutor
DATABASE_SSL=false
REDIS_URL=redis://localhost:56379
```

Остальные параметры возьмите из [инструкции интеграций](INTEGRATIONS.md). Без S3 можно создавать текстовые ДЗ, но настоящая загрузка файлов требует настроенного хранилища. Для ботов нужен публичный HTTPS-адрес, например адрес вашего тестового сервера или туннеля; после его назначения измените `APP_URL` и зарегистрируйте webhooks.

```sh
pnpm db:migrate
pnpm dev
```

В отдельном терминале:

```sh
pnpm worker
```

Скрипты migrate/worker/bots:setup загружают `.env.local` средствами Node.js. Изменения окружения требуют перезапуска web и worker. Остановка локальных сервисов: `docker compose stop`. Это сохраняет данные Docker volumes.

## 3. Проверки

Linux/macOS:

```sh
TEST_DATABASE_URL=postgresql://fortutor:fortutor_local_only@localhost:55432/fortutor TEST_REDIS_URL=redis://localhost:56379 pnpm test
pnpm typecheck
pnpm build
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://fortutor:fortutor_local_only@localhost:55432/fortutor'
$env:TEST_REDIS_URL='redis://localhost:56379'
pnpm test
pnpm typecheck
pnpm build
```

Тесты создают собственные временные tenant-данные и очищают их. Используйте отдельную тестовую базу; команда тестирования запускает миграцию. Функции доставки и S3 в интеграционном тесте подменяются тестовым транспортом, данные и очередь остаются реальными. Никаких настоящих ключей для тестов не требуется.

Дополнительно `scripts/smoke.ts` проверяет реальный HTTP API и работающий worker на **локальных production-контейнерах**. Запустите оба образа в сети `fortutor-dev_default`, web на `127.0.0.1:3002` с `APP_URL=http://127.0.0.1:3002`, `MAX_WEBHOOK_SECRET=test-only-secret`, `DEMO_MODE=false`; задайте внутренние PostgreSQL/Redis URI. Затем на хосте:

```sh
DATABASE_URL=postgresql://fortutor:fortutor_local_only@localhost:55432/fortutor node --import tsx scripts/smoke.ts
```

Тест проверяет регистрацию/HttpOnly Secure session, защиту Origin, приглашение, ДЗ/оценку, урок/оплату, student permissions, подпись webhook и обработку outbox живым worker. Созданный tenant очищается в finally; тест намеренно ограничен localhost. Это не команда для production.

## 4. Где менять код

| Путь                                             | Назначение                                          |
| ------------------------------------------------ | --------------------------------------------------- |
| `components/platform.tsx`, `forms.tsx`, `ui.tsx` | Кабинеты, формы, базовые компоненты                 |
| `app/globals.css`                                | Светлая/темная темы, адаптивность                   |
| `app/api/[...path]/route.ts`                     | Авторизация, команды, файлы, webhook endpoints      |
| `lib/domain.ts`, `shared.ts`                     | Права доступа, расписание, ДЗ, оплаты, планирование |
| `lib/db.ts`, `types.ts`                          | Транзакции PostgreSQL и модель сущностей            |
| `lib/bots.ts`, `providers.ts`                    | Общий диалог ботов и два провайдера                 |
| `lib/reports.ts`, `queue.ts`                     | DeepSeek и надежная обработка задач                 |
| `lib/storage.ts`                                 | S3, подписанные ссылки, проверка файлов             |
| `lib/subscription.ts`, `billing.ts`              | Пробный доступ, ограничения, ЮKassa и автопродление |
| `scripts/billing-admin.ts`                       | Статус/продление/отзыв доступа, сверка платежей     |
| `scripts/worker.ts`                              | Постоянный BullMQ worker                            |
| `.github/workflows/`                             | Проверки, Docker images, deployment                 |

Обычный цикл: ветка → изменения → проверки → PR → merge в `main`. Защитите `main` обязательным успешным job `verify`. Build не требует рабочих API-ключей. Runtime требует корректного `APP_URL` и подключенных сервисов.

Если каталог еще не является Git-репозиторием, создайте пустой private/public repository на GitHub и опубликуйте исходники (замените адрес):

```sh
git init -b main
git add .
git commit -m "Initial For Tutor MVP"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Перед `git add` проверьте `.gitignore` и отсутствие секретов. Локальный `.env*`, `.data/`, node_modules, release-файлы и backups исключены; в Git попадают только `.env.example` и `deploy/env.production.example` с пустыми/примерными значениями. На уже существующем репозитории используйте текущий origin и рабочую ветку, не повторяйте init/remote add. Активация CD требует SSH secrets/variables из инструкции VPS.

Для новой миграции добавляйте новую версию в `ft_schema` и идемпотентные SQL-изменения в `migrate()`. Уже развернутые таблицы нельзя менять только правкой TypeScript-типа: добавьте преобразование сохраненных JSONB-данных. Изменения должны быть совместимы с предыдущим web/worker во время обновления.
