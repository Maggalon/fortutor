# VPS за существующим Nginx Proxy Manager

Проект запускается отдельным Compose-проектом рядом с другими сайтами: web, постоянный worker, собственные PostgreSQL и Redis. Файлы — в приватном S3. Web подключается к существующей Docker-сети Nginx Proxy Manager; PostgreSQL/Redis не публикуют порты. Проект не запускает новый proxy manager и не занимает 80/443.

GitHub Actions сначала проверяет код, затем собирает **готовые web/worker-образы на GitHub**, сжимает и передает по SSH (`docker save | gzip | ssh docker load`). На VPS выполняются проверка конфигурации, backup, миграция и `up --no-build`. Это тот же способ передачи образа, что в meta-platform; registry и его учетные данные не нужны. Образы помечаются полным SHA, web и worker должны иметь одинаковую ревизию.

## 1. Подготовка сервера

Команды — Linux/bash. Нужны Docker Engine, Docker Compose **2.24 или новее**, bash, `flock`, Python 3 и доступ к исходящему HTTPS. GitHub runner и VPS должны иметь одинаковую архитектуру (по умолчанию Linux amd64); workflow проверяет это до передачи образов. На ARM нужен runner соответствующей архитектуры либо отдельная настройка cross-build.

Используйте своего SSH-пользователя с доступом к Docker без sudo. Директория по умолчанию `/opt/for-tutor`; можно задать другую через `VPS_DEPLOY_ROOT`. Создайте ее и назначьте владельцем этого пользователя:

```sh
sudo install -d -m 750 -o YOUR_SSH_USER -g YOUR_SSH_USER /opt/for-tutor/deploy
```

Убедитесь, что можете выполнить `docker info` и `docker compose version`. В `authorized_keys` добавьте публичную часть отдельного deployment-ключа. Права `.ssh` — 700, `authorized_keys` — 600.

Выясните имя сети, к которой подключен существующий NPM:

```sh
docker network ls
docker inspect YOUR_NPM_CONTAINER --format '{{json .NetworkSettings.Networks}}'
```

Если meta-platform уже использует сеть `proxy`, укажите `PROXY_NETWORK=proxy`. Не создавайте вторую сеть с другим именем без подключения к ней NPM. Для приложения выберите уникальный alias, например `fortutor`, чтобы не совпасть с другими проектами.

## 2. Конфигурация и секреты

Скопируйте `deploy/env.production.example` на сервер как `/opt/for-tutor/.env.production`. На сервере нужен этот файл, а не исходники и node_modules. Workflow сам доставит Compose и скрипты в `deploy/`.

Обязательные значения:

