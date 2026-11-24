package gym;

import java.time.LocalDateTime;
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
   при webAppUrl == null (регрессия всех прежних сценариев) снимающего вызова нет.
   [TRN-T2] Раздел «Тренер»: админ-верификация карточек (/trainer_pending — только владелец,
   чек-лист финала 23.11; /trainer_ok — verified+пуш; /trainer_no — rejected+причина+
   rejectedAt), строгий парсинг (§2.7), hidden-карточку не подтверждаем; /trainer —
   18+ гейт, статус карточки, подопечный видит связь и гранты ВКЛ. */
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

        /* === 17. Раздел «Тренер» [TRN-T2]: админ-верификация (/trainer_pending|ok|no),
            /trainer (18+, статус, подопечный с грантами) === */
        runTrainerScenario();

        /* === 18. Разбор заявки кнопками из пуша [TRN-T4]: soc:link_ok/no === */
        runTrainerCallbackScenario();

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
            return true;
        }

        @Override
        public void sendMessageSilent(long chatId, String text) {
            texts.add(text);
        }

        @Override
        public long sendMessageGetId(long chatId, String text, List<List<Map<String, Object>>> keyboard) {
            texts.add(text);
            return 100; /* сообщение-отсчёт «отправилось» — сессия таймера создаётся */
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

    /* ===== [TRN-T2] раздел «Тренер»: админ-верификация карточек + личный статус ===== */

    /* взрослый профиль 18+ (birth = «сегодня минус 20 лет» — возраст детерминирован
       в любой день; месяц рождения = текущий месяц) */
    static void seedAdult(Storage storage, long chat) {
        try {
            GymData d = new GymData();
            d.nextId = 1;
            d.profile = new ProfileData();
            d.profile.sex = "м";
            d.profile.height = 180;
            d.profile.weight = 80;
            java.time.LocalDate b = java.time.LocalDate.now().minusYears(20);
            d.profile.birthYear = b.getYear();
            d.profile.birthMonth = b.getMonthValue();
            storage.save(chat, d);
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: seedAdult " + e);
        }
    }

    /* /trainer_pending (только владелец, чек-лист финала 23.11), /trainer_ok|no
       (статусы verified/rejected, причина, rejectedAt, пуши тренеру), строгий парсинг,
       /trainer: 18- отказ, выключенный режим, подопечный с грантами */
    static void runTrainerScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymtrainer");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, "https://t.me/ContractBot?startapp=app", 9001, null, 0);
            long admin = 9001;

            seedAdult(storage, 501);
            seedAdult(storage, 502);
            seedAdult(storage, 503);
            SocialData d = storage.social().get();
            TrainerCard c = new TrainerCard();
            c.displayName = "Игорь Соколов";
            c.city = "Минск";
            c.gyms = "«Атлет»";
            c.specs.add("rehab");
            c.years = 6;
            c.education.add("РГУФК, 2015");
            c.status = TrainerCard.STATUS_PENDING;
            c.updatedAt = "2026-11-23T10:00:00";
            d.trainers.put(501L, c);
            SocialLink l = new SocialLink();
            l.trainer = 501;
            l.student = 502;
            l.since = "2026-11-20";
            l.grants.putAll(SocialLink.defaultGrants());
            l.grants.put(SocialStore.GRANT_GOALS, true);
            d.links.add(l);
            storage.social().save();

            /* очередь: только владелец */
            int before = api.texts.size();
            logic.handle(msgUpdate(9002, "/trainer_pending"));
            check(api.texts.size() == before, "trainer: /trainer_pending от не-владельца — тихо");
            logic.handle(msgUpdate(admin, "/trainer_pending"));
            check(api.last().contains("Игорь Соколов") && api.last().contains("#501"),
                "trainer: /trainer_pending показывает карточку с id и именем");
            check(api.last().contains("✅ город/зал") && api.last().contains("✅ специализация")
                    && api.last().contains("✅ стаж/образование") && api.last().contains("жалоб: 0"),
                "trainer: чек-лист верификации по финалу владельца 23.11");

            /* строгий парсинг (§2.7) */
            check(BotLogic.parseTrainerAdmin("/trainer_okx 5") == null, "trainer: /trainer_okx не матчится");
            check(BotLogic.parseTrainerAdmin("/trainer_pendingx") == null, "trainer: /trainer_pendingx не матчится");
            check(BotLogic.parseTrainerAdmin("/trainer_nox 5") == null, "trainer: /trainer_nox не матчится");
            check(BotLogic.parseTrainerAdmin("/trainerx") == null, "trainer: /trainerx не матчится");
            check(BotLogic.parseTrainerAdmin("привет") == null, "trainer: не команда — null");
            check(BotLogic.parseTrainerAdmin(null) == null, "trainer: null — null");
            String[] pn = BotLogic.parseTrainerAdmin("/trainer_no 501 нет подтверждения стажа");
            check(pn != null && "no".equals(pn[0]) && "501".equals(pn[1]) && "нет подтверждения стажа".equals(pn[2]),
                "trainer: /trainer_no разбирает id и причину (регистр причины сохранён)");
            String[] pok = BotLogic.parseTrainerAdmin("/trainer_ok 501");
            check(pok != null && "ok".equals(pok[0]) && "501".equals(pok[1]),
                "trainer: /trainer_ok разбирает id");

            /* подтверждение: статус verified + пуш тренеру + отчёт владельцу */
            logic.handle(msgUpdate(admin, "/trainer_ok 501"));
            check(TrainerCard.STATUS_VERIFIED.equals(storage.social().get().trainers.get(501L).status),
                "trainer: /trainer_ok ставит verified");
            check(!storage.social().get().trainers.get(501L).verifiedAt.isEmpty(),
                "trainer: verifiedAt записан (сортировка поиска §6.2)");
            check(api.any("🎉 Карточка тренера подтверждена") && api.any("✅ Карточка #501"),
                "trainer: пуш тренеру и отчёт владельцу");

            /* скрытая карточка не подтверждается — иначе выключенный режим включился бы */
            storage.social().get().trainers.get(501L).status = TrainerCard.STATUS_HIDDEN;
            logic.handle(msgUpdate(admin, "/trainer_ok 501"));
            check(!TrainerCard.STATUS_VERIFIED.equals(storage.social().get().trainers.get(501L).status),
                "trainer: hidden карточку подтвердить нельзя");
            storage.social().get().trainers.get(501L).status = TrainerCard.STATUS_PENDING;

            /* отказ с причиной: rejected + statusNote + rejectedAt + пуш с причиной и 30-дневкой */
            logic.handle(msgUpdate(admin, "/trainer_no 501 нет подтверждения стажа"));
            TrainerCard rn = storage.social().get().trainers.get(501L);
            check(TrainerCard.STATUS_REJECTED.equals(rn.status) && "нет подтверждения стажа".equals(rn.statusNote)
                    && !rn.rejectedAt.isEmpty(),
                "trainer: /trainer_no — rejected, причина и rejectedAt записаны");
            check(api.any("✖️ Карточка отклонена") && api.any("нет подтверждения стажа") && api.any("30 дней"),
                "trainer: пуш об отказе с причиной и 30-дневкой");

            /* форматы */
            logic.handle(msgUpdate(admin, "/trainer_ok"));
            check(api.last().contains("id"), "trainer: /trainer_ok без id — подсказка");
            logic.handle(msgUpdate(admin, "/trainer_no 501"));
            check(api.last().contains("Формат"), "trainer: /trainer_no без причины — подсказка формата");
            logic.handle(msgUpdate(admin, "/trainer_ok абс"));
            check(api.last().contains("id пользователя"), "trainer: мусорный id — подсказка");

            /* /trainer: 18- → отказ; взрослый без карточки → выключен; подопечный → связь+гранты */
            GymData minor = new GymData();
            minor.nextId = 1;
            minor.profile = new ProfileData();
            minor.profile.sex = "ж";
            minor.profile.height = 160;
            minor.profile.weight = 50;
            java.time.LocalDate bm = java.time.LocalDate.now().minusYears(15);
            minor.profile.birthYear = bm.getYear();
            minor.profile.birthMonth = bm.getMonthValue() == 1 ? 12 : bm.getMonthValue() - 1;
            /* месяц на 1 меньше текущего → возраст ровно 15 (день рождения ещё не наступил) */
            storage.save(702, minor);
            logic.handle(msgUpdate(702, "/trainer"));
            check(api.any("доступен с 18 лет"), "trainer: 15 лет — отказ с указанием профиля");

            logic.handle(msgUpdate(503, "/trainer"));
            check(api.any("Режим тренера выключен"), "trainer: взрослый без карточки — режим выключен");

            logic.handle(msgUpdate(502, "/trainer"));
            check(api.any("Вы подопечный: Игорь Соколов") && api.any("с 2026-11-20"),
                "trainer: подопечный видит тренера и дату связки");
            check(api.any("прогресс") && api.any("цели") && !api.any("данные закрыты"),
                "trainer: гранты ВКЛ перечислены (прогресс по умолчанию + цели)");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: trainer " + e);
        }
    }

    /* [TRN-T4] разбор заявки кнопками пуша: soc:link_ok (инварианты + связка
       с грантами по умолчанию + пуш подопечному) и soc:link_no (отклонение);
       заявка не найдена/чужой — без падения */
    static void runTrainerCallbackScenario() {
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymtrcb");
            Storage storage = new Storage(tmp);
            FakeApi api = new FakeApi();
            BotLogic logic = new BotLogic(api, storage, null, null, 0, null, 0);
            long trainer = 601;
            seedAdult(storage, trainer);
            seedAdult(storage, 602);
            SocialData d = storage.social().get();
            TrainerCard c = new TrainerCard();
            c.displayName = "Игорь Соколов";
            c.status = TrainerCard.STATUS_VERIFIED;
            d.trainers.put(trainer, c);
            SocialRequest r = new SocialRequest();
            r.trainer = trainer;
            r.student = 602;
            r.comment = "Хочу к Вам";
            r.createdAt = java.time.LocalDateTime.now().withNano(0).toString();
            r.studentName = "Анна Ковалёва";
            d.requests.add(r);
            storage.social().save();

            /* nonce-ветки: мусорный суффикс и «заявка не найдена» — без падений */
            int before = api.texts.size();
            logic.handle(cbUpdate(trainer, 5, "soc:link_xx:602"));
            check(api.texts.size() == before, "soc: неизвестная soc-ветка — тихо");
            logic.handle(cbUpdate(trainer, 6, "soc:link_ok:999"));
            check(api.last().contains("не найдена"), "soc: несуществующая заявка — сообщение");

            /* принять: связка (гранты дефолт: Прогресс ВКЛ) + пуш подопечному */
            logic.handle(cbUpdate(trainer, 7, "soc:link_ok:602"));
            SocialLink l = storage.social().get().links.isEmpty() ? null : storage.social().get().links.get(0);
            check(l != null && l.trainer == trainer && l.student == 602
                    && Boolean.TRUE.equals(l.grants.get(SocialStore.GRANT_PROGRESS))
                    && "Анна Ковалёва".equals(l.studentName),
                "soc: accept — связка с дефолтными грантами и именем из заявки");
            check(api.any("✅ Заявка принята") && api.any("Игорь Соколов"),
                "soc: пуш подопечному «принято» с именем тренера (§14.1)");
            check(api.any("✅ Заявка принята — Анна Ковалёва в подопечных"),
                "soc: сообщение тренера обновлено");
            check(storage.social().get().requests.isEmpty(), "soc: заявка погашена");

            /* повторный accept — заявка уже разобрана */
            logic.handle(cbUpdate(trainer, 8, "soc:link_ok:602"));
            check(api.last().contains("не найдена"), "soc: повторный accept — «не найдена»");

            /* отклонить новой заявки: пуш отклонения подопечному */
            SocialRequest r2 = new SocialRequest();
            r2.trainer = trainer;
            r2.student = 602;
            r2.createdAt = java.time.LocalDateTime.now().withNano(0).toString();
            storage.social().get().requests.add(r2);
            logic.handle(cbUpdate(trainer, 9, "soc:link_no:602"));
            check(storage.social().get().requests.isEmpty(), "soc: reject — заявка погашена");
            check(api.last().contains("Заявка отклонена\n\nИгорь Соколов пока не может"),
                "soc: пуш отклонения без причины (§14.1)");
        } catch (Exception e) {
            throw new AssertionError("UNIT FAIL: trainer-callback " + e);
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
