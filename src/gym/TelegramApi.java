package gym;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class TelegramApi {
    private final String base;

    public TelegramApi(String token) {
        this.base = "https://api.telegram.org/bot" + token;
    }

    public static Map<String, Object> button(String text, String data) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("text", text);
        b.put("callback_data", data);
        return b;
    }

    public static Map<String, Object> urlButton(String text, String url) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("text", text);
        b.put("url", url);
        return b;
    }

    public String getBotUsername() {
        try {
            Map<String, Object> m = Json.map(post("getMe", "{}"));
            if (!Boolean.TRUE.equals(m.get("ok"))) return null;
            Map<String, Object> r = Json.map(m.get("result"));
            return Json.str(r, "username");
        } catch (Exception e) {
            System.out.println("[warn] getMe: " + e.getMessage());
            return null;
        }
    }

    public List<Map<String, Object>> getUpdates(long offset) throws Exception {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("offset", offset);
        req.put("timeout", 25);
        req.put("limit", 100);
        Map<String, Object> m = Json.map(post("getUpdates", Json.write(req)));
        if (!Boolean.TRUE.equals(m.get("ok"))) {
            throw new IllegalStateException("getUpdates: " + m.get("description"));
        }
        List<Object> arr = Json.list(m.get("result"));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : arr) out.add(Json.map(o));
        return out;
    }

    public void sendMessage(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("chat_id", chatId);
        req.put("text", text);
        req.put("parse_mode", "HTML");
        if (keyboard != null) req.put("reply_markup", markup(keyboard));
        postSilent("sendMessage", req);
    }

    public void sendMessageWithKeyboard(long chatId, String text, Map<String, Object> replyMarkup) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("chat_id", chatId);
        req.put("text", text);
        req.put("parse_mode", "HTML");
        if (replyMarkup != null) req.put("reply_markup", replyMarkup);
        postSilent("sendMessage", req);
    }

    public static Map<String, Object> appKeyboard(String webAppUrl) {
        Map<String, Object> webApp = new LinkedHashMap<>();
        webApp.put("url", webAppUrl);
        Map<String, Object> btn = new LinkedHashMap<>();
        btn.put("text", "🏋️ Открыть приложение");
        btn.put("web_app", webApp);
        Map<String, Object> kb = new LinkedHashMap<>();
        kb.put("keyboard", List.of(List.of(btn)));
        kb.put("resize_keyboard", true);
        return kb;
    }

    public void editMessageText(long chatId, long messageId, String text, List<List<Map<String, Object>>> keyboard) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("chat_id", chatId);
        req.put("message_id", messageId);
        req.put("text", text);
        req.put("parse_mode", "HTML");
        if (keyboard != null) req.put("reply_markup", markup(keyboard));
        postSilent("editMessageText", req);
    }

    public void answerCallbackQuery(String callbackId, String text) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("callback_query_id", callbackId);
        if (text != null) req.put("text", text);
        postSilent("answerCallbackQuery", req);
    }

    public void deleteWebhook() {
        postSilent("deleteWebhook", new LinkedHashMap<>());
    }

    public void setMyCommands() {
        List<Object> cmds = new ArrayList<>();
        cmds.add(cmd("start", "Главное меню"));
        cmds.add(cmd("workout", "Тренировка"));
        cmds.add(cmd("view", "Посмотреть тренировку"));
        cmds.add(cmd("history", "История тренировок"));
        cmds.add(cmd("stats", "Статистика"));
        cmds.add(cmd("app", "Открыть приложение"));
        cmds.add(cmd("profile", "Профиль: рост, вес, возраст"));
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("commands", cmds);
        postSilent("setMyCommands", req);
    }

    public void setChatMenuButton(String webAppUrl) {
        Map<String, Object> webApp = new LinkedHashMap<>();
        webApp.put("url", webAppUrl);
        Map<String, Object> btn = new LinkedHashMap<>();
        btn.put("type", "web_app");
        btn.put("text", "🏋️ Дневник");
        btn.put("web_app", webApp);
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("menu_button", btn);
        postSilent("setChatMenuButton", req);
    }

    private Map<String, Object> cmd(String command, String description) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", command);
        m.put("description", description);
        return m;
    }

    private Map<String, Object> markup(List<List<Map<String, Object>>> keyboard) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("inline_keyboard", keyboard);
        return m;
    }

    private void postSilent(String method, Map<String, Object> req) {
        try {
            Map<String, Object> m = Json.map(post(method, Json.write(req)));
            if (!Boolean.TRUE.equals(m.get("ok"))) {
                System.out.println("[warn] " + method + ": " + m.get("description"));
            }
        } catch (Exception e) {
            System.out.println("[warn] " + method + ": " + e.getMessage());
        }
    }

    private Object post(String method, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/" + method).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(10000);
        c.setReadTimeout(40000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream os = c.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String resp = read(is);
        if (code >= 400) throw new IllegalStateException(method + " HTTP " + code + ": " + resp);
        return Json.parse(resp);
    }

    private static String read(InputStream is) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = is.read(b)) > 0) buf.write(b, 0, n);
        is.close();
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
