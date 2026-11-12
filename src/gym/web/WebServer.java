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
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;

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
        GymData data = storage.load(userId);
        System.out.println("[init] user " + userId + " rev " + data.rev + " workouts " + data.workouts.size());
        stats.inc("maInit");
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

    private void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path == null || path.equals("/") || path.equals("/app")) path = "/index.html";
        Path file = webDir.resolve(path.substring(1)).normalize();
        if (!file.startsWith(webDir) || !Files.isRegularFile(file)) {
            send(ex, 404, "Not found".getBytes(StandardCharsets.UTF_8), "text/plain; charset=utf-8");
            return;
        }
        /* [EXR-T6] фото упражнений (/img/) неизменяемы и именуются стабильно — кэш на неделю;
           остальная статика (JS/CSS с ?v=-бампом) по-прежнему no-store */
        boolean img = path.startsWith("/img/") && "GET".equalsIgnoreCase(ex.getRequestMethod());
        send(ex, 200, Files.readAllBytes(file), contentType(path),
            img ? "public, max-age=604800" : "no-store");
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

    /* [EXR-T6] cacheControl: /img/ — public, max-age=604800; все остальные ответы — no-store, как раньше */
    private void send(HttpExchange ex, int code, byte[] body, String contentType, String cacheControl) throws IOException {
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", cacheControl);
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
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
