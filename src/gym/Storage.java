package gym;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class Storage {
    /* сколько последних версий файла хранить в data/backups — из них восстанавливаются случайно удалённые тренировки */
    public static final int BACKUPS_TO_KEEP = 20;
    private static final Pattern BACKUP_FILE = Pattern.compile("^chat_(\\d+)\\.(\\d{13})\\.json$");

    private final Path dir;
    private final Path backupDir;

    public Storage(Path dir) {
        this.dir = dir;
        this.backupDir = dir.resolve("backups");
    }

    public synchronized GymData load(long chatId) {
        try {
            Path f = dir.resolve("chat_" + chatId + ".json");
            if (Files.exists(f)) {
                return GymData.fromJson(Json.map(Json.parse(Files.readString(f, StandardCharsets.UTF_8))));
            }
        } catch (Exception e) {
            System.out.println("[warn] load: " + e.getMessage());
        }
        return new GymData();
    }

    public synchronized void save(long chatId, GymData data) {
        try {
            Files.createDirectories(dir);
            Path f = dir.resolve("chat_" + chatId + ".json");
            if (Files.exists(f)) {
                backupCurrent(chatId, f);
            }
            Files.writeString(f, Json.write(data.toJson()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.out.println("[warn] save: " + e.getMessage());
        }
    }

    /* копия файла ДО перезаписи: chat_<id>.<timestamp>.json в data/backups, храним последние BACKUPS_TO_KEEP */
    private void backupCurrent(long chatId, Path f) {
        try {
            Files.createDirectories(backupDir);
            String content = Files.readString(f, StandardCharsets.UTF_8);
            if (content.isBlank()) return;
            Path dst = backupDir.resolve("chat_" + chatId + "." + System.currentTimeMillis() + ".json");
            Files.writeString(dst, content, StandardCharsets.UTF_8);
            rotate(chatId);
        } catch (Exception e) {
            System.out.println("[warn] backup: " + e.getMessage());
        }
    }

    private void rotate(long chatId) {
        try {
            List<Path> mine = new ArrayList<>();
            if (!Files.exists(backupDir)) return;
            for (Path p : Files.newDirectoryStream(backupDir, "chat_" + chatId + ".*.json")) {
                Matcher m = BACKUP_FILE.matcher(p.getFileName().toString());
                if (m.matches()) mine.add(p);
            }
            if (mine.size() <= BACKUPS_TO_KEEP) return;
            mine.sort(Path::compareTo);
            int extra = mine.size() - BACKUPS_TO_KEEP;
            for (int i = 0; i < extra; i++) {
                Files.deleteIfExists(mine.get(i));
            }
        } catch (Exception e) {
            System.out.println("[warn] backup rotate: " + e.getMessage());
        }
    }

    /* список бэкапов пользователя, свежие первыми (для восстановления случайно удалённого) */
    public synchronized List<Path> backups(long chatId) {
        List<Path> mine = new ArrayList<>();
        try {
            if (!Files.exists(backupDir)) return mine;
            for (Path p : Files.newDirectoryStream(backupDir, "chat_" + chatId + ".*.json")) {
                Matcher m = BACKUP_FILE.matcher(p.getFileName().toString());
                if (m.matches()) mine.add(p);
            }
            mine.sort(Path::compareTo);
            Collections.reverse(mine);
        } catch (Exception e) {
            System.out.println("[warn] backups: " + e.getMessage());
        }
        return mine;
    }

    /* [ONB-T2] удаление данных пользователя по запросу: chat_<id>.json стирается безвозвратно.
       Бэкапы в data/backups остаются до истечения ретеншна (20 версий; внешние копии — 14 дней) —
       это прозрачно указано в политике (web/privacy.html). */
    public synchronized void deleteChat(long chatId) {
        try {
            if (Files.deleteIfExists(dir.resolve("chat_" + chatId + ".json"))) {
                System.out.println("[info] deleted chat_" + chatId + ".json (по запросу пользователя)");
            }
        } catch (Exception e) {
            System.out.println("[warn] deleteChat: " + e.getMessage());
        }
    }

    /* [ANA-T5] mtime файла данных пользователя (сегментация init, спека ANA-S2 г1):
       -1, если файла нет. Только факт существования и время изменения — содержимое
       не читается (privacy: спека ANA-S2 §3.2). */
    public synchronized long dataFileMtime(long chatId) {
        try {
            Path f = dir.resolve("chat_" + chatId + ".json");
            if (Files.exists(f)) return Files.getLastModifiedTime(f).toMillis();
        } catch (Exception e) {
            System.out.println("[warn] dataFileMtime: " + e.getMessage());
        }
        return -1L;
    }

    /* [UX-T16] рассылка владельцем: все активные чаты — id из имён chat_<id>.json в data/ */
    public synchronized List<Long> chatIds() {
        List<Long> out = new ArrayList<>();
        try {
            if (!Files.exists(dir)) return out;
            Pattern f = Pattern.compile("^chat_(\\d+)\\.json$");
            for (Path p : Files.newDirectoryStream(dir, "chat_*.json")) {
                Matcher m = f.matcher(p.getFileName().toString());
                if (!m.matches()) continue;
                /* try на каждом файле: один мусорный id (например, >18 цифр) не валил весь листинг */
                try {
                    out.add(Long.parseLong(m.group(1)));
                } catch (NumberFormatException e) {
                    System.out.println("[warn] chatIds: skip " + p.getFileName());
                }
            }
        } catch (Exception e) {
            System.out.println("[warn] chatIds: " + e.getMessage());
        }
        return out;
    }

    /* [ANA-T6] активные чаты за последние days дней — уникальные chat_<id>.json с mtime
       в периоде («по активности файлов», решение владельца 16.11 в #253). Содержимое
       не читается — только факт существования и время файла (спека ANA-S2 §3.2). */
    public synchronized int activeChats(int days) {
        long since = System.currentTimeMillis() - days * 86400000L;
        int n = 0;
        try {
            if (!Files.exists(dir)) return 0;
            for (Path p : Files.newDirectoryStream(dir, "chat_*.json")) {
                if (Files.getLastModifiedTime(p).toMillis() >= since) n++;
            }
        } catch (Exception e) {
            System.out.println("[warn] activeChats: " + e.getMessage());
        }
        return n;
    }

    /* [ANA-T6] ежедневная сводка владельцу: состояние доставки — data/summary-state.json
       вида {"day":"2026-11-18","totals":{…снимок Stats.KEYS на момент отправки…}}.
       Глобальный файл без ПДн (только дата и агрегаты-числа); пишется только при
       успешной отправке — рестарт не даёт дубль, недоставленная сводка повторяется. */
    public synchronized Map<String, Object> summaryState() {
        try {
            Path f = dir.resolve("summary-state.json");
            if (Files.exists(f)) return Json.map(Json.parse(Files.readString(f, StandardCharsets.UTF_8)));
        } catch (Exception e) {
            System.out.println("[warn] summaryState: " + e.getMessage());
        }
        return null;
    }

    public synchronized void saveSummaryState(Map<String, Object> m) {
        try {
            Files.createDirectories(dir);
            Files.writeString(dir.resolve("summary-state.json"), Json.write(m), StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.out.println("[warn] saveSummaryState: " + e.getMessage());
        }
    }
}
