import gym.ExerciseEntry;
import gym.GymData;
import gym.Json;
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

        System.out.println("CONTRACT OK");
        System.exit(0);
    }
}
