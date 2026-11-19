package gym.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gym.GymData;
import gym.Json;
import gym.Stats;
import gym.Storage;
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
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
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
       env GYM_BOT_USERNAME, не задан — GymHelper_bot; отдаётся клиенту в /api/init */
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
    private HttpServer server;

    public WebServer(String token, Storage storage, Path webDir, Stats stats) {
        this.token = token;
        this.storage = storage;
        this.stats = stats;
        this.webDir = webDir.toAbsolutePath().normalize();
        String at = System.getenv("GYM_ADMIN_TOKEN");
        this.adminToken = (at == null || at.isBlank()) ? token : at.trim();
        String bu = System.getenv("GYM_BOT_USERNAME");
        this.botUsername = (bu == null || bu.isBlank()) ? "GymHelper_bot" : bu.trim();
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
            /* [UX-I16] публичная страница тренировки — БЕЗ initData (до авторизационного
               слоя /api/*, §8.1); robots.txt — статический файл web/robots.txt */
            if (path.startsWith("/w/")) {
                handleSharePage(ex, path.substring(3));
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
        sendJson(ex, 200, stats.snapshot());
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
        /* [UX-I14] клиентские события воронки картинки (§5): тап/resolved share/скачивание */
        "shareClick", "shareOk", "shareDownload");

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
        /* [EXR-T6] фото упражнений (/img/) неизменяемы и именуются стабильно — кэш на неделю;
           [CNT-T1] ассеты лендинга (/landing/assets/: og/favicon/скриншоты PNG) — тоже;
           остальная статика (JS/CSS с ?v=-бампом) по-прежнему no-store */
        boolean longCache = "GET".equalsIgnoreCase(ex.getRequestMethod())
            && (path.startsWith("/img/") || path.startsWith("/landing/assets/"));
        /* [EXR-T7] gzip-клиенту текстовая статика отдаётся сжатой — из кэша байтов (precompressed:
           send не жмёт повторно); клиенту без gzip — чтение с диска как раньше */
        boolean gzStatic = acceptsGzip(ex) && compressible(ct);
        byte[] body = gzStatic ? gzippedStatic(file) : Files.readAllBytes(file);
        /* [CNT-T1] HEAD на статике (линк-чекеры, мониторы): только заголовки, без тела —
           как /health; иначе JDK-сервер предупреждает о Content-Length при HEAD в лог */
        if ("HEAD".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.getResponseHeaders().set("Content-Type", ct);
            ex.getResponseHeaders().set("Cache-Control", longCache ? "public, max-age=604800" : "no-store");
            ex.getResponseHeaders().set("Vary", "Accept-Encoding");
            ex.sendResponseHeaders(200, -1);
            return;
        }
        send(ex, 200, body, ct, longCache ? "public, max-age=604800" : "no-store", gzStatic);
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
