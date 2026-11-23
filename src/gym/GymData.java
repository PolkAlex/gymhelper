package gym;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class GymData {
    public long nextId = 1;
    public long rev;
    public Integer restSec; /* длительность отдыха, сек (30–600); 0 = таймер выключен [UX-T13]; null = дефолт 90, общий для бота и Mini App */
    public ProfileData profile;
    public final List<Workout> workouts = new ArrayList<>();
    public final List<Template> templates = new ArrayList<>();
    public final List<Long> deletedIds = new ArrayList<>();
    /* [GOA-S1] цели тренировок: ключа «goals» нет → пустой список (старые файлы ок, §10.2) */
    public final List<Goal> goals = new ArrayList<>();
    /* [GOA-S1] тогл напоминаний о целях (R2): null = включены (дефолт) */
    public Boolean goalRemind;
    /* [UX-I16] opt-in имени владельца на публичной странице/OG-превью: null = выключено
       (дефолт — ПДн-минимализм §5.2 спеки); shareOwner — имя, хранится только при opt-in */
    public Boolean shareName;
    public String shareOwner;
    /* [UX-T40] «Разминка по дефолту»: warmupFirst null/false = выкл (дефолт, прежнее
       поведение); warmupEx null = системная запись «Разминка» (дефолт), иначе id строки
       CATALOG Mini App (устаревший id отфильтрует резолв при старте — §2.6 спеки) */
    public Boolean warmupFirst;
    public String warmupEx;
    /* [EXR-T13] «Свои» упражнения (имя + теги групп m:*) и «Любимые» (имена): ключей нет
       → пустые списки (старые файлы ок); имя — уникальный ключ (дубликаты пропускаются
       при чтении), пишутся только когда непустые — файл без «Своих»/«Любимых» прежний */
    public final List<CustomExercise> customEx = new ArrayList<>();
    public final List<String> favs = new ArrayList<>();

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

    /* следующий свободный id по входящим данным: max(nextId, max(id)+1) — защита от id-коллизий */
    public static long incomingNextId(GymData d) {
        long n = d.nextId;
        for (Workout w : d.workouts) {
            if (w.id >= n) n = w.id + 1;
        }
        return n;
    }

    public static GymData fromJson(Map<String, Object> m) {
        GymData d = new GymData();
        d.nextId = Json.lng(m.get("nextId"));
        if (d.nextId < 1) d.nextId = 1;
        d.rev = Json.lng(m.get("rev"));
        /* restSec: 30–600 — длительность; 0 — спец-значение «выкл» [UX-T13];
           остальное вне диапазона игнорируется — читатель возьмёт дефолт 90 [UX-T4/T5] */
        Object rs = m.get("restSec");
        if (rs != null) {
            int n = (int) Json.lng(rs);
            if (n == 0 || (n >= 30 && n <= 600)) d.restSec = n;
        }
        Map<String, Object> pm = Json.map(m.get("profile"));
        if (pm != null) {
            ProfileData p = new ProfileData();
            String sex = Json.str(pm, "sex");
            if (sex != null) p.sex = sex;
            p.age = (int) Json.lng(pm.get("age"));
            p.height = (int) Json.lng(pm.get("height"));
            p.weight = Json.dbl(pm.get("weight"));
            /* [UX-T29] дата рождения: мусор → «не указано»; границы чтения толерантнее границ
               ввода; ключи только парой — встретив одно без другого, считаем дату не указанной.
               Старый файл без ключей → 0/0 → читается как сейчас */
            p.birthYear = (int) Json.lng(pm.get("birthYear"));
            p.birthMonth = (int) Json.lng(pm.get("birthMonth"));
            if (p.birthYear < 1900 || p.birthYear > 2100) p.birthYear = 0;
            if (p.birthMonth < 1 || p.birthMonth > 12) p.birthMonth = 0;
            if (p.birthYear == 0 || p.birthMonth == 0) { p.birthYear = 0; p.birthMonth = 0; }
            d.profile = p;
        }
        List<Object> delList = Json.list(m.get("del"));
        if (delList != null) {
            for (Object o : delList) d.deletedIds.add(Json.lng(o));
        }
        /* шаблоны [UX-T6/T7]: ключа нет → пустой список (старые файлы ок); толерантно к пропускам */
        List<Object> tplList = Json.list(m.get("templates"));
        if (tplList != null) {
            for (Object o : tplList) {
                Map<String, Object> t = Json.map(o);
                if (t == null) continue;
                String name = Json.str(t, "name");
                if (name == null) continue;
                Template tpl = new Template();
                tpl.id = Json.lng(t.get("id"));
                tpl.name = name;
                tpl.createdAt = Json.str(t, "createdAt");
                List<Object> exList = Json.list(t.get("exercises"));
                if (exList != null) {
                    for (Object eo : exList) {
                        Map<String, Object> e = Json.map(eo);
                        String ename = e == null ? null : Json.str(e, "name");
                        if (ename == null) continue;
                        TemplateExercise te = new TemplateExercise();
                        te.name = ename;
                        Object wv = e.get("w");
                        te.w = wv == null ? "" : String.valueOf(wv);
                        int sv = (int) Json.lng(e.get("s"));
                        te.s = sv < 1 ? 1 : sv;
                        Object rv = e.get("r");
                        te.r = rv == null ? "" : String.valueOf(rv);
                        tpl.exercises.add(te);
                    }
                }
                d.templates.add(tpl);
            }
        }
        /* [GOA-S1] цели: битые элементы списка пропускаются, как у шаблонов (§10.2);
            валидность — id ≥ 1, тип 1..4, target > 0, у силовой — имя упражнения,
            статус 1..4; мусорное значение не валит чтение всего файла */
        List<Object> goalList = Json.list(m.get("goals"));
        if (goalList != null) {
            for (Object o : goalList) {
                if (!(o instanceof Map)) continue;
                Map<String, Object> gm = Json.map(o);
                if (gm == null) continue;
                Goal g = Goal.fromJson(gm);
                if (g.id < 1 || g.type < 1 || g.type > 4 || g.target <= 0) continue;
                if (g.type == 1 && (g.exercise == null || g.exercise.isEmpty())) continue;
                if (g.status < 1 || g.status > 4) continue;
                d.goals.add(g);
            }
        }
        /* [GOA-S1] goalRemind читается только если это Boolean, иначе null (§10.2) */
        Object gr = m.get("goalRemind");
        if (gr instanceof Boolean) d.goalRemind = (Boolean) gr;
        /* [UX-I16] opt-in имени: ключа нет → null (анонимно, старые файлы ок); только
            реальные типы (Boolean/String) — мусорное значение не валит чтение файла */
        Object sn = m.get("shareName");
        if (sn instanceof Boolean) d.shareName = (Boolean) sn;
        Object soVal = m.get("shareOwner");
        if (soVal instanceof String && !((String) soVal).isEmpty()) d.shareOwner = (String) soVal;
        /* [UX-T40] разминка по дефолту: ключа нет → null (выкл / системная «Разминка»,
            старые файлы ок); только реальные типы — мусор не валит чтение файла;
            id валидируется резолвом при старте (§2.6), здесь сохраняем как есть */
        Object wf = m.get("warmupFirst");
        if (wf instanceof Boolean) d.warmupFirst = (Boolean) wf;
        Object wx = m.get("warmupEx");
        if (wx instanceof String && !((String) wx).isEmpty()) d.warmupEx = (String) wx;
        /* [EXR-T13] «Свои» упражнения: битые элементы пропускаются (как у шаблонов);
            имя — уникальный ключ (дубликаты без учёта регистра игнорируются, §11 спеки),
            валидность — имя 1..60 после среза пробелов; теги — непустые строки ≤ 40,
            максимум 16 на запись; кап списка — 500 (защита от раздутого payload) */
        List<Object> cexList = Json.list(m.get("customEx"));
        if (cexList != null) {
            Set<String> seen = new HashSet<>();
            for (Object o : cexList) {
                if (d.customEx.size() >= 500) break;
                if (!(o instanceof Map)) continue;
                Map<String, Object> c = Json.map(o);
                if (c == null) continue;
                String name = Json.str(c, "n");
                if (name == null) continue;
                name = name.strip();
                if (name.isEmpty() || name.length() > 60 || !seen.add(name.toLowerCase())) continue;
                CustomExercise ce = new CustomExercise();
                ce.n = name;
                List<Object> tagList = Json.list(c.get("tags"));
                if (tagList != null) {
                    for (Object t : tagList) {
                        if (ce.tags.size() >= 16) break;
                        if (!(t instanceof String)) continue;
                        String tag = ((String) t).strip();
                        if (!tag.isEmpty() && tag.length() <= 40) ce.tags.add(tag);
                    }
                }
                d.customEx.add(ce);
            }
        }
        /* [EXR-T13] «Любимые» — имена упражнений: только непустые строки, без дублей */
        List<Object> favList = Json.list(m.get("favs"));
        if (favList != null) {
            Set<String> seenFav = new HashSet<>();
            for (Object o : favList) {
                if (d.favs.size() >= 500) break;
                if (!(o instanceof String)) continue;
                String name = ((String) o).strip();
                if (name.isEmpty() || !seenFav.add(name)) continue;
                d.favs.add(name);
            }
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
            /* [UX-S17] заметка: ключа нет → null (старые файлы читаются как раньше);
                только String — мусорное значение (число/объект) игнорируется без падения;
                строка читается как есть, включая переносы; пустая строка = заметки нет */
            Object nt = w.get("note");
            if (nt instanceof String && !((String) nt).isEmpty()) workout.note = (String) nt;
            /* [UX-I16] shareId: ключа нет → null (старые файлы и тренировки без шеринга);
                только String — мусорное значение (число и т.п.) игнорируется без падения */
            Object sid = w.get("shareId");
            if (sid instanceof String && !((String) sid).isEmpty()) workout.shareId = (String) sid;
            for (Object eo : Json.list(w.get("exercises"))) {
                Map<String, Object> e = Json.map(eo);
                ExerciseEntry entry = new ExerciseEntry(Json.str(e, "name"));
                entry.startedAt = firstStr(e, "st", "startedAt");
                entry.endedAt = firstStr(e, "en", "endedAt");
                /* [UX-E5] план-подсказка: ключей нет → дефолты (плана нет, старые файлы ок);
                   ps < 1 → план сбрасывается целиком (§2.2) */
                int ps = (int) Json.lng(e.get("ps"));
                if (ps >= 1) {
                    Object pw = e.get("pw");
                    Object pr = e.get("pr");
                    entry.planW = pw == null ? "" : String.valueOf(pw);
                    entry.planS = ps;
                    entry.planR = pr == null ? "" : String.valueOf(pr);
                }
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
        if (restSec != null) m.put("restSec", restSec);
        if (!templates.isEmpty()) {
            List<Object> ts = new ArrayList<>();
            for (Template t : templates) {
                Map<String, Object> tm = new LinkedHashMap<>();
                tm.put("id", t.id);
                tm.put("name", t.name);
                if (t.createdAt != null) tm.put("createdAt", t.createdAt);
                List<Object> tes = new ArrayList<>();
                for (TemplateExercise e : t.exercises) {
                    Map<String, Object> em = new LinkedHashMap<>();
                    em.put("name", e.name);
                    em.put("w", e.w);
                    em.put("s", e.s);
                    em.put("r", e.r);
                    tes.add(em);
                }
                tm.put("exercises", tes);
                ts.add(tm);
            }
            m.put("templates", ts);
        }
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
            /* [UX-T29] birth-ключи в конце карты и только при валидной паре —
               старые файлы без даты остаются байт-в-байт прежними */
            if (profile.birthYear > 0 && profile.birthMonth >= 1 && profile.birthMonth <= 12) {
                pm.put("birthYear", profile.birthYear);
                pm.put("birthMonth", profile.birthMonth);
            }
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
            /* [UX-S17] заметка пишется только когда непустая (trim) — файлы тренировок
                без заметок остаются байт-в-байт прежними (§5 спеки UX-S17) */
            if (w.note != null && !w.note.isBlank()) wm.put("note", w.note);
            /* [UX-I16] shareId пишется только когда задан — файлы без шеринга байт-в-байт прежние */
            if (w.shareId != null) wm.put("shareId", w.shareId);
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
                /* [UX-E5] план пишется только при planS >= 1 — файлы тренировок без плана остаются прежними */
                if (e.planS >= 1) {
                    em.put("pw", e.planW);
                    em.put("ps", e.planS);
                    em.put("pr", e.planR);
                }
                es.add(em);
            }
            wm.put("exercises", es);
            ws.add(wm);
        }
        m.put("workouts", ws);
        /* [GOA-S1] цели и тогл напоминаний пишутся только когда заданы: файл пользователя
           без целей остаётся байт-в-байт прежним (§10.2); порядок ключей — конец карты */
        if (!goals.isEmpty()) {
            List<Object> gs = new ArrayList<>();
            for (Goal g : goals) gs.add(g.toJson());
            m.put("goals", gs);
        }
        if (goalRemind != null) m.put("goalRemind", goalRemind);
        /* [UX-I16] opt-in имени — конец карты, пишется только когда задан (аналог goalRemind):
           файл анонимного пользователя (opt-in выкл.) остаётся без новых ключей */
        if (shareName != null) m.put("shareName", shareName);
        if (shareOwner != null) m.put("shareOwner", shareOwner);
        /* [UX-T40] разминка по дефолту — конец карты, пишутся только когда заданы:
            тоггл пишет true/false явно (иначе «выключил» не пережил бы сохранение),
            файл с настройками по умолчанию остаётся без новых ключей (аналог goalRemind) */
        if (warmupFirst != null) m.put("warmupFirst", warmupFirst);
        if (warmupEx != null) m.put("warmupEx", warmupEx);
        /* [EXR-T13] «Свои» и «Любимые» — конец карты, пишутся только когда непустые:
           файл пользователя без них остаётся байт-в-байт прежним */
        if (!customEx.isEmpty()) {
            List<Object> cs = new ArrayList<>();
            for (CustomExercise c : customEx) {
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("n", c.n);
                List<Object> ts = new ArrayList<>();
                for (String t : c.tags) ts.add(t);
                cm.put("tags", ts);
                cs.add(cm);
            }
            m.put("customEx", cs);
        }
        if (!favs.isEmpty()) m.put("favs", new ArrayList<Object>(favs));
        return m;
    }
}
