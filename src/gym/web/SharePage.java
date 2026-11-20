package gym.web;

import gym.ExerciseEntry;
import gym.GymData;
import gym.ProfileData;
import gym.Records;
import gym.SetEntry;
import gym.Workout;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/* [UX-I16] серверный рендер публичной read-only страницы тренировки GET /w/<shareId>
   и страницы «Тренировка недоступна» (404). Чистая строковая сборка (§8.1 спеки):
   инлайн-CSS Amber Glass по макету docs/mockups/ux-i16-share-link.html, БЕЗ JS и
   внешних файлов; JS не нужен — страница целиком сервер-рендер.
   ПДн-минимализм §5: без имени (opt-in — только в OG-превью), кастомного названия,
   питания и часов начала; ккал только при заданном весе профиля. */
final class SharePage {
    private static final String[] MONTHS_GEN = {
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря"
    };
    private static final String[] DOW_FULL = {
        "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"
    };
    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter ISO_DATETIME = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private SharePage() { }

    /* ---------- страница тренировки (200) ---------- */

    static String render(GymData data, Workout w, String botUsername) {
        StringBuilder b = new StringBuilder(8192);
        String title = ogTitle(w, data);
        b.append("<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n")
            .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n")
            .append("<meta name=\"robots\" content=\"noindex, nofollow\">\n")
            .append("<title>").append(esc(title)).append("</title>\n")
            .append("<meta property=\"og:title\" content=\"").append(esc(title)).append("\">\n")
            .append("<meta property=\"og:description\" content=\"Открытая карточка тренировки — GymHelper, дневник тренировок в Telegram\">\n")
            .append("<meta property=\"og:site_name\" content=\"GymHelper\">\n")
            .append("<style>").append(CSS).append("</style>\n</head>\n<body>\n")
            .append("<div class=\"wp\">\n");
        brand(b, true);
        b.append("<div class=\"wp-body\">\n");
        workoutCard(b, data, w);
        aggregates(b, data, w);
        exercisesCard(b, w);
        streakCard(b, data, w);
        b.append("<p class=\"privline\">🔒 Карточка видна только по этой ссылке — без входа и без имени.</p>\n");
        b.append("</div>\n");
        cta(b, botUsername);
        b.append("</div>\n</body>\n</html>");
        return b.toString();
    }

    /* ---------- страница «Тренировка недоступна» (404; §6.3) ---------- */

    static String renderNotFound(String botUsername) {
        StringBuilder b = new StringBuilder(4096);
        b.append("<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n")
            .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n")
            .append("<meta name=\"robots\" content=\"noindex, nofollow\">\n")
            .append("<title>Тренировка недоступна</title>\n")
            .append("<style>").append(CSS).append("</style>\n</head>\n<body>\n")
            .append("<div class=\"wp\">\n");
        brand(b, false);
        b.append("<div class=\"wp-body\">\n")
            .append("<div class=\"glass na-card\">")
            .append("<div class=\"nic\">🔗</div>")
            .append("<h2>Тренировка недоступна</h2>")
            .append("<p>Ссылка устарела, или владелец удалил тренировку и закрыл доступ. ")
            .append("Попросите свежую карточку — или попробуйте GymHelper сами: ")
            .append("записывать тренировки здесь — за секунды.</p>")
            .append("</div>\n</div>\n");
        cta(b, botUsername);
        b.append("</div>\n</body>\n</html>");
        return b.toString();
    }

    /* ---------- блоки страницы (§6.1) ---------- */

    /* 1 · шапка бренда + пилюля «только просмотр» (на 404 её нет — как в макете) */
    private static void brand(StringBuilder b, boolean readonly) {
        b.append("<div class=\"wp-brand\"><span class=\"tile\">💪</span><b>GymHelper</b>");
        if (readonly) b.append("<span class=\"ro\">👁 только просмотр</span>");
        b.append("</div>\n");
    }

