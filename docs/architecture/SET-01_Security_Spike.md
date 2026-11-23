# SET-01 — Security Spike и предложения для review

Дата: 2026-11-23. Статус: исправления по внешнему Changes Requested подготовлены; browser-only Origin и clock skew = 0 согласованы пользователем для MVP. Повторное внешнее review ожидается.
Задача: [Issue #12](https://github.com/OOO-Vector/Diplom/issues/12).
Исходная база: `ce657dd32f7a9a75a5248016827d7406bc3d5e3e`. Проверенный внешним ревью commit: `1e6d2aec1dec60e7ce10f5dedf51c8faf082cf2e`, опубликован в `feat/set-01-security-spike`. Текущие исправления продолжают эту ветку.

## 1. Источники и фактическая база

Прочитаны README, build.gradle, application.properties, changelog 001–012, database/README, Database_Test_Report,
[SRS](../requirements/SRS.md), [Security Design](Security_Design.md), [Core Design](modules/Core_Module_Design.md),
[OpenAPI](../api/openapi.yaml), Issue #12; дополнительно проверены описания CORE-01–04 (#14–17) и DB-014 (#11).
Применимые AGENTS.md не найдены. В начале работы `docs/api`, `docs/architecture`, `docs/requirements` были untracked:
наличие локального файла не является доказательством его принятия в Git.

В main Java существует только `OrchestratorApplication`, в обычных тестах — `contextLoads` с `@SpringBootTest`.
Есть JPA, Security, Validation, WebMVC, Liquibase starters, PostgreSQL driver. Нет domain entities/repositories,
AuthService, пользовательской SecurityFilterChain, JWT/refresh инфраструктуры или реализованных REST-контрактов.
Security работает на основе автоконфигурации, а не proposed design.

База уже реализована: 12 changesets, 27 CREATE TABLE; Core содержит users/projects/project_members.
002 задаёт UNIQUE lower(email), membership PK и partial unique owner; 003 — deferred проверку ровно одного owner;
011 — явные grants. Refresh-таблицы пока нет: это отдельное запланированное расширение CORE-01, а не дефект базы.
`ddl-auto=validate`, `open-in-view=false`; migration/admin и application credentials разделены.
78 исторических SQL-проверок описаны в отчёте, здесь они не перезапускались. DB-014 остаётся open.

## 2. Проверенная совместимость и зависимости

| Компонент | Фактически использованная версия |
|---|---|
| JDK | Temurin 21.0.12.1+1 |
| Gradle wrapper | 9.8.2 |
| Spring Boot dependency management | 4.0.9 |
| Spring Framework | 7.0.10 |
| Spring Security | 7.0.8 |
| Nimbus JOSE JWT | 10.4 |
| Bouncy Castle bcprov-jdk18on | 1.87, явная версия |
| Jackson databind | 3.1.7 (`tools.jackson`) |
| JUnit Jupiter / Platform | 6.0.3 |

В отдельный source set `securitySpike` добавлены Boot starters `security-oauth2-resource-server`, `webmvc`,
`security-test`, `webmvc-test`, `bcprov-jdk18on:1.87` и runtime `junit-platform-launcher`.
Версии Spring/Nimbus/test libraries берутся из текущего Boot dependency management. Для bcprov версия обязательна:
первый `dependencies` показал `bcprov-jdk18on FAILED` без версии, несмотря на BUILD SUCCESSFUL.
После явной фиксации 1.87 компиляция, тесты и dependencyInsight успешны.

При будущей реализации нужны production зависимости `spring-boot-starter-security-oauth2-resource-server` и
`bcprov-jdk18on:1.87`; сейчас main classpath не менялся. Отдельные JJWT/Auth0 или Authorization Server не нужны
для проверенного подхода. Argon2 использует Java Bouncy Castle, без JNI или глобальной регистрации JCA provider.
Spike не подключает JPA/Liquibase и не загружает application.properties. Он запускается явно, не включён в `test`/`check`.

## 3. Решения, предлагаемые к принятию

### JWT

`NimbusJwtEncoder` и `NimbusJwtDecoder`, RSA минимум 2048 бит, только RS256. Проверять подпись, issuer, audience,
обязательные UUID sub/jti, iat/exp, exp > now, iat <= now, exp > iat и срок <=900 секунд; учитывать nbf при наличии.
В spike время фиксировано для воспроизводимости. Production должен использовать внедряемый Clock.
Проверка обязательности claims нужна дополнительно к базовым validators. Clock skew = 0 утверждён для текущего MVP:
иначе стандартный допуск может продлить фактическое принятие токена за границу 15 минут. Нужна синхронизация часов;
изменение этой политики требует согласования с SRS FR-AUTH-003.

Production private key монтировать как secret; issuer/audience и ключи не брать из непроверенных заголовков токена.
Использовать локальный доверенный key ring с kid; неизвестный kid отклонять, не загружать URL из jku/x5u.
Плановая ротация: сначала распространить новый public key, затем подписывать новым private key;
старый public key оставить до истечения всех ранее выданных JWT (900 секунд после последней подписи при skew=0).
Компрометация ключа требует отдельного отзыва. Key-ring rotation и загрузка secret-файлов здесь не реализованы/не проверены.
В тестах ключи генерируются в памяти и не сохраняются.

Проектные роли не являются authoritative JWT claims. Active-user guard и membership checks выполняются сервером;
spike проверяет криптографию и bearer filter, но не проверяет пользователей через БД.

### Password hashing

`Argon2PasswordEncoder(16, 32, 1, 19456, 2)`: salt 16 bytes, hash 32 bytes, 19 MiB, t=2, p=1.
Фактический hash имеет `$argon2id$v=19$m=19456,t=2,p=1$`; подтверждены случайные соли, совпадение исходного
пароля и отказ для неверного/trimmed пароля. Стоимость требует отдельного нагрузочного измерения на целевом сервере.
Не использовать defaultsForSpringSecurity как замену согласованным параметрам. В users.password_hash подходит text.
Регистрация: 12–128 Unicode code points, максимум 512 UTF-8 bytes, без trim/normalization.
Java `@Size` считает UTF-16 code units, поэтому один @Size не доказывает выполнение этого контракта.
Потребуется явная проверка codePointCount и UTF-8 длины, без сохранения/логирования пароля.

### Cookie, CSRF и origin

Проверен `CookieCsrfTokenRepository` + `XorCsrfTokenRequestAttributeHandler`.
GET `/api/v1/auth/csrf` возвращает masked token через JSON и устанавливает HttpOnly `csrf_token`.
Клиент передаёт именно JSON token в `X-CSRF-Token`, а не raw cookie: raw cookie как header отклоняется.
POST register/login/refresh/logout требуют cookie+header даже при permitAll.
На login/logout явно очищать CSRF cookie; затем клиент повторно вызывает csrf bootstrap.
При собственном REST login нельзя предполагать автоматическое выполнение стандартной authentication session strategy.
Cookie repository stateless: старую украденную пару cookie+header он сам по себе не отзывает; cookie reset не является
серверным отзывом CSRF сессии. Отзыв refresh обеспечивается отдельной DB-логикой.

Обе cookie: Secure, HttpOnly, SameSite=Lax, host-only (без Domain), Path=/api/v1/auth.
Refresh Max-Age <= оставшегося абсолютного срока семьи, максимум 604800 секунд; logout очищает с Max-Age=0
и теми же атрибутами. Spike проверяет начальную выдачу/очистку заголовков; расчёт остатка TTL при ротации ещё не реализован.
Все auth ответы, включая отказы по Origin, должны иметь Cache-Control: no-store.

В spike проверена строгая browser-only политика Origin: ровно разрешённый origin; missing/null/foreign отклоняются.
Эта browser-only политика согласована: CLI без Origin тоже получает 403, Referer fallback и CLI exemption не предусмотрены.
CORS: exact allowlist, credentials=true, ограниченные headers/methods, корректный preflight, без wildcard.
Production предпочтительно same-origin HTTPS. Local HTTP OpenAPI server не гарантирует работу Secure cookie:
нужен согласованный proxy/TLS либо отдельное явное dev-only исключение.

Bearer endpoints не используют cookie для authentication и могут быть исключены из CSRF только при такой гарантии.
В spike matcher ограничен четырьмя auth POST; неизвестные ресурсные маршруты запрещены. Это тестовая конфигурация,
не готовая production policy для будущих endpoints. MockMvc не проверяет реальное поведение браузера SameSite/Secure/Path.

### Refresh persistence (спецификация, без реализации)

SecureRandom >=32 bytes, base64url без padding, SHA-256 digest в БД вместо raw credential; Argon2 для random refresh не нужен.
При сравнении digest в Java использовать constant-time comparison. Семья живёт 7 дней от login, не продлевается ротацией.
Стабильная блокировка root/family должна сериализовать rotate/logout/replay; блокировки только текущего token row недостаточно
для гонки replay старого и rotate нового токена. Replay отзывает семью с гарантированным commit перед ответом 401;
нельзя откатить отзыв исключением из транзакции. Выдача токенов/cookie — после успешного commit.
Хранить consumed/revoked rows до family expiry для обнаружения replay. Cleanup/retention пока открыты.
Потерянный ответ rotate и параллельные вкладки требуют single-flight; без безопасного повторного использования старого token.
Эти транзакционные свойства не подтверждены данным spike и должны проверяться на реальном PostgreSQL в CORE-01/04.

## 4. Сверка контрактов и расхождения

| Операция | Предложенный контракт OpenAPI |
|---|---|
| GET /api/v1/auth/csrf | 200 headerName/token, no bearer |
| POST /api/v1/auth/register | email/displayName/password, 201 safe User, без auto-login; 400/403/409 |
| POST /api/v1/auth/login | email/password, 200 TokenResponse, expiresIn=900 + refresh cookie; generic 401, CSRF 403 |
| POST /api/v1/auth/refresh | без JSON body; cookie+CSRF; 200 TokenResponse; invalid/replayed 401, CSRF 403 |
| POST /api/v1/auth/logout | без body/bearer, refresh optional, CSRF required; 204 даже без refresh, 403 при неверном CSRF |
| GET /api/v1/users/me | bearer + active account; 200 safe User или 401 |

1. `/auth/me` из старого draft не добавлять: актуальный Core OpenAPI и CORE-02 (#15) задают `/api/v1/users/me`.
   SRS §8.2 содержит только приблизительные API groups и не является финальным route contract.
2. SRS DEC-15 называет JUnit 5, фактический Boot BOM выбирает JUnit 6.0.3. Доказательство относится к реально разрешённым версиям.
3. Core Design «timestamps server-generated» требует уточнения: у users/projects/project_members в 002 нет timestamp DEFAULT.
   Значения должен присваивать backend; это не основание менять 002.
4. Исправлено по review: LoginRequest явно задаёт 1–128 Unicode code points и UTF-8 максимум 512 bytes,
   без trim/normalization/truncation; регистрационный минимум 12 не навязывается login.
5. Исправлено по review: OpenAPI задаёт no-store для всех 31 auth responses, включая ошибки;
   refresh 401 документирует обязательный Set-Cookie для очистки invalid/expired/replayed credential.
6. Browser-only exact Origin policy (missing/null/foreign → 403) и clock skew = 0 утверждены для MVP.
   Конкретные deployment origins, issuer/audience values и key rotation остаются предметом последующего согласования.
7. Cookie+XOR proof не подтверждает generic Problem Details, rate limiting, account enumeration/timing protection или active-user checks.
   Stub POST возвращает 204 исключительно для проверки filter chain; он не изображает реализацию register/login response schemas.
8. Ссылки API_Overview.md в OpenAPI и SRS_Decisions.md в SRS локально отсутствуют; V-03 из Issue #12 не найден в доступном SRS.
9. DB-014 (#11) open: исторический отчёт базы не подменяет требуемую повторную проверку live develop.

По внешнему review обновлены Security Design и OpenAPI; Core Design не менялся. Утверждение двух политик не означает
автоматического принятия остальных proposed деталей или готовности production authentication.

## 5. Фактические проверки и воспроизведение

Из `backend/`:

```powershell
.\gradlew.bat --version
.\gradlew.bat dependencies --configuration securitySpikeRuntimeClasspath --console=plain
.\gradlew.bat securitySpike --console=plain
.\gradlew.bat bootJar dependencyInsight --dependency bcprov-jdk18on --configuration securitySpikeRuntimeClasspath --console=plain
```

Результат securitySpike: 7 tests, 0 failures/errors/skips (4 browser/filter + 3 crypto tests; внутри проверяются несколько случаев).
XML и HTML: `backend/build/test-results/securitySpike/` и `backend/build/reports/tests/securitySpike/index.html`.
Итоговые XML сохранены также в `docs/architecture/evidence/SET-01/` для локального code review.
Проверены wrong signature, RS512/none/malformed, issuer/audience, exp boundary/expired, future iat/nbf,
TTL >900, invalid/missing sub, missing aud/jti/exp/iat; Argon2id и соль; CSRF bootstrap и отказы на всех четырёх POST;
login/logout cookie reset и повторный bootstrap; Origin/CORS/preflight; реальные bearer JWT без test jwt()/csrf() shortcuts;
cookie не аутентифицирует `/users/me`, legacy `/auth/me` не существует в тестовом MVC.

Первый Gradle запуск внутри sandbox не смог создать lock в `C:\.gradle`; после разрешённого запуска вне sandbox wrapper работал.
Первый dependencies завершился с unresolved bcprov без версии — исправлено explicit 1.87.
Первый запуск 7 тестов: 1 failure, JWT fixture имел exp==iat и encoder отказал до decoder. Исправлено:
iat перенесён в прошлое, exp==now; подписание вынесено за assertThrows, чтобы проверять именно decoder.
Предупреждение deprecated Jackson asText устранено переходом на asString. Осталось предупреждение JVM CDS о bootstrap classpath;
оно не является ошибкой тестов. В одном успешном прогоне суммарные 2 encode+3 verify Argon2 заняли 426 ms;
это диагностическое измерение, не latency benchmark и не основание менять cost.

bootJar: BUILD SUCCESSFUL; проверка `jar tf` не нашла spike classes, bcprov, Nimbus или OAuth2 resource-server/jose libraries
в production jar. `git diff --check` без ошибок; migrations не изменены.
Обычный `test`/contextLoads, SQL, Docker, браузерный E2E, нагрузочные/DB race tests, coverage и vulnerability scan не запускались.
Никаких данных/контейнеров/volumes не меняли; application startup и Hibernate schema generation не выполнялись.

## 6. Следующие этапы после review (здесь не начаты)

| Issue | Ограниченная спецификация следующего этапа |
|---|---|
| CORE-01 #14 | Согласовать refresh_sessions 013: user FK, unique digest, family/root, timestamps, replacement link, family expiry, индексы user/family/expiry, grants. Выбрать конкретный lock protocol и ограничения; clean + upgrade Testcontainers PG16/pgvector, grants/uniqueness/rollback evidence. 001–012 не менять. |
| CORE-02 #15 | User mapping к существующей 002, case-insensitive lookup/unique conflict 409, Argon2id, DTO validation, safe User без hash, register без login, единственный `/users/me`; доступ активного пользователя интегрировать с CORE-03. |
| CORE-03 #16 | Login с generic failure и защитой от timing enumeration/rate abuse, secret key loading, RS256 validation, active-user guard, initial family/cookie after commit; Problem Details совместно с CORE-07. |
| CORE-04 #17 | Atomic rotation/replay revocation/logout, CSRF auth boundary reset, Origin/CORS policy; PG concurrency/replay/lost-response/expiry/logout integration tests, client single-flight contract. |

Namespace `com.teamai.orchestrator`, Core api/application/domain/persistence, общая Security в infrastructure.
Не переносить stub controller или фиксированный Clock из spike в production.
Следующий конкретный шаг: повторное внешнее review исправлений; затем отдельное поручение CORE-01 с учётом DB-014.
Первое внешнее review завершено с Changes Requested, как сообщил пользователь. Issue не закрыт.

### Финальная проверка перед публикацией SET-01

По отдельному поручению пользователя повторно выполнено `gradlew.bat securitySpike --rerun-tasks --console=plain`:
BUILD SUCCESSFUL, 7 tests, 0 failures/errors/skips. XML evidence обновлены результатами этого запуска.
Проверены git status/diff и состав main Java: migrations 001–012 и production-код не изменены;
авторизация существует только в изолированном spike. Проверка добавляемых файлов на секреты выявила только
явно синтетические примеры. В состав публикации входят spike, его отчёт/evidence и предоставленные пользователем
SRS/Core/Security/OpenAPI contracts; `.env`, build outputs и caches исключены.
Первоначальная публикация выполнена commit `1e6d2aec1dec60e7ce10f5dedf51c8faf082cf2e`; её XML evidence сохранены
как исторические результаты. Публикация не означала принятия proposed contracts.

### Внешнее Code Review и исправления

По сообщению пользователя, review commit `1e6d2aec1dec60e7ce10f5dedf51c8faf082cf2e` завершилось Changes Requested.
Критических ошибок в Java Security Spike не обнаружено; тестовая архитектура оставлена без изменений.
Ссылка на отдельный review artifact не предоставлена; результат зафиксирован со слов пользователя, без выдуманного approval.

Выполнены четыре требования:

1. Security Design: строгий Origin для четырёх auth POST; missing/null/foreign отклоняются даже с валидным CSRF.
   CLI без Origin не поддерживается; подстановка Origin не доказывает браузерную природу клиента. Описана необходимость HTTPS.
2. Security Design: clock skew = 0, отказ при now >= exp, синхронизация часов и внедряемый UTC Clock; фиксированный Clock только в тестах.
3. OpenAPI: no-store на всех auth responses; обязательная очистка refresh-cookie в 401 с matching attributes;
   login 1–128 Unicode code points/512 UTF-8 bytes без trim/normalization/truncation.
4. Этот отчёт обновлён: исходный commit SHA, внешний Changes Requested и согласованные решения отражены явно.

Повторная проверка после исправлений, 2026-11-23: `gradlew.bat securitySpike --rerun-tasks --console=plain` —
BUILD SUCCESSFUL, 7 tests, 0 failures/errors/skips. Начало XML suites: 07:19:34.747Z (browser, 4 tests),
07:19:37.629Z (crypto, 3 tests). Новые результаты доступны в `backend/build/test-results/securitySpike/`;
исторические XML evidence из reviewed commit не перезаписаны. Остаётся прежнее нефатальное предупреждение JVM CDS.

YAML проверен установленным SnakeYAML 2.5 через временный Java validator вне репозитория: parsing с запретом duplicate keys,
разрешение всех локальных `$ref`, no-store для всех 31 auth responses, refresh 401 clearing attributes,
login bounds/Unicode description, наличие `/users/me` и отсутствие `/auth/me` — PASS.
Это проверка YAML и целевых инвариантов, не полная OpenAPI schema validation и не новый API integration test.
PyYAML локально отсутствует; новых зависимостей ради этой проверки не устанавливалось.
Production-код, SQL migrations, Gradle и Java spike не изменены; CORE-01–04 не начаты.

## 7. Первичные источники библиотек

- [Boot 4 starters](https://docs.spring.io/spring-boot/4.0/reference/using/build-systems.html) — актуальное имя security-oauth2-resource-server.
- [Spring JWT resource server](https://docs.spring.io/spring-security/reference/7.0/servlet/oauth2/resource-server/jwt.html) — JOSE/resource-server и validators.
- [Spring Argon2](https://docs.spring.io/spring-security/reference/7.0/features/authentication/password-storage.html) — необходимость Bouncy Castle.
- [Spring CSRF](https://docs.spring.io/spring-security/reference/7.0/servlet/exploits/csrf.html) — cookie repository, XOR handler, deferred token и auth boundaries.
- [Bouncy Castle 1.87](https://www.bouncycastle.org/resources/new-release-bouncy-castle-java-1-87/) — опубликованный release.

Документация объясняет выбор, а точные версии и работоспособность подтверждены локальным Gradle run, не предположены по latest docs.