| Значение                              | Настройка                                                     |
| ------------------------------------- | ------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`                | `fortutor`, уникально на VPS; после первого запуска не менять |
| `PROXY_NETWORK`                       | Имя существующей сети NPM                                     |
| `PROXY_ALIAS`                         | Уникальное имя web-контейнера для NPM, например `fortutor`    |
| `APP_URL`                             | Основной HTTPS-домен без завершающего `/`                     |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Два разных случайных hex-пароля                               |
| `S3_*`                                | Приватный bucket, ключи и endpoint, см. INTEGRATIONS.md       |

Сгенерируйте пароли двумя вызовами `openssl rand -hex 32`. Compose сам задает внутренние `DATABASE_URL` и `REDIS_URL`; hex-пароли не требуют URL-кодирования. `DEMO_MODE=false`. Поля `WEB_IMAGE` и `WORKER_IMAGE` можно оставить с примерным SHA: update.sh переопределяет их конкретными образами; для ручных команд загружайте `.release`.

```sh
chmod 600 /opt/for-tutor/.env.production
```

Не отправляйте реальные ключи в GitHub и не копируйте `.env.production` в образ. Настройте Telegram/MAX и DeepSeek, если эти функции нужны. Проверка перед deployment требует конфигурацию S3; валидность самих ключей проверяется приемкой. Изменение `POSTGRES_PASSWORD` в файле не меняет пароль существующей БД: ротацию выполняйте согласованно с ролью PostgreSQL.

**Первый deployment допускается без ЮKassa**, чтобы разместить сайт для проверки магазина. Оставьте `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` пустыми, сохраните `YOOKASSA_TEST_MODE=false` и `YOOKASSA_RECEIPTS=false`. Регистрация, вход, 14-дневный trial, учебные функции и worker работают; кнопки оплаты и согласие на автоплатежи отключены, worker не обращается к API ЮKassa. После окончания trial сохраняются просмотр/скачивание/экспорт: отсутствие магазина не продлевает trial автоматически. Один заполненный ключ при пустом втором блокирует deployment как ошибка конфигурации. Подключение магазина после проверки описано в [BILLING.md](BILLING.md#первый-запуск-без-юkassa).

## 3. Nginx Proxy Manager

DNS A-запись домена должна указывать на VPS. В существующем NPM создайте **Proxy Host**:

- Domain Names: выбранный домен, например `tutor.example.com`.
- Scheme: `http`.
- Forward Hostname / IP: значение `PROXY_ALIAS`, например `fortutor`.
- Forward Port: `3000`.
- SSL: сертификат для домена, Force SSL; HTTP/2 по желанию.
- Access List: Publicly Accessible, чтобы ЮKassa и боты могли вызывать webhooks.

Оставьте обычные proxy-заголовки NPM, включая Host/X-Forwarded-For/X-Forwarded-Proto. Не включайте cache для `/api/`. Не добавляйте Basic Auth или CAPTCHA на webhook endpoints. Публичный запрос должен проходить по HTTPS без перенаправления POST на другой домен. Панель управления NPM остается настроенной так, как у ваших остальных проектов.

## 4. GitHub Actions

Опубликуйте проект в GitHub, основная ветка — `main`. Создайте Environment `production`. Добавьте Secrets (в production environment или repository):

| Secret            | Значение                                             |
| ----------------- | ---------------------------------------------------- |
| `VPS_HOST`        | IP или hostname без схемы/порта                      |
| `VPS_USER`        | SSH-пользователь с доступом к Docker и папке проекта |
| `VPS_SSH_KEY`     | Приватная часть отдельного deployment-ключа          |
| `VPS_KNOWN_HOSTS` | Проверенная строка known_hosts сервера               |

Repository Variables:

| Variable          | По умолчанию     |
| ----------------- | ---------------- |
| `VPS_SSH_PORT`    | `22`             |
| `VPS_DEPLOY_ROOT` | `/opt/for-tutor` |

Для каталога допустим абсолютный путь без пробелов, `~` и завершающего `/`, например `/home/maggalon/for-tutor`. Сверьте SSH fingerprint с консолью VPS; для нестандартного порта known_hosts содержит `[host]:port`. Проверка хоста строгая. Защитите `main` успешным job `verify`.

PR выполняет typecheck, тесты с PostgreSQL/Redis, проверку Compose/bash и Next build. Push в `main` или workflow_dispatch для `main` после проверок собирает образы и запускает deployment. Устаревший SHA пропускается, если уже появился новый main. Активный deployment не прерывается следующим push. На VPS не выполняются `pnpm install`, `next build` или `docker build`.

## 5. Первый запуск

После успешного workflow:

```sh
cd /opt/for-tutor
set -a
source .release
set +a
docker compose --env-file .env.production -f deploy/compose.production.yml ps
docker compose --env-file .env.production -f deploy/compose.production.yml logs --tail=100 web worker
curl --fail https://tutor.example.com/api/health
```

Health должен вернуть `ok:true`, `demo:false`, worker — сообщение `For Tutor worker online`. Зарегистрируйте преподавателя и проверьте дату окончания 14-дневного периода. Откройте «Подписка».

Для Telegram/MAX один раз установите webhooks:

```sh
docker compose --env-file .env.production -f deploy/compose.production.yml run --rm --no-deps worker node --import tsx scripts/setup-bots.ts
```

Если магазин ЮKassa еще не создан, на этом этапе отправьте адрес размещенного сайта на проверку. В разделе «Подписка» должно быть сообщение о недоступности платежей и отключенная кнопка оплаты. После подключения магазина настройте webhook в ее кабинете: `https://YOUR_DOMAIN/api/webhooks/yookassa`, события `payment.succeeded`, `payment.canceled`. Выполните тестовую оплату по [BILLING.md](BILLING.md), затем [сквозную приемку](ACCEPTANCE.md).