    /* 2 · карточка: дата → герой-число → плашка рекорда реальным весом */
    private static void workoutCard(StringBuilder b, GymData data, Workout w) {
        b.append("<div class=\"glass glow\">")
            .append("<p class=\"wdate\">").append(esc(dateLong(w.date))).append("</p>");
        double volume = volumeOf(w);
        b.append("<div class=\"hero-num\">");
        if (volume > 0) {
            b.append(fmtNum(Math.round(volume))).append("<small>кг</small>");
        } else {
            /* [UX-I16] edge 8 (§5.1/§9.8): объём 0 (калистеника) → герой = сумма повторений */
            b.append(fmtNum(totalReps(w))).append("<small>повторений</small>");
        }
        b.append("</div>\n<div class=\"hero-lbl\">объём тренировки</div>\n");
        /* плашка рекорда: максимальный реальный вес тренировки, строго побивший все прошлые
           тренировки этого упражнения (§5.1 — решение владельца: рекорд реальным весом,
           расчётный 1ПМ по Эпли на странице не показываем) */
        double maxW = 0;
        String maxEx = null;
        String maxWStr = null;
        for (ExerciseEntry e : w.exercises) {
            for (SetEntry s : e.sets) {
                double v = Records.avgWeight(s.weight);
                if (v > maxW) {
                    maxW = v;
                    maxEx = e.name;
                    maxWStr = weightText(s.weight);
                }
            }
        }
        if (maxW > 0 && isRealWeightRecord(data, w, maxEx, maxW)) {
            b.append("<div class=\"prplaque\"><span class=\"pic\">🏆</span><span class=\"pt\">")
                .append("<span class=\"pk\">Новый рекорд · ").append(esc(maxEx)).append("</span>")
                .append("<span class=\"pv\">").append(esc(maxWStr)).append("<small> кг</small></span>")
                .append("<span class=\"ps\">реальный вес подхода</span>")
                .append("</span></div>\n");
        }
        b.append("</div>\n");
    }

    /* 3 · агрегаты: время / ккал (если профиль с весом) / подходы */
    private static void aggregates(StringBuilder b, GymData data, Workout w) {
        Long mins = durationMin(w);
        int setsTotal = setsTotal(w);
        Long kcal = kcalOf(data.profile, w);
        int cols = kcal != null ? 3 : 2;
        StringBuilder agg = new StringBuilder();
        if (mins != null) {
            agg.append("<div class=\"agg\"><b>").append(mins / 60).append(':').append(pad2((int) (mins % 60)))
                .append("</b><span>время</span></div>");
        }
        if (kcal != null) {
            agg.append("<div class=\"agg k\"><b>").append(fmtNum(kcal)).append("</b><span>ккал</span></div>");
        }
        if (setsTotal > 0) {
            agg.append("<div class=\"agg\"><b>").append(setsTotal).append("</b><span>").append(setsWord(setsTotal)).append("</span></div>");
        }
        if (agg.length() == 0) return;
        b.append("<div class=\"aggs c").append(cols).append("\">").append(agg).append("</div>\n");
    }

    /* 4 · упражнения: все (не первые 3, как у картинки); строки «120 кг × 3×8»,
       у лучшего сета упражнения — янтарный бейдж «🏆 рекорд» */
    private static void exercisesCard(StringBuilder b, Workout w) {
        if (w.exercises.isEmpty()) return;
        b.append("<div class=\"glass\">\n");
        for (ExerciseEntry e : w.exercises) {
            int best = bestSetIdx(e);
            b.append("<div class=\"expill\"><div class=\"exhead\"><span class=\"ic\">🏋️</span>")
                .append("<span class=\"en\">").append(esc(e.name)).append("</span></div>");
            for (int si = 0; si < e.sets.size(); si++) {
                SetEntry s = e.sets.get(si);
                b.append("<div class=\"entry\"><span class=\"rt\">").append(esc(setLine(s))).append("</span>");
                if (si == best) b.append("<span class=\"prtag\">🏆 рекорд</span>");
                b.append("</div>");
            }
            b.append("</div>\n");
        }
        b.append("</div>\n");
    }

    /* 5 · серия (§6.2): череда дней подряд, заканчивающаяся датой этой тренировки;
       N — число тренировок в череде, показ при N ≥ 2; считается живьём при каждом открытии */
    private static void streakCard(StringBuilder b, GymData data, Workout w) {
        LocalDate until = parseDate(w.date);
        if (until == null) return;
        Map<LocalDate, Integer> perDay = new HashMap<>();
        for (Workout x : data.workouts) {
            if (!x.finished) continue;
            LocalDate d = parseDate(x.date);
            if (d == null || d.isAfter(until)) continue;
            perDay.merge(d, 1, Integer::sum);
        }
        int n = 0;
        LocalDate first = null;
        for (LocalDate d = until; perDay.containsKey(d); d = d.minusDays(1)) {
            first = d; /* последний шаг цикла — самый старый день череды */
            n += perDay.get(d);
        }
        if (n < 2 || first == null) return;
        b.append("<div class=\"streak\"><span class=\"sic\">🔥</span><span>")
            .append("<b>Серия: ").append(n).append(' ').append(trainWord(n)).append(" подряд</b>")
            .append("<span class=\"tn\">беспрерывно с ").append(first.getDayOfMonth()).append(' ')
            .append(MONTHS_GEN[first.getMonthValue() - 1]);
        if (first.getYear() != LocalDate.now().getYear()) b.append(' ').append(first.getYear());
        b.append("</span></span></div>\n");
    }

