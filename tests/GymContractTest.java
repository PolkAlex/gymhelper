import gym.BotLogic;
import gym.ExerciseEntry;
import gym.GymData;
import gym.Json;
import gym.SetEntry;
import gym.Storage;
import gym.Workout;

import java.util.Map;

public class GymContractTest {
    static void check(boolean b, String m) {
        if (!b) throw new AssertionError("CONTRACT FAIL: " + m);
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        String appJson = "{\"nextId\":23,\"rev\":5,\"profile\":{\"sex\":\"м\",\"age\":31,\"height\":190,\"weight\":95}," +
            "\"workouts\":[{\"id\":22,\"date\":\"2026-10-29\",\"started\":\"2026-10-29T18:30:00\",\"ended\":\"2026-10-29T19:38:00\"," +
            "\"finished\":true,\"title\":\"\",\"nutrition\":\"вода\"," +
            "\"exercises\":[{\"name\":\"Жим\",\"st\":\"2026-10-29T18:31:00\",\"en\":\"2026-10-29T18:40:00\"," +
            "\"sets\":[{\"w\":\"100\",\"s\":3,\"r\":\"8-10\",\"t\":\"2026-10-29T18:32:00\"}]}]}]}";
        GymData d = GymData.fromJson((Map<String, Object>) Json.parse(appJson));
        Workout w = d.findById(22);
        check(w != null, "workout найден");
        check("2026-10-29T18:30:00".equals(w.startedAt), "w.started сохранился");
        check("2026-10-29T19:38:00".equals(w.endedAt), "w.ended сохранился");
        check(w.finished, "w.finished");
        ExerciseEntry e = w.exercises.get(0);
        check("2026-10-29T18:31:00".equals(e.startedAt), "ex.st сохранился");
        check("2026-10-29T18:40:00".equals(e.endedAt), "ex.en сохранился");
        check("2026-10-29T18:32:00".equals(e.sets.get(0).t), "set.t сохранился");
        check("100".equals(e.sets.get(0).weight), "set.w");
        check(3 == e.sets.get(0).sets, "set.s");
        check("8-10".equals(e.sets.get(0).reps), "set.r");
        check(d.profile != null && d.profile.weight == 95, "profile");
        check(d.rev == 5, "rev");

        String legacy = "{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-10-26\"," +
            "\"startedAt\":\"2026-10-26T18:00:00\",\"endedAt\":\"2026-10-26T19:00:00\"," +
            "\"finished\":true,\"exercises\":[{\"name\":\"Жим\",\"sets\":[{\"weight\":\"80\",\"sets\":1,\"reps\":\"10\"}]}]}]}";
        GymData d2 = GymData.fromJson((Map<String, Object>) Json.parse(legacy));
        Workout w2 = d2.findById(1);
        check("2026-10-26T18:00:00".equals(w2.startedAt), "legacy startedAt читается");
        check("80".equals(w2.exercises.get(0).sets.get(0).weight), "legacy weight/sets/reps читаются");

        String out = Json.write(d.toJson());
        check(out.contains("\"started\":\"2026-10-29T18:30:00\""), "toJson пишет started");
        check(out.contains("\"st\":\"2026-10-29T18:31:00\""), "toJson пишет st");

        String delJson = "{\"nextId\":24,\"rev\":6,\"del\":[22],\"workouts\":[]}";
        GymData dd = GymData.fromJson((Map<String, Object>) Json.parse(delJson));
        check(dd.deletedIds.size() == 1 && dd.deletedIds.get(0) == 22L, "del читается");
        String delOut = Json.write(dd.toJson());
        check(delOut.contains("\"del\":[22]"), "toJson пишет del");

        /* nextId обязан расти от id тренировок: клиент с устаревшим nextId не создаёт коллизий */
        String staleJson = "{\"nextId\":22,\"workouts\":[{\"id\":22,\"date\":\"2026-11-02\",\"started\":\"2026-11-02T21:30:58\",\"finished\":false,\"exercises\":[]}]}";
        GymData stale = GymData.fromJson((Map<String, Object>) Json.parse(staleJson));
        check(GymData.incomingNextId(stale) == 23, "incomingNextId: max(nextId, max(id)+1) = 23");
        GymData empty = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":7,\"workouts\":[]}"));
        check(GymData.incomingNextId(empty) == 7, "incomingNextId без тренировок = nextId");
        GymData gap = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":5,\"workouts\":[{\"id\":2,\"date\":\"2026-10-01\",\"exercises\":[]},{\"id\":9,\"date\":\"2026-10-02\",\"exercises\":[]}]}"));
        check(GymData.incomingNextId(gap) == 10, "incomingNextId: max(id)+1 = 10");

        /* Storage: перед каждой перезаписью создаётся бэкап, хранятся последние 20, чужие не смешиваются */
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymstore");
            Storage st = new Storage(tmp);
            GymData seed = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-10-01\",\"finished\":true,\"exercises\":[]}]}"));
            st.save(777, seed);
            check(java.nio.file.Files.exists(tmp.resolve("chat_777.json")), "storage: основной файл создан");
            for (int i = 0; i < Storage.BACKUPS_TO_KEEP + 3; i++) {
                GymData v = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"rev\":" + (i + 1) + ",\"workouts\":[{\"id\":1,\"date\":\"2026-10-01\",\"finished\":true,\"exercises\":[]}]}"));
                Thread.sleep(3);
                st.save(777, v);
            }
            Storage st2 = new Storage(tmp);
            check(st2.backups(777).size() == Storage.BACKUPS_TO_KEEP, "storage: ротация держит " + Storage.BACKUPS_TO_KEEP + " бэкапов, а не " + st2.backups(777).size());
            check(st2.backups(888).isEmpty(), "storage: бэкапы разных пользователей не смешиваются");
            GymData restored = st2.load(777);
            check(restored.findById(1) != null && restored.rev == Storage.BACKUPS_TO_KEEP + 3, "storage: основной файл читается после ротации");
            GymData fromBackup = GymData.fromJson(Json.map(Json.parse(java.nio.file.Files.readString(st2.backups(777).get(0)))));
            check(fromBackup.findById(1) != null, "storage: свежий бэкап валиден и содержит тренировку");
        } catch (Exception storageErr) {
            throw new AssertionError("CONTRACT FAIL: storage " + storageErr);
        }

        /* склонения в формулировках записей (веб + бот) */
        check(BotLogic.renderLine("Жим", new SetEntry("25", 2, "4")).equals("Жим 25 кг, 2 подхода по 4 повторения"), "renderLine: 2 подхода по 4 повторения");
        check(BotLogic.renderLine("Жим", new SetEntry("", 5, "12")).equals("Жим, 5 подходов по 12 повторений"), "renderLine: 5 подходов по 12 повторений");
        check(BotLogic.renderLine("Тяга", new SetEntry("", 1, "1")).equals("Тяга, 1 подход по 1 повторению"), "renderLine: 1 подход по 1 повторению");
        check(BotLogic.renderLine("Становая", new SetEntry("", 21, "макс")).equals("Становая, 21 подход по макс"), "renderLine: 21 подход по макс");
        check(BotLogic.renderLine("Жим", new SetEntry("100", 3, "8-10")).equals("Жим 100 кг, 3 подхода по 8-10 повторений"), "renderLine: 3 подхода по 8-10 повторений");
        check(BotLogic.renderLine("Жим", new SetEntry("", 11, "2-4")).equals("Жим, 11 подходов по 2-4 повторения"), "renderLine: 11 подходов по 2-4 повторения (диапазон по последнему числу)");

        System.out.println("CONTRACT OK");
        System.exit(0);
    }
}