## 6. Обновление, backup и откат

Каждый deployment проверяет загруженные образы/сеть/секреты, поднимает PostgreSQL/Redis и перед миграцией существующей установки делает dump. После миграции запускает web/worker и ждет их health. `.release` обновляется только после успешного запуска; `.release.previous` хранит предыдущую пару образов. Worker создает heartbeat после подключения к PostgreSQL/Redis и обновляет его после успешного tick; health допускает до 20 минут на длинный пакет AI/сетевых задач. Дополнительно проверяйте logs/очередь: heartbeat не подтверждает успешность конкретной оплаты или доставки.

Ручное обновление возможно только после загрузки обоих готовых образов:

```sh
bash deploy/update.sh fortutor-web:FULL_40_CHARACTER_SHA fortutor-worker:FULL_40_CHARACTER_SHA
```

Ручной backup:

```sh
bash deploy/backup.sh
```

Dump сохраняется в `backups/` с закрытыми правами. Планируйте ежедневный backup, копирование на другой сервер и проверку восстановления. Скрипт не удаляет старые dump/образы автоматически: задайте срок хранения, контролируйте диск, сохраняйте как минимум текущие и предыдущие образы. Резервируйте также S3-объекты и конфигурацию секретов. Не запускайте общий Docker prune на сервере с другими проектами.

Откат кода при наличии предыдущих образов:

```sh
set -a
source .release.previous
set +a
bash deploy/update.sh "$WEB_IMAGE" "$WORKER_IMAGE"
```

Это не откат БД. Старая версия до подписок не применяет ограничения доступа, поэтому откат к ней после начала продаж недопустим. Миграции должны оставаться совместимыми с предыдущей продаваемой версией.

Восстановление dump сначала проверяйте на отдельной базе. Для осознанной замены рабочей БД:

```sh
set -a
source .release
set +a
docker compose --env-file .env.production -f deploy/compose.production.yml stop web worker
docker compose --env-file .env.production -f deploy/compose.production.yml exec -T postgres pg_restore -U fortutor -d fortutor --clean --if-exists --no-owner < backups/CHOSEN_BACKUP.dump
```

После восстановления сверяйте платежи с ЮKassa **до запуска worker**. Старый dump может потерять факт списания и привести к повторной оплате; повторите reconciliation известных платежей и проверьте незавершенные заказы. Старые outbox-задачи также могут повторно доставить сообщения.

## 7. Диагностика

- NPM возвращает 502: проверьте сеть `PROXY_NETWORK`, alias и здоровье web, порт 3000.
- HTTP 403 на действиях: `APP_URL` должен совпадать с основным HTTPS-доменом.
- Подписка не обновляется: webhook URL/события ЮKassa, logs worker, ключи магазина и тестовый режим.
- Автопродление не срабатывает: worker/Redis, сохраненный способ оплаты и явное согласие; дата следующей попытки видна в кабинете.
- Настройка MAX падает с `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`: обновите оба образа до версии с `certs/max-ca.pem`, затем повторите настройку ботов. Цепочка CA и ее обновление описаны в [INTEGRATIONS.md](INTEGRATIONS.md#сертификаты-max-api).
- Бот показывает команды, но не отвечает: выполните диагностику внутри worker по [INTEGRATIONS.md](INTEGRATIONS.md#проверка-ботов-на-vps). Deployment автоматически обновляет webhooks и команды; ошибки настройки любого канала делают deployment неуспешным.
- Неопределенный платеж: см. команды поддержки в BILLING.md, не создавайте новое списание без сверки.
- Неуспешный health после deployment: `.release` остается прежним, но контейнеры могли обновиться; восстановите согласованную пару образов и проверьте БД.

Следите за доступностью `/api/health`, `Worker tick failed`, рестартами worker, очередью, ошибками ЮKassa и объемом диска. PostgreSQL/Redis принадлежат этому Compose-проекту; не меняйте его имя после создания volumes и не используйте `down -v` при обновлении.
