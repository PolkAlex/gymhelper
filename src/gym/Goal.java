package gym;

import java.util.LinkedHashMap;
import java.util.Map;

/* Цель тренировок [GOA-S1] (docs/spec-goa-s1-goals.md §10.1): тип 1 — силовая
   (упражнение + целевой e1RM, срок опционален), тип 2 — частота (N тренировок за
   период неделя/месяц/квартал); типы 3 (объём) и 4 (вес тела) — R4, модель готова.
   В JSON имя поля упражнения — «ex» (короче файл, §10.1). */
public final class Goal {
    public long id;            /* общий счётчик data.nextId (сущность как Workout) */
    public int type;           /* 1 силовая, 2 частота, 3 объём, 4 вес тела */
    public String exercise;    /* силовая: название упражнения; остальные — null */
    public double target;      /* кг (e1RM/тоннаж/вес) или штук (тренировки) */
    public String start;       /* ISO-дата создания (начало окна прогресса) */
    public String end;         /* ISO-дата срока; null = без срока (только силовая) */
    public int status;         /* 1 активная, 2 достигнута, 3 не успела, 4 отменена */
    public String doneDate;    /* дата закрытия (достижение/истечение) */
    public double doneValue;   /* результат на момент закрытия */

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("type", type);
        if (exercise != null) m.put("ex", exercise);
        m.put("target", target);
        if (start != null) m.put("start", start);
        if (end != null) m.put("end", end);
        m.put("status", status);
        m.put("doneDate", doneDate == null ? "" : doneDate);
        m.put("doneValue", doneValue);
        return m;
    }

    public static Goal fromJson(Map<String, Object> m) {
        Goal g = new Goal();
        g.id = Json.lng(m.get("id"));
        g.type = (int) Json.lng(m.get("type"));
        g.exercise = Json.str(m, "ex");
        g.target = Json.dbl(m.get("target"));
        g.start = Json.str(m, "start");
        g.end = Json.str(m, "end");
        g.status = (int) Json.lng(m.get("status"));
        g.doneDate = Json.str(m, "doneDate");
        g.doneValue = Json.dbl(m.get("doneValue"));
        return g;
    }

    /* переименование упражнения обновляет ex активных целей с этим названием (§4.3):
       сравнение без регистра (как в расчёте прогресса), архив и отменённые не трогаем */
    public static void renameExercise(GymData data, String from, String to) {
        if (from == null || to == null || from.equalsIgnoreCase(to)) return;
        for (Goal g : data.goals) {
            if (g.status == 1 && g.type == 1 && from.equalsIgnoreCase(g.exercise)) g.exercise = to;
        }
    }
}
