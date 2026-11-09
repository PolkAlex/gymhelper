package gym;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/* [TST-S1] юнит-тесты чистой логики бота: парсинг блока одной строкой, валидации
   веса/подходов/повторений, MET-модель калорий, e1RM и правила рекордов, даты
   и заголовки, форматирование таймера отдыха, стат-подсказки (последние/популярные веса).
   Класс живёт в пакете gym — так package-private статические функции BotLogic доступны
   без рефлексии. Раннер и стиль — как в tests/GymContractTest (БЕЗ внешних зависимостей).
   Всё, что зависит от времени (durationMin/calcKcal), принимает «сейчас» параметром —
   тесты детерминированы в любой день недели (урок дата-зависимых тестов).
   Парсинг /announce и /delete_my_data, renderLine, planCore, plural, csvField,
   incomingNextId и Storage уже покрыты в GymContractTest — здесь не дублируются. */
public class BotLogicTest {
    static void check(boolean b, String m) {
        if (!b) throw new AssertionError("UNIT FAIL: " + m);
    }

    /* фиксированное «сейчас»: понедельник 09.11.2026 полдень */
    static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 9, 12, 0);

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        /* === 1. Парсинг блока одной строкой (BotLogic.parseLine): валидации границ и мусора === */
        SetEntry pl1 = BotLogic.parseLine("45кг, 4 по 12");
        check(pl1 != null && "45".equals(pl1.weight) && pl1.sets == 4 && "12".equals(pl1.reps),
            "parseLine: «45кг, 4 по 12» → вес 45, 4 подхода, 12 повторений");
        SetEntry pl2 = BotLogic.parseLine("4 по 12");
        check(pl2 != null && pl2.weight.isEmpty() && pl2.sets == 4 && "12".equals(pl2.reps),
            "parseLine: «4 по 12» без веса — вес пустой");
        SetEntry pl3 = BotLogic.parseLine("75-175 кг, 3 по 10");
        check(pl3 != null && "75-175".equals(pl3.weight) && pl3.sets == 3 && "10".equals(pl3.reps),
            "parseLine: «75-175 кг, 3 по 10» → вес-диапазон без «кг» и хвостовой запятой");
        SetEntry pl4 = BotLogic.parseLine("45кг, 4 по 8-10");
        check(pl4 != null && "8-10".equals(pl4.reps), "parseLine: диапазон повторений проходит целиком");
        check(BotLogic.parseLine("45кг, 31 по 12") == null && BotLogic.parseLine("45кг, 0 по 12") == null,
            "parseLine: подходы вне 1..30 (0 и 31) → отказ");
        check(BotLogic.parseLine("45кг, 4 по ") == null, "parseLine: пустые повторения → отказ");
        check(BotLogic.parseLine("45кг, 4 по 1234567890123456") == null,
            "parseLine: повторения длиннее 15 символов → отказ");
        check(BotLogic.parseLine("11111111111111111111111111кг, 3 по 10") == null,
            "parseLine: вес длиннее 25 символов → отказ");
        check(BotLogic.parseLine("привет") == null, "parseLine: не блок одной строкой → null");

        /* === 2. Нормализация веса и числовые оценки (normalizeWeight/maxWeight/repsNum) === */
        check(BotLogic.normalizeWeight("45кг").equals("45"), "normalizeWeight: суффикс «кг» отрезается");
        check(BotLogic.normalizeWeight("45,").equals("45") && BotLogic.normalizeWeight("45.").equals("45")
            && BotLogic.normalizeWeight("45;").equals("45"), "normalizeWeight: хвостовые , . ; отрезаются");
        check(BotLogic.normalizeWeight(" 62,5 ").equals("62,5") && BotLogic.normalizeWeight("45кг,").equals("45"),
            "normalizeWeight: пробелы и комбинация «45кг,» → 45; дробь с запятой сохраняется");
        check(BotLogic.normalizeWeight("тяжело").equals("тяжело"),
            "normalizeWeight: мусор не режется — числовую проверку делает вызывающий код");
        check(BotLogic.maxWeight("75-175") == 175.0, "maxWeight: диапазон → максимум 175");
        check(BotLogic.maxWeight("50, 80") == 80.0, "maxWeight: список → максимум 80");
        check(BotLogic.maxWeight("62,5") == 62.5 && BotLogic.maxWeight("") == 0 && BotLogic.maxWeight(null) == 0,
            "maxWeight: дробь 62,5 → 62.5; пустая строка и null → 0");
        check(BotLogic.repsNum("12") == 12, "repsNum: «12» → 12");
        check(BotLogic.repsNum("8-10") == 8, "repsNum: «8-10» → 8 (первое число — консервативная оценка объёма)");
        check(BotLogic.repsNum("макс") == 10 && BotLogic.repsNum("") == 10,
            "repsNum: нечисловое и пустое → 10 (дефолт)");

        /* === 3. MET-модель калорий (calcKcal) + BMR + объём + длительность === */
        ProfileData p = new ProfileData();
        p.sex = "м"; p.age = 30; p.height = 180; p.weight = 80;
        Workout ek = w("2026-11-09T11:00:00", null, false);
        check(BotLogic.calcKcal(null, ek, NOW) == -1, "calcKcal: нет профиля → -1");
        ProfileData p0 = new ProfileData();
        p0.weight = 0;
        check(BotLogic.calcKcal(p0, ek, NOW) == -1, "calcKcal: профиль с весом 0 → -1");
        check(BotLogic.calcKcal(p, w(null, null, false), NOW) == -1,
            "calcKcal: время начала не зафиксировано → -1");
        check(BotLogic.calcKcal(p, ek, NOW) == 294,
            "calcKcal: 0 подходов, 60 мин, 80 кг → 294 (низкая интенсивность, 3.5 MET)");
        Workout avg = w("2026-11-09T11:00:00", null, false);
        ex(avg, "Жим", new SetEntry("120", 10, "12"));
        check(BotLogic.calcKcal(p, avg, NOW) == 420,
            "calcKcal: объём 14400 кг / 60 мин = 240 кг/мин → средняя (5.0 MET) → 420");
        Workout hi = w("2026-11-09T11:00:00", null, false);
        ex(hi, "Жим", new SetEntry("120", 30, "12"));
        check(BotLogic.calcKcal(p, hi, NOW) == 504,
            "calcKcal: 720 кг/мин → высокая интенсивность (6.0 MET) → 504");
        Workout b120 = w("2026-11-09T11:10:00", null, false);
        ex(b120, "Жим", new SetEntry("100", 6, "10"));
        check(BotLogic.calcKcal(p, b120, NOW) == 350,
            "calcKcal: граница ровно 120 кг/мин → уже средняя (5.0 MET) → 350");
        Workout cap = w("2026-11-09T07:00:00", null, false);
        check(BotLogic.calcKcal(p, cap, NOW) == 1176,
            "calcKcal: 300 мин → в расчёте максимум 240 (KCAL_MAX_MIN) → 1176");

        Workout df = w("2026-11-08T18:00:00", "2026-11-08T19:38:00", true);
        LocalDateTime far = LocalDateTime.of(2027, 5, 1, 23, 59);
        Long m1 = BotLogic.durationMin(df, NOW);
        Long m2 = BotLogic.durationMin(df, far);
        check(m1 != null && m1 == 98 && m2 != null && m2 == 98,
            "durationMin: завершённая 18:00–19:38 → 98 мин, не зависит от «сейчас» (детерминизм)");
        check(BotLogic.calcKcal(p, df, NOW) == 480 && BotLogic.calcKcal(p, df, far) == 480,
            "calcKcal: завершённая (0 подходов, 98 мин) → 480 ккал при любом «сейчас»");

        Long m3 = BotLogic.durationMin(w("2026-11-09T10:00:00", null, false), LocalDateTime.of(2026, 11, 9, 12, 30));
        check(m3 != null && m3 == 150,
            "durationMin: незавершённая считается до переданного «сейчас» (10:00 → 12:30 = 150)");
        check(BotLogic.durationMin(w(null, null, false), NOW) == null, "durationMin: нет времени начала → null");
        Long m4 = BotLogic.durationMin(w("2026-11-09T10:00:00", null, false), LocalDateTime.of(2026, 11, 9, 9, 0));
        check(m4 != null && m4 == 0, "durationMin: конец раньше начала → 0, без отрицательных");
        check(BotLogic.durationText(98).equals("1ч 38м") && BotLogic.durationText(59).equals("59м")
            && BotLogic.durationText(0).equals("0м"), "durationText: «1ч 38м» / «59м» / «0м»");

        Workout wv = w("2026-11-09T11:00:00", null, false);
        ex(wv, "Жим", new SetEntry("75-175", 2, "10"), new SetEntry("", 3, "12"));
        check(BotLogic.workoutVolume(wv) == 3500.0,
            "workoutVolume: диапазон веса по максимуму (175×2×10) + блок без веса (0) → 3500");
        check(Math.round(BotLogic.bmr(p)) == 1780,
            "bmr: м/30/180/80 → 800+1125−150+5 = 1780 (Mifflin-St Jeor)");
        ProfileData pf = new ProfileData();
        pf.sex = "ж"; pf.age = 30; pf.height = 180; pf.weight = 82;
        check(Math.round(BotLogic.bmr(pf)) == 1634, "bmr: «ж» → 1795−161 = 1634");

        /* [UX-T29] bmr/ageOf: валидная дата рождения → вычисленный возраст (зеркало age
           игнорируется). Месяц = текущий → возраст ровно год-разница — детерминировано
           в любой день; возраст наступает 1-го числа месяца рождения */
        java.time.LocalDate todayBD = java.time.LocalDate.now();
        ProfileData pb = new ProfileData();
        pb.sex = "м"; pb.height = 180; pb.weight = 80;
        pb.birthYear = todayBD.getYear() - 30;
        pb.birthMonth = todayBD.getMonthValue();
        check(pb.ageOf() == 30, "ageOf: год текущий−30, месяц текущий → 30 (зеркало age=0 игнорируется)");
        check(Math.round(BotLogic.bmr(pb)) == 1780, "bmr: возраст из даты рождения → 1780, как при age=30");
        ProfileData pbNext = new ProfileData();
        pbNext.sex = "м"; pbNext.height = 180; pbNext.weight = 80;
        pbNext.birthYear = todayBD.getYear() - 30;
        pbNext.birthMonth = (todayBD.getMonthValue() % 12) + 1; /* следующий месяц (с заворотом декабря) */
        /* ожидание считается по правилу ageOf (год−birthYear − (текущийМесяц < birthMonth ? 1 : 0)):
           месяц больше текущего → 29; в декабре «следующий» = январь, он в текущем году уже
           прошёл → 30 — без этого ожидания тест падал бы каждый декабрь */
        int expNext = 30 - (pbNext.birthMonth > todayBD.getMonthValue() ? 1 : 0);
        check(pbNext.ageOf() == expNext, "ageOf: месяц рождения ещё не наступил → " + expNext);
        ProfileData pLegacyBD = new ProfileData();
        pLegacyBD.sex = "м"; pLegacyBD.age = 44; pLegacyBD.height = 180; pLegacyBD.weight = 80;
        check(pLegacyBD.ageOf() == 44, "ageOf: без даты — статический age");
        ProfileData pHalfBD = new ProfileData();
        pHalfBD.sex = "м"; pHalfBD.age = 44; pHalfBD.height = 180; pHalfBD.weight = 80;
        pHalfBD.birthYear = todayBD.getYear() - 30; /* год без месяца — полупара не считается датой */
        check(pHalfBD.ageOf() == 44, "ageOf: полупара (год без месяца) — дата не считается");

        /* === 4. e1RM по Эпли и живые рекорды (Records) === */
        check(Math.abs(Records.e1rm(new SetEntry("100", 5, "5")) - 116.6667) < 0.001,
            "e1rm: 100 кг × 5 → ≈116.7 (вес × (1 + повторения ÷ 30)); подходы не участвуют");
        check(Records.e1rm(new SetEntry("", 4, "10")) == 0, "e1rm: блок без веса → 0");
        check(Math.abs(Records.e1rm(new SetEntry("50-60", 3, "12")) - 77.0) < 0.001,
            "e1rm: диапазон веса 50-60 → среднее 55 → 55 × (1 + 12 ÷ 30) = 77");

        GymData pd1 = prData();
        String prMsg = Records.congratulation(pd1, pd1.findById(2), "Жим", new SetEntry("105", 3, "8-10"));
        check(prMsg != null && prMsg.contains("Рекорд!") && prMsg.contains("137") && prMsg.contains("130"),
            "pr: 105×8-10 (1ПМ ≈ 136.5 → 137) против базы 100×8-10 (130) — рекорд с округлениями в тексте");
        GymData pd3 = prData();
        check(Records.congratulation(pd3, pd3.findById(2), "Жим", new SetEntry("99", 3, "8-10")) == null,
            "pr: ниже базы (128.7 < 130) — не рекорд (строгое >)");
        GymData pd2 = prData();
        Workout cur2 = pd2.findById(2);
        ExerciseEntry curJ = new ExerciseEntry("Жим");
        curJ.sets.add(new SetEntry("105", 3, "8-10"));
        cur2.exercises.add(curJ);
        check(Records.congratulation(pd2, cur2, "Жим", new SetEntry("110", 3, "8-10")) == null,
            "pr: упражнение уже побило базу в этой тренировке — поздравление максимум 1 раз");
        check(Records.congratulation(prData(), new Workout(), "Жим", new SetEntry("200", 3, "8")) == null,
            "pr: тренировка не из списка данных → защита, не рекорд");
        GymData pd4 = prData();
        String volMsg = Records.congratulation(pd4, pd4.findById(2), "Подтягивания", new SetEntry("", 5, "9"));
        check(volMsg != null && volMsg.contains("Рекорд объёма") && volMsg.contains("45"),
            "pr: объёмный рекорд блока без веса (5×9 = 45 против базы 40)");
        GymData pd5 = prData();
        check(Records.congratulation(pd5, pd5.findById(2), "Подтягивания", new SetEntry("", 4, "10")) == null,
            "pr: равный объём (40 = 40) — не рекорд");
        GymData pd6 = prData();
        check(Records.congratulation(pd6, pd6.findById(2), "Подтягивания", new SetEntry("", 0, "10")) == null,
            "pr: блок с 0 подходов (объём 0) — не рекорд");

        /* === 5. Даты и заголовки (детерминированные, Пн — первый день недели) === */
        Workout fp = new Workout();
        fp.date = "2026-11-09";
        Workout fs = new Workout();
        fs.date = "2026-11-14";
        check(BotLogic.firstLineText(fp).equals("09-11 Пн") && BotLogic.firstLineText(fs).equals("14-11 Сб"),
            "firstLineText: 2026-11-09 → «09-11 Пн», 2026-11-14 → «14-11 Сб» (неделя с понедельника)");
        Workout fb = new Workout();
        fb.date = "осень";
        Workout fn = new Workout();
        fn.date = null;
        check(BotLogic.firstLineText(fb).equals("осень") && BotLogic.firstLineText(fn).equals("Тренировка"),
            "firstLineText: неразборчивая дата → как есть, отсутствует → «Тренировка»");
        Workout at = w("2026-11-09T10:00:00", null, false);
        at.date = "2026-11-09";
        ex(at, "Жим", new SetEntry("50", 1, "10"));
        ex(at, "Тяга", new SetEntry("", 1, "12"));
        ex(at, "Присед", new SetEntry("80", 1, "8"));
        ex(at, "Планка", new SetEntry("", 0, "60"));
        check(BotLogic.autoTitle(at).equals("09-11 Пн\nЖим\nТяга\nПрисед"),
            "autoTitle: дата + максимум 3 упражнения; без записей — пропущено");
        Workout th = new Workout();
        th.title = "День 1\nЖим <b>";
        check(BotLogic.titleHtml(th).equals("<b>День 1</b>\nЖим &lt;b&gt;"),
            "titleHtml: первая строка — жирным, остальные экранируются");
        Workout th2 = w("2026-11-09T10:00:00", null, false);
        th2.date = "2026-11-09";
        ex(th2, "Жим", new SetEntry("50", 1, "10"));
        check(BotLogic.titleHtml(th2).equals("<b>09-11 Пн</b>\nЖим"),
            "titleHtml: без своего названия — автозаголовок (дата + упражнения)");

        /* === 6. Таймер отдыха и экранирование (restCountdownText/restPushDesc/esc) === */
        check(BotLogic.restCountdownText("Жим", 82, 90)
                .equals("⏱ Отдых: 1:22\n" + "▰".repeat(16) + "▱".repeat(2) + "\nЖим — следующий подход"),
            "restCountdownText: 82/90 → «1:22», бар 16 из 18 ячеек");
        check(BotLogic.restCountdownText(null, 200, 90)
                .equals("⏱ Отдых: 3:20\n" + "▰".repeat(18) + "\n — следующий подход"),
            "restCountdownText: остаток больше полной шкалы → все ячейки; без упражнения");
        check(BotLogic.restCountdownText("Тяга", 0, 90)
                .equals("⏱ Отдых: 0:00\n" + "▱".repeat(18) + "\nТяга — следующий подход"),
            "restCountdownText: 0 сек → пустой бар, «0:00»");
        check(BotLogic.restCountdownText("Тяга", 5, 0).startsWith("⏱ Отдых: 0:05"),
            "restCountdownText: dur=0 не делит на ноль (защита max(dur,1))");
        check(BotLogic.restPushDesc(new SetEntry("75", 3, "8")).equals("75 кг × 8"),
            "restPushDesc: «75 кг × 8» для финального пуша");
        check(BotLogic.restPushDesc(new SetEntry("", 3, "8")) == null && BotLogic.restPushDesc(null) == null,
            "restPushDesc: блок без веса и null → описания нет");
        check(BotLogic.esc("a<b>&c>d").equals("a&lt;b&gt;&amp;c&gt;d") && BotLogic.esc(null).isEmpty(),
            "esc: <>& экранируются, null → пустая строка");

        /* === 7. Стат-подсказки: последние веса/повторения и популярный вес === */
        GymData sd = statData();
        check(BotLogic.lastWeights(sd, "Жим").equals(List.of("90", "80")),
            "lastWeights: последняя тренировка с упражнением, уникальные, пустой вес пропущен");
        check(BotLogic.lastWeights(sd, "жим").equals(List.of("90", "80")),
            "lastWeights: имя упражнения без учёта регистра");
        check(BotLogic.lastWeights(sd, "Присед").isEmpty() && BotLogic.lastWeights(sd, "Подтягивания").isEmpty(),
            "lastWeights: нет упражнения / только блоки без веса → пустой список");
        check(BotLogic.lastReps(sd, "Жим").equals(List.of("10", "12")),
            "lastReps: повторения последней тренировки, уникальные");
        check(BotLogic.popularWeight(sd, "Жим").equals("80"),
            "popularWeight: «80» встречается 3 раза → популярный");
        check(BotLogic.popularWeight(sd, "Подтягивания") == null && BotLogic.popularWeight(sd, "Нет") == null,
            "popularWeight: только блоки без веса / нет данных → null");
        GymData ld = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-11-02\",\"finished\":true,\"exercises\":[" +
                "{\"name\":\"Жим\",\"sets\":[" +
                "{\"w\":\"60\",\"s\":1,\"r\":\"5\"},{\"w\":\"70\",\"s\":1,\"r\":\"6\"},{\"w\":\"80\",\"s\":1,\"r\":\"7\"}," +
                "{\"w\":\"90\",\"s\":1,\"r\":\"8\"},{\"w\":\"100\",\"s\":1,\"r\":\"9\"}]}]}]}"));
        check(BotLogic.lastWeights(ld, "Жим").equals(List.of("60", "70", "80", "90"))
            && BotLogic.lastReps(ld, "Жим").equals(List.of("5", "6", "7", "8")),
            "подсказки: не больше 4 последних значений (из 5 уникальных)");

        System.out.println("UNIT OK");
        System.exit(0);
    }

    /* свежие данные для сценариев рекордов: база id1 (Жим 100×3 «8-10» → 1ПМ 130;
       Подтягивания 4×«10» → объём 40), текущая незавершённая id2 без записей */
    @SuppressWarnings("unchecked")
    static GymData prData() {
        return GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":3,\"workouts\":[" +
                "{\"id\":1,\"date\":\"2026-11-01\",\"finished\":true,\"exercises\":[" +
                "{\"name\":\"Жим\",\"sets\":[{\"w\":\"100\",\"s\":3,\"r\":\"8-10\"}]}," +
                "{\"name\":\"Подтягивания\",\"sets\":[{\"w\":\"\",\"s\":4,\"r\":\"10\"}]}]}," +
                "{\"id\":2,\"date\":\"2026-11-09\",\"finished\":false,\"exercises\":[]}]}"));
    }

    /* данные для стат-подсказок: Жим в двух тренировках (веса 80×3/85/90, повторения 8-10/10/12) */
    @SuppressWarnings("unchecked")
    static GymData statData() {
        return GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":3,\"workouts\":[" +
                "{\"id\":1,\"date\":\"2026-11-01\",\"finished\":true,\"exercises\":[" +
                "{\"name\":\"Жим\",\"sets\":[{\"w\":\"80\",\"s\":1,\"r\":\"8-10\"},{\"w\":\"85\",\"s\":1,\"r\":\"10\"},{\"w\":\"80\",\"s\":1,\"r\":\"8-10\"}]}," +
                "{\"name\":\"Подтягивания\",\"sets\":[{\"w\":\"\",\"s\":4,\"r\":\"8\"}]}]}," +
                "{\"id\":2,\"date\":\"2026-11-02\",\"finished\":true,\"exercises\":[" +
                "{\"name\":\"Жим\",\"sets\":[{\"w\":\"90\",\"s\":1,\"r\":\"10\"},{\"w\":\"\",\"s\":2,\"r\":\"12\"},{\"w\":\"80\",\"s\":1,\"r\":\"12\"}]}]}]}"));
    }

    static Workout w(String started, String ended, boolean finished) {
        Workout wk = new Workout();
        wk.date = "2026-11-09";
        wk.startedAt = started;
        wk.endedAt = ended;
        wk.finished = finished;
        return wk;
    }

    static ExerciseEntry ex(Workout wk, String name, SetEntry... sets) {
        ExerciseEntry e = new ExerciseEntry(name);
        for (SetEntry s : sets) e.sets.add(s);
        wk.exercises.add(e);
        return e;
    }
}
