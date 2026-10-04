# CA для MAX

`max-ca.pem` содержит публичные Russian Trusted Root CA и Russian Trusted Sub CA, полученные 2026-10-04 с сервиса загрузок, указанного на [Госуслугах](https://www.gosuslugi.ru/crt):

- https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer
- https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer

SHA256 отпечатки:

- Root: `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`; действует до 2032-02-27.
- Sub: `BB:BD:E2:10:3E:79:0B:99:9E:C6:2B:D0:3C:F6:25:A5:A2:E7:C3:16:E1:0A:FE:6A:49:0E:ED:EA:D8:B3:FD:9B`; действует до 2027-03-06.

Обновление: `node scripts/update-max-ca.mjs`. Скрипт скачивает сертификаты по HTTPS с проверкой TLS, проверяет признак CA, сроки и подписи цепочки. После обновления проверьте изменения отпечатков и сроков, исправьте этот файл, выполните сборку и deployment обоих образов.

Цепочка применяется только в `lib/max-transport.ts`, дополняя стандартные доверенные CA процесса. TLS-проверка имени/срока/подписи сохраняется. Bundle копируется в web и worker; глобальное системное хранилище не изменяется. Требование MAX: [POST /subscriptions](https://dev.max.ru/docs-api/methods/POST/subscriptions).
