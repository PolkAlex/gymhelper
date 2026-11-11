package gym;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/* [ANA-T1] агрегаты-счётчики событий сервера и бота: data/stats.json.
   ТОЛЬКО агрегаты — никаких chat_id/имён/весов (privacy.html): maInit/maSave —
   открытия/сохранения Mini App, workoutsCreated/workoutsCompleted — прирост по данным
   при /save, templatesCreated/templatesUsed — действия с шаблонами в боте; плюс недельные
   агрегаты ISO (хранятся последние WEEKS_TO_KEEP недель — ротация при записи).
   Формат файла = формат ответа /stats: {"maInit":N,...,"weeks":{"2026-W46":{...}}}.
   Все методы synchronized: веб-сервер отвечает пулом из 4 потоков, бот пишет из основного.
   Файл перезаписывается при каждом событии (нагрузка мизерная), паттерн записи — как
   в Storage: createDirectories + writeString + try/catch. */
public final class Stats {
    /* известные ключи (и порядок в JSON); неизвестные ключи из файла игнорируются */
    static final String[] KEYS = {
        "maInit", "maSave", "workoutsCreated", "workoutsCompleted", "templatesCreated", "templatesUsed"
    };
    /* сколько последних недель (ISO) хранить в weeks */
    public static final int WEEKS_TO_KEEP = 26;
    private static final WeekFields ISO = WeekFields.ISO;

    private final Path file;
    private final Map<String, Long> totals = new LinkedHashMap<>();
    /* ключ недели «2026-W46» → счётчики недели; недели добавляются строго по возрастанию */
    private final Map<String, Map<String, Long>> weeks = new LinkedHashMap<>();

    public Stats(Path file) {
        this.file = file;
        load();
    }

    /* +1 к счётчику (итог и текущая ISO-неделя) с записью файла */
    public synchronized void inc(String key) {
        add(key, 1);
    }

    /* +delta к счётчику с записью файла; delta <= 0 игнорируется */
    public synchronized void add(String key, long delta) {
        if (delta <= 0) return;
        totals.merge(key, delta, Long::sum);
        week(currentWeek()).merge(key, delta, Long::sum);
        trimWeeks();
        flush();
    }

    /* снимок для /stats и файла: все ключи (нулями) + weeks; LinkedHashMap — порядок стабилен */
    public synchronized Map<String, Object> snapshot() {
        Map<String, Object> m = counters(totals);
        Map<String, Object> ws = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Long>> e : weeks.entrySet()) {
            ws.put(e.getKey(), counters(e.getValue()));
        }
        m.put("weeks", ws);
        return m;
    }

    private static Map<String, Object> counters(Map<String, Long> src) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (String k : KEYS) {
            m.put(k, src.getOrDefault(k, 0L));
        }
        return m;
    }

    private Map<String, Long> week(String key) {
        Map<String, Long> w = weeks.get(key);
        if (w == null) {
            w = new LinkedHashMap<>();
            weeks.put(key, w);
        }
        return w;
    }

    /* текущая ISO-неделя «2026-W46» (неделя с понедельника; неделя 1 — с первым четвергом года) */
    private static String currentWeek() {
        LocalDate d = LocalDate.now();
        return weekKey(d);
    }

    private static String weekKey(LocalDate d) {
        return String.format("%04d-W%02d",
            d.get(ISO.weekBasedYear()), d.get(ISO.weekOfWeekBasedYear()));
    }

    /* ключ «YYYY-Www» сортируется лексикографически = хронологически → отсекаем старейшие */
    private void trimWeeks() {
        if (weeks.size() <= WEEKS_TO_KEEP) return;
        List<String> keys = new ArrayList<>(weeks.keySet());
        Collections.sort(keys);
        for (int i = 0; i < keys.size() - WEEKS_TO_KEEP; i++) {
            weeks.remove(keys.get(i));
        }
    }

    /* старые файлы (или битые) читаются толерантно: нет ключа → 0, мусор → пропускается */
    private void load() {
        try {
            if (!Files.exists(file)) return;
            Map<String, Object> m = Json.map(Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
            if (m == null) return;
            for (String k : KEYS) {
                Object v = m.get(k);
                if (v instanceof Number) totals.put(k, ((Number) v).longValue());
            }
            Map<String, Object> ws = Json.map(m.get("weeks"));
            if (ws == null) return;
            for (Map.Entry<String, Object> e : ws.entrySet()) {
                Map<String, Object> wm = Json.map(e.getValue());
                if (wm == null) continue;
                Map<String, Long> w = new LinkedHashMap<>();
                for (String k : KEYS) {
                    Object v = wm.get(k);
                    if (v instanceof Number) w.put(k, ((Number) v).longValue());
                }
                weeks.put(e.getKey(), w);
            }
            trimWeeks();
        } catch (Exception e) {
            System.out.println("[warn] stats load: " + e.getMessage());
        }
    }

    private void flush() {
        try {
            Path parent = file.getParent();
            if (parent != null) Files.createDirectories(parent);
            Files.writeString(file, Json.write(snapshot()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.out.println("[warn] stats save: " + e.getMessage());
        }
    }
}
