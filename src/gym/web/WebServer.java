package gym.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gym.BotLogic;
import gym.GymData;
import gym.Json;
import gym.ProfileData;
import gym.SocialData;
import gym.SocialInvite;
import gym.SocialLink;
import gym.SocialReport;
import gym.SocialRequest;
import gym.SocialStore;
import gym.Stats;
import gym.Storage;
import gym.TelegramApi;
import gym.TrainerCard;
import gym.Workout;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.zip.GZIPOutputStream;

public final class WebServer {
    private static final int MAX_BODY = 2 * 1024 * 1024;
    private static final long INIT_DATA_TTL_SEC = 86400;

    private final String token;
    private final Storage storage;
    private final Path webDir;
    /* [ANA-T1] агрегаты-счётчики (без ПДн) — общий с ботом экземпляр из Main */
    private final Stats stats;
    /* [ANA-T1] токен /stats: env GYM_ADMIN_TOKEN, не задан — токен бота */
    private final String adminToken;
    /* [ONB-T6] username бота для deep-link «Написать разработчику» (?start=feedback):
       env GYM_BOT_USERNAME, не задан — MyHelperGymBot (настоящий юзернейм бота;
       старый фолбэк GymHelper_bot — ЧУЖОЙ бот, [UX-B14]); отдаётся клиенту в /api/init */
    private final String botUsername;
    private final long startedAt = System.currentTimeMillis();
    /* [EXR-T7] кэш сжатых gzip-байтов крупной статики (app/catalog/style/index ~600 KB):
       сжимаем при первом gzip-запросе и держим в памяти. Инвалидация — рестарт процесса:
       статика меняется только вместе с релизом, между релизами файлы неизменны */
    private final Map<Path, byte[]> gzipCache = new ConcurrentHashMap<>();
    /* [UX-I16] публичные ссылки: индекс shareId → chatId. Наполняется при создании ссылки
       (/api/share) и ленивым сканом data/*.json (промах по памяти; повторный скан не чаще
       раз в SHARE_RESCAN_MS — мусорные id не гоняют скан-петлю). Удаление тренировки не
       чистит индекс — рендер сам вернёт 404, когда workout по shareId не найден */
    private final Map<String, Long> shareIndex = new ConcurrentHashMap<>();
    private volatile long shareIndexAt;
    private static final long SHARE_RESCAN_MS = 10_000;
    private static final String SHARE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final int SHARE_ID_LEN = 22; /* ~131 бит энтропии (§4.1 спеки) */
    private static final String SHARE_URL_BASE = "https://app.gym-helper.com/w/";
    private final SecureRandom shareRandom = new SecureRandom();
    /* [UX-S16] постер тренировки (серверный рендер CardRender + sendPhoto ботом):
       PNG рендерится на лету и живёт в data/cards/<token>.png (не data/*.json —
       формат GymData не меняется), токен = 22 символа base62 (как shareId,
       не угадывается), TTL жёсткий 1 час — чистка при старте сервера и лениво при
       каждой записи + гвард при выдаче; кап каталога от злоупотребления; антиспам —
       3 успешных POST /api/card в час на чат (окно скользящее; 500/502/503 слот
       откатывают — ревью [UX-S16]) */
    private static final long CARD_TTL_MS = 60L * 60 * 1000;
    private static final int CARD_TOKEN_LEN = 22;
    private static final int CARD_DIR_MAX_FILES = 1000;
    private static final int CARD_RATE_LIMIT = 3;
    private static final long CARD_RATE_WINDOW_MS = 60L * 60 * 1000;
    private static final byte[] PNG_MAGIC = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
    private final Map<Long, List<Long>> cardHits = new ConcurrentHashMap<>();
    /* [UX-S16] https-база карточек (downloadFile Telegram и Bot API принимают только
       https; sendPhoto по URL): env GYM_WEBAPP_URL, не задан/не https — домен Mini App */
    private final String cardUrlBase;
    /* [UX-S16] TelegramApi для sendPhoto; инжект в пакетном конструкторе —
       контракт-тест подменяет заглушкой (реальной сети в тестах быть не должно) */
    private final TelegramApi api;
    /* [TRN-T2] chat id владельца для уведомления о карточке «на проверке»
       (env GYM_OWNER_CHAT_ID — так же, как у BotLogic); 0 — уведомления off */
    private final long ownerChatId;
    private HttpServer server;

    public WebServer(String token, Storage storage, Path webDir, Stats stats) {
        this(token, storage, webDir, stats, System.getenv("GYM_BOT_USERNAME"), new TelegramApi(token), 0);
    }

    /* [UX-B14] инжект username для контракт-теста (env JVM-процесса поменять нельзя);
        прод использует конструктор выше с env GYM_BOT_USERNAME */
    public WebServer(String token, Storage storage, Path webDir, Stats stats, String botUsername) {
        this(token, storage, webDir, stats, botUsername, new TelegramApi(token), 0);
    }

    /* [UX-S16] полный конструктор: username + TelegramApi (заглушка в контракт-тесте —
        sendPhoto не должен ходить в реальную сеть); прод использует конструкторы выше */
    public WebServer(String token, Storage storage, Path webDir, Stats stats, String botUsername, TelegramApi api) {
        this(token, storage, webDir, stats, botUsername, api, 0);
    }

    /* [TRN-T2] +ownerChatId: уведомление владельцу о карточке, отправленной на проверку;
        botUsername null/пустой — env GYM_BOT_USERNAME (Main), дальше фолбэк как раньше */
    public WebServer(String token, Storage storage, Path webDir, Stats stats, String botUsername, TelegramApi api, long ownerChatId) {
        this.token = token;
        this.storage = storage;
        this.stats = stats;
        this.webDir = webDir.toAbsolutePath().normalize();
        String at = System.getenv("GYM_ADMIN_TOKEN");
        this.adminToken = (at == null || at.isBlank()) ? token : at.trim();
        String bu = (botUsername == null || botUsername.isBlank()) ? System.getenv("GYM_BOT_USERNAME") : botUsername;
        this.botUsername = (bu == null || bu.isBlank()) ? "MyHelperGymBot" : bu.trim();
        String wu = System.getenv("GYM_WEBAPP_URL");
        if (wu == null || !wu.trim().startsWith("https://")) wu = "https://app.gym-helper.com";
        wu = wu.trim();
        while (wu.endsWith("/")) wu = wu.substring(0, wu.length() - 1);
        this.cardUrlBase = wu;
        this.api = api;
        this.ownerChatId = ownerChatId;
    }

