package gym;

import gym.web.WebServer;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public final class Main {
    public static void main(String[] args) throws Exception {
        String token = System.getenv("GYM_BOT_TOKEN");
        if (token == null || token.isBlank()) token = readTextFile(Path.of("token.txt"));
        if (token == null || token.isBlank()) {
            System.out.println("Bot token not found!");
            System.out.println("1) Create a bot via @BotFather in Telegram and get the token.");
            System.out.println("2) Set env var GYM_BOT_TOKEN, or create token.txt in the project root with the token inside.");
            return;
        }

        Storage storage = new Storage(Path.of("data"));
        /* [ANA-T1] агрегаты-счётчики (без ПДн): один экземпляр на бот и веб-сервер */
        Stats stats = new Stats(Path.of("data").resolve("stats.json"));
        TelegramApi api = new TelegramApi(token);

        String webAppUrl = System.getenv("GYM_WEBAPP_URL");
        if (webAppUrl == null || webAppUrl.isBlank()) webAppUrl = readTextFile(Path.of("webapp.txt"));
        if (webAppUrl != null && webAppUrl.trim().startsWith("https://")) {
            webAppUrl = webAppUrl.trim();
        } else {
            webAppUrl = null;
            System.out.println("[hint] put a public https URL into webapp.txt (or GYM_WEBAPP_URL) to enable the Mini App button");
        }

        String appLink = null;
        String botUsername = api.getBotUsername();
        if (botUsername != null && !botUsername.isBlank()) {
            appLink = "https://t.me/" + botUsername + "?startapp=app";
        }

        /* [UX-T16] рассылка владельцем: chat id владельца из env; не задан — admin-команды недоступны */
        long adminChatId = readLng(System.getenv("GYM_ADMIN_CHAT_ID"), 0);

        BotLogic logic = new BotLogic(api, storage, webAppUrl, appLink, adminChatId, stats);

        int port = readInt(System.getenv("GYM_PORT"), 8080);
        Path webDir = Path.of("web");
        if (Files.isDirectory(webDir)) {
            new WebServer(token, storage, webDir, stats).start(port);
            System.out.println("Web app server: http://" + WebServer.bindAddress() + ":" + port);
        } else {
            System.out.println("[warn] web/ folder not found - Mini App disabled");
        }

        if (webAppUrl != null) {
            api.setChatMenuButton(webAppUrl);
            System.out.println("Mini App menu button set: " + webAppUrl);
        }

        api.deleteWebhook();
        api.setMyCommands();
        System.out.println("Gym bot started. Press Ctrl+C to stop.");

        long offset = 0;
        while (true) {
            try {
                List<Map<String, Object>> updates = api.getUpdates(offset);
                for (Map<String, Object> u : updates) {
                    offset = Json.lng(u.get("update_id")) + 1;
                    logic.handle(u);
                }
            } catch (Exception e) {
                System.out.println("[warn] poll: " + e.getMessage());
                Thread.sleep(3000);
            }
        }
    }

    private static String readTextFile(Path p) {
        try {
            if (Files.exists(p)) return Files.readString(p, StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
        }
        return null;
    }

    private static int readInt(String s, int def) {
        try {
            if (s != null && !s.isBlank()) return Integer.parseInt(s.trim());
        } catch (NumberFormatException ignored) {
        }
        return def;
    }

    private static long readLng(String s, long def) {
        try {
            if (s != null && !s.isBlank()) return Long.parseLong(s.trim());
        } catch (NumberFormatException ignored) {
        }
        return def;
    }
}