    /* 7 · sticky CTA (§2.1): у юзера откроется его дневник, у остальных — бот.
       [UX-B14] фолбэк — настоящий юзернейм бота (старый GymHelper_bot — чужой бот) */
    private static void cta(StringBuilder b, String botUsername) {
        String bot = (botUsername == null || botUsername.isEmpty()) ? "MyHelperGymBot" : botUsername;
        b.append("<div class=\"cta\">")
            .append("<a class=\"btn\" href=\"https://t.me/").append(esc(bot)).append("/app\">🏋️ Попробовать в Telegram</a>")
            .append("<p class=\"already\">Уже пользуетесь? Откроется ваш дневник.</p>")
            .append("<p class=\"brandline\">GymHelper · дневник тренировок в Telegram</p>")
            .append("</div>\n");
    }

    /* ---------- вычисления (поритет Mini App: workoutVolume/calcWorkoutKcal/monthStreak) ---------- */

    /* OG-заголовок §5.3: «Тренировка · 16 ноября»; имя — только при opt-in владельца */
    private static String ogTitle(Workout w, GymData data) {
        String t = "Тренировка · " + dateShort(w.date);
        if (Boolean.TRUE.equals(data.shareName) && data.shareOwner != null && !data.shareOwner.isEmpty()) {
            t += " · " + data.shareOwner;
        }
        return t;
    }

    /* объём кг: Σ средний вес × подходы × средние повторения (паритет workoutVolume) */
    static double volumeOf(Workout w) {
        double v = 0;
        for (ExerciseEntry e : w.exercises) {
            for (SetEntry s : e.sets) {
                v += Records.avgWeight(s.weight) * Math.max(s.sets, 0) * Records.repsAvg(s.reps);
            }
        }
        return v;
    }

    /* сумма повторений: Σ подходы × средние повторения — герой калистеники (edge 8) */
    static long totalReps(Workout w) {
        long n = 0;
        for (ExerciseEntry e : w.exercises) {
            for (SetEntry s : e.sets) {
                n += (long) Math.max(s.sets, 0) * Records.repsAvg(s.reps);
            }
        }
        return n;
    }

    /* длительность в минутах (округление как durationMin в app.js); null — нет времён */
    static Long durationMin(Workout w) {
        if (w.startedAt == null || w.endedAt == null) return null;
        try {
            LocalDateTime s = LocalDateTime.parse(w.startedAt, ISO_DATETIME);
            LocalDateTime e = LocalDateTime.parse(w.endedAt, ISO_DATETIME);
            long secs = ChronoUnit.SECONDS.between(s, e);
            return Math.round(secs / 60.0);
        } catch (Exception e) {
            return null;
        }
    }

    static int setsTotal(Workout w) {
        int n = 0;
        for (ExerciseEntry e : w.exercises) {
            for (SetEntry s : e.sets) n += Math.max(s.sets, 0);
        }
        return n;
    }

    /* ккал тренировки (§5.2 — осознанно показываем): MET по объёму в минуту,
       формула calcWorkoutKcal Mini App; null — профиль без веса или нет данных */
    static Long kcalOf(ProfileData p, Workout w) {
        if (p == null || !(p.weight > 0)) return null;
        Long minsRaw = durationMin(w);
        if (minsRaw == null) return null;
        double wmin = Math.min(minsRaw, 240);
        if (wmin <= 0) return null;
        List<ExerciseEntry> exs = w.exercises.stream().filter(e -> !e.sets.isEmpty()).toList();
        if (exs.isEmpty()) return null;
        double vol = 0;
        double[] vols = new double[exs.size()];
        int totalSets = 0;
        for (int i = 0; i < exs.size(); i++) {
            double v = 0;
            for (SetEntry s : exs.get(i).sets) {
                v += Records.avgWeight(s.weight) * Math.max(s.sets, 0) * Records.repsAvg(s.reps);
                totalSets += Math.max(s.sets, 0);
            }
            vols[i] = v;
            vol += v;
        }
        double perMin = vol / Math.max(wmin, 1);
        double met = perMin < 120 ? 3.5 : (perMin <= 300 ? 5.0 : 6.0);
        double kcalTotal = Math.round(met * 3.5 * p.weight / 200 * wmin);
        if (kcalTotal <= 0) return null;
        /* разброс по упражнениям как в app.js: total = Σ округлённых долей */
        long total = 0;
        for (int i = 0; i < exs.size(); i++) {
            double share = vol > 0 ? vols[i] / vol : 1.0 / exs.size();
            total += Math.round(kcalTotal * share);
        }
        return total > 0 ? total : null;
    }