    public void start(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress(bindAddress(), port), 0);
        server.createContext("/", this::handle);
        server.setExecutor(Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "web");
            t.setDaemon(true);
            return t;
        }));
        server.start();
        /* [UX-S16] карточки прошлой сессии (до рестарта) — по TTL */
        cleanupCards();
    }

    /* адрес HTTP-сервера из env GYM_BIND_ADDR, по умолчанию 127.0.0.1 (как раньше).
       В контейнере DNAT доставляет внешние соединения на eth0, и слушатель на loopback
       их не принимает — поэтому compose задаёт GYM_BIND_ADDR=0.0.0.0 */
    public static String bindAddress() {
        String addr = System.getenv("GYM_BIND_ADDR");
        return (addr == null || addr.isBlank()) ? "127.0.0.1" : addr.trim();
    }

    private void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        try {
            if ("/health".equals(path)) {
                handleHealth(ex);
                return;
            }
            if ("/stats".equals(path)) {
                handleStats(ex);
                return;
            }
            if ("/api/init".equals(path)) {
                if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                    sendJson(ex, 405, Map.of("ok", false));
                    return;
                }
                handleInit(ex);
                return;
            }
            if ("/api/save".equals(path)) {
                if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                    sendJson(ex, 405, Map.of("ok", false));
                    return;
                }
                handleSave(ex);
                return;
            }
            if ("/api/track".equals(path)) {
                if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                    sendJson(ex, 405, Map.of("ok", false));
                    return;
                }
                handleTrack(ex);
                return;
            }
            /* [UX-I16] создание публичной ссылки тренировки — авторизованный маршрут, как /api/* */
            if ("/api/share".equals(path)) {
                if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                    sendJson(ex, 405, Map.of("ok", false));
                    return;
                }
                handleShare(ex);
                return;
            }
            /* [UX-S16] постер тренировки: initData-авторизация → рендер PNG → сохранение
                в data/cards → sendPhoto ботом в чат пользователя */
            if ("/api/card".equals(path)) {
                if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                    sendJson(ex, 405, Map.of("ok", false));
                    return;
                }
                handleCard(ex);
                return;
            }
            /* [TRN-T1] соцслой «Тренер»: каркас API (спека [TRN-S1] §4.2) */
            if (path.startsWith("/api/social/")) {
                handleSocial(ex, path);
                return;
            }
            /* [UX-I16] публичная страница тренировки — БЕЗ initData (до авторизационного
               слоя /api/*, §8.1); robots.txt — статический файл web/robots.txt */
            if (path.startsWith("/w/")) {
                handleSharePage(ex, path.substring(3));
                return;
            }
            /* [UX-S16] публичная раздача постера по токену — БЕЗ initData (Telegram
               скачивает https-URL сам при sendPhoto); Content-Type image/png */
            if (path.startsWith("/card/")) {
                handleCardGet(ex, path.substring(6));
                return;
            }
            serveStatic(ex, path);
        } catch (Exception e) {
            System.out.println("[warn] web " + path + ": " + e.getMessage());
            sendJson(ex, 500, Map.of("ok", false));
        } finally {
            ex.close();
        }
    }

    /* лёгкий эндпоинт для внешнего монитора (UptimeRobot) — без Telegram-валидации; HEAD поддерживается, т.к. мониторы часто стучатся им */
    private void handleHealth(HttpExchange ex) throws IOException {
        String method = ex.getRequestMethod();
        boolean head = "HEAD".equalsIgnoreCase(method);
        if (!head && !"GET".equalsIgnoreCase(method)) {
            sendJson(ex, 405, Map.of("ok", false));
            return;
        }
        long uptimeSec = (System.currentTimeMillis() - startedAt) / 1000;
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("uptimeSec", uptimeSec);
        resp.put("chats", countChats());
        byte[] body = Json.write(resp).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        if (head) {
            ex.sendResponseHeaders(200, -1);
        } else {
            ex.sendResponseHeaders(200, body.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(body);
            }
        }
    }

    /* число чатов = количество *.json в каталоге data (сосед web/); -1, если посчитать не удалось */
    private int countChats() {
        try {
            Path parent = webDir.getParent();
            if (parent == null) return -1;
            Path dataDir = parent.resolve("data");
            if (!Files.isDirectory(dataDir)) return -1;
            int n = 0;
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dataDir, "*.json")) {
                for (Path p : stream) {
                    if (Files.isRegularFile(p)) n++;
                }
            }
            return n;
        } catch (Exception e) {
            return -1;
        }
    }

    /* [ANA-T1] GET /stats?token=X — агрегаты-счётчики (без ПДн) для владельца.
       Доступ по GYM_ADMIN_TOKEN (fallback: токен бота). Неверный/отсутствующий токен —
       404 как у несуществующей страницы, чтобы не раскрывать существование эндпоинта. */
    private void handleStats(HttpExchange ex) throws IOException {
        if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
            sendJson(ex, 405, Map.of("ok", false));
            return;
        }
        String given = queryParam(ex.getRequestURI().getRawQuery(), "token");
        boolean ok = adminToken != null && given != null
            && MessageDigest.isEqual(adminToken.getBytes(StandardCharsets.UTF_8),
                given.getBytes(StandardCharsets.UTF_8));
        if (!ok) {
            send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
            return;
        }
        /* [ANA-T11] активационные метрики «за вчера» доезжают в /stats из
           data/summary-state.json (пишутся ботом при последней успешной утренней сводке,
           семантика «на момент сводки»); activationDay — день сводки для контекста.
           Оба ключа ставятся только вместе: в унаследованном summary-state от ANA-T6
           (day+totals без activation, до первой 09:00-сводки) осиротевшего
           activationDay в /stats быть не должно. */
        Map<String, Object> snap = stats.snapshot();
        Map<String, Object> st = storage.summaryState();
        if (st != null) {
            Map<String, Object> act = Json.map(st.get("activation"));
            if (act != null) {
                snap.put("activation", act);
                String day = Json.str(st, "day");
                if (day != null) snap.put("activationDay", day);
            }
        }
        sendJson(ex, 200, snap);
    }

    /* первый параметр name из rawQuery (уже декодированный), null — нет параметра */
    private static String queryParam(String rawQuery, String name) {
        if (rawQuery == null || rawQuery.isEmpty()) return null;
        for (String pair : rawQuery.split("&")) {
            int i = pair.indexOf('=');
            if (i <= 0) continue;
            try {
                if (name.equals(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8))) {
                    return URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8);
                }
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    private void handleInit(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] init rejected: initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        /* [ANA-T5] сегмент init (спека ANA-S2 г1) считается ДО load по факту существования
           файла данных и его mtime — содержимое не читается */
        long dataMtime = storage.dataFileMtime(userId);
        GymData data = storage.load(userId);
        System.out.println("[init] user " + userId + " rev " + data.rev + " workouts " + data.workouts.size());
        stats.inc("maInit");
        stats.inc(initSegment(dataMtime));
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("userId", userId);
        resp.put("botUsername", botUsername);
        resp.put("data", data.toJson());
        sendJson(ex, 200, resp);
    }

    private void handleSave(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] save rejected: initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        Map<String, Object> dataJson = Json.map(body.get("data"));
        if (dataJson == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        GymData current = storage.load(userId);
        GymData data = GymData.fromJson(dataJson);
        /* [ONB-T2] защита от «воскрешения» удалённых данных: после /delete_my_data сервер пуст
           (rev=0), но открытая вкладка Mini App держит старый G (rev>0) — первый же её save()
           без этой проверки смёржил бы старые тренировки в пустой current и пересоздал
           chat_<id>.json, хотя политика обещает удаление «безвозвратно». Такой save отклоняем
           до merge и записи файла: клиент по 409 перечитывает /api/init, получает пустой
           G rev=0 — открытая вкладка опустевает сама. */
        long clientRev = Math.max(data.rev, Json.lng(body.get("rev")));
        if (current.rev == 0 && clientRev > 0 && !data.workouts.isEmpty()) {
            System.out.println("[save] user " + userId + " rejected 409: сервер пуст (rev 0), клиент прислал rev " + clientRev);
            sendJson(ex, 409, Map.of("ok", false, "rev", 0));
            return;
        }
        if (data.nextId < 1) data.nextId = 1;
        long incomingNextId = data.nextId;
        /* [ANA-T1] агрегаты ДО слияния: новые id → workoutsCreated, прирост finished → workoutsCompleted */
        Set<Long> beforeIds = new HashSet<>();
        int finishedBefore = 0;
        for (Workout cw : current.workouts) {
            beforeIds.add(cw.id);
            if (cw.finished) finishedBefore++;
        }
        for (Workout iw : data.workouts) {
            if (iw.id >= incomingNextId) incomingNextId = iw.id + 1;
            System.out.println("[save-data] id " + iw.id + " date " + iw.date + " started " + iw.startedAt + " ended " + iw.endedAt + " finished " + iw.finished + " sets " + iw.exercises.size());
        }
        for (Workout iw : data.workouts) {
            boolean replaced = false;
            for (int i = 0; i < current.workouts.size(); i++) {
                if (current.workouts.get(i).id == iw.id) {
                    Workout cw = current.workouts.get(i);
                    if (iw.startedAt == null) iw.startedAt = cw.startedAt;
                    if (iw.endedAt == null) iw.endedAt = cw.endedAt;
                    if (iw.date == null) iw.date = cw.date;
                    /* [UX-I16] клиент не знает shareId (старый кэш JS / создан после init) —
                        ссылка тренировки не теряется при обычном save из Mini App */
                    if (iw.shareId == null) iw.shareId = cw.shareId;
                    iw.finished = cw.finished || iw.finished;
                    current.workouts.set(i, iw);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) current.workouts.add(iw);
        }
        for (Long id : data.deletedIds) {
            if (!current.deletedIds.contains(id)) current.deletedIds.add(id);
        }
        for (Long id : current.deletedIds) {
            current.workouts.removeIf(w -> w.id == id);
        }
        while (current.deletedIds.size() > 100) current.deletedIds.remove(0);
        /* [UX-T29] клиент без birth-ключей (старый кэш JS или legacy-сохранение Mini App)
           не теряет дату рождения текущего профиля — переносим её до замены (аналог
           «старый кэш JS — не трогаем» для templates); сервер зеркало age не пересчитывает */
        if (data.profile != null) {
            if (data.profile.birthYear == 0 && current.profile != null && current.profile.birthYear > 0) {
                data.profile.birthYear = current.profile.birthYear;
                data.profile.birthMonth = current.profile.birthMonth;
            }
            current.profile = data.profile;
        }
        /* restSec и templates Mini App сохраняет целиком со своим G — сервер обязан принять их
           при round-trip, иначе настройка/шаблон из приложения молча исчезнут (спека §0.2).
           restSec: null у клиента (ещё не настраивал) серверное значение не затирает;
           templates: замещаем только если клиент вообще прислал ключ (старый кэш JS — не трогаем) */
        if (data.restSec != null) current.restSec = data.restSec;
        if (dataJson.containsKey("templates")) {
            current.templates.clear();
            current.templates.addAll(data.templates);
        }
        /* [GOA-S1] цели Mini App сохраняет целиком со своим G — замещаем только если клиент
           вообще прислал ключ (старый кэш JS — не трогаем, по образцу templates);
           goalRemind — по образцу restSec: null (ключа нет / не настраивал) не затирает */
        if (dataJson.containsKey("goals")) {
            current.goals.clear();
            current.goals.addAll(data.goals);
        }
        if (data.goalRemind != null) current.goalRemind = data.goalRemind;
        /* [UX-T40] разминка по дефолту: ключа нет → серверное значение не трогаем (старый
           кэш JS — не затираем, по образцу templates/goals «замещаем если клиент прислал
           ключ»); явный ключ применяется как есть, включая null — «возврат к системной
           Разминке» обязан пережить сохранение (§5 спеки) */
        if (dataJson.containsKey("warmupFirst")) current.warmupFirst = data.warmupFirst;
        if (dataJson.containsKey("warmupEx")) current.warmupEx = data.warmupEx;
        /* [EXR-T13] «Свои»/«Любимые» Mini App сохраняет целиком со своим G — замещаем только
            если клиент прислал ключ (старый кэш JS — не трогаем, по образцу templates/goals);
            дубликаты имён уже отсеяны при GymData.fromJson (имя — уникальный ключ, §11) */
        if (dataJson.containsKey("customEx")) {
            current.customEx.clear();
            current.customEx.addAll(data.customEx);
        }
        if (dataJson.containsKey("favs")) {
            current.favs.clear();
            current.favs.addAll(data.favs);
        }
        data = current;
        /* nextId монотонно растёт: max(серверный, клиентский, max(id)+1) — иначе коллизии id затирают данные */
        data.nextId = Math.max(current.nextId, incomingNextId);
        data.rev = current.rev + 1;
        storage.save(userId, data);
        System.out.println("[save] user " + userId + " rev " + data.rev + " workouts " + data.workouts.size() + " nextId " + data.nextId);
        /* [ANA-T1] счётчики успешного save: сам save + прирост новых/завершённых тренировок
           (отклонённые 401/400/409 сюда не доезжают и не считаются) */
        stats.inc("maSave");
        int created = 0;
        int finishedAfter = 0;
        for (Workout w : current.workouts) {
            if (!beforeIds.contains(w.id)) created++;
            if (w.finished) finishedAfter++;
        }
        if (created > 0) stats.add("workoutsCreated", created);
        if (finishedAfter > finishedBefore) stats.add("workoutsCompleted", finishedAfter - finishedBefore);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("rev", data.rev);
        sendJson(ex, 200, resp);
    }

    /* [ANA-T5] события онбординга (спека ANA-S2 §2г2): белый список имён — неизвестные
       игнорируются. Только счётчики Stats, БЕЗ персистенции в GymData: формат
       chat_*.json не меняется (принцип [ONB] §7 — онбординг не пишет в данные). */
    private static final Set<String> TRACK_EVENTS = Set.of(
        "onboardingStarted", "onboardingCompleted", "onboardingTutorialSkipped",
        /* [UX-I16] клиентские события воронки шеринга (§7.3): буфер + открытие выбора чата */
        "linkCopy", "linkSend",
        /* [UX-I14] события картинки (§5): фича вырезана 20.11 (решение владельца),
           ключи оставлены для старых клиентов в кэше и истории stats.json */
        "shareClick", "shareOk", "shareDownload",
        /* [UX-S16] воронка «Картинка» (постер v2): тап пункта шита / успех / ошибка */
        "cardClick", "cardOk", "cardErr");

    /* [ANA-T5] POST /api/track {initData, events:[имя,...]} — события онбординга в Stats.
       Онбординг завершается без изменений данных, /api/save при нём не вызывается, а
       события completed/skipped наступают после /api/init — поэтому отдельный эндпоинт.
       Валидация initData та же, что у /api/init; максимум 16 событий за запрос. */
    private void handleTrack(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] track rejected: initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        List<Object> events = Json.list(body.get("events"));
        if (events == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        int counted = 0;
        for (Object o : events) {
            if (counted >= 16) break;
            String name = o instanceof String ? (String) o : null;
            if (name != null && TRACK_EVENTS.contains(name)) {
                stats.inc(name);
                counted++;
            }
        }
        System.out.println("[track] user " + userId + " events " + counted);
        sendJson(ex, 200, Map.of("ok", true));
    }

    /* [ANA-T5] сегмент init (спека ANA-S2 §2г1): файла данных нет → maInitNew; есть, но
       последняя активность (mtime = время последнего /api/save) старше 7 суток →
       maInitReturn; иначе → maInitRepeat. Privacy: только существование файла и его
       mtime — содержимое не читается (спека §3.2). */
    private static final long INIT_RETURN_AFTER_MS = 7L * 24 * 60 * 60 * 1000;

    private static String initSegment(long dataMtime) {
        if (dataMtime < 0) return "maInitNew";
        if (System.currentTimeMillis() - dataMtime > INIT_RETURN_AFTER_MS) return "maInitReturn";
        return "maInitRepeat";
    }

    /* ============ [UX-I16] шейринг тренировки по ссылке ============ */

    /* POST /api/share {initData, wid, shareName?, name?} — создать/вернуть shareId своей
       ЗАВЕРШЁННОЙ тренировки (§4.2): id создаётся лениво один раз и переиспользуется;
       rev данных не трогаем (изменения клиенту не нужны). Opt-in имени: shareName —
       тогл из шита (Boolean); при выключенном имя из данных удаляется (ПДн-минимализм),
       при включённом — сохраняется для OG-превью. Счётчик linkCreate (§7.3). */
    private void handleShare(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] share rejected: initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        long wid = Json.lng(body.get("wid"));
        GymData data = storage.load(userId);
        Workout w = data.findById(wid);
        if (w == null) {
            sendJson(ex, 404, Map.of("ok", false));
            return;
        }
        if (!w.finished) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        /* opt-in имя владельца ссылки (§11.1): состояние тогла живёт в данных; само имя —
           server-owned: берётся ТОЛЬКО из проверенного initData (user.first_name, ревью №3),
           клиентский payload «name» не доверенный. Нет юзера/имени в initData → аноним */
        Object sn = body.get("shareName");
        if (sn instanceof Boolean) {
            data.shareName = (Boolean) sn;
            if (!data.shareName) data.shareOwner = null;
        }
        if (Boolean.TRUE.equals(data.shareName)) {
            String nm = initUserName(initData);
            if (nm != null) data.shareOwner = nm;
        }
        if (w.shareId == null || w.shareId.isEmpty()) {
            w.shareId = newShareId(data);
            shareIndex.put(w.shareId, userId);
        }
        storage.save(userId, data);
        System.out.println("[share] user " + userId + " wid " + wid + " id " + w.shareId);
        stats.inc("linkCreate");
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("shareId", w.shareId);
        resp.put("url", SHARE_URL_BASE + w.shareId);
        sendJson(ex, 200, resp);
    }

    /* [UX-I16] имя владельца ссылки из ПОДПИСАННОГО initData (user.first_name) — клиентский
       payload «name» не доверенный (ревью №3). null — в initData нет юзера/имени (аноним).
       Лимит 60 символов и срез управляющих — до записи в файл/og:title (ревью №2). */
    static String initUserName(String initData) {
        if (initData == null || initData.isEmpty()) return null;
        try {
            Map<String, String> params = new HashMap<>();
            for (String pair : initData.split("&")) {
                int i = pair.indexOf('=');
                if (i <= 0) continue;
                params.put(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
            }
            String userJson = params.get("user");
            if (userJson == null) return null;
            Map<String, Object> user = Json.map(Json.parse(userJson));
            String fn = Json.str(user, "first_name");
            if (fn == null) return null;
            fn = fn.strip();
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < fn.length() && b.length() < 60; i++) {
                char c = fn.charAt(i);
                if (c >= 0x20) b.append(c);
            }
            return b.length() == 0 ? null : b.toString();
        } catch (Exception e) {
            return null;
        }
    }

    /* 22 символа base62 (§4.1); коллизию в пределах файла данных исключаем перегенерацией
       (между файлами — случайность ~0 и безвредна: lookup ведёт к чужому chatId только
       при совпадении 62^22, а рендер всё равно берёт тренировку по shareId этого файла) */
    private String newShareId(GymData data) {
        Set<String> taken = new HashSet<>();
        for (Workout w : data.workouts) {
            if (w.shareId != null) taken.add(w.shareId);
        }
        StringBuilder b = new StringBuilder(SHARE_ID_LEN);
        do {
            b.setLength(0);
            for (int i = 0; i < SHARE_ID_LEN; i++) {
                b.append(SHARE_ALPHABET.charAt(shareRandom.nextInt(SHARE_ALPHABET.length())));
            }
        } while (taken.contains(b.toString()));
        return b.toString();
    }

    /* ============ [UX-S16] постер тренировки: рендер → cards → sendPhoto ============ */

    /* POST /api/card {initData, wid} — собрать постер завершённой тренировки и отправить
       его ботом в чат пользователя (sendPhoto по URL, §7.3): рендер CardRender на лету
       (кэша нет — каждый тап рендерит заново), файл в data/cards/<token>.png (TTL 1 ч,
       кап, магия PNG), ответ {ok:true}. Ошибки — человекочитаемые на русском. Счётчики:
       cardSend (принятый запрос), cardSendOk/cardSendErr (исход sendPhoto). */
    private void handleCard(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] card rejected: initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        long wid = Json.lng(body.get("wid"));
        GymData data = storage.load(userId);
        Workout w = data.findById(wid);
        if (w == null) {
            sendJson(ex, 404, Map.of("ok", false, "error", "Тренировка не найдена"));
            return;
        }
        if (!w.finished) {
            sendJson(ex, 400, Map.of("ok", false, "error", "Постер можно сделать для завершённой тренировки"));
            return;
        }
        if (w.exercises.stream().noneMatch(e -> !e.sets.isEmpty())) {
            sendJson(ex, 400, Map.of("ok", false, "error", "У этой тренировки нет записанных упражнений"));
            return;
        }
        /* антиспам: окно скользящее; слот тратит ТОЛЬКО успешная отправка —
           рендер-ошибка (500), переполнение каталога (503) и отказ Telegram (502)
           слот откатывают (ревью [UX-S16]: 502 не должен съедать лимит) */
        long slot = cardRateTakeSlot(userId);
        if (slot < 0) {
            sendJson(ex, 429, Map.of("ok", false, "error",
                "Слишком часто: постер можно собирать не чаще " + CARD_RATE_LIMIT + " раз в час"));
            return;
        }
        stats.inc("cardSend");
        byte[] png;
        try {
            png = CardRender.render(data, w);
        } catch (Exception e) {
            cardRateReleaseSlot(userId, slot);
            System.out.println("[warn] card render user " + userId + " wid " + wid + ": " + e.getMessage());
            sendJson(ex, 500, Map.of("ok", false, "error", "Не получилось собрать постер 😔 Попробуйте ещё раз"));
            return;
        }
        if (png.length < PNG_MAGIC.length || !isPng(png)) {
            cardRateReleaseSlot(userId, slot);
            sendJson(ex, 500, Map.of("ok", false, "error", "Не получилось собрать постер 😔 Попробуйте ещё раз"));
            return;
        }
        cleanupCards();
        /* кап каталога: переполнение data/cards (злоупотреб/сбой) — 503 */
        if (countCards() > CARD_DIR_MAX_FILES) {
            cardRateReleaseSlot(userId, slot);
            sendJson(ex, 503, Map.of("ok", false, "error", "Слишком много картинок, попробуйте позже"));
            return;
        }
        Path file = newCardFile(png);
        String url = cardUrlBase + "/card/" + file.getFileName();
        boolean sent = api.sendPhotoByUrl(userId, url, cardCaption(w));
        if (!sent) {
            cardRateReleaseSlot(userId, slot);
            stats.inc("cardSendErr");
            System.out.println("[warn] card sendPhoto failed user " + userId + " " + file.getFileName());
            sendJson(ex, 502, Map.of("ok", false, "error", "Telegram не принял картинку. Попробуйте ещё раз"));
            return;
        }
        stats.inc("cardSendOk");
        System.out.println("[card] user " + userId + " wid " + wid + " " + file.getFileName() + " " + png.length + "B");
        sendJson(ex, 200, Map.of("ok", true));
    }

    /* антиспам /api/card: не более CARD_RATE_LIMIT запросов за окно на чат.
        Резервирует слот (метка времени), handleCard откатывает его cardRateReleaseSlot,
        если отправка не состоялась по серверной/Telegram-причине (ревью [UX-S16]);
        гонки потоков пула — computeIfAbsent + synchronized, как было. -1 — лимит */
    private long cardRateTakeSlot(long chatId) {
        long now = System.currentTimeMillis();
        List<Long> hits = cardHits.computeIfAbsent(chatId, k -> new ArrayList<>());
        synchronized (hits) {
            hits.removeIf(t -> now - t > CARD_RATE_WINDOW_MS);
            if (hits.size() >= CARD_RATE_LIMIT) return -1;
            hits.add(now);
            return now;
        }
    }

    /* откат зарезервированного слота (неудачная отправка); дубли метки времени
        безвредны — удалится одна, вторая остаётся честным слотом */
    private void cardRateReleaseSlot(long chatId, long slot) {
        if (slot < 0) return;
        List<Long> hits = cardHits.get(chatId);
        if (hits == null) return;
        synchronized (hits) {
            hits.remove(Long.valueOf(slot));
        }
    }

    /* caption §7.3: день тренировки из w.date (не «сегодня», урок UX-B14),
       dd.MM — или dd.MM.yyyy, если год не текущий; нераспарсимая — строка как есть.
       public с [UX-S16] — контракт-тест проверяет формат (прецедент validateInitData) */
    public static String cardCaption(Workout w) {
        String day;
        try {
            LocalDate d = LocalDate.parse(w.date.trim());
            day = String.format("%02d.%02d", d.getDayOfMonth(), d.getMonthValue());
            if (d.getYear() != LocalDate.now().getYear()) day += "." + d.getYear();
        } catch (Exception e) {
            day = w.date == null ? "" : w.date.trim();
        }
        return "Постер тренировки за " + day + " — перешли друзьям 💪";
    }

    /* data/cards рядом с data/*.json (прод-раскладка root/web + root/data — как
       countChats/scanShareIndex); каталог не коммитится (data/ в .gitignore) */
    private Path cardsDir() {
        Path parent = webDir.getParent();
        return (parent == null ? webDir : parent).resolve("data").resolve("cards");
    }

    /* случайный токен = имя файла; запись через CREATE_NEW — атомарна: гонка коллизии
       токена не перезапишет чужой файл, занятый токен — молчаливая перегенерация */
    private Path newCardFile(byte[] body) throws IOException {
        Path dir = cardsDir();
        Files.createDirectories(dir);
        StringBuilder b = new StringBuilder(CARD_TOKEN_LEN);
        while (true) {
            b.setLength(0);
            for (int i = 0; i < CARD_TOKEN_LEN; i++) {
                b.append(SHARE_ALPHABET.charAt(shareRandom.nextInt(SHARE_ALPHABET.length())));
            }
            Path file = dir.resolve(b + ".png");
            try {
                Files.write(file, body, StandardOpenOption.CREATE_NEW);
                return file;
            } catch (FileAlreadyExistsException e) {
                /* токен занят — следующая итерация */
            }
        }
    }

    /* число файлов в data/cards (кап каталога); недоступен каталог — 0 */
    private long countCards() {
        try (java.util.stream.Stream<Path> s = Files.list(cardsDir())) {
            return s.count();
        } catch (Exception e) {
            return 0;
        }
    }

    private static boolean isPng(byte[] b) {
        for (int i = 0; i < PNG_MAGIC.length; i++) {
            if (b[i] != PNG_MAGIC[i]) return false;
        }
        return true;
    }

    /* TTL-чистка карточек старше CARD_TTL_MS; ошибка на одном файле/каталоге — не помеха */
    private void cleanupCards() {
        try {
            Path dir = cardsDir();
            if (!Files.isDirectory(dir)) return;
            long now = System.currentTimeMillis();
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.png")) {
                for (Path p : stream) {
                    try {
                        if (now - Files.getLastModifiedTime(p).toMillis() > CARD_TTL_MS) {
                            Files.deleteIfExists(p);
                        }
                    } catch (Exception e) {
                        System.out.println("[warn] cards cleanup skip " + p.getFileName() + ": " + e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            System.out.println("[warn] cards cleanup: " + e.getMessage());
        }
    }

    /* GET /card/<token>.png — публичная раздача постера: Telegram скачивает https-URL
       сам при sendPhoto. Токен строго 22 base62 + «.png» — иначе 404 (заодно
       traversal-гвард: «..» паттерн не проходит). Картинка по токену неизменна до
       истечения TTL — короткий public-кэш вместо no-store (токен не угадывается). */
    private void handleCardGet(HttpExchange ex, String name) throws IOException {
        boolean head = "HEAD".equalsIgnoreCase(ex.getRequestMethod());
        if (!head && !"GET".equalsIgnoreCase(ex.getRequestMethod())) {
            sendJson(ex, 405, Map.of("ok", false));
            return;
        }
        if (name == null || !name.matches("[0-9a-zA-Z]{22}\\.png")
            || !Files.isRegularFile(cardsDir().resolve(name))) {
            send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
            return;
        }
        Path file = cardsDir().resolve(name);
        /* TTL-гвард при выдаче (ревью [UX-S16]): истёкший, но ещё не вычищенный
            файл не отдаётся — тот же CARD_TTL_MS, что у ленивой чистки */
        try {
            if (System.currentTimeMillis() - Files.getLastModifiedTime(file).toMillis() > CARD_TTL_MS) {
                send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
                return;
            }
        } catch (IOException e) {
            send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
            return;
        }
        byte[] body = Files.readAllBytes(file);
        ex.getResponseHeaders().set("Content-Type", "image/png");
        ex.getResponseHeaders().set("Cache-Control", "public, max-age=3600");
        ex.getResponseHeaders().set("X-Robots-Tag", "noindex, nofollow");
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        if (head) {
            ex.sendResponseHeaders(200, -1);
            return;
        }
        ex.sendResponseHeaders(200, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
    }

    /* GET /w/<shareId> — публичная страница (§8.1): noindex-заголовки, живой рендер,
       404-страница одна для «не существует / удалена / мусорный id» (§4.3 — без оракула).
       Счётчик linkView — только успешные GET 200. */
    private void handleSharePage(HttpExchange ex, String shareId) throws IOException {
        boolean head = "HEAD".equalsIgnoreCase(ex.getRequestMethod());
        if (!head && !"GET".equalsIgnoreCase(ex.getRequestMethod())) {
            sendJson(ex, 405, Map.of("ok", false));
            return;
        }
        Workout found = null;
        GymData data = null;
        if (shareId != null && !shareId.isEmpty() && shareId.length() <= 64) {
            long chatId = findChatByShareId(shareId);
            if (chatId > 0) {
                data = storage.load(chatId);
                for (Workout w : data.workouts) {
                    if (w.finished && shareId.equals(w.shareId)) {
                        found = w;
                        break;
                    }
                }
            }
        }
        int code;
        String html;
        if (found != null) {
            /* ошибки рендера (битые данные) → та же 404-страница, не stacktrace (§8.2) */
            try {
                html = SharePage.render(data, found, botUsername);
                code = 200;
            } catch (Exception e) {
                System.out.println("[warn] share render: " + e.getMessage());
                html = null;
                code = 404;
            }
        } else {
            code = 404;
            html = null;
        }
        if (code != 200) html = SharePage.renderNotFound(botUsername);
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("X-Robots-Tag", "noindex, nofollow");
        /* на странице нет ни JS, ни внешних ресурсов (§8.1) */
        ex.getResponseHeaders().set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
        /* hardening публичной страницы (ревью №4) */
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        ex.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        if (head) {
            ex.sendResponseHeaders(code, -1);
            return;
        }
        if (code == 200) stats.inc("linkView");
        boolean gz = acceptsGzip(ex);
        byte[] out = gz ? gzip(body) : body;
        if (gz) ex.getResponseHeaders().set("Content-Encoding", "gzip");
        ex.getResponseHeaders().set("Vary", "Accept-Encoding");
        ex.sendResponseHeaders(code, out.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(out);
        }
    }

    /* chatId по shareId: сначала индекс в памяти, при промахе — скан data/*.json
       (не чаще раза в SHARE_RESCAN_MS; десятки файлов, не тысячи — §8.1) */
    private long findChatByShareId(String shareId) {
        Long known = shareIndex.get(shareId);
        if (known != null) return known;
        long now = System.currentTimeMillis();
        if (now - shareIndexAt < SHARE_RESCAN_MS) return -1;
        shareIndexAt = now;
        scanShareIndex();
        Long found = shareIndex.get(shareId);
        return found == null ? -1 : found;
    }

    private void scanShareIndex() {
        Path parent = webDir.getParent();
        if (parent == null) return;
        Path dataDir = parent.resolve("data");
        if (!Files.isDirectory(dataDir)) return;
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dataDir, "chat_*.json")) {
            for (Path p : stream) {
                if (!Files.isRegularFile(p)) continue;
                String name = p.getFileName().toString();
                String idStr = name.substring("chat_".length(), name.length() - ".json".length());
                long chatId;
                try {
                    chatId = Long.parseLong(idStr);
                } catch (NumberFormatException e) {
                    continue;
                }
                try {
                    for (Workout w : storage.load(chatId).workouts) {
                        if (w.finished && w.shareId != null && !w.shareId.isEmpty()) {
                            shareIndex.put(w.shareId, chatId);
                        }
                    }
                } catch (Exception e) {
                    System.out.println("[warn] share index: skip chat " + chatId + ": " + e.getMessage());
                }
            }
        } catch (Exception e) {
            System.out.println("[warn] share index scan: " + e.getMessage());
        }
    }

    /* ============ [TRN-T1] соцслой «Тренер»: каркас API (спека [TRN-S1] §4.2) ============
       Все эндпоинты POST с initData в теле — как /api/init|save|share (initData длинный,
       в URL не передаём). Здесь только чтение/запись SocialStore: карточки, поиск,
       заявки, связки, гранты, коды приглашений, жалобы. Верификация/админ-команды и
       уведомления бота — [TRN-T2/T4], экраны Mini App — [TRN-T3/T5]. /api/social/health
       не реализован: поле «Здоровье» отложено (решение владельца 23.11). */

    private void handleSocial(HttpExchange ex, String path) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            sendJson(ex, 405, Map.of("ok", false));
            return;
        }
        Map<String, Object> body = readJsonBody(ex);
        if (body == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        String initData = (String) body.get("initData");
        long userId = validateInitData(initData == null ? "" : initData, token);
        if (userId <= 0) {
            System.out.println("[warn] social rejected: " + path
                + " initDataLen=" + (initData == null ? -1 : initData.length()));
            sendJson(ex, 401, Map.of("ok", false));
            return;
        }
        /* [TRN-T2] 18+ для ВСЕГО соцслоя (решение владельца 12.11 №12 — «18+ для
           соцфункций», не только режим тренера): возраст self-declared — birth-данные
           или поле age (ProfileData.ageOf()); неизвестный возраст или < 18 — 403 на
           любой эндпоинт (и чтение, и запись) */
        ProfileData prof = storage.load(userId).profile;
        if (prof == null || prof.ageOf() < 18) {
            System.out.println("[warn] social age-gate: user " + userId + " " + path);
            sendJson(ex, 403, Map.of("ok", false, "reason", "age"));
            return;
        }
        SocialStore social = storage.social();
        switch (path) {
            case "/api/social/me" -> sendJson(ex, 200, socialMe(social, userId));
            case "/api/social/card" -> socialCard(social, userId, body, ex);
            case "/api/social/search" -> sendJson(ex, 200, socialSearch(social, userId, body));
            case "/api/social/apply" -> socialApply(social, userId, body, ex);
            case "/api/social/link" -> socialLinkAction(social, userId, body, ex);
            case "/api/social/invite" -> socialInvite(social, userId, body, ex);
            case "/api/social/grants" -> socialGrants(social, userId, body, ex);
            case "/api/social/report" -> socialReport(social, userId, body, ex);
            default -> sendJson(ex, 404, Map.of("ok", false));
        }
    }

    /* «моя соцпанель» (§4.2 /api/social/me): своя карточка, связки в обе стороны
       (с именем контрагента), входящие заявки (тренер), моя исходящая заявка, мой код.
       Истёкшие заявки не показываются и гасятся при следующей записи (§7.1). */
    private Map<String, Object> socialMe(SocialStore social, long userId) {
        SocialData d = social.get();
        long now = System.currentTimeMillis();
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        TrainerCard card = d.trainers.get(userId);
        resp.put("card", card == null ? null : card.toMap());
        List<Object> asTrainer = new ArrayList<>();
        List<Object> asStudent = new ArrayList<>();
        for (SocialLink l : d.links) {
            if (l.trainer == userId) asTrainer.add(linkView(l, d.trainers.get(l.student)));
            if (l.student == userId) asStudent.add(linkView(l, d.trainers.get(l.trainer)));
        }
        resp.put("linksAsTrainer", asTrainer);
        resp.put("linksAsStudent", asStudent);
        List<Object> incoming = new ArrayList<>();
        Map<String, Object> outgoing = null;
        for (SocialRequest r : d.requests) {
            if (r.expired(now)) continue;
            if (r.trainer == userId) incoming.add(r.toJson());
            if (r.student == userId && outgoing == null) outgoing = r.toJson();
        }
        resp.put("requests", incoming);
        resp.put("myRequest", outgoing);
        SocialInvite invite = d.inviteOf(userId);
        resp.put("inviteCode", invite == null ? null : invite.code);
        return resp;
    }

    /* связка для /api/social/me: данные как в файле + имя контрагента (после связки
       контакт раскрыт — §13.1); карточки у контрагента нет — null */
    private Map<String, Object> linkView(SocialLink l, TrainerCard peer) {
        Map<String, Object> m = l.toJson();
        m.put("peerName", peer == null ? null : peer.displayName);
        return m;
    }

    /* POST /api/social/card {initData, card:{…}, submit?, enabled?} — карточка режима
       «Я тренер» (§5.2). Переходы статусов [TRN-T2]: новая — draft; submit → pending
       (после отказа — не раньше чем через 30 дней, rejectedAt — финал владельца 23.11);
       правка содержимого подтверждённой возвращает в pending (§5.3); enabled=false —
       выключение режима (§5.4: скрытие из поиска, связи сохраняются — при них вернётся
       warning; полный разрыв связей — [TRN-T4]). 18+ гейт (решение 12.11 №12): возраст
       из birth-данных GymData. Клиентские поля замещаются целиком с лимитами формы;
       status/statusNote/verifiedAt/rejectedAt/updatedAt/photoUrl — server-owned. */
    private void socialCard(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        Map<String, Object> in = Json.map(body.get("card"));
        boolean submit = Boolean.TRUE.equals(body.get("submit"));
        boolean disable = body.containsKey("enabled") && !Boolean.TRUE.equals(body.get("enabled"));
        boolean enable = Boolean.TRUE.equals(body.get("enabled"));
        /* submit/enabled без card разрешены: у клиента уже есть карточка — меняется только
           статус; но хотя бы что-то одно прийти обязано. 18+ гейт — общий в handleSocial */
        if (in == null && !submit && !disable && !enable) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        SocialData d = social.get();
        TrainerCard prev = d.trainers.get(userId);
        if (prev == null && in == null) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        /* [TRN-T2 фикс ревью] стартуем с ПОЛНОЙ копии prev: путь «только статус»
           (submit/enabled без card) не теряет контент карточки; client-поля ниже
           замещаются поверх копии, server-owned остаются как были */
        TrainerCard card = TrainerCard.copyOf(prev);
        if (in != null) {
            String name = clamp(in, "displayName", TrainerCard.MAX_NAME);
            if (name.isEmpty()) { /* имя — единственное обязательное поле формы (§5.2: 2–40) */
                sendJson(ex, 400, Map.of("ok", false));
                return;
            }
            card.displayName = name;
            card.bio = clamp(in, "bio", TrainerCard.MAX_BIO);
            card.city = clamp(in, "city", TrainerCard.MAX_CITY);
            card.gyms = clamp(in, "gyms", TrainerCard.MAX_GYMS);
            /* [TRN-T2 фикс ревью] card — копия prev: клиентские списки ЗАМЕЩАЮТ содержимое */
            card.specs.clear();
            card.specs.addAll(clampList(in, "specs", TrainerCard.MAX_SPECS, 16));
            card.specs.removeIf(s -> !TrainerCard.SPEC_IDS.contains(s)); /* только набор §5.2 */
            int y = (int) Json.lng(in.get("years"));
            card.years = Math.max(0, Math.min(y, TrainerCard.MAX_YEARS));
            card.achievements.clear();
            card.achievements.addAll(clampList(in, "achievements", TrainerCard.MAX_LIST_ITEMS, TrainerCard.MAX_ITEM_LEN));
            card.education.clear();
            card.education.addAll(clampList(in, "education", TrainerCard.MAX_LIST_ITEMS, TrainerCard.MAX_ITEM_LEN));
            card.schedule.clear();
            card.schedule.addAll(clampList(in, "schedule", TrainerCard.MAX_SCHEDULE_ITEMS, TrainerCard.MAX_SCHEDULE_LEN));
            int c = (int) Json.lng(in.get("cap"));
            card.cap = TrainerCard.CAPS.contains(c) ? c : TrainerCard.DEFAULT_CAP;
            Object av = in.get("useTgAvatar");
            if (av instanceof Boolean b) card.useTgAvatar = b;
            /* [TRN-T3] аватар Telegram — ТОЛЬКО из подписанного initData (user.photo_url);
               клиентский payload не доверенный (по образцу initUserName, ревью №3);
               пустой photo_url (Telegram не дал ссылку) прежний аватар не затирает */
            String photo = initUserPhoto((String) body.get("initData"));
            if (!photo.isEmpty()) card.photoUrl = photo;
            card.updatedAt = nowIso();
            /* [TRN-T2] правка содержимого возвращает подтверждённую карточку на проверку (§5.3) */
            if (TrainerCard.STATUS_VERIFIED.equals(card.status)) card.status = TrainerCard.STATUS_PENDING;
            if (prev == null) stats.inc("socialTrainerOn"); /* включение режима (§17) */
        }
        boolean alreadyPending = TrainerCard.STATUS_PENDING.equals(card.status);
        if (submit && !alreadyPending) { /* «Отправить на проверку» (§5.2 → §14.5) */
            if (TrainerCard.STATUS_REJECTED.equals(card.status)) {
                long left = resubmitLeftDays(card.rejectedAt);
                if (left > 0) { /* после отказа — через 30 дней (решение владельца 23.11) */
                    sendJson(ex, 403, Map.of("ok", false, "reason", "cooldown", "retryInDays", left));
                    return;
                }
            }
            card.status = TrainerCard.STATUS_PENDING;
            card.updatedAt = nowIso();
            stats.inc("socialCardPending");
            notifyOwnerPending(userId, card);
        }
        /* повторный submit при уже-pending — тихий успех: статус не меняется, владелец
           повторно не уведомляется, счётчик не растёт (замечание ревью батча T1–T3) */
        String warning = null;
        if (disable) { /* выключение режима (§5.4): вне поиска, связи сохраняются */
            card.status = TrainerCard.STATUS_HIDDEN;
            card.updatedAt = nowIso();
            int linked = d.studentCount(userId);
            if (linked > 0) {
                warning = "Режим выключен, карточка скрыта из поиска. Связи сохранены: "
                    + linked + " " + BotLogic.plural(linked, "подопечный", "подопечных", "подопечных")
                    + " — разорвать их можно в разделе «Мои подопечные»";
            }
        } else if (enable && TrainerCard.STATUS_HIDDEN.equals(card.status)) {
            /* повторное включение — черновик; submit снова отправит на проверку */
            card.status = TrainerCard.STATUS_DRAFT;
            card.updatedAt = nowIso();
        }
        d.trainers.put(userId, card);
        social.save();
        System.out.println("[social] card user " + userId + " status " + card.status
            + " specs " + card.specs.size() + " years " + card.years);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("card", card.toMap());
        if (warning != null) resp.put("warning", warning);
        sendJson(ex, 200, resp);
    }

    /* [TRN-T2] сколько дней осталось до конца 30-дневного кулдауна повторной отправки
       после отказа; 0 — кулдаун истёк, отказа не было или дата неразборчива.
       rejectedAt — локальное серверное время (как LocalDateTime.now()) → зона системная */
    private static long resubmitLeftDays(String rejectedAt) {
        if (rejectedAt == null || rejectedAt.isEmpty()) return 0;
        try {
            long ms = LocalDateTime.parse(rejectedAt)
                .plusDays(TrainerCard.RESUBMIT_COOLDOWN_DAYS)
                .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
                - System.currentTimeMillis();
            return ms <= 0 ? 0 : (ms + 86_399_999) / 86_400_000; /* вверх до целого дня */
        } catch (Exception e) {
            return 0;
        }
    }

    /* [TRN-T2] уведомление владельцу о карточке «на проверке» (§5.2 → §14.5);
       ownerChatId не задан (контракт-тесты, env пуст) — тихо. sendMessage шлёт в
       HTML-режиме — имя/город экранируются (замечание ревью) */
    private void notifyOwnerPending(long userId, TrainerCard card) {
        if (ownerChatId <= 0) return;
        api.sendMessage(ownerChatId, "🧑‍🏫 Карточка отправлена на проверку\n\n#"
            + userId + " · " + BotLogic.esc(card.displayName)
            + (card.city.isEmpty() ? "" : " · " + BotLogic.esc(card.city))
            + "\n\nРазбор очереди: /trainer_pending", null);
    }

    /* [TRN-T3] аватар Telegram из ПОДПИСАННОГО initData (user.photo_url) — server-owned
       ПДн, клиентский payload «photo» не доверенный; пусто — аватара нет.
       Только https (инъекция javascript:/data: исключена на входе в базу). */
    static String initUserPhoto(String initData) {
        if (initData == null || initData.isEmpty()) return "";
        try {
            Map<String, String> params = new HashMap<>();
            for (String pair : initData.split("&")) {
                int i = pair.indexOf('=');
                if (i <= 0) continue;
                params.put(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
            }
            String userJson = params.get("user");
            if (userJson == null) return "";
            Map<String, Object> user = Json.map(Json.parse(userJson));
            String photo = Json.str(user, "photo_url");
            if (photo == null) return "";
            photo = photo.strip();
            return photo.startsWith("https://") ? photo : "";
        } catch (Exception e) {
            return "";
        }
    }

    /* POST /api/social/search {initData, city?, specs?:[id]} — публичный каталог:
       только verified-карточки (§6.2); анонимного каталога нет (initData обязателен).
       city — вхождение без регистра в city и gyms; specs — совпадение по любой (OR).
       Сортировка: свежие подтверждения сверху (§6.2); пока verifiedAt не проставляется
       ([TRN-T2]) — по updatedAt; строки ISO сравниваются лексикографически. */
    private Map<String, Object> socialSearch(SocialStore social, long userId, Map<String, Object> body) {
        String city = clamp(body, "city", 80).toLowerCase();
        List<String> specs = clampList(body, "specs", TrainerCard.MAX_SPECS, 16);
        SocialData d = social.get();
        stats.inc("socialSearch"); /* [TRN-T3] поиски тренера (§17) */
        List<Map.Entry<Long, TrainerCard>> hits = new ArrayList<>();
        for (Map.Entry<Long, TrainerCard> e : d.trainers.entrySet()) {
            TrainerCard card = e.getValue();
            if (!TrainerCard.STATUS_VERIFIED.equals(card.status)) continue;
            if (!city.isEmpty() && !card.city.toLowerCase().contains(city)
                && !card.gyms.toLowerCase().contains(city)) continue;
            if (!specs.isEmpty() && card.specs.stream().noneMatch(specs::contains)) continue;
            hits.add(e);
        }
        hits.sort((a, b) -> {
            String ka = a.getValue().verifiedAt.isEmpty() ? a.getValue().updatedAt : a.getValue().verifiedAt;
            String kb = b.getValue().verifiedAt.isEmpty() ? b.getValue().updatedAt : b.getValue().verifiedAt;
            return kb.compareTo(ka);
        });
        List<Object> cards = new ArrayList<>();
        for (Map.Entry<Long, TrainerCard> e : hits) {
            Map<String, Object> cm = e.getValue().publicMap();
            cm.put("userId", e.getKey());
            cards.add(cm);
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("cards", cards);
        return resp;
    }

    /* POST /api/social/apply {initData, trainerId, comment?} — заявка в подопечные (§7.1):
       только на verified-карточку, не к себе, без существующей связки и дубля активной
       заявки; лимит подопечных тренера («Набор закрыт», §6.4). Истёкшие заявки гаснут. */
    private void socialApply(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        long trainerId = Json.lng(body.get("trainerId"));
        String comment = clamp(body, "comment", SocialRequest.MAX_COMMENT);
        if (trainerId <= 0 || trainerId == userId) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        SocialData d = social.get();
        long now = System.currentTimeMillis();
        TrainerCard card = d.trainers.get(trainerId);
        if (card == null || !TrainerCard.STATUS_VERIFIED.equals(card.status)) {
            sendJson(ex, 404, Map.of("ok", false));
            return;
        }
        d.purgeExpiredRequests(now);
        if (d.linkBetween(trainerId, userId) != null || d.activeRequest(trainerId, userId, now) != null) {
            sendJson(ex, 409, Map.of("ok", false));
            return;
        }
        if (d.studentCount(trainerId) >= card.cap) {
            sendJson(ex, 409, Map.of("ok", false));
            return;
        }
        SocialRequest r = new SocialRequest();
        r.trainer = trainerId;
        r.student = userId;
        r.comment = comment;
        r.createdAt = nowIso();
        d.requests.add(r);
        social.save();
        System.out.println("[social] apply user " + userId + " -> trainer " + trainerId);
        sendJson(ex, 200, Map.of("ok", true));
    }

    /* POST /api/social/link {initData, action, userId} — механика связки (§7):
       accept — тренер принимает заявку (связка создаётся, гранты дефолтные:
       «Прогресс» ВКЛ — финал владельца 23.11), reject — отклоняет, break — любая
       из сторон разрывает связь (гранты умирают вместе со связкой, §7.5/§8.2).
       Уведомления бота — [TRN-T4]. */
    private void socialLinkAction(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        String action = Json.str(body, "action");
        long peer = Json.lng(body.get("userId"));
        SocialData d = social.get();
        long now = System.currentTimeMillis();
        if ("break".equals(action)) {
            SocialLink link = peer > 0 ? d.linkBetween(userId, peer) : null;
            if (link == null) {
                sendJson(ex, 404, Map.of("ok", false));
                return;
            }
            d.links.remove(link);
            social.save();
            System.out.println("[social] break user " + userId + " peer " + peer);
            sendJson(ex, 200, Map.of("ok", true));
            return;
        }
        if ("reject".equals(action) || "accept".equals(action)) {
            /* заявки разбирает только тренер (я — адресат заявки) */
            SocialRequest r = peer > 0 ? d.activeRequest(userId, peer, now) : null;
            if (r == null) {
                sendJson(ex, 404, Map.of("ok", false));
                return;
            }
            if ("reject".equals(action)) {
                d.requests.remove(r);
                social.save();
                System.out.println("[social] reject user " + userId + " student " + peer);
                sendJson(ex, 200, Map.of("ok", true));
                return;
            }
            if (d.linkBetween(userId, peer) != null) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            /* [TRN-T2 фикс ревью] выключенный (hidden) тренер не принимает заявок (§5.4) */
            if (!trainerActive(d, userId)) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            /* [TRN-T2 фикс ревью] у подопечного один активный тренер (§7.4 MVP):
               не только дубль этой пары, но и любая другая действующая связка */
            if (d.hasTrainer(peer)) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            TrainerCard card = d.trainers.get(userId);
            int cap = card == null ? TrainerCard.DEFAULT_CAP : card.cap;
            if (d.studentCount(userId) >= cap) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            SocialLink link = new SocialLink();
            link.trainer = userId;
            link.student = peer;
            link.since = LocalDate.now().toString();
            link.grants.putAll(SocialLink.defaultGrants());
            link.source = SocialLink.SOURCE_APPLY;
            d.requests.remove(r);
            d.links.add(link);
            social.save();
            System.out.println("[social] accept user " + userId + " student " + peer);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("link", link.toJson());
            sendJson(ex, 200, resp);
            return;
        }
        sendJson(ex, 400, Map.of("ok", false));
    }

    /* [TRN-T2 фикс ревью] карточка тренера существует и режим не выключен: новые заявки
       и раздача кодов невозможны при hidden (§5.4) — иначе выключенный режим обходится
       напрямую через API в обход поиска */
    private static boolean trainerActive(SocialData d, long trainerId) {
        TrainerCard c = d.trainers.get(trainerId);
        return c != null && !TrainerCard.STATUS_HIDDEN.equals(c.status);
    }

    /* POST /api/social/invite {initData, action, code?} — код приглашения (§7.2):
       create — новый одноразовый код (прежний гасится), revoke — отозвать,
       use — подопечный применяет код: связка сразу, без стадии заявки. */
    private void socialInvite(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        String action = Json.str(body, "action");
        SocialData d = social.get();
        if ("create".equals(action)) {
            /* [TRN-T2 фикс ревью] код раздаёт только активный (не hidden) тренер (§5.4) */
            if (!trainerActive(d, userId)) {
                sendJson(ex, 403, Map.of("ok", false));
                return;
            }
            d.invites.removeIf(i -> i.trainer == userId);
            SocialInvite inv = new SocialInvite();
            inv.trainer = userId;
            inv.code = newInviteCode(d);
            d.invites.add(inv);
            social.save();
            System.out.println("[social] invite create user " + userId);
            sendJson(ex, 200, Map.of("ok", true, "code", inv.code));
            return;
        }
        if ("revoke".equals(action)) {
            d.invites.removeIf(i -> i.trainer == userId);
            social.save();
            sendJson(ex, 200, Map.of("ok", true));
            return;
        }
        if ("use".equals(action)) {
            String code = Json.str(body, "code");
            SocialInvite inv = code == null ? null : d.inviteByCode(code.strip());
            if (inv == null || inv.trainer == userId) {
                sendJson(ex, 404, Map.of("ok", false));
                return;
            }
            /* [TRN-T2 фикс ревью] код выключенного (hidden) тренера не работает (§5.4) */
            if (!trainerActive(d, inv.trainer)) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            /* [TRN-T2 фикс ревью] у подопечного один активный тренер (§7.4 MVP) */
            if (d.hasTrainer(userId)) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            if (d.linkBetween(inv.trainer, userId) != null) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            TrainerCard card = d.trainers.get(inv.trainer);
            int cap = card == null ? TrainerCard.DEFAULT_CAP : card.cap;
            if (d.studentCount(inv.trainer) >= cap) {
                sendJson(ex, 409, Map.of("ok", false));
                return;
            }
            SocialLink link = new SocialLink();
            link.trainer = inv.trainer;
            link.student = userId;
            link.since = LocalDate.now().toString();
            link.grants.putAll(SocialLink.defaultGrants());
            link.source = SocialLink.SOURCE_INVITE;
            d.invites.remove(inv); /* код одноразовый — гасится применением (§7.2) */
            d.links.add(link);
            social.save();
            System.out.println("[social] invite use user " + userId + " trainer " + inv.trainer);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("link", link.toJson());
            sendJson(ex, 200, resp);
            return;
        }
        sendJson(ex, 400, Map.of("ok", false));
    }

    /* 6 символов, алфавит без похожих (§7.2); коллизия в пределах активных кодов
       исключена перегенерацией (как newShareId) */
    private static final String INVITE_ALPHABET = "ABCDEFGHJKLMNPRTUVWXY23456789";

    private String newInviteCode(SocialData d) {
        Set<String> active = new HashSet<>();
        for (SocialInvite i : d.invites) active.add(i.code);
        StringBuilder b = new StringBuilder(SocialInvite.CODE_LEN);
        do {
            b.setLength(0);
            for (int i = 0; i < SocialInvite.CODE_LEN; i++) {
                b.append(INVITE_ALPHABET.charAt(shareRandom.nextInt(INVITE_ALPHABET.length())));
            }
        } while (active.contains(b.toString()));
        return b.toString();
    }

    /* POST /api/social/grants {initData, trainerId, grants:{key:bool}} — согласие
       подопечного (§8): меняет только его связку, применяется немедленно; уведомлений
       тренеру нет (спам-риск, §8.2). Незнакомые ключи клиента игнорируются, ранее
       сохранённые (будущие гранты) не теряются. */
    private void socialGrants(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        long trainerId = Json.lng(body.get("trainerId"));
        Map<String, Object> in = Json.map(body.get("grants"));
        SocialLink link = trainerId > 0 ? social.get().linkBetween(trainerId, userId) : null;
        if (link == null || link.student != userId || in == null) {
            sendJson(ex, 404, Map.of("ok", false));
            return;
        }
        for (String k : SocialStore.GRANT_KEYS) {
            Object v = in.get(k);
            if (v instanceof Boolean b) link.grants.put(k, b);
        }
        social.save();
        System.out.println("[social] grants user " + userId + " trainer " + trainerId);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("grants", link.toJson().get("grants"));
        sendJson(ex, 200, resp);
    }

    /* POST /api/social/report {initData, about, text} — жалоба (§13.4): владелец получает
       текст через существующий feedback-канал (deep-link — клиентская часть), здесь —
       запись в social.json; разбор — админ-команды [TRN-T2]. */
    private void socialReport(SocialStore social, long userId, Map<String, Object> body, HttpExchange ex) throws IOException {
        long about = Json.lng(body.get("about"));
        String text = clamp(body, "text", SocialReport.MAX_TEXT);
        if (about <= 0 || about == userId || text.isEmpty()) {
            sendJson(ex, 400, Map.of("ok", false));
            return;
        }
        SocialData d = social.get();
        SocialReport r = new SocialReport();
        r.by = userId;
        r.about = about;
        r.at = nowIso();
        r.text = text;
        d.reports.add(r);
        social.save();
        System.out.println("[social] report user " + userId + " about " + about);
        sendJson(ex, 200, Map.of("ok", true));
    }

    /* [TRN-T1] серверная обрезка строк по лимитам формы (§5.2) — как initUserName
       (ревью №2): null/пусто → "", длиннее лимита — хвост отрезан */
    private static String clamp(Map<String, Object> m, String key, int max) {
        String v = Json.str(m, key);
        if (v == null) return "";
        String t = v.strip();
        return t.length() <= max ? t : t.substring(0, max);
    }

    /* список строк формы: не-строки пропускаются, лимит количества и длины элемента */
    private static List<String> clampList(Map<String, Object> m, String key, int maxItems, int maxLen) {
        List<String> out = new ArrayList<>();
        List<Object> in = Json.list(m.get(key));
        if (in == null) return out;
        for (Object o : in) {
            if (out.size() >= maxItems) break;
            if (!(o instanceof String s)) continue;
            String t = s.strip();
            if (t.isEmpty()) continue;
            out.add(t.length() <= maxLen ? t : t.substring(0, maxLen));
        }
        return out;
    }

    /* ISO-дата-время без наносекунд (формат createdAt/updatedAt в social.json) */
    private static String nowIso() {
        return LocalDateTime.now().withNano(0).toString();
    }

    private void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path == null || path.equals("/") || path.equals("/app")) path = "/index.html";
        /* [CNT-T1] лендинг: /landing и /landing/ — index.html из web/landing/
           (без редиректа, по аналогии с / и /app; счётчик ниже срабатывает одинаково) */
        if (path.equals("/landing") || path.equals("/landing/")) path = "/landing/index.html";
        /* [EXR-T8] гвард path traversal: путь приходит уже декодированным (%2e%2e → ..),
           сегменты «..» запрещены; канонический путь (toRealPath, с симлинками) обязан
           остаться внутри webDir — иначе 404. Раньше /img/%2e%2e/app.js отдавал соседний
           файл с 200. Легитимные запросы (без «..» и симлинков) не меняются. */
        boolean traversal = false;
        for (String seg : path.split("/")) {
            if ("..".equals(seg)) {
                traversal = true;
                break;
            }
        }
        Path file = null;
        try {
            file = webDir.resolve(path.substring(1)).normalize().toRealPath();
        } catch (IOException e) {
            /* файла нет / битый путь — ниже уйдёт в 404 */
        }
        boolean inside = false;
        try {
            inside = file != null && file.startsWith(webDir.toRealPath());
        } catch (IOException e) {
            /* webDir недоступен — считаем цель снаружи */
        }
        if (traversal || !inside || !Files.isRegularFile(file)) {
            send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
            return;
        }
        /* [CNT-T1] просмотры лендинга — свой анонимный счётчик по образцу maInit (решение
           владельца: агрегат без ПДн, попадает в /stats). Считаем только успешные GET
           /landing/ и /landing/index.html; HEAD-пробы мониторов и 404 не считаются */
        if (path.equals("/landing/index.html") && "GET".equalsIgnoreCase(ex.getRequestMethod())) {
            stats.inc("landingViews");
        }
        String ct = contentType(path);
        /* [UX-B17] кэш-политика статики: HTML-документы — входные точки (/, /app, /landing/,
           /privacy.html — открываются по ссылкам без ?v=) — no-cache: браузер каждый раз
           ре-валидирует, в index.html лежат ссылки на ?v= версионной статики. Вся остальная
           статика (JS/CSS с обязательным ?v=-бампом на каждом релизе, img/ассеты с
           неизменяемыми именами) — годовой immutable-кэш. Раньше вся статика была
           no-store: Mini App перекачивал ~660KB при каждом открытии (UX-B17).
           Релиз без бампа ?v= = устаревшая статика у пользователей до истечения max-age —
           docs/static-caching.md, контроль — ревьюер */
        String cachePolicy = path.endsWith(".html")
            ? "no-cache"
            : "public, max-age=31536000, immutable";
        /* [EXR-T7] gzip-клиенту текстовая статика отдаётся сжатой — из кэша байтов (precompressed:
           send не жмёт повторно); клиенту без gzip — чтение с диска как раньше */
        boolean gzStatic = acceptsGzip(ex) && compressible(ct);
        byte[] body = gzStatic ? gzippedStatic(file) : Files.readAllBytes(file);
        /* [CNT-T1] HEAD на статике (линк-чекеры, мониторы): только заголовки, без тела —
           как /health; иначе JDK-сервер предупреждает о Content-Length при HEAD в лог */
        if ("HEAD".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.getResponseHeaders().set("Content-Type", ct);
            ex.getResponseHeaders().set("Cache-Control", cachePolicy);
            ex.getResponseHeaders().set("Vary", "Accept-Encoding");
            ex.sendResponseHeaders(200, -1);
            return;
        }
        send(ex, 200, body, ct, cachePolicy, gzStatic);
    }

    private static String contentType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        /* [EXR-T2] фото упражнений (web/img/exercises) */
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }

    private Map<String, Object> readJsonBody(HttpExchange ex) throws IOException {
        try (InputStream is = ex.getRequestBody()) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            int total = 0;
            while ((n = is.read(b)) > 0) {
                total += n;
                if (total > MAX_BODY) return null;
                buf.write(b, 0, n);
            }
            String s = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            if (s.isEmpty()) return null;
            return Json.map(Json.parse(s));
        } catch (Exception e) {
            return null;
        }
    }

    private void sendJson(HttpExchange ex, int code, Object obj) throws IOException {
        send(ex, code, Json.write(obj).getBytes(StandardCharsets.UTF_8), "application/json; charset=utf-8");
    }

    private void send(HttpExchange ex, int code, byte[] body, String contentType) throws IOException {
        send(ex, code, body, contentType, "no-store");
    }

    private void send(HttpExchange ex, int code, byte[] body, String contentType, String cacheControl) throws IOException {
        send(ex, code, body, contentType, cacheControl, false);
    }

    /* [EXR-T6] cacheControl: /img/ и /landing/assets/ [CNT-T1] — public, max-age=604800;
        все остальные ответы — no-store, как раньше.
       [EXR-T7] Клиенту с Accept-Encoding: gzip текстовые ответы (text/*, JS, JSON: /api/init,
       /api/save, /stats) сжимаются: Content-Encoding: gzip + Vary: Accept-Encoding, длина —
       сжатого размера. Бинарное (img) и клиенты без gzip — байт-в-байт как раньше.
       precompressed: байты тела уже сжаты (кэш gzip-статики) — ставим только заголовок,
       повторно не жмём. */
    private void send(HttpExchange ex, int code, byte[] body, String contentType, String cacheControl,
                      boolean precompressed) throws IOException {
        boolean gz = !precompressed && acceptsGzip(ex) && compressible(contentType);
        byte[] out = gz ? gzip(body) : body;
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", cacheControl);
        if (gz || precompressed) ex.getResponseHeaders().set("Content-Encoding", "gzip");
        /* Vary у обоих вариантов: кэши обязаны различать ответы по Accept-Encoding */
        ex.getResponseHeaders().set("Vary", "Accept-Encoding");
        ex.sendResponseHeaders(code, out.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(out);
        }
    }

    /* [EXR-T7] клиент явно допускает gzip в Accept-Encoding (достаточно подстроки:
       q-значения и x-gzip не различаем — браузеры и curl посылают ровно «gzip») */
    private static boolean acceptsGzip(HttpExchange ex) {
        List<String> ae = ex.getRequestHeaders().get("Accept-Encoding");
        if (ae == null) return false;
        for (String h : ae) {
            if (h != null && h.toLowerCase().contains("gzip")) return true;
        }
        return false;
    }

    /* [EXR-T7] сжимаем только текст: HTML/CSS/JS/JSON (API-ответы и /stats идут через тот же
       send); изображения и прочий бинар уже сжаты или не текст — отдаём как есть */
    private static boolean compressible(String contentType) {
        return contentType.startsWith("text/")
            || contentType.startsWith("application/javascript")
            || contentType.startsWith("application/json");
    }

    private static byte[] gzip(byte[] body) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(Math.max(64, body.length / 4));
        try (GZIPOutputStream gz = new GZIPOutputStream(buf)) {
            gz.write(body);
        }
        return buf.toByteArray();
    }

    /* [EXR-T7] сжатая статика из кэша (инвалидация — рестарт: файлы меняются только с релизом);
       гонка двух потоков на первом запросе безвредна — оба сжимают один и тот же файл,
       в кэш атомарно попадает один результат */
    private byte[] gzippedStatic(Path file) throws IOException {
        byte[] hit = gzipCache.get(file);
        if (hit != null) return hit;
        byte[] gz = gzip(Files.readAllBytes(file));
        gzipCache.putIfAbsent(file, gz);
        return gz;
    }

    public static long validateInitData(String initData, String botToken) {
        if (initData == null || initData.isEmpty() || botToken == null) return -1;
        Map<String, String> params = new HashMap<>();
        for (String pair : initData.split("&")) {
            int i = pair.indexOf('=');
            if (i <= 0) continue;
            try {
                params.put(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
            } catch (Exception e) {
                return -1;
            }
        }
        String hash = params.remove("hash");
        if (hash == null || hash.isEmpty()) return -1;

        List<String> keys = new ArrayList<>(params.keySet());
        Collections.sort(keys);
        StringBuilder check = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            if (i > 0) check.append('\n');
            check.append(keys.get(i)).append('=').append(params.get(keys.get(i)));
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("WebAppData".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] secret = mac.doFinal(botToken.getBytes(StandardCharsets.UTF_8));
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] computed = mac.doFinal(check.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : computed) hex.append(String.format("%02x", b));
            if (!MessageDigest.isEqual(hex.toString().getBytes(StandardCharsets.UTF_8),
                hash.toLowerCase().getBytes(StandardCharsets.UTF_8))) {
                return -1;
            }
        } catch (Exception e) {
            return -1;
        }

        String authDate = params.get("auth_date");
        if (authDate != null) {
            try {
                Long.parseLong(authDate);
            } catch (NumberFormatException e) {
                return -1;
            }
        }

        String userJson = params.get("user");
        if (userJson == null) return -1;
        try {
            Map<String, Object> user = Json.map(Json.parse(userJson));
            return Json.lng(user.get("id"));
        } catch (Exception e) {
            return -1;
        }
    }
}
