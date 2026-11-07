package gym;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/* Живые рекорды и оценка 1ПМ по Эпли [UX-T2]. Формат данных НЕ меняется: PR считается
   на лету из существующих тренировок (docs/spec-sprint1-features.md §3).
   Правила рекорда:
   - e1RM = вес × (1 + повторения ÷ 30); количество подходов в формуле не участвует;
   - упражнение с весом празднует e1RM-PR, без веса — объёмный PR (повторения за тренировку);
   - база — только ПРОШЛЫЕ тренировки (индекс строго меньше текущей), блоки той же
     тренировки в базу не входят; поэтому за тренировку упражнение празднуется максимум 1 раз;
   - первый подход упражнения (база пуста) и равный результат (строгое >) — не рекорд. */
public final class Records {
    private static final Pattern NUM = Pattern.compile("\\d+(?:[.,]\\d+)?");

    private Records() { }

    /* среднее по числам строки веса: «75-175» → 125, «50, 80» → 65, «100» → 100, без веса → 0 */
    static double avgWeight(String t) {
        String s = t == null ? "" : t;
        List<Double> nums = new ArrayList<>();
        Matcher m = NUM.matcher(s);
        while (m.find()) nums.add(Double.parseDouble(m.group().replace(',', '.')));
        if (nums.isEmpty()) return 0;
        if (nums.size() >= 2 && s.indexOf('-') >= 0) {
            double mn = nums.get(0), mx = nums.get(0);
            for (double v : nums) {
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            return (mn + mx) / 2;
        }
        double sum = 0;
        for (double v : nums) sum += v;
        return sum / nums.size();
    }

    /* среднее повторений блока: «12» → 12, «8-10» → 9, «5+1» → 6 (дроп-сет суммируется),
       нечисловой текст («макс») → 10 — та же логика, что repsAvg в Mini App */
    public static int repsAvg(String r) {
        String s = r == null ? "" : r;
        List<Integer> nums = new ArrayList<>();
        Matcher m = NUM.matcher(s);
        while (m.find()) nums.add((int) Math.round(Double.parseDouble(m.group().replace(',', '.'))));
        if (nums.isEmpty()) return 10;
        int sum = 0;
        for (int v : nums) sum += v;
        if (s.indexOf('+') >= 0) return sum;
        if (nums.size() >= 2 && s.indexOf('-') >= 0) {
            int mn = nums.get(0), mx = nums.get(0);
            for (int v : nums) {
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            return Math.round((mn + mx) / 2f);
        }
        return nums.size() > 1 ? Math.round((float) sum / nums.size()) : nums.get(0);
    }

    /* e1RM блока по Эпли; 0 — блок без веса */
    public static double e1rm(SetEntry s) {
        double w = avgWeight(s.weight);
        if (w <= 0) return 0;
        return w * (1 + repsAvg(s.reps) / 30.0);
    }

    /* метрики упражнения в одной тренировке: лучший e1RM блока + объём (Σ подходы × повторения) */
    private static final class Metrics {
        double bestE;
        boolean hasE;
        int vol;
        boolean hasSets;
    }

    private static Metrics metricsOf(Workout w, String nameLower) {
        Metrics m = new Metrics();
        for (ExerciseEntry e : w.exercises) {
            if (!e.name.toLowerCase().equals(nameLower) || e.sets.isEmpty()) continue;
            m.hasSets = true;
            for (SetEntry s : e.sets) {
                double er = e1rm(s);
                if (er > m.bestE) m.bestE = er;
                if (er > 0) m.hasE = true;
                m.vol += Math.max(s.sets, 0) * repsAvg(s.reps);
            }
        }
        return m;
    }

    /* Поздравление для только что записанного блока, ещё НЕ добавленного в e.sets
       (точка проверки одна — BotLogic.confirmEntry, как для пошагового ввода,
       так и для блока одной строкой «45кг, 4 по 12»). null — не рекорд. */
    public static String congratulation(GymData data, Workout current, String name, SetEntry block) {
        int idx = data.workouts.indexOf(current);
        if (idx < 0) return null;
        String nameLower = name.toLowerCase();
        double baseE = 0;
        boolean baseHasE = false;
        int baseVol = 0;
        boolean baseHasVol = false;
        /* база — только прошлые тренировки (i < idx), как в prCheck/prChipSetIdx Mini App */
        for (int i = 0; i < idx; i++) {
            Metrics m = metricsOf(data.workouts.get(i), nameLower);
            if (m.hasE) {
                baseHasE = true;
                if (m.bestE > baseE) baseE = m.bestE;
            }
            if (m.hasSets) {
                baseHasVol = true;
                if (m.vol > baseVol) baseVol = m.vol;
            }
        }
        /* блоки текущей тренировки (новый блок ещё не добавлен): если они уже побили
           базу — поздравление уже прозвучало, максимум 1 на упражнение за тренировку */
        Metrics here = metricsOf(data.workouts.get(idx), nameLower);
        if (avgWeight(block.weight) > 0) {
            double v = e1rm(block);
            if (!baseHasE || v <= baseE || (here.hasE && here.bestE > baseE)) return null;
            return "🏆 Рекорд! 1ПМ ≈ " + Math.round(v) + " кг (прошлый ≈ " + Math.round(baseE) + " кг)";
        }
        int vol = Math.max(block.sets, 0) * repsAvg(block.reps);
        if (!baseHasVol || vol <= baseVol || here.vol > baseVol) return null;
        return "🏆 Рекорд объёма! " + vol + " повторений «" + name + "» за тренировку";
    }
}
