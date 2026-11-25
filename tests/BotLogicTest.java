package gym;

import java.time.LocalDateTime;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/* [TST-S1] юнит-тесты чистой логики бота: парсинг блока одной строкой, валидации
   веса/подходов/повторений, MET-модель калорий, e1RM и правила рекордов, даты
   и заголовки, форматирование таймера отдыха, стат-подсказки (последние/популярные веса),
   шаблоны тренировок [TST-E1]: авто-имя, обрезки имён, план-строка/компакт-план,
   санитизация чтения шаблонов (GymData.fromJson).
   Класс живёт в пакете gym — так package-private статические функции BotLogic доступны
   без рефлексии. Раннер и стиль — как в tests/GymContractTest (БЕЗ внешних зависимостей).
   Всё, что зависит от времени (durationMin/calcKcal), принимает «сейчас» параметром —
   тесты детерминированы в любой день недели (урок дата-зависимых тестов).
   Парсинг /announce и /delete_my_data, renderLine, planCore, plural, csvField,
   incomingNextId, Storage и round-trip шаблонов уже покрыты в GymContractTest —
   здесь не дублируются.
   [TST-T4] Поведенческая зона (лимит 20 шаблонов, мастер ввода, применение шаблона)
   гоняется через публичную точку входа BotLogic.handle() с заглушкой TelegramApi
   (FakeApi — тексты сообщений собираются в список, сети нет) и реальным Storage во
   временном каталоге: состояние — по logic.states (package-private) и storage.load().
   Сценарии: старт мастера (wk:add → ex:i_N), ввод веса/подходов/повторений с отказами,
   отмена «готово», запись блока и запуск таймера отдыха; лимит TPL_LIMIT (19→ок «20 из 20»,
   20→отказ во всех трёх точках: tplNew, имя, авто-имя); применение шаблона tpl:start
   (план w/s/r снимается в запись, пустой шаблон/1 упражнение, старт при активной
   тренировке → wk:discard доустанавливает отложенный шаблон §4.6).
   Обратная связь [ONB-T8]: deep-link «/start feedback» → режим FEEDBACK → свободный
   текст уходит владельцу через FakeApi.sendMessageResult (адресат — GYM_OWNER_CHAT_ID,
   шапка с именем/username/chat_id, HTML-экранирование) → подтверждение, режим сброшен;
   /cancel и /help отменяют режим без пересылки; GYM_OWNER_CHAT_ID не задан (0) — фича off.
   [UX-T33]: persistent reply-клавиатура «Открыть приложение» убрана — на /start при
   webAppUrl != null перед меню уходит разовое сообщение с reply_keyboard_remove
   ({remove_keyboard: true}, текст про кнопку ☰ «🏋️ Дневник»); на /menu снимающего
   сообщения нет; deep-link «/start feedback» обрабатывается раньше и тоже не снимает;
   при webAppUrl == null (регрессия всех прежних сценариев) снимающего вызова нет. */
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

        /* === 8. Шаблоны: авто-имя и обрезки (templateAutoName/trimName/shortName) === */
        Workout tn1 = w(null, null, true);
        tn1.title = "День 1\nЖим лёжа";
        check(BotLogic.templateAutoName(tn1).equals("День 1"),
            "templateAutoName: многострочный title → только первая строка");
        Workout tn2 = w(null, null, true);
        tn2.title = "  Спина и бицепс  \nЖим";
        check(BotLogic.templateAutoName(tn2).equals("Спина и бицепс"),
            "templateAutoName: первая строка title обрезается по краям");
        Workout tn3 = w(null, null, true);
        ex(tn3, "Жим", new SetEntry("60", 3, "10"));
        ex(tn3, "Тяга", new SetEntry("", 4, "8"));
        ex(tn3, "Присед", new SetEntry("80", 3, "8"));
        check(BotLogic.templateAutoName(tn3).equals("Жим · Тяга"),
            "templateAutoName: без title — максимум 2 упражнения через « · »");
        Workout tn4 = w(null, null, true);
        ex(tn4, "Жим", new SetEntry("60", 3, "10"));
        ex(tn4, "Пустое", new SetEntry[0]);
        check(BotLogic.templateAutoName(tn4).equals("Жим"),
            "templateAutoName: упражнение без подходов не попадает в имя");
        check(BotLogic.templateAutoName(w(null, null, true)).equals("Тренировка 09-11"),
            "templateAutoName: ни title, ни упражнений → «Тренировка ДД-ММ» из даты");
        Workout tn5 = w(null, null, true);
        tn5.date = "осень";
        check(BotLogic.templateAutoName(tn5).equals("Тренировка "),
            "templateAutoName: неразборчивая дата → «Тренировка » (пустой хвост — поведение прод-кода)");
        String sixty = "А".repeat(60);
        check(BotLogic.trimName("  " + sixty + "  ").equals(sixty),
            "trimName: пробелы по краям срезаются, ровно 60 символов не обрезается");
        check(BotLogic.trimName("Б".repeat(70)).length() == 60,
            "trimName: 70 символов → ровно 60 (лимит названия)");
        check(BotLogic.trimName(null).isEmpty(), "trimName: null → пустая строка");
        check(BotLogic.shortName("0123456789abcdef").equals("0123456789abcdef")
            && BotLogic.shortName("0123456789abcdegx").equals("0123456789abcde…"),
            "shortName: 16 символов целыми, 17 → 15 + «…»");
        check(BotLogic.shortName(null).isEmpty(), "shortName: null → пустая строка");

        /* === 9. Шаблоны: план-строка списка и компакт-план (templatePlanLine/compactPlan) === */
        check(BotLogic.compactPlan(te("Жим", "60", 3, "10")).equals("60×3×10"),
            "compactPlan: «60×3×10» (вес × подходы × повторения)");
        check(BotLogic.compactPlan(te("Жим", "62.5", 3, "10")).equals("62,5×3×10"),
            "compactPlan: точка в весе → запятая");
        check(BotLogic.compactPlan(te("Жим", "60", 3, "")).equals("60×3")
            && BotLogic.compactPlan(te("Жим", "", 3, "10")).equals("3×10"),
            "compactPlan: без повторений «60×3», без веса «3×10»");
        check(BotLogic.compactPlan(te("Жим", "", 2, "")).equals("2")
            && BotLogic.compactPlan(te("Жим", null, 2, null)).equals("2"),
            "compactPlan: только подходы (в т.ч. null-поля из JSON) → «2»");
        Template tp1 = new Template();
        tp1.exercises.add(te("Жим", "60", 3, "10"));
        tp1.exercises.add(te("Тяга", "", 4, "10"));
        check(BotLogic.templatePlanLine(tp1).equals("Жим 60×3×10 · Тяга 4×10"),
            "templatePlanLine: первые упражнения с планом через « · »");
        Template tp2 = new Template();
        for (int i = 0; i < 5; i++) tp2.exercises.add(te("Упр" + i, "60", 3, "10"));
        check(BotLogic.templatePlanLine(tp2).equals("Упр0 60×3×10 · Упр1 60×3×10 · Упр2 60×3×10 · +2"),
            "templatePlanLine: показываются первые 3, остальные — счётчиком «+2»");
        Template tp3 = new Template();
        tp3.exercises.add(te("Тяга верхнего блока к груди", "60", 3, "10"));
        check(BotLogic.templatePlanLine(tp3).equals("Тяга верхнего б… 60×3×10"),
            "templatePlanLine: имя длиннее 16 символов клипается с «…»");
        Template tp4 = new Template();
        tp4.exercises.add(te("Жим", "", 1, ""));
        tp4.exercises.add(te("Тяга", "", 1, ""));
        check(BotLogic.templatePlanLine(tp4).isEmpty(),
            "templatePlanLine: ни у одного упражнения нет осмысленного плана → пустая строка");
        Template tp5 = new Template();
        tp5.exercises.add(te("Голое", "", 1, ""));
        tp5.exercises.add(te("Жим", "60", 3, "10"));
        tp5.exercises.add(te("Тяга", "", 3, "8"));
        tp5.exercises.add(te("Присед", "80", 3, "8"));
        check(BotLogic.templatePlanLine(tp5).equals("Жим 60×3×10 · Тяга 3×8 · +1"),
            "templatePlanLine: упражнение без плана пропускается, но учитывается в счётчике «+N»");

        /* === 10. Чтение шаблонов из GymData.fromJson: санитизация (лимит и применение —
           приватные instance-методы с TelegramApi, юнитом не покрыты) === */
        GymData ts1 = tplData("{\"id\":1,\"name\":\"Т\",\"exercises\":[" +
            "{\"name\":\"Жим\",\"w\":\"60\",\"s\":0,\"r\":\"10\"}," +
            "{\"name\":\"Тяга\",\"w\":\"60\",\"s\":-5,\"r\":\"10\"}]}");
        check(ts1.templates.get(0).exercises.get(0).s == 1 && ts1.templates.get(0).exercises.get(1).s == 1,
            "чтение шаблонов: подходы меньше 1 (0 и отрицательные) → 1");
        GymData ts2 = tplData("{\"id\":1,\"name\":\"Ок\",\"exercises\":[]}," +
                "{\"id\":2,\"exercises\":[]}");
        check(ts2.templates.size() == 1 && "Ок".equals(ts2.templates.get(0).name),
            "чтение шаблонов: запись без имени пропускается, остальные читаются");
        GymData ts3 = tplData("{\"id\":1,\"name\":\"Т\",\"exercises\":[" +
                "{\"w\":\"60\",\"s\":2,\"r\":\"10\"}," +
                "{\"name\":\"Тяга\",\"s\":2}]}");
        check(ts3.templates.get(0).exercises.size() == 1 && "Тяга".equals(ts3.templates.get(0).exercises.get(0).name),
            "чтение шаблонов: упражнение без имени пропускается");
        GymData ts4 = tplData("{\"id\":1,\"name\":\"Т\",\"exercises\":[" +
            "{\"name\":\"Жим\",\"w\":75.5,\"s\":3,\"r\":10}]}");
        check("75.5".equals(ts4.templates.get(0).exercises.get(0).w)
            && "10".equals(ts4.templates.get(0).exercises.get(0).r),
            "чтение шаблонов: вес/повторения числом → строки (дробь сохраняется)");

        /* === 11. Лимит 20 шаблонов [TST-T4]: константы и поведенческий сценарий === */
        check(BotLogic.TPL_LIMIT == 20 && BotLogic.TPL_EX_LIMIT == 20,
            "лимиты шаблонов: 20 на пользователя и 20 упражнений в шаблоне (спека §0.2)");
        runLimitScenario();

        /* === 12. Мастер ввода [TST-T4]: старт → вес → подходы → повторения → запись,
            отказы на каждом шаге, отмена «готово», таймер отдыха после записи === */
        runWizardScenario();

        /* === 13. Применение шаблона [TST-T4]: tpl:start снимает план в запись,
            пустой шаблон и 1 упражнение, активная тренировка → отложенный шаблон (§4.6) === */
        runApplyScenario();

        /* === 14. Счётчики Stats [ANA-T1]: создание/использование шаблонов через handle() === */
        runStatsScenario();

        /* === 15. Обратная связь [ONB-T8]: deep-link → режим → пересылка владельцу === */
        runFeedbackScenario();

        /* === 17. Источники привлечения [ANA-T10]: /start <payload> → bucket startSrc === */
        runStartSrcScenario();

        /* === 18. Активационные метрики «за вчера» [ANA-T11]: скан chat-файлов + summaryText === */
        runActivationScenario();

        /* === 16. Снятие reply-клавиатуры [UX-T33]: /start webapp → remove_keyboard + меню,
            /menu и /start feedback без снятия, webAppUrl == null — регрессия === */
        runKeyboardRemoveScenario();

        /* === 19. Механика возврата [UX-S19 T51]: решение тика decideNotify — все
            триггеры/пороги/окна/лимиты, лестница реактивации, книга учёта === */
        runNotifyScenario();

        /* === 20. [UX-S19 T53] тексты §4.1–4.3, клавиатуры, /notify, отписки,
            строка «первая тренировка» в финише, reacted-инкремент === */
        runNotifyBotScenario();

        /* === 21. [UX-T54] дайджест §4.4 (состав, секции, финалы, дельта,
            рекорды) + «первая тренировка» тиком + /digest === */
        runDigestScenario();

        System.out.println("UNIT OK");
        System.exit(0);
    }

    /* шаблонное упражнение для план-тестов */
    static TemplateExercise te(String name, String w, int s, String r) {
        TemplateExercise t = new TemplateExercise();
        t.name = name;
        t.w = w;
        t.s = s;
        t.r = r;
        return t;
    }

    /* ===== [TST-T4] поведенческие сценарии: заглушка Api + handle() ===== */

    /* Заглушка TelegramApi: все исходящие тексты складываются в список, HTTP не дёргается.
       Наследование возможно, т.к. TelegramApi не final (см. src/gym/TelegramApi.java). */
    static final class FakeApi extends TelegramApi {
        final List<String> texts = new ArrayList<>();
        /* [ONB-T8] chat_id отправок sendMessageResult — проверка адресата пересылки feedback */
        final List<Long> sentChats = new ArrayList<>();
        /* [ONB-T8] ненулевое значение — sendMessageResult «падает» с этой ошибкой
           (тест отказа доставки: режим остаётся, счётчик не растёт) */
        String failResult;
        /* [UX-T33] вызовы sendMessageWithKeyboard: унаследованная реализация ходит в сеть
           (postSilent), поэтому переопределяем — фиксируем chat_id/текст/reply_markup */
        final List<Long> kbChats = new ArrayList<>();
        final List<String> kbTexts = new ArrayList<>();
        final List<Map<String, Object>> kbMarkups = new ArrayList<>();

        FakeApi() {
            super("fake-token-unit-tests");
        }

        @Override
        public void sendMessage(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
            texts.add(text);
        }

        @Override
        public void sendMessageWithKeyboard(long chatId, String text, Map<String, Object> replyMarkup) {
            kbChats.add(chatId);
            kbTexts.add(text);
            kbMarkups.add(replyMarkup);
            texts.add(text); /* это тоже исходящее сообщение — порядок в texts проверяем */
        }

        @Override
        public String sendMessageResult(long chatId, String text) {
            sentChats.add(chatId);
            texts.add(text);
            return failResult;
        }

        @Override
        public boolean editMessageText(long chatId, long messageId, String text, List<List<Map<String, Object>>> keyboard) {
            texts.add(text);
            editKbs.add(keyboard);
            return true;
        }

        @Override
        public void sendMessageSilent(long chatId, String text) {
            texts.add(text);
        }

        /* [UX-S19] клавиатуры перерисованных экранов (/notify) — подписи кнопок §4.7 */
        final List<List<List<Map<String, Object>>>> editKbs = new ArrayList<>();

        @Override
        public long sendMessageGetId(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
            texts.add(text);
            return 100; /* сообщение-отсчёт «отправилось» — сессия таймера создаётся */
        }

        /* [UX-S19] сетевые методы возврата: унаследованные ходят в post/postSilent —
            переопределяем, фиксируем вызовы (клавиатуры нужны проверкам сообщений тика) */
        final List<List<List<Map<String, Object>>>> kbSent = new ArrayList<>();

        @Override
        public String sendMessageResult(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
            sentChats.add(chatId);
            texts.add(text);
            kbSent.add(keyboard);
            return failResult;
        }

        @Override
        public String sendMessageSilentKb(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
            sentChats.add(chatId);
            texts.add(text);
            kbSent.add(keyboard);
            return failResult;
        }

        @Override
        public boolean removeKeyboard(long chatId, long messageId) {
            texts.add("[removed-kb:" + messageId + "]");
            return true;
        }

        @Override
        public void answerCallbackQuery(String callbackId, String text) {
            /* подтверждение колбэка — игнорируем */
        }

        String last() {
            return texts.get(texts.size() - 1);
        }

        boolean any(String part) {
            return texts.stream().anyMatch(t -> t.contains(part));
        }
    }

    /* Telegram-update с callback_query (нажатие inline-кнопки) */
    static Map<String, Object> cbUpdate(long chatId, long mid, String data) {
        return Map.of("callback_query", Map.of(
            "id", "cb" + chatId + data,
            "data", data,
            "message", Map.of("message_id", mid, "chat", Map.of("id", chatId))));
    }

    /* Telegram-update с текстовым сообщением пользователя */
    static Map<String, Object> msgUpdate(long chatId, String text) {
        return Map.of("message", Map.of(
            "message_id", 77, "chat", Map.of("id", chatId), "text", text));
    }

    /* то же с отправителем (from) — для сценариев обратной связи [ONB-T8];
       last/username могут быть null (LinkedHashMap — Map.of nulls не принимает) */
    static Map<String, Object> msgUpdateFrom(long chatId, String text, String first, String last, String username) {
        Map<String, Object> from = new java.util.LinkedHashMap<>();
        if (first != null) from.put("first_name", first);
        if (last != null) from.put("last_name", last);
        if (username != null) from.put("username", username);
        Map<String, Object> msg = new java.util.LinkedHashMap<>();
        msg.put("message_id", 77);
        msg.put("chat", Map.of("id", chatId));
        msg.put("from", from);
        msg.put("text", text);
        return Map.of("message", msg);
    }

    /* завершённая тренировка с одной записью — источник для «💾 В шаблоны» */
    static GymData limData() {
        GymData d = new GymData();
        d.nextId = 51;
        Workout done = w(null, null, true);
        done.id = 50;
        ex(done, "Жим", new SetEntry("60", 3, "10"));
        d.workouts.add(done);
        return d;
    }

    static Template tpl(int id, String name) {
        Template t = new Template();
        t.id = id;
        t.name = name;
        t.createdAt = "2026-11-0" + (1 + id % 8) + "T10:00:00";
        t.exercises.add(te("Жим", "60", 3, "10"));
        return t;
    }

    /* лимит 20: 19-й сохраняется с текстом «20 из 20», 21-й отказывает во всех трёх
       точках входа (кнопка «В шаблоны», ввод имени, кнопка «Авто-имя»), состояние не мутирует */
    static void runLimitScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymtplimit");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0);
            long chat = 9002;

            GymData d = limData();
            for (int i = 1; i <= 19; i++) d.templates.add(tpl(i, "Шаблон " + i));
            storage.save(chat, d);

            /* 19 → 20: диалог открывается, имя сохраняется, текст хвалит «20 из 20» */
            logic.handle(cbUpdate(chat, 10, "tpl:new_50"));
            UserState st = logic.states.get(chat);
            check(st.mode == UserState.Mode.TPL_NAME && st.editWorkoutId == 50,
                "лимит 19/20: tpl:new открывает диалог имени (TPL_NAME, editWorkoutId=50)");
            check(api.last().contains("Сохраним тренировку как шаблон"),
                "лимит 19/20: показан диалог «💾 Сохраним тренировку как шаблон»");
            logic.handle(msgUpdate(chat, "Спина и бицепс"));
            GymData after = storage.load(chat);
            check(after.templates.size() == 20, "лимит 19/20: сохранён ровно 20-й шаблон");
            check("Спина и бицепс".equals(after.templates.get(19).name) && after.templates.get(19).id == 20,
                "лимит 19/20: имя от пользователя, id = maxId+1 = 20");
            check(api.last().contains("✅ Шаблон «Спина и бицепс» сохранён (20 из 20)"),
                "лимит 19/20: текст подтверждения с счётчиком «20 из 20»");
            check(st.mode == UserState.Mode.MENU, "лимит 19/20: после сохранения режим MENU");

            /* 20/20: кнопка «💾 В шаблоны» — отказ до диалога, TPL_NAME не включается */
            logic.handle(cbUpdate(chat, 11, "tpl:new_50"));
            check(api.last().equals("Лимит — 20 шаблонов. Удали лишний: /templates"),
                "лимит 20/20: tpl:new отказывает текстом лимита");
            check(logic.states.get(chat).mode == UserState.Mode.MENU,
                "лимит 20/20: диалог имени не открывается (режим остался MENU)");

            /* 20/20: кнопка «🔤 Авто-имя» — отказ, шаблон не добавлен */
            logic.handle(cbUpdate(chat, 12, "tpl:auto_50"));
            check(api.last().equals("Лимит — 20 шаблонов. Удали лишний: /templates"),
                "лимит 20/20: tpl:auto отказывает текстом лимита");
            check(storage.load(chat).templates.size() == 20,
                "лимит 20/20: 21-й шаблон НЕ добавлен");

            /* 20/20: ввод имени в «зависшем» диалоге (режим открыт до исчерпания лимита) —
               отказ, состояние сбрасывается в MENU */
            UserState stale = logic.states.get(chat);
            stale.mode = UserState.Mode.TPL_NAME;
            stale.editWorkoutId = 50;
            logic.handle(msgUpdate(chat, "Ещё один шаблон"));
            check(api.last().equals("Лимит — 20 шаблонов. Удали лишний: /templates"),
                "лимит 20/20: ввод имени отказывает текстом лимита");
            check(stale.mode == UserState.Mode.MENU,
                "лимит 20/20: после отказа в имени режим сброшен в MENU");
            check(storage.load(chat).templates.size() == 20,
                "лимит 20/20: ввод имени не создаёт 21-й шаблон");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: лимит-сценарий " + e);
        }
    }

    /* мастер ввода: wk:add → выбор из каталога → вес (отказ на мусоре) → подходы
       (отказ на мусоре и 99) → повторения (отказ на длинном) → запись блока +
       запуск таймера; «готово» отменяет мастер без записи */
    static void runWizardScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymwizard");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0);
            long chat = 9001;

            GymData d = new GymData();
            d.nextId = 2;
            Workout active = w(null, null, false);
            active.id = 1;
            d.workouts.add(active);
            storage.save(chat, d);

            /* старт: каталог упражнений → выбор «Жим» (ex:i_0) */
            logic.handle(cbUpdate(chat, 10, "wk:add"));
            check(api.last().equals("Выбери упражнение:"), "мастер: wk:add показывает каталог");
            check(logic.states.get(chat).mode == UserState.Mode.WORKOUT, "мастер: после wk:add режим WORKOUT");
            logic.handle(cbUpdate(chat, 11, "ex:i_0"));
            UserState st = logic.states.get(chat);
            check(st.mode == UserState.Mode.EX_WEIGHT && "Жим".equals(st.currentExercise),
                "мастер: выбор упражнения → EX_WEIGHT, currentExercise=«Жим»");
            check(api.last().contains("«Жим» добавлено") && api.last().contains("Введи вес (кг)"),
                "мастер: экран ввода веса с пометкой «добавлено»");
            check(storage.load(chat).findById(1).exercises.size() == 1,
                "мастер: запись упражнения создана в активной тренировке");

            /* отмена из EX_WEIGHT: «готово» возвращает на экран тренировки, set не пишется */
            logic.handle(msgUpdate(chat, "готово"));
            st = logic.states.get(chat);
            check(st.mode == UserState.Mode.WORKOUT && st.currentExercise == null,
                "мастер: «готово» из EX_WEIGHT → экран тренировки (WORKOUT, currentExercise=null)");
            check(storage.load(chat).findById(1).exercises.get(0).sets.isEmpty(),
                "мастер: отмена до ввода — блоков нет");

            /* ввод веса: мусор отклоняется, валидный вес двигает в EX_SETS */
            logic.handle(cbUpdate(chat, 12, "wk:add"));
            logic.handle(cbUpdate(chat, 13, "ex:i_0"));
            st = logic.states.get(chat);
            check(st.mode == UserState.Mode.EX_WEIGHT && !api.last().contains("добавлено"),
                "мастер: повторный выбор существующего упражнения — без «добавлено»");
            logic.handle(msgUpdate(chat, "тяжело!!!"));
            check(api.last().contains("Не понял вес 🤔") && logic.states.get(chat).mode == UserState.Mode.EX_WEIGHT,
                "мастер: буквенный вес отклонён, режим EX_WEIGHT сохранён");
            logic.handle(msgUpdate(chat, "45"));
            st = logic.states.get(chat);
            check(st.mode == UserState.Mode.EX_SETS && "45".equals(st.pendingWeight),
                "мастер: «45» → EX_SETS, pendingWeight=45");
            check(api.last().contains("Вес: 45кг") && api.last().contains("Сколько подходов?"),
                "мастер: экран подходов показывает вес и вопрос");

            /* отмена из EX_SETS: «готово» — введённый вес не записывается */
            logic.handle(msgUpdate(chat, "готово"));
            check(logic.states.get(chat).mode == UserState.Mode.WORKOUT,
                "мастер: «готово» из EX_SETS → экран тренировки");
            check(storage.load(chat).findById(1).exercises.get(0).sets.isEmpty(),
                "мастер: отмена из EX_SETS — блоков нет");

            /* подходы: мусор и 99 отклоняются, 4 двигает в EX_REPS */
            logic.handle(cbUpdate(chat, 14, "wk:add"));
            logic.handle(cbUpdate(chat, 15, "ex:i_0"));
            logic.handle(msgUpdate(chat, "45"));
            logic.handle(msgUpdate(chat, "abc"));
            check(api.last().contains("Введи число подходов") && logic.states.get(chat).mode == UserState.Mode.EX_SETS,
                "мастер: нечисловые подходы отклонены");
            logic.handle(msgUpdate(chat, "99"));
            check(api.last().contains("Число подходов от 1 до 30") && logic.states.get(chat).mode == UserState.Mode.EX_SETS,
                "мастер: подходы вне 1..30 отклонены");
            logic.handle(msgUpdate(chat, "4"));
            st = logic.states.get(chat);
            check(st.mode == UserState.Mode.EX_REPS && st.pendingSets == 4,
                "мастер: «4» → EX_REPS, pendingSets=4");
            check(api.last().contains("подходов: 4") && api.last().contains("Сколько повторений?"),
                "мастер: экран повторений показывает вес/подходы и вопрос");

            /* повторения: длинная строка отклоняется, «12» завершает мастер записью */
            logic.handle(msgUpdate(chat, "01234567890123456"));
            check(api.last().contains("Введи количество повторений") && logic.states.get(chat).mode == UserState.Mode.EX_REPS,
                "мастер: повторения длиннее 15 символов отклонены");
            logic.handle(msgUpdate(chat, "12"));
            st = logic.states.get(chat);
            check(st.mode == UserState.Mode.WORKOUT, "мастер: запись завершает мастер (WORKOUT)");
            SetEntry written = storage.load(chat).findById(1).exercises.get(0).sets.get(0);
            check("45".equals(written.weight) && written.sets == 4 && "12".equals(written.reps),
                "мастер: записан блок 45 кг × 4 × 12");
            check(api.any("✅ Записано: Жим 45 кг, 4 подхода по 12 повторений"),
                "мастер: подтверждение записи с живым склонением");
            check(api.any("⏱ Отдых: 1:30"), "мастер: после записи запущен таймер отдыха 90 сек");

            /* итоговая тренировка живёт в данных как активная */
            check(storage.load(chat).active() != null && storage.load(chat).active().id == 1,
                "мастер: тренировка осталась активной после записи");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: мастер-ввод " + e);
        }
    }

    /* применение шаблона: tpl:start создаёт тренировку с планом из шаблона в каждой записи;
       при активной тренировке шаблон откладывается (pendingTplId) и применяется после
       «Удалить и начать новую» (wk:discard, §4.6); пустой шаблон и 1 упражнение */
    static void runApplyScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymtpapply");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0);
            long chat = 9003;

            GymData d = new GymData();
            d.nextId = 2;
            Workout hist = w(null, null, true);
            hist.id = 1;
            ex(hist, "Жим", new SetEntry("60", 3, "10"));
            d.workouts.add(hist);
            Template two = new Template();
            two.id = 1;
            two.name = "Спина и бицепс";
            two.createdAt = "2026-11-06T18:30:00";
            two.exercises.add(te("Тяга верхнего блока", "75-175", 3, "10"));
            two.exercises.add(te("Подтягивания", "", 4, "8"));
            d.templates.add(two);
            Template one = tpl(2, "Один");
            one.exercises.clear();
            one.exercises.add(te("Жим", "60", 5, "12"));
            d.templates.add(one);
            Template empty = new Template();
            empty.id = 3;
            empty.name = "Пустой";
            empty.createdAt = "2026-11-07T18:30:00";
            d.templates.add(empty);
            storage.save(chat, d);

            /* старт из шаблона с 2 упражнениями: план снимается в записи, id/nextId двигаются */
            logic.handle(cbUpdate(chat, 10, "tpl:start_1"));
            UserState st = logic.states.get(chat);
            GymData after = storage.load(chat);
            check(after.workouts.size() == 2 && after.findById(2) != null,
                "применение: создана новая тренировка id=2");
            check(after.nextId == 3, "применение: nextId увеличен до 3");
            Workout w2 = after.findById(2);
            check(!w2.finished && after.active() == w2, "применение: новая тренировка активна");
            check(w2.exercises.size() == 2
                    && "Тяга верхнего блока".equals(w2.exercises.get(0).name)
                    && "Подтягивания".equals(w2.exercises.get(1).name),
                "применение: упражнения шаблона в тренировке по порядку");
            check("75-175".equals(w2.exercises.get(0).planW) && w2.exercises.get(0).planS == 3
                    && "10".equals(w2.exercises.get(0).planR),
                "применение: план 1-й записи = план шаблона (75-175×3×10)");
            check("".equals(w2.exercises.get(1).planW) && w2.exercises.get(1).planS == 4
                    && "8".equals(w2.exercises.get(1).planR),
                "применение: блок без веса снимается как пустой план ×4×8");
            check(w2.exercises.get(0).sets.isEmpty() && w2.exercises.get(0).startedAt.equals(w2.startedAt),
                "применение: записи стартуют пустыми, время упражнения = времени тренировки");
            check(st.mode == UserState.Mode.WORKOUT && st.pendingTplId == 0 && st.editWorkoutId == 0,
                "применение: режим WORKOUT, отложенных/редактируемых id нет");
            check(api.last().startsWith("📋 Шаблон «Спина и бицепс» применён — 2 упражнения"),
                "применение: шапка с именем шаблона и счётчиком «2 упражнения»");

            /* старт при активной тренировке: шаблон «Один» (id=2) откладывается */
            logic.handle(cbUpdate(chat, 11, "tpl:start_2"));
            st = logic.states.get(chat);
            check(st.pendingTplId == 2 && api.last().contains("незавершённая тренировка от"),
                "применение: при активной — диалог конфликта, pendingTplId=2");
            check(storage.load(chat).workouts.size() == 2, "применение: конфликт — ничего не создано");

            /* «Удалить и начать новую» доустанавливает отложенный шаблон (§4.6) */
            logic.handle(cbUpdate(chat, 12, "wk:discard"));
            after = storage.load(chat);
            check(after.findById(2) == null && after.findById(3) != null,
                "применение: старая активная удалена, создана id=3");
            check(after.nextId == 4, "применение: nextId=4 после отложенного старта");
            Workout w3 = after.findById(3);
            check(w3.exercises.size() == 1 && "Жим".equals(w3.exercises.get(0).name)
                    && "60".equals(w3.exercises.get(0).planW) && w3.exercises.get(0).planS == 5
                    && "12".equals(w3.exercises.get(0).planR),
                "применение: отложенный «Один» применился (Жим 60×5×12)");
            check(logic.states.get(chat).pendingTplId == 0,
                "применение: pendingTplId сброшен после отложенного старта");

            /* шаблон с 1 упражнением — форма «1 упражнение» (после отмены активной) */
            logic.handle(cbUpdate(chat, 13, "wk:cancelok"));
            check(storage.load(chat).active() == null, "применение: активная отменена (wk:cancelok)");
            logic.handle(cbUpdate(chat, 14, "tpl:start_2"));
            check(api.last().startsWith("📋 Шаблон «Один» применён — 1 упражнение."),
                "применение: 1 упражнение — форма «1 упражнение»");

            /* пустой шаблон: тренировка создаётся без записей */
            logic.handle(cbUpdate(chat, 15, "wk:cancelok"));
            logic.handle(cbUpdate(chat, 16, "tpl:start_3"));
            after = storage.load(chat);
            Workout w5 = after.findById(after.workouts.get(after.workouts.size() - 1).id);
            check(w5.exercises.isEmpty() && after.active() == w5,
                "применение: пустой шаблон → активная тренировка без записей");
            check(api.last().startsWith("📋 Шаблон «Пустой» применён — 0 упражнений"),
                "применение: 0 упражнений — форма «0 упражнений»");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: применение шаблона " + e);
        }
    }

    /* [ANA-T1] счётчики шаблонов: tplSaved → templatesCreated; tpl:start и «Повторить»
       (оба едут через startFromTemplate) → templatesUsed. Счётчик — Stats во временном
       каталоге (6-й аргумент конструктора), файл stats.json перечитывается. */
    static void runStatsScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymtplstats");
            Storage storage = new Storage(tmp);
            Stats stats = new Stats(tmp.resolve("stats.json"));
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0, stats);
            long chat = 9003;

            GymData d = limData(); /* завершённая id=50 (Жим 60×3×10) — источник шаблона */
            d.templates.add(tpl(1, "Спина"));
            storage.save(chat, d);

            /* создание шаблона с вводом имени → templatesCreated */
            logic.handle(cbUpdate(chat, 10, "tpl:new_50"));
            logic.handle(msgUpdate(chat, "Мой шаблон"));
            check(storage.load(chat).templates.size() == 2, "stats: шаблон добавлен");
            check(Json.lng(stats.snapshot().get("templatesCreated")) == 1,
                "stats: tplSaved → templatesCreated=1");
            check(Json.lng(stats.snapshot().get("templatesUsed")) == 0,
                "stats: до старта templatesUsed=0");

            /* старт из сохранённого шаблона → templatesUsed */
            logic.handle(cbUpdate(chat, 11, "tpl:start_1"));
            check(Json.lng(stats.snapshot().get("templatesUsed")) == 1,
                "stats: tpl:start → templatesUsed=1");

            /* «Повторить прошлую» едет через startFromTemplate → тоже templatesUsed */
            logic.handle(cbUpdate(chat, 12, "wk:cancelok"));
            logic.handle(cbUpdate(chat, 13, "tpl:rep_50"));
            check(Json.lng(stats.snapshot().get("templatesUsed")) == 2,
                "stats: tpl:rep → templatesUsed=2");

            /* недельный агрегат зеркалит события; счётчики переживают перечитывание файла */
            Map<String, Object> snap = stats.snapshot();
            Map<String, Object> weeks = Json.map(snap.get("weeks"));
            check(weeks != null && weeks.size() == 1, "stats: одна текущая неделя в weeks");
            Map<String, Object> cur = weeks == null ? null : Json.map(weeks.values().iterator().next());
            check(cur != null && Json.lng(cur.get("templatesCreated")) == 1
                    && Json.lng(cur.get("templatesUsed")) == 2,
                "stats: недельный агрегат зеркалит шаблонные события");
            Stats reloaded = new Stats(tmp.resolve("stats.json"));
            check(Json.lng(reloaded.snapshot().get("templatesCreated")) == 1
                    && Json.lng(reloaded.snapshot().get("templatesUsed")) == 2,
                "stats: счётчики переживают перечитывание файла");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: stats-сценарий " + e);
        }
    }

    /* [ONB-T8] обратная связь: deep-link «/start feedback» включает режим, свободный текст
       уходит владельцу (chat id 555000111 — FakeApi.sendMessageResult пишет sentChats) с
       именем/username/chat_id и HTML-экранированием — и текста, и имени (спецсимволы в
       from без esc() ломали доставку: 400 can't parse entities); юзеру — подтверждение,
       режим сброшен; sentChats после двух циклов = [owner, owner]; отказ sendMessageResult —
       режим остаётся, счётчик feedbackSent не растёт; /cancel и /help отменяют режим без
       пересылки; GYM_OWNER_CHAT_ID не задан (5-арг конструктор, 0) — фича off, режим не
       включается. */
    static void runFeedbackScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymfeedback");
            Storage storage = new Storage(tmp);
            Stats stats = new Stats(tmp.resolve("stats.json"));
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0, stats, 555000111L);
            long chat = 9004;

            /* deep-link: Telegram присылает payload текстом «/start feedback» */
            logic.handle(msgUpdateFrom(chat, "/start feedback", "Иван", "Иванов", "ivan_user"));
            UserState st = logic.states.get(chat);
            check(st.mode == UserState.Mode.FEEDBACK, "feedback: deep-link включает режим FEEDBACK");
            check(api.last().equals("Опишите проблему одним сообщением. Отменить — /cancel"),
                "feedback: приглашение с подсказкой про /cancel");
            check(api.sentChats.isEmpty(), "feedback: до ввода текста владельцу ничего не уходит");

            /* свободный текст → пересылка владельцу (HTML-экранирование, паттерн /announce) */
            logic.handle(msgUpdateFrom(chat, "Падает <b>экран</b> & пропали шаблоны", "Иван", "Иванов", "ivan_user"));
            check(st.mode == UserState.Mode.MENU, "feedback: после отправки режим сброшен в MENU");
            check(api.sentChats.equals(List.of(555000111L)),
                "feedback: пересылка ушла в чат владельца (GYM_OWNER_CHAT_ID), и только туда");
            String owner = api.texts.get(api.texts.size() - 2); /* предпоследнее — письмо владельцу */
            check(owner.startsWith("💬 Обратная связь\nОт: Иван Иванов @ivan_user\nchat_id: 9004\n\n"),
                "feedback: шапка письма — имя + username + chat_id пользователя");
            check(owner.endsWith("Падает &lt;b&gt;экран&lt;/b&gt; &amp; пропали шаблоны"),
                "feedback: текст пользователя экранирован (HTML-режим sendMessage)");
            check(api.last().equals("Сообщение отправлено. Спасибо!"),
                "feedback: пользователю отправлено подтверждение");
            check(Json.lng(stats.snapshot().get("feedbackSent")) == 1,
                "feedback: счётчик feedbackSent=1 (агрегат, без ПДн)");

            /* повторный цикл с неполными данными from (только имя) */
            logic.handle(msgUpdateFrom(chat, "/start feedback", "Иван", null, null));
            check(logic.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback: повторный deep-link снова включает режим");
            logic.handle(msgUpdateFrom(chat, "Второе сообщение", "Иван", null, null));
            check(Json.lng(stats.snapshot().get("feedbackSent")) == 2,
                "feedback: счётчик feedbackSent=2 после второй отправки");
            String owner2 = api.texts.get(api.texts.size() - 2);
            check(owner2.equals("💬 Обратная связь\nОт: Иван\nchat_id: 9004\n\nВторое сообщение"),
                "feedback: без фамилии/username шапка только из имени, текст целиком");
            check(api.last().equals("Сообщение отправлено. Спасибо!"),
                "feedback: подтверждение после второй отправки");
            check(api.sentChats.equals(List.of(555000111L, 555000111L)),
                "feedback: два цикла — ровно две пересылки, обе владельцу (никому больше)");

            /* имя/username со спецсимволами: без esc() ломали HTML-письмо
               (инъекция тегов → Telegram 400 can't parse entities → недоставка) */
            logic.handle(msgUpdateFrom(chat, "/start feedback", "Иван <b>хак</b>", null, null));
            check(logic.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback: режим включён перед отправкой со спец-именем");
            logic.handle(msgUpdateFrom(chat, "Сообщение с <незакрытым> тегом", "Иван <b>хак</b>", null, null));
            String owner3 = api.texts.get(api.texts.size() - 2);
            check(owner3.startsWith("💬 Обратная связь\nОт: Иван &lt;b&gt;хак&lt;/b&gt;\nchat_id: 9004\n\n"),
                "feedback: имя со спецсимволами экранировано в письме (esc, паттерн /announce)");
            check(owner3.endsWith("Сообщение с &lt;незакрытым&gt; тегом"),
                "feedback: текст с <незакрытым> тегом тоже экранирован");
            check(api.last().equals("Сообщение отправлено. Спасибо!"),
                "feedback: подтверждение при спец-имени (доставка не сорвалась)");
            check(logic.states.get(chat).mode == UserState.Mode.MENU,
                "feedback: после отправки со спец-именем режим сброшен");

            /* /cancel отменяет режим штатно, пересылки нет */
            logic.handle(msgUpdateFrom(chat, "/start feedback", "Иван", null, null));
            check(logic.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback: режим включён перед отменой");
            logic.handle(msgUpdate(chat, "/cancel"));
            check(logic.states.get(chat).mode == UserState.Mode.MENU,
                "feedback: /cancel сбрасывает режим (команды обрабатываются раньше режима)");
            int ownerMsgs = api.sentChats.size();
            logic.handle(msgUpdate(chat, "Это сообщение уже не пересылка"));
            check(api.sentChats.size() == ownerMsgs,
                "feedback: после /cancel свободный текст владельцу не пересылается");

            /* /help тоже отменяет режим */
            logic.handle(msgUpdate(chat, "/start feedback"));
            check(logic.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback: режим включён перед проверкой /help");
            logic.handle(msgUpdate(chat, "/help"));
            check(logic.states.get(chat).mode == UserState.Mode.MENU,
                "feedback: /help отменяет режим");
            check(api.sentChats.size() == ownerMsgs,
                "feedback: /help не порождает пересылку");

            /* отказ доставки: sendMessageResult вернул ошибку — режим оставлен (юзер может
               повторить или отменить), вместо подтверждения — «Не удалось отправить…»,
               счётчик feedbackSent не растёт */
            java.nio.file.Path tmpFail = java.nio.file.Files.createTempDirectory("gymfeedbackfail");
            Stats statsFail = new Stats(tmpFail.resolve("stats.json"));
            FakeApi apiFail = new FakeApi();
            apiFail.failResult = "Bad Request: can't parse entities";
            BotLogic logicFail = new BotLogic(apiFail, new Storage(tmpFail), null, null, 0, statsFail, 555000111L);
            logicFail.handle(msgUpdateFrom(chat, "/start feedback", "Иван", null, null));
            check(logicFail.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback fail: режим включён перед отказом");
            logicFail.handle(msgUpdateFrom(chat, "Текст при отказе", "Иван", null, null));
            check(logicFail.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "feedback fail: при ошибке отправки режим остался FEEDBACK");
            check(apiFail.last().equals("Не удалось отправить, попробуй позже. Отменить — /cancel"),
                "feedback fail: юзер получил «Не удалось отправить…», а не подтверждение");
            check(Json.lng(statsFail.snapshot().get("feedbackSent")) == 0,
                "feedback fail: счётчик feedbackSent не растёт при ошибке доставки");
            check(apiFail.sentChats.equals(List.of(555000111L)),
                "feedback fail: попытка пересылки была адресована владельцу");

            /* фича off: GYM_OWNER_CHAT_ID не задан — режим не включается */
            java.nio.file.Path tmpOff = java.nio.file.Files.createTempDirectory("gymfeedbackoff");
            FakeApi apiOff = new FakeApi();
            BotLogic logicOff = new BotLogic(apiOff, new Storage(tmpOff), null, null, 0);
            logicOff.handle(msgUpdate(chat, "/start feedback"));
            check(logicOff.states.get(chat).mode == UserState.Mode.MENU,
                "feedback off: без GYM_OWNER_CHAT_ID режим не включается");
            check(apiOff.last().equals("Канал связи временно недоступен"),
                "feedback off: бот отвечает «Канал связи временно недоступен»");
            logicOff.handle(msgUpdate(chat, "любой свободный текст"));
            check(apiOff.sentChats.isEmpty(),
                "feedback off: никакие сообщения владельцу не уходят");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: feedback-сценарий " + e);
        }
    }

    /* [ANA-T10] источники привлечения: deep-link «/start <payload>» (?start=<src> из
       кампаний/пабликов, Telegram присылает payload текстом). Payload санитизируется
       (trim/lowercase/только [a-z0-9_]/длина ≤32) и считается в stats bucket startSrc —
       разбивка по источникам видна владельцу в /stats. Невалидный/пустой/без-пробела —
       без события; «/start feedback» уходит в feedback-ветку (раньше) и startSrc не пишет.
       Юзеру во всех случаях — обычное меню, как и без payload. Совместимость stats.json:
       старый файл без ключа читается (bucket пуст, ключ не пишется), файл с startSrc
       читается (мусорные ключи/значения пропускаются, валидные читаются). */
    static void runStartSrcScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymstartsrc");
            Storage storage = new Storage(tmp);
            Stats stats = new Stats(tmp.resolve("stats.json"));
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0, stats);
            long chat = 9005;

            /* валидные payload'ы: меню как обычно, события посчитаны */
            logic.handle(msgUpdate(chat, "/start vcru"));
            check(api.any("Мой дневник"), "startSrc: /start vcru — обычное меню");
            check(logic.states.get(chat).mode == UserState.Mode.MENU, "startSrc: режим MENU");
            logic.handle(msgUpdate(chat, "/start vcru"));
            logic.handle(msgUpdate(chat, "/START VCRU"));
            logic.handle(msgUpdate(chat, "/start Pikabu_2026"));
            Map<String, Object> snap = stats.snapshot();
            Map<String, Object> src = Json.map(snap.get("startSrc"));
            check(src != null && Json.lng(src.get("vcru")) == 3,
                "startSrc: vcru=3 (регистр и повторные запуски суммируются)");
            check(src != null && Json.lng(src.get("pikabu_2026")) == 1,
                "startSrc: pikabu_2026=1 ([a-z0-9_] валидны)");
            check(src != null && src.size() == 2, "startSrc: ровно 2 источника");

            /* без события: чистый /start, без пробела, два слова, длиннее 32, мусор, пустые */
            int before = src.size();
            long vcruBefore = Json.lng(src.get("vcru"));
            logic.handle(msgUpdate(chat, "/start"));
            logic.handle(msgUpdate(chat, "/startvcru"));
            logic.handle(msgUpdate(chat, "/start vcru extra"));
            logic.handle(msgUpdate(chat, "/start " + "a".repeat(33)));
            logic.handle(msgUpdate(chat, "/start bad-src!"));
            logic.handle(msgUpdate(chat, "/start    "));
            check(api.any("Мой дневник"), "startSrc: на все вариации — обычное меню");
            Map<String, Object> snap2 = stats.snapshot();
            Map<String, Object> src2 = Json.map(snap2.get("startSrc"));
            check(src2 != null && src2.size() == before, "startSrc: невалидные payload'ы не считаются");
            check(Json.lng(src2.get("vcru")) == vcruBefore, "startSrc: счётчик vcru не изменился");

            /* feedback обрабатывается раньше и в источники не попадает (6-арг конструктор:
               ownerChatId=0 — фича off, юзеру «Канал связи временно недоступен») */
            logic.handle(msgUpdate(chat, "/start feedback"));
            check(api.last().contains("Канал связи"), "startSrc: feedback-ветка отработала раньше /start-ветки");
            Map<String, Object> src3 = Json.map(stats.snapshot().get("startSrc"));
            check(src3 != null && src3.size() == before, "startSrc: feedback не попадает в источники");

            /* bucket переживает перечитывание файла */
            Stats reloaded = new Stats(tmp.resolve("stats.json"));
            Map<String, Object> srcR = Json.map(reloaded.snapshot().get("startSrc"));
            check(srcR != null && Json.lng(srcR.get("vcru")) == vcruBefore
                    && Json.lng(srcR.get("pikabu_2026")) == 1,
                "startSrc: bucket переживает перечитывание stats.json");

            /* совместимость: старый stats.json без ключа startSrc читается, ключ не пишется */
            java.nio.file.Path legacy = tmp.resolve("legacy-stats.json");
            java.nio.file.Files.writeString(legacy,
                "{\"maInit\":7,\"weeks\":{\"2026-W46\":{\"maInit\":3}}}");
            Stats legacyStats = new Stats(legacy);
            check(Json.lng(legacyStats.snapshot().get("maInit")) == 7,
                "startSrc: legacy stats.json — maInit читается");
            check(legacyStats.snapshot().get("startSrc") == null,
                "startSrc: legacy без ключа — пустой bucket и ключ не пишется");

            /* совместимость: мусорные записи пропускаются, валидные читаются */
            java.nio.file.Path junk = tmp.resolve("junk-stats.json");
            java.nio.file.Files.writeString(junk,
                "{\"maInit\":1,\"startSrc\":{\"BAD KEY\":5,\"ok\":2,\"num\":\"x\",\"UPPER\":3}}");
            Stats junkStats = new Stats(junk);
            Map<String, Object> jsrc = Json.map(junkStats.snapshot().get("startSrc"));
            check(jsrc != null && jsrc.size() == 1 && Json.lng(jsrc.get("ok")) == 2,
                "startSrc: мусорные ключи/значения пропускаются, валидные читаются");

            /* [ANA-T10 ревью] кап START_SRC_MAX на inc-пути: 200 разных источников заполняют
               bucket — новые валидные payload'ы молча не считаются, существующий
               инкрементируется */
            Stats capStats = new Stats(tmp.resolve("cap-stats.json"));
            for (int i = 0; i < 200; i++) capStats.incStartSrc("src" + i);
            capStats.incStartSrc("brand_new");
            capStats.incStartSrc("src5");
            Map<String, Object> srcCap = Json.map(capStats.snapshot().get("startSrc"));
            check(srcCap != null && srcCap.size() == 200, "startSrc: кап 200 — bucket не растёт сверх капа");
            check(Json.lng(srcCap.get("brand_new")) == 0, "startSrc: brand_new после капа не добавляется");
            check(Json.lng(srcCap.get("src5")) == 2, "startSrc: существующий источник после капа инкрементируется (1+1)");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: startSrc-сценарий " + e);
        }
    }

    /* [ANA-T11] активационные метрики «за вчера»: Storage.activationStats сканирует
       chat_*.json (толерантно: битый JSON — пользователь без тренировок, не падение);
       границы: «сегодня» не «вчера», finished=false не завершённая, date отсутствует;
       summaryText (HTML) содержит термины и числа N/M/K/L в ожидаемом формате. */
    static void runActivationScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymactiv");
            Storage storage = new Storage(tmp);
            java.time.LocalDate today = java.time.LocalDate.now();
            java.time.LocalDate yest = today.minusDays(1);
            final String Y = yest.toString(), T = today.toString();

            /* chat 1: вчера — завершённая (finished) + «сегодня» (не входит в «вчера») */
            GymData d1 = new GymData();
            Workout w1 = new Workout(); w1.date = Y; w1.finished = true; w1.startedAt = Y + "T09:00:00"; d1.workouts.add(w1);
            Workout w2 = new Workout(); w2.date = T; w2.finished = true; w2.startedAt = T + "T09:00:00"; d1.workouts.add(w2);
            storage.save(1, d1);
            /* chat 2: вчера — незавершённая (создал вчера, но не finished → completed не растёт) */
            GymData d2 = new GymData();
            Workout w3 = new Workout(); w3.date = Y; w3.finished = false; d2.workouts.add(w3);
            Workout w4 = new Workout(); w4.date = "2026-01-01"; w4.finished = true; d2.workouts.add(w4);
            storage.save(2, d2);
            /* chat 3: пустой workouts (создан файл, тренировок нет) */
            GymData d3 = new GymData();
            storage.save(3, d3);
            /* chat 4: workout без date (legacy/мусор в поле) — ever да, вчера нет */
            GymData d4 = new GymData();
            Workout w5 = new Workout(); w5.finished = true; d4.workouts.add(w5);
            storage.save(4, d4);
            /* chat 5: битый JSON — считается пользователем без тренировок */
            java.nio.file.Files.writeString(tmp.resolve("chat_5.json"), "{broken json");

            Storage.ActivationStats a = storage.activationStats(yest);
            check(a.usersTotal == 5, "activ: пользователей 5 (битый JSON считается, не-чат файл — нет)");
            check(a.usersEverWorkout == 3, "activ: с тренировками 3 (chats 1/2/4; пустой и битый — нет)");
            check(a.usersWorkoutYesterday == 2, "activ: создали вчера 2 (chats 1/2; «сегодня» и без date — нет)");
            check(a.workoutsCompletedYesterday == 1, "activ: завершено вчера 1 (chat 1 finished; chat 2 false; «сегодня» — нет)");

            /* пустой каталог data — нули */
            java.nio.file.Path empty = java.nio.file.Files.createTempDirectory("gymactiv-empty");
            Storage emptyStorage = new Storage(empty);
            Storage.ActivationStats a0 = emptyStorage.activationStats(yest);
            check(a0.usersTotal == 0 && a0.usersEverWorkout == 0 && a0.usersWorkoutYesterday == 0
                    && a0.workoutsCompletedYesterday == 0,
                "activ: пустой каталог — нули без падения");

            /* summaryText (HTML): активационный блок с числами и терминами */
            Map<String, Object> snap = new java.util.LinkedHashMap<>();
            snap.put("maInit", 10L);
            snap.put("maSave", 5L);
            snap.put("workoutsCreated", 2L);
            snap.put("workoutsCompleted", 1L);
            snap.put("templatesCreated", 0L);
            snap.put("templatesUsed", 0L);
            snap.put("feedbackSent", 0L);
            snap.put("landingViews", 0L);
            String txt = BotLogic.summaryText(snap, null, 4, 5, a);
            check(txt.contains("👥 Пользователи: <b>5</b> всего · <b>3</b> с тренировками · <b>2</b> создали вчера"),
                "activ: summaryText — пользователи N всего / M с тренировками / K создали вчера");
            check(txt.contains("✅ Завершено вчера: <b>1</b>"), "activ: summaryText — завершено вчера L");
            check(txt.contains("📊 <b>Ежедневная сводка</b>"), "activ: summaryText — шапка на месте");
            check(!txt.contains("null"), "activ: summaryText — без null-хвостов");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: activation-сценарий " + e);
        }
    }

    /* [UX-T33] клавиатура «Открыть приложение» убрана: при webAppUrl != null /start перед
        меню шлёт разовое сообщение с reply_keyboard_remove (снятие приклеенной у существующих
        пользователей клавиатуры); /menu ничего не снимает; deep-link «/start feedback»
        обрабатывается раньше /start и тоже не снимает; при webAppUrl == null (конфигурация
        всех прежних сценариев этого файла) снимающего вызова нет. Заодно проверяется новая
        подсказка меню («кнопка ☰ «🏋️ Дневник» … или команда /app») вместо старой
        «кнопка «🏋️ Открыть приложение» внизу». */
    static void runKeyboardRemoveScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymkbremove");
            Storage storage = new Storage(tmp);
            Stats stats = new Stats(tmp.resolve("stats.json"));
            long chat = 9005;

            /* a) /start при webAppUrl != null: сначала снятие клавиатуры, затем меню */
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, "https://example.org", null, 0, stats, 555000111L);
            logic.handle(msgUpdate(chat, "/start"));
            check(api.kbChats.equals(List.of(chat)),
                "клавиатура /start: снимающий вызов адресован чату пользователя");
            check(api.kbTexts.size() == 1,
                "клавиатура /start: ровно один вызов sendMessageWithKeyboard");
            check(api.kbTexts.get(0).contains("«🏋️ Дневник»") && api.kbTexts.get(0).contains("поля ввода"),
                "клавиатура /start: текст отсылает к кнопке ☰ «🏋️ Дневник» у поля ввода");
            check(Map.of("remove_keyboard", true).equals(api.kbMarkups.get(0)),
                "клавиатура /start: reply_markup = {remove_keyboard: true} (reply_keyboard_remove)");
            check(api.texts.size() == 2 && api.texts.get(0).equals(api.kbTexts.get(0))
                    && api.texts.get(1).startsWith("💪 Мой дневник тренировок"),
                "клавиатура /start: ровно два сообщения — сначала снятие, затем меню");
            String menu = api.texts.get(1);
            check(menu.contains("кнопка ☰ «🏋️ Дневник» у поля ввода или команда /app"),
                "клавиатура /start: в меню новая подсказка про приложение (команда /app)");
            check(!menu.contains("Открыть приложение"),
                "клавиатура /start: старая подсказка «Открыть приложение» из меню убрана");
            check(logic.states.get(chat).mode == UserState.Mode.MENU,
                "клавиатура /start: режим пользователя MENU");

            /* b) /menu при webAppUrl != null: только меню, ничего не снимается */
            FakeApi apiMenu = new FakeApi();
            BotLogic logicMenu = new BotLogic(apiMenu, storage, "https://example.org", null, 0, stats, 555000111L);
            logicMenu.handle(msgUpdate(chat, "/menu"));
            check(apiMenu.kbChats.isEmpty() && apiMenu.kbMarkups.isEmpty(),
                "клавиатура /menu: снимающего вызова sendMessageWithKeyboard нет");
            check(apiMenu.texts.size() == 1 && apiMenu.texts.get(0).startsWith("💪 Мой дневник тренировок"),
                "клавиатура /menu: отправлено только меню");

            /* c) /start при webAppUrl == null: снимающего вызова нет (регрессия прежних сценариев) */
            FakeApi apiNull = new FakeApi();
            BotLogic logicNull = new BotLogic(apiNull, storage, null, null, 0, stats, 555000111L);
            logicNull.handle(msgUpdate(chat, "/start"));
            check(apiNull.kbChats.isEmpty() && apiNull.kbMarkups.isEmpty(),
                "клавиатура null-ветка: снимающего вызова нет");
            check(apiNull.texts.size() == 1 && apiNull.texts.get(0).startsWith("💪 Мой дневник тренировок"),
                "клавиатура null-ветка: отправлено сразу меню");
            check(!apiNull.texts.get(0).contains("команда /app") && !apiNull.texts.get(0).contains("Дневник» у поля"),
                "клавиатура null-ветка: в меню нет подсказки про приложение");

            /* d) deep-link «/start feedback» при webAppUrl != null: deep-link обрабатывается
               раньше /start — снимающего сообщения нет, режим feedback включён */
            FakeApi apiFb = new FakeApi();
            BotLogic logicFb = new BotLogic(apiFb, storage, "https://example.org", null, 0, stats, 555000111L);
            logicFb.handle(msgUpdateFrom(chat, "/start feedback", "Иван", null, null));
            check(apiFb.kbChats.isEmpty() && apiFb.kbMarkups.isEmpty(),
                "клавиатура feedback: снимающего вызова нет (deep-link раньше /start)");
            check(logicFb.states.get(chat).mode == UserState.Mode.FEEDBACK,
                "клавиатура feedback: режим FEEDBACK включён");
            check(apiFb.last().equals("Опишите проблему одним сообщением. Отменить — /cancel"),
                "клавиатура feedback: приглашение без снятия клавиатуры");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: снятие клавиатуры " + e);
        }
    }

    /* [UX-S19 T51] механика возврата: чистая функция decideNotify — все триггеры,
       пороги, окна, суточный лимит; лестница реактивации 7/14/21 (+7 при cadence=1);
       молчание от завершённых/mtime; книга учёта (lastWid/stage/firstDone/лог ≤7).
       якорь дат: сегодня = 2026-11-09 (Пн, W46), окно 12:00 = «день» (дефолт). */
    static void runNotifyScenario() {
        LocalDate today = LocalDate.of(2026, 11, 9);
        LocalTime day = LocalTime.of(14, 0); /* внутри окна «день» 13–17 (дефолт) */
        long m24 = 25 * 3600000L;      /* mtime старше 24 ч (гард unf) */
        long m3d = 4 * BotLogic.DAY_MS; /* mtime старше 3 дней (гард cb) */
        try {
            /* --- окна отправки + тихие часы (§5.1): null = «день» --- */
            check(!BotLogic.notifyInWindow(null, LocalTime.of(12, 0)) && !BotLogic.notifyInWindow(null, LocalTime.of(12, 59)),
                "notify: до 13:00 окно «день» (дефолт) закрыто");
            check(BotLogic.notifyInWindow(null, LocalTime.of(13, 0)) && BotLogic.notifyInWindow(null, LocalTime.of(16, 59))
                    && !BotLogic.notifyInWindow(null, LocalTime.of(17, 0)),
                "notify: окно «день» 13:00–16:59");
            check(BotLogic.notifyInWindow(1, LocalTime.of(10, 0)) && BotLogic.notifyInWindow(1, LocalTime.of(12, 59))
                    && !BotLogic.notifyInWindow(1, LocalTime.of(13, 0)),
                "notify: окно «утро» 10:00–12:59");
            check(BotLogic.notifyInWindow(3, LocalTime.of(17, 0)) && BotLogic.notifyInWindow(3, LocalTime.of(20, 59))
                    && !BotLogic.notifyInWindow(3, LocalTime.of(21, 0)),
                "notify: окно «вечер» 17:00–20:59");
            check(!BotLogic.notifyInWindow(null, LocalTime.of(9, 59)) && !BotLogic.notifyInWindow(1, LocalTime.of(21, 0))
                    && !BotLogic.notifyInWindow(3, LocalTime.of(2, 0)),
                "notify: тихие часы 21:00–10:00 — отправок нет ни в каком окне");

            /* --- лестница реактивации (§5.3): 7/14/21, cadence=1 → 14/21/28 --- */
            check(BotLogic.notifyCbLevel(6, null) == 0 && BotLogic.notifyCbLevel(7, null) == 1
                    && BotLogic.notifyCbLevel(13, null) == 1 && BotLogic.notifyCbLevel(14, null) == 2
                    && BotLogic.notifyCbLevel(20, null) == 2 && BotLogic.notifyCbLevel(21, null) == 3
                    && BotLogic.notifyCbLevel(90, null) == 3,
                "notify: уровни 0/1/2/3 по порогам 7/14/21");
            check(BotLogic.notifyCbLevel(13, 1) == 0 && BotLogic.notifyCbLevel(14, 1) == 1
                    && BotLogic.notifyCbLevel(21, 1) == 2 && BotLogic.notifyCbLevel(28, 1) == 3,
                "notify: cadence=1 сдвигает пороги на +7 (14/21/28, решение 6 §17)");
            check(BotLogic.notifyCbLevel(14, 3) == 2 && BotLogic.notifyCbLevel(14, null) == 2,
                "notify: cadence ≥2/null — базовые пороги");

            /* --- молчание: от последней завершённой; незавершённая не считается --- */
            GymData sil = new GymData();
            Workout fin1 = w("2026-11-01T10:00:00", "2026-11-01T11:00:00", true);
            fin1.date = "2026-11-02";
            Workout hang = w("2026-11-07T10:00:00", null, false);
            sil.workouts.add(fin1);
            sil.workouts.add(hang);
            check(BotLogic.notifySilenceDays(sil, today, m24) == 7,
                "notify: молчание 7 дней от последней завершённой, висящая не считается");
            GymData noFin = new GymData();
            check(BotLogic.notifySilenceDays(noFin, today, 8 * BotLogic.DAY_MS) == 8,
                "notify: нет завершённых — молчание от mtime файла");

            /* --- суточный лимит (§2.1) --- */
            GymData sent = new GymData();
            sent.notifyLog.add(new NotifyMark("2026-11-09", "unf"));
            check(BotLogic.notifySentToday(sent, today) && !BotLogic.notifySentToday(new GymData(), today),
                "notify: отметка сегодня блокирует повтор, вчера — нет");
            GymData sentY = new GymData();
            sentY.notifyLog.add(new NotifyMark("2026-11-08", "cb"));
            check(!BotLogic.notifySentToday(sentY, today), "notify: запись вчера не блокирует сегодня");

            /* --- [first] событие вне очереди: окон/мастера/лимита не смотрит (§3) --- */
            GymData f = new GymData();
            Workout fw = w("2026-11-05T10:00:00", "2026-11-05T11:00:00", true);
            fw.date = "2026-11-06";
            f.workouts.add(fw);
            check("first".equals(BotLogic.decideNotify(f, today, LocalTime.of(3, 0), 1, m3d)),
                "notify: first — единственная завершённая ≤7 дней, ночное время и мастер не важны");
            f.notifyMaster = false;
            f.notifyLog.add(new NotifyMark("2026-11-09", "unf"));
            check("first".equals(BotLogic.decideNotify(f, today, day, 1, m3d)),
                "notify: first не глушится мастер-тоглом и суточным лимитом (событие §2.6)");
            GymData fOld = new GymData();
            Workout old = w("2026-10-01T10:00:00", "2026-10-01T11:00:00", true);
            old.date = "2026-10-01";
            fOld.workouts.add(old);
            /* cb выключаем: легаси-молчун — законная цель реактивации (winback §17-8);
               здесь проверяем именно first: старая дата → поздравления нет */
            fOld.notifyComeback = false;
            check(BotLogic.decideNotify(fOld, today, day, 1, m3d) == null,
                "notify: легаси (первая завершена давно) — first не срабатывает (§10)");
            GymData fDone = new GymData();
            Workout fw2 = w("2026-11-05T10:00:00", "2026-11-05T11:00:00", true);
            fw2.date = "2026-11-06";
            fDone.workouts.add(fw2);
            fDone.firstDone = true;
            fDone.notifyDigest = false; /* понедельник с завершённой на прошлой неделе — это dg, изолируем first */
            check(BotLogic.decideNotify(fDone, today, day, 1, m3d) == null,
                "notify: firstDone=true — второго «первого раза» нет (§10)");

            /* --- мастер-тогл / лимит / окно гасят 4 проактивных типа --- */
            GymData m = new GymData();
            m.notifyMaster = false;
            m.workouts.add(hang2());
            check(BotLogic.decideNotify(m, today, day, 1, m24) == null,
                "notify: мастер выкл — все 4 проактивных типа молчат");
            GymData lim = new GymData();
            lim.workouts.add(hang2());
            lim.notifyLog.add(new NotifyMark("2026-11-09", "dg"));
            check(BotLogic.decideNotify(lim, today, day, 1, m24) == null,
                "notify: отправляли сегодня — тишина до завтра (1/день §2.1)");
            GymData night = new GymData();
            night.workouts.add(hang2());
            check(BotLogic.decideNotify(night, today, LocalTime.of(23, 30), 1, m24) == null,
                "notify: тихие часы — ни одной отправки");

            /* --- [unf] незавершённая (§5.2): дата ≤ вчера + mtime ≥24 ч + не писали --- */
            check("unf".equals(BotLogic.decideNotify(unfData("2026-11-08"), today, day, 1, m24)),
                "notify: незавершённая от вчера с mtime 25 ч → unf");
            check(BotLogic.decideNotify(unfData("2026-11-08"), today, day, 1, 2 * 3600000L) == null,
                "notify: юзер трогал данные <24 ч — unf не приходит (§5.2)");
            check(BotLogic.decideNotify(unfData("2026-11-09"), today, day, 1, m24) == null,
                "notify: сегодняшняя незавершённая не триггерит (висит < суток)");
            GymData wW = unfData("2026-11-08");
            wW.notifyLastWid = 5L;
            check(BotLogic.decideNotify(wW, today, day, 1, m24) == null,
                "notify: про эту тренировку уже писали (lastWid) — одного сообщения на тренировку");
            GymData wOff = unfData("2026-11-08");
            wOff.notifyUnfinished = false;
            check(BotLogic.decideNotify(wOff, today, day, 1, m24) == null,
                "notify: notifyUnfinished=false — про незавершённую не пишем");

            /* --- [goal] воскресенье + активные цели (§7) --- */
            check("goal".equals(BotLogic.decideNotify(goalData(), today, day, 7, m3d)),
                "notify: воскресенье + активная цель → чек-ин");
            check(BotLogic.decideNotify(goalData(), today, day, 1, m3d) == null,
                "notify: не воскресенье — чек-ина нет");
            GymData gOff = goalData();
            gOff.goalRemind = false;
            check(BotLogic.decideNotify(gOff, today, day, 7, m3d) == null,
                "notify: goalRemind=false — чек-ин выключен");
            GymData gEmpty = goalData();
            gEmpty.goals.get(0).status = 2;
            check(BotLogic.decideNotify(gEmpty, today, day, 7, m3d) == null,
                "notify: нет активных целей — сообщение не отправляется (GOA §6.1)");

            /* --- [dg] понедельник + ≥1 завершённой за прошлую ISO-неделю (§8) --- */
            check("dg".equals(BotLogic.decideNotify(dgData(), today, day, 1, m3d)),
                "notify: понедельник + завершённая на прошлой неделе → дайджест");
            check(BotLogic.decideNotify(dgData(), today, day, 3, m3d) == null,
                "notify: дайджест только в понедельник");
            /* E1 (0 завершённых за ПРОШЛУЮ неделю — молчим) изолируем от триггеров unf/cb:
               тренировка завершена две недели назад (вне окна недели), юзер активен (mtime <3 д) */
            GymData dg0 = dgData();
            dg0.workouts.get(0).date = "2026-10-29";
            check(BotLogic.decideNotify(dg0, today, day, 1, m24) == null,
                "notify: 0 завершённых за неделю — молчим (E1 ANA-S2)");
            GymData dgOff = dgData();
            dgOff.notifyDigest = false;
            check(BotLogic.decideNotify(dgOff, today, day, 1, m3d) == null,
                "notify: notifyDigest=false — итоги выключены");

            /* --- [cb] реактивация: stage/молчание/активность (§5.3) --- */
            GymData cb = new GymData(); /* нулевая история: молчание от mtime */
            check("cb".equals(BotLogic.decideNotify(cb, today, day, 3, 8 * BotLogic.DAY_MS)),
                "notify: нулевая история, mtime 8 дней → реактивация уровня 1");
            check(BotLogic.decideNotify(cb, today, day, 3, 2 * BotLogic.DAY_MS) == null,
                "notify: юзер активен (<3 дней) — реактивация не нужна");
            GymData cb2 = new GymData();
            cb2.notifyStage = 1;
            check(BotLogic.decideNotify(cb2, today, day, 3, 8 * BotLogic.DAY_MS) == null,
                "notify: stage=1, молчание 8 (уровень 1) — повтора нет");
            GymData cb90 = new GymData(); /* молчун с релиза: одно «последнее» сразу */
            check("cb".equals(BotLogic.decideNotify(cb90, today, day, 3, 90 * BotLogic.DAY_MS)),
                "notify: молчание 90 дней при stage=0 → сразу уровень 3 (одно сообщение)");
            GymData cbOff = new GymData();
            cbOff.notifyComeback = false;
            check(BotLogic.decideNotify(cbOff, today, day, 3, 90 * BotLogic.DAY_MS) == null,
                "notify: notifyComeback=false — без реактивации");
            GymData cbCad = new GymData();
            cbCad.cadence = 1;
            check(BotLogic.decideNotify(cbCad, today, day, 3, 8 * BotLogic.DAY_MS) == null,
                "notify: cadence=1 — 8 дней молчания его норма, уровня 1 нет (порог 14)");

            /* --- приоритет внутри дня (§3): unf важнее cb --- */
            GymData both = new GymData();
            both.workouts.add(hang2());
            check("unf".equals(BotLogic.decideNotify(both, today, day, 3, 90 * BotLogic.DAY_MS)),
                "notify: готовы unf и cb — отправится unf (приоритет §3)");

            /* --- книга учёта notifyMark (§12.1): lastWid / stage / firstDone / трим --- */
            GymData book = unfData("2026-11-08");
            BotLogic.notifyMark(book, "unf", today, m24);
            check(book.notifyLastWid != null && book.notifyLastWid == 5L,
                "notify: после unf lastWid = id тренировки");
            GymData bookCb = new GymData();
            BotLogic.notifyMark(bookCb, "cb", today, 8 * BotLogic.DAY_MS);
            check(bookCb.notifyStage != null && bookCb.notifyStage == 1,
                "notify: после cb stage = отправленный уровень");
            GymData bookF = new GymData();
            BotLogic.notifyMark(bookF, "first", today, m24);
            check(Boolean.TRUE.equals(bookF.firstDone), "notify: после first firstDone=true");
            for (int i = 0; i < 9; i++) bookF.notifyLog.add(new NotifyMark("2026-11-0" + (i % 9 + 1), "cb"));
            check(bookF.notifyLog.size() == 10, "notify: подготовка трима (1 + 9 записей)");
            BotLogic.notifyMark(bookF, "cb", today, m24);
            check(bookF.notifyLog.size() == 7 && today.toString().equals(bookF.notifyLog.get(6).d)
                    && "cb".equals(bookF.notifyLog.get(6).t),
                "notify: лог триммируется до 7, последняя запись — сегодняшняя");

            /* --- реакция на напоминание (§13): завершение в течение суток после наджа --- */
            java.nio.file.Path tmpN = java.nio.file.Files.createTempDirectory("gymnotify");
            Stats stN = new Stats(tmpN.resolve("stats.json"));
            GymData react = new GymData();
            react.notifyLog.add(new NotifyMark("2026-11-09", "unf"));
            react.notifyLog.add(new NotifyMark("2026-11-07", "cb"));
            BotLogic.notifyReacted(react, stN, today);
            check(Json.lng(stN.snapshot().get("notifyReactedUnf")) == 1
                    && Json.lng(stN.snapshot().get("notifyReactedRc")) == 0,
                "notify: среагировал на unf (запись сегодня) — cb от 3 дней назад не считается");
            GymData react2 = new GymData();
            react2.notifyLog.add(new NotifyMark("2026-11-08", "dg"));
            BotLogic.notifyReacted(react2, stN, today);
            check(Json.lng(stN.snapshot().get("notifyReactedDigest")) == 1,
                "notify: вчерашняя отметка тоже считается реакцией (≤24 ч, дата-гранулярность)");

            /* --- ключ ISO-недели для лога (§6.6) --- */
            check("2026-W46".equals(BotLogic.notifyWeekKey(today)), "notify: 09.11.2026 — понедельник W46");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: notify-сценарий " + e);
        }
    }

    /* активная незавершённая тренировка id=5 от указанной даты (для unf) */
    static Workout hang2() {
        Workout wk = w("2026-11-08T10:00:00", null, false);
        wk.id = 5;
        wk.date = "2026-11-08";
        ex(wk, "Жим", new SetEntry("60", 3, "10"));
        return wk;
    }

    /* [UX-S19 T53] бот-часть механики: тексты/клавиатуры/экран/отписки/финиш. Тексты —
       дословно из §4 (владелец утвердил 25.11): даты-длины в коридоре 60–100, стоп-слова
       стыда отсутствуют; чек-ин собирается из целей (e1RM 80×6=96 — ровно как в примере
       спеки); отписка пишет поле, снимает кнопки, отвечает §4.6; /notify — тоглы §4.7 */
    static void runNotifyBotScenario() {
        LocalDate today = LocalDate.of(2026, 11, 9);
        long m3d = 4 * BotLogic.DAY_MS;
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymnotifybot");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0);
            long chat = 9042;

            /* --- текст unf (§4.1): дата в формате истории «24-11» --- */
            String unfText = BotLogic.notifyText("unf", unfData("2026-11-08"), today, m3d);
            check(unfText != null && unfText.equals(
                    "🏋️ Тренировка от 08-11 осталась незавершённой. Жизнь бывает насыщенной — допишешь сегодня?"),
                "notify: текст unf дословно §4.1 (дата dd-MM)");

            /* --- тексты cb (§4.2): по факту молчания, нулевая история; молчание — от
                последней ЗАВЕРШЁННОЙ, поэтому дата тренировки задаёт «сколько молчит» --- */
            GymData cb8 = new GymData();
            Workout cbw = w("2026-11-01T10:00:00", "2026-11-01T11:00:00", true);
            cbw.date = "2026-11-01";
            cb8.workouts.add(cbw);
            check(BotLogic.notifyText("cb", cb8, today, 8 * BotLogic.DAY_MS).equals(
                    "👋 Неделя без тренировок. Может, сегодня тот самый день? Один подход — уже победа."),
                "notify: cb день 7 — «неделя» (§4.2)");
            GymData cb15 = new GymData();
            Workout cbw15 = w("2026-10-25T10:00:00", "2026-10-25T11:00:00", true);
            cbw15.date = "2026-10-25";
            cb15.workouts.add(cbw15);
            check(BotLogic.notifyText("cb", cb15, today, 15 * BotLogic.DAY_MS).equals(
                    "Две недели без зала — бывает. Начать снова — самое трудное, дальше само пойдёт 💪"),
                "notify: cb день 14 — «две недели»");
            GymData cb22 = new GymData();
            Workout cbw22 = w("2026-10-18T10:00:00", "2026-10-18T11:00:00", true);
            cbw22.date = "2026-10-18";
            cb22.workouts.add(cbw22);
            check(BotLogic.notifyText("cb", cb22, today, 22 * BotLogic.DAY_MS).equals(
                    "Прошло три недели. Это последнее напоминание — не хочу быть спамером. Дневник никуда не уйдёт 🙏"),
                "notify: cb день 21 — «последнее»");
            check(BotLogic.notifyText("cb", new GymData(), today, 8 * BotLogic.DAY_MS).equals(
                    "Первая тренировка — самая важная. 15 минут сегодня лучше идеального плана завтра 💪"),
                "notify: cb день 7 нулевой истории — «первая тренировка» (§4.2)");

            /* --- ревью PR #417: границы текстов едут вместе с порогами лестницы (cadence=1
                → 14/21/28) — «последнее» приходит ровно один раз, на закрывающей ступени;
                раньше день 21 давал «последнее» при ещё открытой ступени 28 (двойное обещание) --- */
            GymData cbC21 = new GymData();
            cbC21.cadence = 1;
            Workout cbwC21 = w("2026-10-19T10:00:00", "2026-10-19T11:00:00", true);
            cbwC21.date = "2026-10-19";
            cbC21.workouts.add(cbwC21);
            String cad21 = BotLogic.notifyText("cb", cbC21, today, 21 * BotLogic.DAY_MS);
            check(cad21 != null && !cad21.contains("последнее") && cad21.equals(
                    "Две недели без зала — бывает. Начать снова — самое трудное, дальше само пойдёт 💪"),
                "notify: cadence=1 день 21 — ещё НЕ «последнее» (уровень 2, порог 28)");
            GymData cbC28 = new GymData();
            cbC28.cadence = 1;
            Workout cbwC28 = w("2026-10-12T10:00:00", "2026-10-12T11:00:00", true);
            cbwC28.date = "2026-10-12";
            cbC28.workouts.add(cbwC28);
            check(BotLogic.notifyText("cb", cbC28, today, 28 * BotLogic.DAY_MS).equals(
                    "Прошло три недели. Это последнее напоминание — не хочу быть спамером. Дневник никуда не уйдёт 🙏"),
                "notify: cadence=1 день 28 — «последнее» (закрывающая ступень)");

            /* --- коридор 60–100 символов для наджей + стоп-слова стыда (§14) --- */
            String[] nudges = {
                BotLogic.notifyText("unf", unfData("2026-11-08"), today, m3d),
                BotLogic.notifyText("cb", cb8, today, 8 * BotLogic.DAY_MS),
                BotLogic.notifyText("cb", cb15, today, 15 * BotLogic.DAY_MS),
                BotLogic.notifyText("cb", cb22, today, 22 * BotLogic.DAY_MS),
                BotLogic.notifyText("cb", new GymData(), today, 8 * BotLogic.DAY_MS)
            };
            for (String t : nudges) {
                check(t.length() >= 60 && t.length() <= 100,
                    "notify: надж в коридоре 60–100, длина " + (t == null ? -1 : t.length()));
                String low = t.toLowerCase();
                check(!low.contains("пропал") && !low.contains("забросил") && !low.contains("сорвёш") && !low.contains("провал"),
                    "notify: без слов вины/страха (§2.5)");
            }

            /* --- чек-ин по целям (§4.3): e1RM 80 кг × 6 = 96 — цифры примера спеки --- */
            GymData gd = new GymData();
            Workout gw = w("2026-11-05T10:00:00", "2026-11-05T11:00:00", true);
            gw.date = "2026-11-05";
            ex(gw, "Жим", new SetEntry("80", 3, "6"));
            gd.workouts.add(gw);
            Goal g1 = new Goal();
            g1.id = 1; g1.type = 1; g1.exercise = "Жим"; g1.target = 100; g1.status = 1;
            g1.end = "2026-12-31";
            gd.goals.add(g1);
            Goal g2 = new Goal();
            g2.id = 2; g2.type = 2; g2.target = 12; g2.status = 1;
            g2.start = "2026-11-01"; g2.end = "2026-11-30";
            gd.goals.add(g2);
            String goalText = BotLogic.notifyGoalText(gd, today);
            check(goalText.startsWith("🎯 Чек-ин по целям"), "notify: чек-ин — заголовок");
            check(goalText.contains("1. Жим — e1RM 100 кг"), "notify: силовая — заголовок цели");
            check(goalText.contains("96 из 100 кг (96%). Осталось 4 кг, до 31.12 — 7 недель."),
                "notify: силовая — прогресс и срок (e1RM 80×6=96)");
            check(goalText.contains("2. 12 тренировок до 30.11"),
                "notify: частота — заголовок со сроком (без недель, §4.3)");
            check(goalText.contains("1 из 12 (8%). Нужно ещё 11, до 30.11 — 3 недели."),
                "notify: частота — прогресс (1 завершённая в окне)");
            check(goalText.endsWith("Маленький шаг на этой неделе — и ты ближе 💪"),
                "notify: финальная строка — «ты» (решение 1 §17)");
            check(BotLogic.notifyGoalText(new GymData(), today) == null,
                "notify: нет активных целей — чек-ина нет (GOA §6.1)");

            /* --- клавиатуры (§4.1–4.3): существующие флоу + отписка; «последнее» без 🔕 --- */
            List<List<Map<String, Object>>> kUnf = logic.notifyKb("unf", unfData("2026-11-08"), today, m3d);
            check(kUnf.size() == 2 && "wk:resume".equals(Json.str(kUnf.get(0).get(0), "callback_data"))
                    && "ntf:offunf".equals(Json.str(kUnf.get(1).get(0), "callback_data")),
                "notify: kb unf — Продолжить + отписка (wk:resume/ntf:offunf)");
            check(kUnf.get(0).get(0).get("text").equals("▶️ Продолжить тренировку")
                    && kUnf.get(1).get(0).get("text").equals("🔕 Не напоминать"),
                "notify: kb unf — подписи кнопок дословно §4.1");
            List<List<Map<String, Object>>> kCb8 = logic.notifyKb("cb", new GymData(), today, 8 * BotLogic.DAY_MS);
            check(kCb8.size() == 2 && "menu:start".equals(Json.str(kCb8.get(0).get(0), "callback_data"))
                    && "ntf:offcb".equals(Json.str(kCb8.get(1).get(0), "callback_data")),
                "notify: kb cb день 7/14 — Начать + отписка");
            List<List<Map<String, Object>>> kCb90 = logic.notifyKb("cb", new GymData(), today, 90 * BotLogic.DAY_MS);
            check(kCb90.size() == 1 && "menu:start".equals(Json.str(kCb90.get(0).get(0), "callback_data")),
                "notify: kb «последнее» (≥21) — без отписки (§4.2)");
            /* ревью PR #417: граница отписки — закрывающая ступень лестницы, не константа 21:
               cadence=1 день 21 — НЕ последнее, отписка на месте (§2.4 под каждым сообщением) */
            List<List<Map<String, Object>>> kCbC21 = logic.notifyKb("cb", cbC21, today, 21 * BotLogic.DAY_MS);
            check(kCbC21.size() == 2 && "menu:start".equals(Json.str(kCbC21.get(0).get(0), "callback_data"))
                    && "ntf:offcb".equals(Json.str(kCbC21.get(1).get(0), "callback_data")),
                "notify: kb cadence=1 день 21 — Начать + отписка (сообщение ещё будет)");
            List<List<Map<String, Object>>> kCbC28 = logic.notifyKb("cb", cbC28, today, 28 * BotLogic.DAY_MS);
            check(kCbC28.size() == 1 && "menu:start".equals(Json.str(kCbC28.get(0).get(0), "callback_data")),
                "notify: kb cadence=1 день 28 — «последнее» без отписки");
            List<List<Map<String, Object>>> kGoal = logic.notifyKb("goal", gd, today, m3d);
            check(kGoal.size() == 1 && "ntf:offgoal".equals(Json.str(kGoal.get(0).get(0), "callback_data")),
                "notify: kb goal без webAppUrl/appLink — только отписка (ряда приложения нет, §4.4)");
            Map<?, ?> wab = (Map<?, ?>) TelegramApi.webAppButton("📱 Открыть приложение", "https://app.example").get("web_app");
            check(wab != null && "https://app.example".equals(wab.get("url")),
                "notify: webAppButton — web_app-клавиша с url (§8)");

            /* --- /notify экран (§4.7): команда, тоглы, цикл времени, мастер --- */
            storage.save(chat, gd);
            logic.handle(msgUpdate(chat, "/notify"));
            check(api.last().startsWith("🔔 <b>Напоминания</b>")
                    && api.last().contains("• Незавершённая тренировка — вкл")
                    && api.last().contains("• Чек-ин по целям (вс) — вкл")
                    && api.last().contains("Когда напоминать: <b>днём</b> (UTC+3)"),
                "notify: /notify — экран §4.7 (дефолты вкл, днём)");
            logic.handle(cbUpdate(chat, 55, "ntf:unf"));
            check(storage.load(chat).notifyUnfinished == Boolean.FALSE
                    && api.last().contains("• Незавершённая тренировка — выкл"),
                "notify: тап ntf:unf — поле выключено, экран перерисовался");
            logic.handle(cbUpdate(chat, 55, "ntf:unf"));
            check(storage.load(chat).notifyUnfinished == Boolean.TRUE,
                "notify: повторный тап — возврат (null/true = вкл, §12.1)");
            logic.handle(cbUpdate(chat, 55, "ntf:when"));
            check(storage.load(chat).notifyWhen != null && storage.load(chat).notifyWhen == 3
                    && api.last().contains("Когда напоминать: <b>вечером</b> (UTC+3)"),
                "notify: ntf:when — цикл днём→вечером (§4.7)");
            logic.handle(cbUpdate(chat, 55, "ntf:master"));
            List<List<Map<String, Object>>> lastKb = api.editKbs.get(api.editKbs.size() - 1);
            check(storage.load(chat).notifyMaster == Boolean.FALSE
                    && "🔔 Включить всё".equals(lastKb.get(0).get(0).get("text")),
                "notify: мастер выкл — строка 1 становится «Включить всё»");
            logic.handle(cbUpdate(chat, 55, "ntf:master"));
            check(storage.load(chat).notifyMaster == Boolean.TRUE,
                "notify: мастер вернул — true пишется явно (§12.1)");

            /* --- отписка в один тап (§4.6): поле, снятие кнопок, ответ --- */
            GymData offData = storage.load(chat);
            offData.notifyStage = 2;
            offData.notifyLog.add(new NotifyMark(BotLogic.notifyToday().toString(), "unf"));
            storage.save(chat, offData);
            logic.handle(cbUpdate(chat, 55, "ntf:offcb"));
            GymData afterOff = storage.load(chat);
            check(afterOff.notifyComeback == Boolean.FALSE && afterOff.notifyStage != null && afterOff.notifyStage == 2,
                "notify: отписка cb — поле false, книга не тронута");
            check(api.any("[removed-kb:55]") && api.any("Хорошо, про это больше не пишу 👌")
                    && api.any("Вернуть: /notify или в приложении — ⚙️ Настройки → Уведомления."),
                "notify: отписка — кнопки сняты, ответ §4.6");
            logic.handle(cbUpdate(chat, 56, "digest:off"));
            check(storage.load(chat).notifyDigest == Boolean.FALSE
                    && api.any("Хорошо, итоги недели больше не приходят 👌")
                    && api.any("Вернуть: /digest — покажу последнюю сводку и включу отправку."),
                "notify: digest:off — текст ANA-S2 (§4.6)");
            logic.handle(cbUpdate(chat, 57, "ntf:offgoal"));
            check(storage.load(chat).goalRemind == Boolean.FALSE,
                "notify: offgoal — пишет СУЩЕСТВУЮЩЕЕ поле goalRemind (§7)");

            /* --- финиш: строка «первая», книга, reacted, сброс лестницы (§10/§13/§5.3) --- */
            java.nio.file.Path tmp2 = java.nio.file.Files.createTempDirectory("gymnotifyfin");
            Storage storage2 = new Storage(tmp2);
            Stats st2 = new Stats(tmp2.resolve("stats.json"));
            FakeApi api2 = new FakeApi();
            BotLogic logic2 = new BotLogic(api2, storage2, null, null, 0, st2);
            long chat2 = 9043;
            GymData fin = new GymData();
            Workout act = w(null, null, false);
            act.id = 9;
            ex(act, "Жим", new SetEntry("60", 3, "10"));
            fin.workouts.add(act);
            fin.notifyStage = 2;
            fin.notifyLog.add(new NotifyMark(BotLogic.notifyToday().toString(), "unf"));
            storage2.save(chat2, fin);
            logic2.handle(cbUpdate(chat2, 66, "wk:finish"));
            GymData finAfter = storage2.load(chat2);
            check(api2.last().contains("🏅 Первая тренировка в дневнике — с неё всё начинается. Дальше легче 💪"),
                "notify: финиш первой — строка §4.5 в сообщении завершения");
            check(finAfter.firstDone == Boolean.TRUE && finAfter.workouts.get(0).finished,
                "notify: финиш первой — firstDone в книге, тренировка завершена");
            check(finAfter.notifyStage != null && finAfter.notifyStage == 0,
                "notify: новая завершённая обнуляет лестницу (§5.3)");
            check(Json.lng(st2.snapshot().get("notifyReactedUnf")) == 1,
                "notify: reacted — завершение в сутки после наджа unf (§13)");
            /* вторая тренировка не «первая»: firstDone=true — строки нет */
            GymData fin2 = storage2.load(chat2);
            Workout act2 = w(null, null, false);
            act2.id = 10;
            ex(act2, "Присед", new SetEntry("80", 3, "8"));
            fin2.workouts.add(act2);
            storage2.save(chat2, fin2);
            logic2.handle(cbUpdate(chat2, 66, "wk:finish"));
            check(api2.last().startsWith("🎉 Тренировка завершена!") && !api2.last().contains("🏅 Первая"),
                "notify: вторая тренировка — без строки «первая»");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: notify-bot-сценарий " + e);
        }
    }

    /* [UX-T54] дайджест недели: 2026-11-16 (Пн) — прошедшая неделя 9–15 ноября ровно
       как в примере §4.4: 4 тренировки по 55 мин, тоннаж 6,3 т (+0,8 к прошлой),
       рекорд Жим лёжа 83 кг (▲ +2), профиль → ккал; финал по числу тренировок;
       «первая» тиком (§4.5); /digest-экран с тоглом */
    static void runDigestScenario() {
        LocalDate today = LocalDate.of(2026, 11, 16); /* Пн: неделя 9–15 ноября */
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymdigest");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0);
            long chat = 9044;

            GymData d = new GymData();
            d.cadence = 3;
            d.profile = new ProfileData();
            d.profile.sex = "м";
            d.profile.height = 190;
            d.profile.weight = 95;
            /* базовая неделя (2–8 ноября): Жим 54×10×10 = 5400 + Жим лёжа 78×1 (e1RM ≈ 80,6) */
            Workout prev = w("2026-11-03T10:00:00", "2026-11-03T10:55:00", true);
            prev.date = "2026-11-03";
            ex(prev, "Жим", new SetEntry("54", 10, "10"));
            ex(prev, "Жим лёжа", new SetEntry("78", 1, "1"));
            d.workouts.add(prev);
            /* неделя: 4 тренировки по 55 мин, Жим 62×5×5 = 1550 → 6,2 т + Жим лёжа 80×1 */
            String[] dates = {"2026-11-09", "2026-11-10", "2026-11-12", "2026-11-14"};
            for (int i = 0; i < dates.length; i++) {
                Workout wk = w(dates[i] + "T10:00:00", dates[i] + "T10:55:00", true);
                wk.date = dates[i];
                ex(wk, "Жим", new SetEntry("62", 5, "5"));
                if (i == 3) ex(wk, "Жим лёжа", new SetEntry("80", 1, "1"));
                d.workouts.add(wk);
            }
            String t = BotLogic.digestText(d, today);
            check(t.startsWith("📊 <b>Итоги недели</b> · 9–15 ноября"), "digest: заголовок с датами недели");
            check(t.contains("🏋️ Тренировки: <b>4</b> · в зале 3 ч 40 мин · план 3/нед"),
                "digest: тренировки/время/план (cadence=3, §4.4)");
            check(t.contains("⚖️ Тоннаж: <b>6,3 т</b> · ▲ +0,8 т к прошлой"),
                "digest: тоннаж с дельтой к прошлой неделе");
            check(t.contains("🔥 Ккал: <b>≈ 1 280</b>"), "digest: ккал с профилем (группировка разрядов)");
            check(t.contains("🏆 <b>Рекорды недели:</b>") && t.contains("• Жим лёжа — 1ПМ ≈ <b>83 кг</b> (▲ +2)"),
                "digest: рекорд недели e1RM с дельтой");
            check(!t.contains("(▲ +0)"), "digest: прирост, не переживший округления, — не рекорд");
            check(t.contains("Хорошая неделя. Так держать 💪"), "digest: финал 3–4 тренировки (решение 4 §17)");
            check(!t.contains("• Жим —"), "digest: упражнение с весом не дублируется строкой объёма");

            /* секции опускаются: без профиля нет ккал, без весов нет тоннажа */
            GymData dNoProf = new GymData();
            for (Workout wk : d.workouts) dNoProf.workouts.add(wk);
            dNoProf.cadence = null;
            String t2 = BotLogic.digestText(dNoProf, today);
            check(!t2.contains("Ккал") && !t2.contains("план"), "digest: без профиля/cadence — строк нет");
            GymData dNoW = new GymData();
            for (int i = 0; i < 2; i++) {
                Workout wk = w(dates[i] + "T10:00:00", dates[i] + "T10:30:00", true);
                wk.date = dates[i];
                ex(wk, "Отжимания", new SetEntry("", 4, "20"));
                dNoW.workouts.add(wk);
            }
            String t3 = BotLogic.digestText(dNoW, today);
            check(!t3.contains("Тоннаж") && t3.contains("Неделя в работу — каждая тренировка на счету 💪"),
                "digest: без весов — без тоннажа; финал 1–2 тренировки");
            check(BotLogic.digestText(new GymData(), today) == null,
                "digest: 0 завершённых за неделю — null (E1: молчим)");

            /* объёмный рекорд без веса: 60 → 70 повторений за тренировку */
            GymData dVol = new GymData();
            Workout v1 = w("2026-11-03T10:00:00", "2026-11-03T10:20:00", true);
            v1.date = "2026-11-03";
            ex(v1, "Отжимания", new SetEntry("", 3, "20"));
            dVol.workouts.add(v1);
            Workout v2 = w("2026-11-10T10:00:00", "2026-11-10T10:20:00", true);
            v2.date = "2026-11-10";
            ex(v2, "Отжимания", new SetEntry("", 7, "10"));
            dVol.workouts.add(v2);
            String t4 = BotLogic.digestText(dVol, today);
            check(t4.contains("• Отжимания — <b>70</b> повторений (▲ +10)"),
                "digest: рекорд объёма для упражнения без веса (§8)");

            /* первая тренировка тиком (§4.5): текст, без клавиатуры */
            GymData f = new GymData();
            Workout fw = w("2026-11-15T10:00:00", "2026-11-15T11:00:00", true);
            fw.date = "2026-11-15";
            f.workouts.add(fw);
            check(BotLogic.notifyText("first", f, today, 0).equals(
                    "🎉 <b>Первая тренировка в дневнике!</b>\n\nС неё всё начинается. Дальше — легче: история, рекорды и прогресс копятся сами 💪"),
                "digest: текст «первая тренировка» тика дословно §4.5");
            List<List<Map<String, Object>>> kFirst = logic.notifyKb("first", f, today, 0);
            check(kFirst == null, "digest: «первая» — без клавиатуры (§4.5)");

            /* /digest-экран: краткая строка + тогл (ANA-S2 §2в); точная строка —
               статически с фиксированной датой, команда — состояние (дата реальная) */
            check(BotLogic.digestScreenText(d, today).startsWith(
                    "За прошлую неделю (9–15 ноября): 4 тренировки, тоннаж 6,3 т, ккал ≈ 1 280.")
                && BotLogic.digestScreenText(d, today).contains("Сводки недели: 🔔 включены."),
                "digest: экран — краткая строка и состояние (§2в ANA-S2)");
            storage.save(chat, d);
            logic.handle(msgUpdate(chat, "/digest"));
            check(api.last().startsWith("За прошлую неделю (") && api.last().contains("Сводки недели: 🔔 включены."),
                "digest: /digest — команда отвечает экраном");
            logic.handle(cbUpdate(chat, 55, "digest:onoff"));
            check(storage.load(chat).notifyDigest == Boolean.FALSE
                    && api.last().contains("Сводки недели: 🔕 выключены."),
                "digest: тогл экрана выключает и перерисовывает");
            logic.handle(cbUpdate(chat, 55, "digest:onoff"));
            check(storage.load(chat).notifyDigest == Boolean.TRUE, "digest: возврат отправки — true явно");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: digest-сценарий " + e);
        }
    }

    static GymData unfData(String date) {
        GymData d = new GymData();
        Workout wk = hang2();
        wk.date = date;
        d.workouts.add(wk);
        return d;
    }

    /* воскресный юзер с активной силовой целью (для goal) */
    @SuppressWarnings("unchecked")
    static GymData goalData() {
        return GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":2,\"goals\":[{\"id\":1,\"type\":1,\"ex\":\"Жим\",\"target\":100,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}],\"workouts\":[]}"));
    }

    /* понедельник: одна завершённая на прошлой ISO-недели (02–08.11), id 3 (для dg);
       firstDone=true — единственная завершённая «та самая первая», без этого dg-кейс
       перехватывает событие [first] (приоритет §3) */
    @SuppressWarnings("unchecked")
    static GymData dgData() {
        return GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":4,\"firstDone\":true,\"workouts\":[{\"id\":3,\"date\":\"2026-11-05\",\"finished\":true,\"exercises\":[]}]}"));
    }

    /* данные с массивом templates (запятая между шаблонами в вызове) */
    @SuppressWarnings("unchecked")
    static GymData tplData(String templatesJson) {
        return GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"templates\":[" + templatesJson + "],\"workouts\":[]}"));
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
