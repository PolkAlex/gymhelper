package gym.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gym.GymData;
import gym.Json;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

public final class WebServer {
    private static final int MAX_BODY = 2 * 1024 * 1024;
    private static final long INIT_DATA_TTL_SEC = 86400;

    private final String token;
    private final Storage storage;
    private final Path webDir;
    private HttpServer server;

    public WebServer(String token, Storage storage, Path webDir) {
        this.token = token;
        this.storage = storage;
        this.webDir = webDir.toAbsolutePath().normalize();
    }

    public void start(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", this::handle);
        server.setExecutor(Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "web");
            t.setDaemon(true);
            return t;
        }));
        server.start();
    }

    private void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        try {
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
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("userId", userId);
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
        if (data.nextId < 1) data.nextId = 1;
        for (Workout iw : data.workouts) {
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
        if (data.profile != null) current.profile = data.profile;
        data = current;
        data.nextId = Math.max(current.nextId, data.nextId);
        data.rev = current.rev + 1;
        storage.save(userId, data);
        System.out.println("[save] user " + userId + " rev " + data.rev + " workouts " + data.workouts.size());
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
        send(ex, 200, Files.readAllBytes(file), contentType(path));
    }

    private static String contentType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
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
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
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
