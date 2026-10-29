package gym;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class Storage {
    private final Path dir;

    public Storage(Path dir) {
        this.dir = dir;
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
            Files.writeString(f, Json.write(data.toJson()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.out.println("[warn] save: " + e.getMessage());
        }
    }
}