    /* рекорд реальным весом: max вес упражнения в этой тренировке строго больше всех
       прошлых (индекс < текущей — база как в prChipSetIdx/Records.congratulation);
       первое выполнение упражнения (базы нет) рекордом не считается */
    private static boolean isRealWeightRecord(GymData data, Workout current, String exercise, double hereMax) {
        int idx = data.workouts.indexOf(current);
        if (idx < 0) return false;
        String nl = exercise.toLowerCase();
        boolean baseHas = false;
        double baseMax = 0;
        for (int i = 0; i < idx; i++) {
            for (ExerciseEntry e : data.workouts.get(i).exercises) {
                if (!e.name.toLowerCase().equals(nl) || e.sets.isEmpty()) continue;
                for (SetEntry s : e.sets) {
                    double v = Records.avgWeight(s.weight);
                    if (v > 0) {
                        baseHas = true;
                        if (v > baseMax) baseMax = v;
                    }
                }
            }
        }
        return baseHas && hereMax > baseMax;
    }

    /* лучший сет упражнения: с максимальным реальным весом; без весов — по сумме повторений;
       ничьи — первый (§5.1, edge 8/10). -1 — отмечать нечего */
    static int bestSetIdx(ExerciseEntry e) {
        boolean weighted = false;
        for (SetEntry s : e.sets) {
            if (Records.avgWeight(s.weight) > 0) { weighted = true; break; }
        }
        double bestW = 0;
        int bestVol = 0;
        int best = -1;
        for (int i = 0; i < e.sets.size(); i++) {
            SetEntry s = e.sets.get(i);
            if (weighted) {
                double wv = Records.avgWeight(s.weight);
                if (wv > bestW) { bestW = wv; best = i; }
            } else {
                int vol = Math.max(s.sets, 0) * Records.repsAvg(s.reps);
                if (vol > bestVol) { bestVol = vol; best = i; }
            }
        }
        return best;
    }

    /* строка подхода «120 кг × 3×8»; без веса — «4×8» (§5.1) */
    static String setLine(SetEntry s) {
        StringBuilder b = new StringBuilder();
        if (Records.avgWeight(s.weight) > 0) {
            b.append(weightText(s.weight)).append(" кг × ");
        }
        b.append(Math.max(s.sets, 0));
        String reps = s.reps == null ? "" : s.reps.trim();
        if (!reps.isEmpty()) b.append('×').append(reps);
        return b.toString();
    }

    /* серия «N тренировок подряд» — склонение trainWord app.js */
    static String trainWord(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "тренировка";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "тренировки";
        return "тренировок";
    }

    static String setsWord(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "подход";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "подхода";
        return "подходов";
    }

    /* «16 ноября · понедельник»; год — если дата не текущего года (§5.1, edge 13) */
    static String dateLong(String date) {
        LocalDate d = parseDate(date);
        if (d == null) return date == null ? "Тренировка" : date;
        String s = d.getDayOfMonth() + " " + MONTHS_GEN[d.getMonthValue() - 1]
            + " · " + DOW_FULL[d.getDayOfWeek().getValue() - 1];
        if (d.getYear() != LocalDate.now().getYear()) s += " " + d.getYear();
        return s;
    }

    /* «16 ноября» — для OG-превью (§5.3) */
    static String dateShort(String date) {
        LocalDate d = parseDate(date);
        if (d == null) return date == null ? "" : date;
        String s = d.getDayOfMonth() + " " + MONTHS_GEN[d.getMonthValue() - 1];
        if (d.getYear() != LocalDate.now().getYear()) s += " " + d.getYear();
        return s;
    }

    private static LocalDate parseDate(String date) {
        if (date == null) return null;
        try {
            return LocalDate.parse(date, ISO_DATE);
        } catch (Exception e) {
            return null;
        }
    }

    /* вес для показа: строку храним как есть («82.5» → «82,5»), без нормализации чисел */
    private static String weightText(String w) {
        return (w == null ? "" : w.trim()).replace('.', ',');
    }

