package gym;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class GymData {
    public long nextId = 1;
    public long rev;
    public ProfileData profile;
    public final List<Workout> workouts = new ArrayList<>();
    public final List<Long> deletedIds = new ArrayList<>();

    public Workout active() {
        for (Workout w : workouts) {
            if (!w.finished) return w;
        }
        return null;
    }

    public Workout findById(long id) {
        for (Workout w : workouts) {
            if (w.id == id) return w;
        }
        return null;
    }

    public static GymData fromJson(Map<String, Object> m) {
        GymData d = new GymData();
        d.nextId = Json.lng(m.get("nextId"));
        if (d.nextId < 1) d.nextId = 1;
        d.rev = Json.lng(m.get("rev"));
        Map<String, Object> pm = Json.map(m.get("profile"));
        if (pm != null) {
            ProfileData p = new ProfileData();
            String sex = Json.str(pm, "sex");
            if (sex != null) p.sex = sex;
            p.age = (int) Json.lng(pm.get("age"));
            p.height = (int) Json.lng(pm.get("height"));
            p.weight = Json.dbl(pm.get("weight"));
            d.profile = p;
        }
        List<Object> delList = Json.list(m.get("del"));
        if (delList != null) {
            for (Object o : delList) d.deletedIds.add(Json.lng(o));
        }
        for (Object o : Json.list(m.get("workouts"))) {
            Map<String, Object> w = Json.map(o);
            Workout workout = new Workout();
            workout.id = Json.lng(w.get("id"));
            workout.date = Json.str(w, "date");
            workout.startedAt = firstStr(w, "started", "startedAt");
            workout.endedAt = firstStr(w, "ended", "endedAt");
            workout.finished = Boolean.TRUE.equals(w.get("finished"));
            workout.title = Json.str(w, "title");
            workout.nutrition = Json.str(w, "nutrition");
            for (Object eo : Json.list(w.get("exercises"))) {
                Map<String, Object> e = Json.map(eo);
                ExerciseEntry entry = new ExerciseEntry(Json.str(e, "name"));
                entry.startedAt = firstStr(e, "st", "startedAt");
                entry.endedAt = firstStr(e, "en", "endedAt");
                for (Object so : Json.list(e.get("sets"))) {
                    entry.sets.add(setFromJson(Json.map(so)));
                }
                workout.exercises.add(entry);
            }
            d.workouts.add(workout);
        }
        return d;
    }

    private static String firstStr(Map<String, Object> m, String a, String b) {
        String v = Json.str(m, a);
        return v != null ? v : Json.str(m, b);
    }

    private static Object firstOf(Map<String, Object> s, String a, String b) {
        Object v = s.get(a);
        return v != null ? v : s.get(b);
    }

    private static SetEntry setFromJson(Map<String, Object> s) {
        Object wv = firstOf(s, "w", "weight");
        Object rv = firstOf(s, "r", "reps");
        Object sv = firstOf(s, "s", "sets");
        String t = Json.str(s, "t");
        if (rv instanceof Number) {
            String weight = wv instanceof Number ? fmtNum(((Number) wv).doubleValue()) : "";
            if ("0".equals(weight)) weight = "";
            return new SetEntry(weight, 1, String.valueOf(((Number) rv).longValue()));
        }
        String weight = wv == null ? "" : String.valueOf(wv);
        String reps = rv == null ? "" : String.valueOf(rv);
        int sets = (int) Json.lng(sv);
        if (sets < 1) sets = 1;
        return new SetEntry(weight, sets, reps, t);
    }

    private static String fmtNum(double d) {
        if (d == Math.floor(d) && !Double.isInfinite(d)) return String.valueOf((long) d);
        return String.valueOf(d);
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("nextId", nextId);
        m.put("rev", rev);
        if (!deletedIds.isEmpty()) {
            List<Object> del = new ArrayList<>();
            for (Long id : deletedIds) del.add(id);
            m.put("del", del);
        }
        if (profile != null) {
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("sex", profile.sex);
            pm.put("age", profile.age);
            pm.put("height", profile.height);
            pm.put("weight", profile.weight);
            m.put("profile", pm);
        }
        List<Object> ws = new ArrayList<>();
        for (Workout w : workouts) {
            Map<String, Object> wm = new LinkedHashMap<>();
            wm.put("id", w.id);
            wm.put("date", w.date);
            if (w.startedAt != null) wm.put("started", w.startedAt);
            if (w.endedAt != null) wm.put("ended", w.endedAt);
            wm.put("finished", w.finished);
            if (w.title != null) wm.put("title", w.title);
            if (w.nutrition != null) wm.put("nutrition", w.nutrition);
            List<Object> es = new ArrayList<>();
            for (ExerciseEntry e : w.exercises) {
                Map<String, Object> em = new LinkedHashMap<>();
                em.put("name", e.name);
                if (e.startedAt != null) em.put("st", e.startedAt);
                if (e.endedAt != null) em.put("en", e.endedAt);
                List<Object> ss = new ArrayList<>();
                for (SetEntry s : e.sets) {
                    Map<String, Object> sm = new LinkedHashMap<>();
                    sm.put("w", s.weight);
                    sm.put("s", s.sets);
                    sm.put("r", s.reps);
                    if (s.t != null) sm.put("t", s.t);
                    ss.add(sm);
                }
                em.put("sets", ss);
                es.add(em);
            }
            wm.put("exercises", es);
            ws.add(wm);
        }
        m.put("workouts", ws);
        return m;
    }
}
