package gym;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
}