    private static String pad2(int n) {
        return n < 10 ? "0" + n : String.valueOf(n);
    }

    /* группировка тысяч: 5340 → «5 340» */
    private static String fmtNum(long n) {
        String raw = String.valueOf(n);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            if (i > 0 && (raw.length() - i) % 3 == 0) b.append(' ');
            b.append(raw.charAt(i));
        }
        return b.toString();
    }

    /* §8.2: экранирование HTML обязательно для всех пользовательских строк */
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                case '\'': b.append("&#39;"); break;
                case '&': b.append("&amp;"); break;
                default: b.append(c);
            }
        }
        return b.toString();
    }

    /* инлайн-CSS Amber Glass по макету (bg #101114, стекло rgba(255,255,255,.055) + бордер .10);
       колонка ~430px на любом экране (§6.4), тёмная тема всегда */
    private static final String CSS = ""
        + "*{box-sizing:border-box}html,body{margin:0;padding:0}"
        + "body{background:#08090b;font-family:-apple-system,'SF Pro Display','Segoe UI Variable Display','Segoe UI',Roboto,sans-serif}"
        + ".wp{--bg:#101114;--text:#f2f3f5;--muted:#9aa0aa;--accent:#ffc220;--accent-deep:#ffb000;--on-accent:#14120a;"
        + "--glass:rgba(255,255,255,.055);--glassbrd:rgba(255,255,255,.10);--glowbrd:rgba(255,194,32,.28);"
        + "--nested:rgba(0,0,0,.18);--nestedbrd:rgba(255,255,255,.05);--btn:rgba(255,255,255,.07);"
        + "position:relative;max-width:430px;margin:0 auto;min-height:100vh;background:var(--bg);color:var(--text);"
        + "font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;overflow-x:hidden}"
        + ".wp::before{content:'';position:absolute;inset:0;pointer-events:none;"
        + "background:radial-gradient(420px 300px at 85% -40px,rgba(255,178,32,.15),transparent 70%),"
        + "radial-gradient(380px 320px at -60px 30%,rgba(255,138,60,.09),transparent 70%),"
        + "radial-gradient(460px 360px at 110% 80%,rgba(150,92,25,.18),transparent 72%)}"
        + ".wp>*{position:relative}"
        + ".wp-brand{display:flex;align-items:center;gap:9px;padding:14px 16px 12px}"
        + ".wp-brand .tile{width:30px;height:30px;border-radius:9px;flex:none;"
        + "background:linear-gradient(135deg,var(--accent-deep),var(--accent));display:inline-flex;align-items:center;"
        + "justify-content:center;font-size:15px;box-shadow:0 4px 14px rgba(255,194,32,.25)}"
        + ".wp-brand b{font-size:16px;font-weight:800;letter-spacing:.2px}"
        + ".wp-brand .ro{margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;"
        + "border-radius:999px;background:var(--btn);border:1px solid var(--glassbrd);color:var(--muted);"
        + "font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}"
        + ".wp-body{padding:0 12px 150px}"
        + ".glass{background:var(--glass);border:1px solid var(--glassbrd);border-radius:20px;padding:14px;margin-bottom:10px;"
        + "box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.28)}"
        + ".glass.glow{border-color:var(--glowbrd);"
        + "box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.28),0 0 26px rgba(255,194,32,.08)}"
        + ".wdate{font-size:13px;color:var(--muted);text-transform:capitalize;margin:0 0 6px}"
        + ".hero-num{font-size:44px;font-weight:800;color:var(--accent);line-height:1.05;letter-spacing:.5px}"
        + ".hero-num small{font-size:19px;font-weight:700;color:var(--muted);margin-left:4px}"
        + ".hero-lbl{font-size:12px;color:var(--muted);font-weight:600;margin-top:3px}"
        + ".prplaque{margin-top:12px;display:flex;align-items:center;gap:12px;background:var(--nested);"
        + "border:1px solid var(--glowbrd);border-radius:16px;padding:11px 13px;box-shadow:0 0 22px rgba(255,194,32,.08)}"
        + ".prplaque .pic{width:38px;height:38px;border-radius:12px;flex:none;font-size:18px;display:inline-flex;"
        + "align-items:center;justify-content:center;background:rgba(255,194,32,.12);border:1px solid var(--glowbrd)}"
        + ".prplaque .pt{flex:1;min-width:0}"
        + ".prplaque .pk{display:block;font-size:10.5px;font-weight:800;color:var(--accent);letter-spacing:.6px;"
        + "text-transform:uppercase}"
        + ".prplaque .pv{display:block;font-size:26px;font-weight:800;color:var(--text);line-height:1.15;margin-top:2px}"
        + ".prplaque .pv small{font-size:13px;color:var(--muted);font-weight:700}"
        + ".prplaque .ps{display:block;font-size:10.5px;color:var(--muted);margin-top:2px;font-weight:600}"
        + ".aggs{display:grid;gap:8px;margin-bottom:10px}"
        + ".aggs.c3{grid-template-columns:1fr 1fr 1fr}.aggs.c2{grid-template-columns:1fr 1fr}"
        + ".agg{background:var(--glass);border:1px solid var(--glassbrd);border-radius:16px;padding:11px 8px;"
        + "text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}"
        + ".agg b{display:block;font-size:20px;font-weight:800;color:var(--text);line-height:1.2}"
        + ".agg.k b{color:var(--accent)}"
        + ".agg span{display:block;margin-top:2px;font-size:10px;font-weight:700;color:var(--muted);"
        + "letter-spacing:.5px;text-transform:uppercase;white-space:nowrap}"
        + ".expill{background:var(--nested);border:1px solid var(--nestedbrd);border-radius:14px;padding:10px;margin-top:10px}"
        + ".glass .expill:first-of-type{margin-top:2px}"
        + ".exhead{display:flex;align-items:center;gap:8px}"
        + ".exhead .ic{width:32px;height:32px;border-radius:10px;flex:none;font-size:14px;display:inline-flex;"
        + "align-items:center;justify-content:center;background:var(--btn);border:1px solid var(--glassbrd)}"
        + ".exhead .en{flex:1;min-width:0;font-size:14px;font-weight:700;line-height:1.25}"
        + ".entry{margin-top:5px;padding:4px 2px;border-radius:8px;font-size:13.5px;display:flex;align-items:center;gap:6px}"
        + ".entry .rt{flex:1;min-width:0}"
        + ".entry .prtag{flex:none;margin-left:auto;background:rgba(255,194,32,.12);border:1px solid var(--glowbrd);"
        + "color:var(--accent);border-radius:9px;padding:2px 8px;font-size:11.5px;font-weight:700;white-space:nowrap}"
        + ".streak{display:flex;align-items:center;gap:12px;background:var(--glass);border:1px solid var(--glassbrd);"
        + "border-radius:16px;padding:11px 13px;margin-bottom:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}"
        + ".streak .sic{width:38px;height:38px;border-radius:12px;flex:none;font-size:17px;display:inline-flex;"
        + "align-items:center;justify-content:center;background:rgba(255,194,32,.12);border:1px solid var(--glowbrd)}"
        + ".streak b{display:block;font-size:14.5px;line-height:1.3}"
        + ".streak .tn{display:block;font-size:11.5px;color:var(--muted);margin-top:1px}"
        + ".privline{display:flex;align-items:flex-start;gap:7px;font-size:12px;color:var(--muted);line-height:1.5;"
        + "padding:2px 6px 0}"
        + ".na-card{text-align:center;padding:30px 18px 26px;margin-top:40px}"
        + ".na-card .nic{width:52px;height:52px;border-radius:16px;margin:0 auto 14px;font-size:24px;display:flex;"
        + "align-items:center;justify-content:center;background:var(--btn);border:1px solid var(--glassbrd);color:var(--muted)}"
        + ".na-card h2{margin:0 0 8px;font-size:18px;font-weight:800}"
        + ".na-card p{margin:0;font-size:13.5px;color:var(--muted);line-height:1.55}"
        + ".cta{position:absolute;left:0;right:0;bottom:0;z-index:10;padding:26px 16px calc(14px + env(safe-area-inset-bottom,0px));"
        + "background:linear-gradient(180deg,rgba(16,17,20,0),rgba(16,17,20,.94) 38%,#101114 60%)}"
        + ".cta .btn{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:14px;"
        + "border-radius:16px;border:none;background:linear-gradient(135deg,var(--accent-deep),var(--accent));"
        + "color:var(--on-accent);font-weight:800;font-size:16px;font-family:inherit;text-decoration:none;"
        + "box-shadow:0 10px 30px rgba(255,194,32,.22)}"
        + ".cta .already{margin:8px 0 0;text-align:center;font-size:12px;color:var(--muted)}"
        + ".cta .brandline{margin:10px 0 0;text-align:center;font-size:11px;color:#6d737d}";
}
