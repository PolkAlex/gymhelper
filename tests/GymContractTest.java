import gym.BotLogic;
import gym.ExerciseEntry;
import gym.GymData;
import gym.Json;
import gym.Records;
import gym.SetEntry;
import gym.Stats;
import gym.Storage;
import gym.Template;
import gym.TemplateExercise;
import gym.Workout;
import gym.web.WebServer;

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

        /* [UX-T29] дата рождения: legacy age-only (фикстура выше без birth-ключей) —
           читается «не указано» и не получает birth-ключей при записи (байт-в-байт) */
        check(d.profile.birthYear == 0 && d.profile.birthMonth == 0, "legacy age-only: birth не указан");
        String noBirthOut = Json.write(d.toJson());
        check(!noBirthOut.contains("birthYear") && !noBirthOut.contains("birthMonth"),
            "toJson без даты не пишет birth-ключи (legacy байт-в-байт)");

        /* [UX-T29] birth-пара: чтение, round-trip без потерь; age-зеркало остаётся как записано;
           ageOf — вычисленный возраст, наступает 1-го числа месяца рождения */
        GymData db = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":36,\"height\":178,\"weight\":78.5,\"birthYear\":1990,\"birthMonth\":11},\"workouts\":[]}"));
        check(db.profile.birthYear == 1990 && db.profile.birthMonth == 11, "birth-пара читается");
        check(db.profile.age == 36, "age-зеркало читается как записано");
        String birthOut = Json.write(db.toJson());
        check(birthOut.contains("\"birthYear\":1990") && birthOut.contains("\"birthMonth\":11"), "toJson пишет birth-пару");
        GymData db2 = GymData.fromJson((Map<String, Object>) Json.parse(birthOut));
        check(db2.profile.birthYear == 1990 && db2.profile.birthMonth == 11 && db2.profile.age == 36,
            "birth-пара переживает round-trip без потерь");
        java.time.LocalDate todayBD = java.time.LocalDate.now();
        int expAgeBD = todayBD.getYear() - 1990 - (todayBD.getMonthValue() < 11 ? 1 : 0);
        check(db.profile.ageOf() == expAgeBD, "ageOf: 1990-11 → вычисленный возраст " + expAgeBD);

        /* [UX-T29] мусор при чтении → «не указано» (границы чтения 1900–2100 / 1–12, оба-или-ничего) */
        GymData dgb = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":1800,\"birthMonth\":13},\"workouts\":[]}"));
        check(dgb.profile.birthYear == 0 && dgb.profile.birthMonth == 0, "мусор: год 1800 и месяц 13 → не указано");
        GymData dgs = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":\"1990\",\"birthMonth\":\"5\"},\"workouts\":[]}"));
        check(dgs.profile.birthYear == 0 && dgs.profile.birthMonth == 0, "мусор: birthYear строкой → не указано (без падения)");

        /* [UX-T29] полуфабрикат: год без месяца → оба 0, ключи не пишутся */
        GymData dh = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":1990},\"workouts\":[]}"));
        check(dh.profile.birthYear == 0 && dh.profile.birthMonth == 0, "полуфабрикат: год без месяца → оба 0");
        check(!Json.write(dh.toJson()).contains("birth"), "полуфабрикат: toJson не пишет birth-ключи");

        /* [UX-T29, TST-E1] границы чтения: 1900–2100 и 1–12 валидны включительно, вне — «не указано»;
           мусорный месяц обнуляет пару даже при валидном годе (оба-или-ничего) */
        GymData dgl = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":1900,\"birthMonth\":1},\"workouts\":[]}"));
        check(dgl.profile.birthYear == 1900 && dgl.profile.birthMonth == 1, "границы: 1900 и месяц 1 читаются (нижняя граница включительно)");
        GymData dgu = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":2100,\"birthMonth\":12},\"workouts\":[]}"));
        check(dgu.profile.birthYear == 2100 && dgu.profile.birthMonth == 12, "границы: 2100 и месяц 12 читаются (верхняя граница включительно)");
        GymData dgy = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":2101,\"birthMonth\":6},\"workouts\":[]}"));
        check(dgy.profile.birthYear == 0 && dgy.profile.birthMonth == 0, "границы: год 2101 → оба 0");
        GymData dgm = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":1990,\"birthMonth\":0},\"workouts\":[]}"));
        check(dgm.profile.birthYear == 0 && dgm.profile.birthMonth == 0, "границы: валидный год, месяц 0 → вся пара «не указано»");
        GymData dgm13 = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":30,\"height\":180,\"weight\":80,\"birthYear\":1990,\"birthMonth\":13},\"workouts\":[]}"));
        check(dgm13.profile.birthYear == 0 && dgm13.profile.birthMonth == 0, "границы: валидный год, месяц 13 → вся пара «не указано»");

        String legacy = "{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-10-26\"," +
            "\"startedAt\":\"2026-10-26T18:00:00\",\"endedAt\":\"2026-10-26T19:00:00\"," +
            "\"finished\":true,\"exercises\":[{\"name\":\"Жим\",\"sets\":[{\"weight\":\"80\",\"sets\":1,\"reps\":\"10\"}]}]}]}";
        GymData d2 = GymData.fromJson((Map<String, Object>) Json.parse(legacy));
        Workout w2 = d2.findById(1);
        check("2026-10-26T18:00:00".equals(w2.startedAt), "legacy startedAt читается");
        check("80".equals(w2.exercises.get(0).sets.get(0).weight), "legacy weight/sets/reps читаются");
        check(d2.restSec == null, "legacy без restSec читается (дефолт 90 берёт читатель)");

        /* restSec [UX-T4/T5]: round-trip поля; старые файлы без поля читаются; вне 30–600 игнорируется */
        GymData dr = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"restSec\":180,\"workouts\":[]}"));
        check(dr.restSec != null && dr.restSec == 180, "restSec читается");
        check(Json.write(dr.toJson()).contains("\"restSec\":180"), "toJson пишет restSec");
        String restOut = Json.write(d2.toJson());
        check(!restOut.contains("restSec"), "toJson без restSec не пишет ключ (legacy байт-в-байт)");
        GymData badRest = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"restSec\":700,\"workouts\":[]}"));
        check(badRest.restSec == null, "restSec вне 30–600 игнорируется при чтении");

        /* restSec=0 — спец-значение «выкл» таймера [UX-T13]: читается и переживает round-trip;
           legacy без ключа — по-прежнему null (дефолт 90, таймер включён) */
        GymData offRest = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"restSec\":0,\"workouts\":[]}"));
        check(offRest.restSec != null && offRest.restSec == 0, "restSec=0 (выкл) читается как спец-значение, а не игнорируется");
        check(Json.write(offRest.toJson()).contains("\"restSec\":0"), "toJson пишет restSec=0 (выкл) — round-trip без потерь");

        /* templates [UX-T6/T7]: legacy без ключа читается; round-trip без потерь; пустой список — ключа нет */
        check(d2.templates.isEmpty(), "legacy без templates читается (пустой список)");
        String tplJson = "{\"nextId\":2,\"templates\":[{" +
            "\"id\":1,\"name\":\"Спина \\\"и\\\" бицепс 💪\",\"createdAt\":\"2026-11-06T18:30:00\",\"exercises\":[" +
            "{\"name\":\"Тяга верхнего блока\",\"w\":\"75-175\",\"s\":3,\"r\":\"10\"}," +
            "{\"name\":\"Подтягивания\",\"s\":4,\"r\":\"8\"}]}],\"workouts\":[]}";
        GymData dt = GymData.fromJson((Map<String, Object>) Json.parse(tplJson));
        check(dt.templates.size() == 1, "templates читаются");
        Template t0 = dt.templates.get(0);
        check(t0.id == 1 && "Спина \"и\" бицепс 💪".equals(t0.name), "имя шаблона с кавычками/эмодзи");
        check("2026-11-06T18:30:00".equals(t0.createdAt), "createdAt шаблона");
        check(t0.exercises.size() == 2, "упражнения шаблона");
        check("75-175".equals(t0.exercises.get(0).w) && t0.exercises.get(0).s == 3 && "10".equals(t0.exercises.get(0).r),
            "план w/s/r с диапазоном веса");
        check("".equals(t0.exercises.get(1).w) && t0.exercises.get(1).s == 4 && "8".equals(t0.exercises.get(1).r),
            "пропуск w читается как пустая строка, s без деградации");
        String tplOut = Json.write(dt.toJson());
        GymData dt2 = GymData.fromJson((Map<String, Object>) Json.parse(tplOut));
        check(dt2.templates.size() == 1 && dt2.templates.get(0).exercises.size() == 2
            && "75-175".equals(dt2.templates.get(0).exercises.get(0).w)
            && "Спина \"и\" бицепс 💪".equals(dt2.templates.get(0).name)
            && "2026-11-06T18:30:00".equals(dt2.templates.get(0).createdAt), "templates переживают round-trip без потерь");
        check(!Json.write(d2.toJson()).contains("templates"), "toJson без шаблонов не пишет ключ (legacy байт-в-байт)");

        /* план-подсказка в записях [UX-E5]: legacy без pw/ps/pr читается (плана нет); round-trip без плана не пишет ключи */
        check(d2.workouts.get(0).exercises.get(0).planS == 0, "legacy запись без pw/ps/pr: планS=0");
        String noPlanOut = Json.write(d2.toJson());
        check(!noPlanOut.contains("\"pw\"") && !noPlanOut.contains("\"ps\"") && !noPlanOut.contains("\"pr\""),
            "toJson без плана не пишет ключи pw/ps/pr (legacy байт-в-байт)");

        /* [UX-E5]: тренировка с планом переживает round-trip без потерь; ps < 1 при чтении сбрасывает план целиком */
        String planJson = "{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-11-07\",\"finished\":false,\"exercises\":[" +
            "{\"name\":\"Тяга верхнего блока\",\"st\":\"2026-11-07T18:00:00\",\"sets\":[],\"pw\":\"75-175\",\"ps\":3,\"pr\":\"\"}," +
            "{\"name\":\"Подтягивания\",\"sets\":[{\"w\":\"\",\"s\":4,\"r\":\"8\"}],\"pw\":\"abc\",\"ps\":0,\"pr\":\"10\"}]}]}";
        GymData dp = GymData.fromJson((Map<String, Object>) Json.parse(planJson));
        ExerciseEntry pe = dp.findById(1).exercises.get(0);
        check("75-175".equals(pe.planW) && pe.planS == 3 && "".equals(pe.planR), "план pw/ps/pr читается (диапазон веса, пустой pr)");
        ExerciseEntry peBad = dp.findById(1).exercises.get(1);
        check(peBad.planS == 0 && "".equals(peBad.planW) && "".equals(peBad.planR), "ps < 1 при чтении сбрасывает план целиком");
        String planOut = Json.write(dp.toJson());
        check(planOut.contains("\"pw\":\"75-175\"") && planOut.contains("\"ps\":3") && planOut.contains("\"pr\":\"\""),
            "toJson пишет план при planS >= 1");
        check(!planOut.contains("\"ps\":0"), "toJson при planS=0 не пишет ключи плана");
        GymData dp2 = GymData.fromJson((Map<String, Object>) Json.parse(planOut));
        ExerciseEntry pe2 = dp2.findById(1).exercises.get(0);
        check("75-175".equals(pe2.planW) && pe2.planS == 3 && "".equals(pe2.planR), "план переживает round-trip без потерь");
        /* мусорный ps (строка вместо числа) → Json.lng даёт 0 → план сбрасывается, без падения */
        String psGarbage = planJson.replace("\"pw\":\"abc\",\"ps\":0", "\"pw\":\"abc\",\"ps\":\"3\"");
        ExerciseEntry peGarbage = GymData.fromJson((Map<String, Object>) Json.parse(psGarbage)).findById(1).exercises.get(1);
        check(peGarbage.planS == 0 && "".equals(peGarbage.planW), "мусорный ps (строка) сбрасывает план без падения");

        /* [UX-E5]: строки плана бота — «60 кг, 3 по 10» / «без веса, 3 по 10» / «60 кг × 3» (без повторений) */
        TemplateExercise pc0 = new TemplateExercise();
        check(BotLogic.planCore(pc0).equals("без веса × 1"), "planCore: пустой план — без веса × 1");
        TemplateExercise pc1 = new TemplateExercise();
        pc1.w = "60"; pc1.s = 3; pc1.r = "10";
        check(BotLogic.planCore(pc1).equals("60 кг, 3 по 10"), "planCore: 60 кг, 3 по 10");
        TemplateExercise pc2 = new TemplateExercise();
        pc2.w = ""; pc2.s = 3; pc2.r = "10";
        check(BotLogic.planCore(pc2).equals("без веса, 3 по 10"), "planCore: без веса, 3 по 10");
        TemplateExercise pc3 = new TemplateExercise();
        pc3.w = "62,5"; pc3.s = 4; pc3.r = "";
        check(BotLogic.planCore(pc3).equals("62,5 кг × 4"), "planCore: без повторений — 62,5 кг × 4");

        String out = Json.write(d.toJson());
        check(out.contains("\"started\":\"2026-10-29T18:30:00\""), "toJson пишет started");
        check(out.contains("\"st\":\"2026-10-29T18:31:00\""), "toJson пишет st");

        String delJson = "{\"nextId\":24,\"rev\":6,\"del\":[22],\"workouts\":[]}";
        GymData dd = GymData.fromJson((Map<String, Object>) Json.parse(delJson));
        check(dd.deletedIds.size() == 1 && dd.deletedIds.get(0) == 22L, "del читается");
        String delOut = Json.write(dd.toJson());
        check(delOut.contains("\"del\":[22]"), "toJson пишет del");

        /* nextId обязан расти от id тренировок: клиент с устаревшим nextId не создаёт коллизий */
        String staleJson = "{\"nextId\":22,\"workouts\":[{\"id\":22,\"date\":\"2026-11-02\",\"started\":\"2026-11-02T21:30:58\",\"finished\":false,\"exercises\":[]}]}";
        GymData stale = GymData.fromJson((Map<String, Object>) Json.parse(staleJson));
        check(GymData.incomingNextId(stale) == 23, "incomingNextId: max(nextId, max(id)+1) = 23");
        GymData empty = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":7,\"workouts\":[]}"));
        check(GymData.incomingNextId(empty) == 7, "incomingNextId без тренировок = nextId");
        GymData gap = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":5,\"workouts\":[{\"id\":2,\"date\":\"2026-10-01\",\"exercises\":[]},{\"id\":9,\"date\":\"2026-10-02\",\"exercises\":[]}]}"));
        check(GymData.incomingNextId(gap) == 10, "incomingNextId: max(id)+1 = 10");

        /* Storage: перед каждой перезаписью создаётся бэкап, хранятся последние 20, чужие не смешиваются */
        try {
            java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("gymstore");
            Storage st = new Storage(tmp);
            GymData seed = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-10-01\",\"finished\":true,\"exercises\":[]}]}"));
            st.save(777, seed);
            check(java.nio.file.Files.exists(tmp.resolve("chat_777.json")), "storage: основной файл создан");
            for (int i = 0; i < Storage.BACKUPS_TO_KEEP + 3; i++) {
                GymData v = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":2,\"rev\":" + (i + 1) + ",\"workouts\":[{\"id\":1,\"date\":\"2026-10-01\",\"finished\":true,\"exercises\":[]}]}"));
                Thread.sleep(3);
                st.save(777, v);
            }
            Storage st2 = new Storage(tmp);
            check(st2.backups(777).size() == Storage.BACKUPS_TO_KEEP, "storage: ротация держит " + Storage.BACKUPS_TO_KEEP + " бэкапов, а не " + st2.backups(777).size());
            check(st2.backups(888).isEmpty(), "storage: бэкапы разных пользователей не смешиваются");
            GymData restored = st2.load(777);
            check(restored.findById(1) != null && restored.rev == Storage.BACKUPS_TO_KEEP + 3, "storage: основной файл читается после ротации");
            GymData fromBackup = GymData.fromJson(Json.map(Json.parse(java.nio.file.Files.readString(st2.backups(777).get(0)))));
            check(fromBackup.findById(1) != null, "storage: свежий бэкап валиден и содержит тренировку");
        } catch (Exception storageErr) {
            throw new AssertionError("CONTRACT FAIL: storage " + storageErr);
        }

        /* склонения в формулировках записей (веб + бот) */
        check(BotLogic.renderLine("Жим", new SetEntry("25", 2, "4")).equals("Жим 25 кг, 2 подхода по 4 повторения"), "renderLine: 2 подхода по 4 повторения");
        check(BotLogic.renderLine("Жим", new SetEntry("", 5, "12")).equals("Жим, 5 подходов по 12 повторений"), "renderLine: 5 подходов по 12 повторений");
        check(BotLogic.renderLine("Тяга", new SetEntry("", 1, "1")).equals("Тяга, 1 подход по 1 повторению"), "renderLine: 1 подход по 1 повторению");
        check(BotLogic.renderLine("Становая", new SetEntry("", 21, "макс")).equals("Становая, 21 подход по макс"), "renderLine: 21 подход по макс");
        check(BotLogic.renderLine("Жим", new SetEntry("100", 3, "8-10")).equals("Жим 100 кг, 3 подхода по 8-10 повторений"), "renderLine: 3 подхода по 8-10 повторений");
        check(BotLogic.renderLine("Жим", new SetEntry("", 11, "2-4")).equals("Жим, 11 подходов по 2-4 повторения"), "renderLine: 11 подходов по 2-4 повторения (диапазон по последнему числу)");

        /* живые рекорды [UX-T2]: repsAvg, e1RM по Эпли, правила поздравления */
        check(Records.repsAvg("12") == 12, "repsAvg: «12» → 12");
        check(Records.repsAvg("8-10") == 9, "repsAvg: «8-10» → 9 (середина диапазона)");
        check(Records.repsAvg("5+1") == 6, "repsAvg: «5+1» → 6 (дроп-сет суммируется)");
        check(Records.repsAvg("макс") == 10, "repsAvg: «макс» → 10 (нечисловой текст)");
        check(Math.abs(Records.e1rm(new SetEntry("100", 1, "9")) - 130.0) < 0.001,
            "e1rm: 100 кг × 9 → 130 (вес × (1 + повторения ÷ 30)); подходы не участвуют");

        /* база рекорда — только ПРОШЛЫЕ тренировки (i < idx): id3 стоит ПОСЛЕ текущей и в базу не входит */
        GymData prD = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":4,\"workouts\":[" +
            "{\"id\":1,\"date\":\"2026-11-01\",\"finished\":true,\"exercises\":[" +
            "{\"name\":\"Жим\",\"sets\":[{\"weight\":\"100\",\"sets\":3,\"reps\":\"8-10\"}]}," +
            "{\"name\":\"Подтягивания\",\"sets\":[{\"weight\":\"\",\"sets\":4,\"reps\":\"8\"}]}]}," +
            "{\"id\":2,\"date\":\"2026-11-02\",\"finished\":false,\"exercises\":[]}," +
            "{\"id\":3,\"date\":\"2026-11-03\",\"finished\":true,\"exercises\":[" +
            "{\"name\":\"Жим\",\"sets\":[{\"weight\":\"200\",\"sets\":2,\"reps\":\"8\"}]}]}]}"));
        Workout prCur = prD.findById(2);
        check(prD.workouts.indexOf(prCur) == 1, "pr: текущая тренировка найдена в списке");
        check(Records.congratulation(prD, prCur, "Тяга", new SetEntry("80", 3, "8")) == null,
            "congratulation: первый подход упражнения (база пуста) — не рекорд");
        check(Records.congratulation(prD, prCur, "Жим", new SetEntry("100", 3, "8-10")) == null,
            "congratulation: равный результат — не рекорд (строгое >)");
        String prMsg = Records.congratulation(prD, prCur, "Жим", new SetEntry("105", 3, "8-10"));
        check(prMsg != null && prMsg.contains("1ПМ"),
            "congratulation: превышение — рекорд (id3 после текущей не мешает, иначе база была бы 200×8)");
        check(Records.congratulation(prD, prCur, "Подтягивания", new SetEntry("", 5, "8")).contains("Рекорд объёма"),
            "congratulation: объёмный рекорд для блока без веса");

        /* CSV-экспорт: RFC 4180-кавычки и защита от инъекции формулами (= + - @ → апостроф) */
        check(BotLogic.csvField("29.10.2026").equals("29.10.2026"), "csvField: дата/число без изменений");
        check(BotLogic.csvField("Жим;лежа").equals("\"Жим;лежа\""), "csvField: ; берёт поле в кавычки");
        check(BotLogic.csvField("Жим \"и\" тяга").equals("\"Жим \"\"и\"\" тяга\""), "csvField: кавычки удваиваются");
        check(BotLogic.csvField("=HYPERLINK(x)").equals("'=HYPERLINK(x)"), "csvField: = экранируется апострофом");
        check(BotLogic.csvField("@cmd").equals("'@cmd"), "csvField: @ экранируется апострофом");
        check(BotLogic.csvField("=cmd;1").equals("\"'=cmd;1\""), "csvField: инъекция и ; вместе");

        /* склонения */
        check(BotLogic.plural(1, "тренировка", "тренировки", "тренировок").equals("тренировка"), "plural: 1");
        check(BotLogic.plural(2, "тренировка", "тренировки", "тренировок").equals("тренировки"), "plural: 2");
        check(BotLogic.plural(5, "тренировка", "тренировки", "тренировок").equals("тренировок"), "plural: 5");
        check(BotLogic.plural(11, "тренировка", "тренировки", "тренировок").equals("тренировок"), "plural: 11");
        check(BotLogic.plural(21, "тренировка", "тренировки", "тренировок").equals("тренировка"), "plural: 21");

        /* рассылка владельцем [UX-T16]: разбор /announce и /announce_dry, строгий матчинг */
        String[] a1 = BotLogic.parseAnnounce("/announce Релиз 1.18 в 21:00");
        check(a1 != null && "0".equals(a1[0]) && "Релиз 1.18 в 21:00".equals(a1[1]), "parseAnnounce: /announce с текстом");
        String[] a2 = BotLogic.parseAnnounce("/announce_dry Техработы ночью");
        check(a2 != null && "1".equals(a2[0]) && "Техработы ночью".equals(a2[1]), "parseAnnounce: /announce_dry с текстом");
        String[] a3 = BotLogic.parseAnnounce("/announce");
        check(a3 != null && "0".equals(a3[0]) && a3[1].isEmpty(), "parseAnnounce: /announce без текста — пустой текст");
        String[] a4 = BotLogic.parseAnnounce("/ANNOUNCE капитал");
        check(a4 != null && "0".equals(a4[0]) && "капитал".equals(a4[1]), "parseAnnounce: регистр команды не важен");
        check(BotLogic.parseAnnounce("/announcex нет") == null, "parseAnnounce: /announcex не матчится");
        check(BotLogic.parseAnnounce("/announce_dryx нет") == null, "parseAnnounce: /announce_dryx не матчится");
        check(BotLogic.parseAnnounce("/announce_x") == null, "parseAnnounce: /announce_x не матчится");
        check(BotLogic.parseAnnounce("привет") == null, "parseAnnounce: не команда — null");
        check(BotLogic.parseAnnounce(null) == null, "parseAnnounce: null — null");

        /* удаление данных по запросу [ONB-T2]: разбор /delete_my_data и /delete_my_data_confirm, строгий матчинг */
        check("ask".equals(BotLogic.parseDeleteData("/delete_my_data")), "parseDeleteData: /delete_my_data — ask");
        check("ask".equals(BotLogic.parseDeleteData("/DELETE_MY_DATA")), "parseDeleteData: регистр команды не важен");
        check("confirm".equals(BotLogic.parseDeleteData("/delete_my_data_confirm")), "parseDeleteData: /delete_my_data_confirm — confirm");
        check("confirm".equals(BotLogic.parseDeleteData("/Delete_My_Data_Confirm")), "parseDeleteData: confirm — регистр не важен");
        check(BotLogic.parseDeleteData("/delete_my_datax") == null, "parseDeleteData: /delete_my_datax не матчится");
        check(BotLogic.parseDeleteData("/delete_my_data_confirmx") == null, "parseDeleteData: /delete_my_data_confirmx не матчится");
        check(BotLogic.parseDeleteData("/delete_my_data 2") == null, "parseDeleteData: с аргументом не матчится");
        check(BotLogic.parseDeleteData("привет") == null, "parseDeleteData: не команда — null");
        check(BotLogic.parseDeleteData(null) == null, "parseDeleteData: null — null");

        /* Storage.chatIds [UX-T16]: id из имён chat_<id>.json, чужие/мусорные файлы и бэкапы не попадают */
        try {
            java.nio.file.Path tmpChats = java.nio.file.Files.createTempDirectory("gymchats");
            Storage stChats = new Storage(tmpChats);
            java.nio.file.Files.writeString(tmpChats.resolve("chat_111.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_222.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_notanumber.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_333.old.json"), "{}");
            /* >18 цифр: regex проходит, parseLong даёт overflow → файл пропускается, а не валит листинг */
            java.nio.file.Files.writeString(tmpChats.resolve("chat_99999999999999999999.json"), "{}");
            java.nio.file.Files.createDirectories(tmpChats.resolve("backups"));
            java.nio.file.Files.writeString(tmpChats.resolve("backups").resolve("chat_444.1700000000000.json"), "{}");
            java.util.List<Long> ids = stChats.chatIds();
            check(ids.size() == 2 && ids.contains(111L) && ids.contains(222L),
                "chatIds: только chat_<id>.json, мусор и backups не попадают");
        } catch (Exception chatsErr) {
            throw new AssertionError("CONTRACT FAIL: chatIds " + chatsErr);
        }

        /* [ONB-T2] Storage.deleteChat: файл удаляется безвозвратно, несуществующий id — тихо */
        try {
            java.nio.file.Path tmpDel = java.nio.file.Files.createTempDirectory("gymdel");
            Storage stDel = new Storage(tmpDel);
            GymData seedDel = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":1,\"workouts\":[]}"));
            stDel.save(555, seedDel);
            check(java.nio.file.Files.exists(tmpDel.resolve("chat_555.json")), "deleteChat: файл перед удалением существует");
            stDel.deleteChat(555);
            check(!java.nio.file.Files.exists(tmpDel.resolve("chat_555.json")), "deleteChat: chat_<id>.json удалён");
            stDel.deleteChat(999); /* несуществующий — без падения и без исключения */
            stDel.deleteChat(555); /* повторное удаление — тоже тихо */
        } catch (Exception delErr) {
            throw new AssertionError("CONTRACT FAIL: deleteChat " + delErr);
        }

        /* [ONB-T2] регресс «воскрешения» удалённых данных: открытая вкладка с rev>0 бьёт
           save'ом в пустой сервер после /delete_my_data → 409, chat_<id>.json НЕ пересоздаётся;
           легитимные save'ы (первый с rev=0 и пустой от свежей вкладки) работают как раньше.
           Реальный WebServer на эфемерном порту + Storage во временном каталоге. */
        try {
            java.nio.file.Path tmpRes = java.nio.file.Files.createTempDirectory("gymres");
            Storage stRes = new Storage(tmpRes);
            WebServer ws = new WebServer("contract-test-token", stRes, tmpRes, new Stats(tmpRes.resolve("stats.json")));
            java.net.ServerSocket probe = new java.net.ServerSocket(0);
            int port = probe.getLocalPort();
            probe.close();
            ws.start(port);
            String id = tgInitData("contract-test-token", 424242);
            String w1 = "{\"id\":1,\"date\":\"2026-11-08\",\"finished\":true,\"exercises\":[]}";
            java.nio.file.Path chatFile = tmpRes.resolve("chat_424242.json");

            java.net.http.HttpResponse<String> r1 = postSave(port, id, 0,
                "{\"rev\":0,\"nextId\":2,\"workouts\":[" + w1 + "]}");
            check(r1.statusCode() == 200, "resurrect: легитимный первый save (rev=0) — 200, а не " + r1.statusCode());
            java.util.Map<String, Object> m1 = Json.map(Json.parse(r1.body()));
            check(Boolean.TRUE.equals(m1.get("ok")) && Json.lng(m1.get("rev")) == 1, "resurrect: первый save ok, rev=1");
            check(java.nio.file.Files.exists(chatFile), "resurrect: файл после первого save создан");

            stRes.deleteChat(424242);
            check(!java.nio.file.Files.exists(chatFile), "resurrect: файл удалён (аналог /delete_my_data)");

            /* save из открытой вкладки: старый G (rev=5, с тренировками) на пустой сервер */
            java.net.http.HttpResponse<String> r2 = postSave(port, id, 5,
                "{\"rev\":5,\"nextId\":2,\"workouts\":[" + w1 + "]}");
            check(r2.statusCode() == 409, "resurrect: stale save отклонён 409, а не " + r2.statusCode());
            java.util.Map<String, Object> m2 = Json.map(Json.parse(r2.body()));
            check(Boolean.FALSE.equals(m2.get("ok")) && Json.lng(m2.get("rev")) == 0, "resurrect: тело 409 {ok:false, rev:0}");
            check(!java.nio.file.Files.exists(chatFile), "resurrect: файл не воскрес после stale save");
            check(stRes.load(424242).workouts.isEmpty(), "resurrect: серверное состояние осталось пустым");

            /* свежая вкладка (rev=0, пустой G) — легитимный save проходит */
            java.net.http.HttpResponse<String> r3 = postSave(port, id, 0,
                "{\"rev\":0,\"nextId\":1,\"workouts\":[]}");
            check(r3.statusCode() == 200, "resurrect: пустой save от свежей вкладки — 200, а не " + r3.statusCode());
            check(java.nio.file.Files.exists(chatFile), "resurrect: файл после пустого save создан заново (уже пустой)");
        } catch (Exception resErr) {
            throw new AssertionError("CONTRACT FAIL: resurrect " + resErr);
        }

        /* [UX-T29] merge-защита birth-полей: save профиля от клиента без birth-ключей
           (старый кэш JS) не теряет дату рождения текущего профиля — реальный WebServer */
        try {
            java.nio.file.Path tmpB = java.nio.file.Files.createTempDirectory("gymbirth");
            Storage stB = new Storage(tmpB);
            WebServer wsB = new WebServer("contract-test-token", stB, tmpB, new Stats(tmpB.resolve("stats.json")));
            java.net.ServerSocket probeB = new java.net.ServerSocket(0);
            int portB = probeB.getLocalPort();
            probeB.close();
            wsB.start(portB);
            String idB = tgInitData("contract-test-token", 424243);
            java.time.LocalDate todayB = java.time.LocalDate.now();
            int mirror = todayB.getYear() - 1990 - (todayB.getMonthValue() < 11 ? 1 : 0);
            /* клиент с датой: birth-пара + age-зеркало = вычисленный возраст */
            java.net.http.HttpResponse<String> rb1 = postSave(portB, idB, 0,
                "{\"rev\":0,\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":" + mirror + ",\"height\":178,\"weight\":78.5,\"birthYear\":1990,\"birthMonth\":11},\"workouts\":[]}");
            check(rb1.statusCode() == 200, "birth merge: save с датой — 200, а не " + rb1.statusCode());
            GymData savedB = stB.load(424243);
            check(savedB.profile != null && savedB.profile.birthYear == 1990 && savedB.profile.birthMonth == 11,
                "birth merge: дата сохранена");
            /* старый кэш JS: профиль без birth-ключей — дата переживает merge */
            java.net.http.HttpResponse<String> rb2 = postSave(portB, idB, 1,
                "{\"rev\":1,\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":50,\"height\":180,\"weight\":82},\"workouts\":[]}");
            check(rb2.statusCode() == 200, "birth merge: save без birth-ключей — 200, а не " + rb2.statusCode());
            GymData mergedB = stB.load(424243);
            check(mergedB.profile.birthYear == 1990 && mergedB.profile.birthMonth == 11,
                "birth merge: дата пережила merge от клиента без birth-ключей");
            check(mergedB.profile.age == 50, "birth merge: сервер — не редактор, age = что прислал клиент");
            /* клиент с датой снова сохраняет пару — зеркало обновляется вычисленным */
            java.net.http.HttpResponse<String> rb3 = postSave(portB, idB, 2,
                "{\"rev\":2,\"nextId\":1,\"profile\":{\"sex\":\"м\",\"age\":" + mirror + ",\"height\":178,\"weight\":78.5,\"birthYear\":1990,\"birthMonth\":11},\"workouts\":[]}");
            check(rb3.statusCode() == 200, "birth merge: повторный save с датой — 200, а не " + rb3.statusCode());
            GymData backB = stB.load(424243);
            check(backB.profile.age == mirror && backB.profile.birthYear == 1990 && backB.profile.birthMonth == 11,
                "birth merge: зеркало обновлено клиентом с датой");
        } catch (Exception birthErr) {
            throw new AssertionError("CONTRACT FAIL: birth merge " + birthErr);
        }

        /* [ANA-T1] Stats: /stats за токеном (404 без токена/с неверным — не палим существование),
           инкременты maInit/maSave/workoutsCreated/workoutsCompleted при init/save,
           недельные агрегаты ISO, файл stats.json и ротация недель.
           Реальный WebServer на эфемерном порту (env GYM_ADMIN_TOKEN в тестах не задан →
           действует токен бота). */
        try {
            java.nio.file.Path tmpS = java.nio.file.Files.createTempDirectory("gymstats");
            java.nio.file.Path statsFile = tmpS.resolve("stats.json");
            Storage stS = new Storage(tmpS);
            Stats counter = new Stats(statsFile);
            WebServer wsS = new WebServer("contract-test-token", stS, tmpS, counter);
            java.net.ServerSocket probeS = new java.net.ServerSocket(0);
            int portS = probeS.getLocalPort();
            probeS.close();
            wsS.start(portS);
            String idS = tgInitData("contract-test-token", 424244);

            /* токен-гейт: без токена и с неверным — 404, как у несуществующей страницы */
            check(get(portS, "/stats").statusCode() == 404, "stats: без токена — 404");
            check(get(portS, "/stats?token=wrong").statusCode() == 404, "stats: неверный токен — 404");
            check(get(portS, "/stats?token=contract-test-token").statusCode() == 200, "stats: верный токен — 200");
            check(get(portS, "/stats?token=contract-test-token&x=1").statusCode() == 200, "stats: лишние параметры запроса не мешают");

            /* init + save с новой завершённой тренировкой */
            check(postInit(portS, idS).statusCode() == 200, "stats: /api/init — 200");
            String wS = "{\"id\":1,\"date\":\"2026-11-11\",\"finished\":true,\"exercises\":[]}";
            check(postSave(portS, idS, 0, "{\"rev\":0,\"nextId\":2,\"workouts\":[" + wS + "]}").statusCode() == 200,
                "stats: /api/save с новой тренировкой — 200");
            Map<String, Object> snap = Json.map(Json.parse(get(portS, "/stats?token=contract-test-token").body()));
            check(Json.lng(snap.get("maInit")) == 1, "stats: maInit=1 после init");
            check(Json.lng(snap.get("maSave")) == 1, "stats: maSave=1 после save");
            check(Json.lng(snap.get("workoutsCreated")) == 1, "stats: workoutsCreated=1 (новый id)");
            check(Json.lng(snap.get("workoutsCompleted")) == 1, "stats: workoutsCompleted=1 (прирост finished)");
            check(Json.lng(snap.get("templatesCreated")) == 0 && Json.lng(snap.get("templatesUsed")) == 0,
                "stats: шаблонные счётчики с нуля");

            /* повторный save того же workout: maSave растёт, created/completed — нет */
            check(postSave(portS, idS, 1, "{\"rev\":1,\"nextId\":2,\"workouts\":[" + wS + "]}").statusCode() == 200,
                "stats: повторный save — 200");
            snap = Json.map(Json.parse(get(portS, "/stats?token=contract-test-token").body()));
            check(Json.lng(snap.get("maSave")) == 2, "stats: maSave=2 после второго save");
            check(Json.lng(snap.get("workoutsCreated")) == 1, "stats: повторный save не растит workoutsCreated");
            check(Json.lng(snap.get("workoutsCompleted")) == 1, "stats: повторный save не растит workoutsCompleted");

            /* недельный агрегат: текущая ISO-неделя зеркалит события */
            Map<String, Object> weeks = Json.map(snap.get("weeks"));
            check(weeks != null && !weeks.isEmpty(), "stats: weeks присутствуют");
            java.time.LocalDate todayS = java.time.LocalDate.now();
            String curWeek = String.format("%04d-W%02d",
                todayS.get(java.time.temporal.WeekFields.ISO.weekBasedYear()),
                todayS.get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear()));
            Map<String, Object> cur = Json.map(weeks.get(curWeek));
            check(cur != null && Json.lng(cur.get("maInit")) == 1 && Json.lng(cur.get("maSave")) == 2
                    && Json.lng(cur.get("workoutsCreated")) == 1 && Json.lng(cur.get("workoutsCompleted")) == 1,
                "stats: недельный агрегат текущей недели зеркалит события");

            /* файл stats.json записан и перечитывается с теми же данными */
            check(java.nio.file.Files.exists(statsFile), "stats: файл stats.json создан");
            Map<String, Object> fileSnap = new Stats(statsFile).snapshot();
            check(Json.lng(fileSnap.get("maSave")) == 2 && Json.lng(fileSnap.get("workoutsCreated")) == 1,
                "stats: totals перечитываются из файла");
            Map<String, Object> fileWeeks = Json.map(fileSnap.get("weeks"));
            Map<String, Object> fileCur = fileWeeks == null ? null : Json.map(fileWeeks.get(curWeek));
            check(fileCur != null && Json.lng(fileCur.get("maSave")) == 2, "stats: недели перечитываются из файла");

            /* ротация: 30 недель в файле → остаются последние 26, старейшая вытеснена, totals не тронуты */
            StringBuilder wkKeys = new StringBuilder();
            for (int i = 30; i >= 1; i--) {
                if (wkKeys.length() > 0) wkKeys.append(',');
                java.time.LocalDate dS = todayS.minusWeeks(i);
                wkKeys.append('"').append(String.format("%04d-W%02d",
                        dS.get(java.time.temporal.WeekFields.ISO.weekBasedYear()),
                        dS.get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear())))
                    .append("\":{\"maInit\":1}");
            }
            java.nio.file.Files.writeString(statsFile,
                "{\"maInit\":30,\"weeks\":{" + wkKeys + "}}", java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Object> rot = new Stats(statsFile).snapshot();
            Map<String, Object> rotWeeks = Json.map(rot.get("weeks"));
            check(rotWeeks.size() == Stats.WEEKS_TO_KEEP,
                "stats: ротация держит " + Stats.WEEKS_TO_KEEP + " недель, а не " + rotWeeks.size());
            java.time.LocalDate dOld = todayS.minusWeeks(30);
            String oldKey = String.format("%04d-W%02d",
                dOld.get(java.time.temporal.WeekFields.ISO.weekBasedYear()),
                dOld.get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear()));
            check(!rotWeeks.containsKey(oldKey), "stats: старейшая неделя вытеснена при ротации");
            check(Json.lng(rot.get("maInit")) == 30, "stats: totals при ротации недель не трогаются");
        } catch (Exception statsErr) {
            throw new AssertionError("CONTRACT FAIL: stats " + statsErr);
        }

        /* [EXR-T7] gzip: текстовые ответы (статика + JSON) сжимаются ТОЛЬКО при
           Accept-Encoding: gzip (Content-Encoding: gzip, Vary: Accept-Encoding,
           Content-Length — сжатого размера); без заголовка — байт-в-байт как раньше;
           бинарное (img) не сжимается. Реальный WebServer на эфемерном порту,
           статика кладётся во временный webDir. */
        try {
            java.nio.file.Path tmpG = java.nio.file.Files.createTempDirectory("gymgzip");
            Storage stG = new Storage(tmpG);
            WebServer wsG = new WebServer("contract-test-token", stG, tmpG, new Stats(tmpG.resolve("stats.json")));
            java.net.ServerSocket probeG = new java.net.ServerSocket(0);
            int portG = probeG.getLocalPort();
            probeG.close();
            wsG.start(portG);
            String jsSource = "function f(){return 'жим штанги лёжа, 3 подхода по 8-10';}\n".repeat(400);
            byte[] jsBytes = jsSource.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            java.nio.file.Files.write(tmpG.resolve("app.js"), jsBytes);
            byte[] jpgBytes = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0x00, 0x10, 0x00, 0x01};
            java.nio.file.Files.createDirectories(tmpG.resolve("img"));
            java.nio.file.Files.write(tmpG.resolve("img").resolve("x.jpg"), jpgBytes);

            /* без Accept-Encoding — прежний несжатый ответ */
            java.net.http.HttpResponse<byte[]> plain = getRaw(portG, "/app.js");
            check(plain.statusCode() == 200, "gzip: GET /app.js без Accept-Encoding — 200, а не " + plain.statusCode());
            check(plain.headers().firstValue("Content-Encoding").isEmpty(),
                "gzip: без Accept-Encoding нет Content-Encoding");
            check(java.util.Arrays.equals(plain.body(), jsBytes), "gzip: без gzip тело байт-в-байт равно файлу");
            check(plain.headers().firstValue("Vary").orElse("").contains("Accept-Encoding"),
                "gzip: Vary: Accept-Encoding стоит и на несжатом варианте");

            /* с Accept-Encoding: gzip — сжатие, валидный поток, Content-Length пересчитан */
            java.net.http.HttpResponse<byte[]> packed = getRaw(portG, "/app.js", "Accept-Encoding", "gzip");
            check(packed.statusCode() == 200, "gzip: GET /app.js с gzip — 200, а не " + packed.statusCode());
            check("gzip".equals(packed.headers().firstValue("Content-Encoding").orElse(null)),
                "gzip: Content-Encoding: gzip при Accept-Encoding: gzip");
            check(packed.headers().firstValue("Vary").orElse("").contains("Accept-Encoding"), "gzip: Vary: Accept-Encoding");
            check(packed.headers().firstValue("Content-Length").orElse("").equals(String.valueOf(packed.body().length)),
                "gzip: Content-Length пересчитан на сжатый размер");
            check(packed.body().length < jsBytes.length / 2, "gzip: сжатие текста хотя бы вдвое");
            java.io.ByteArrayInputStream bin = new java.io.ByteArrayInputStream(packed.body());
            java.io.ByteArrayOutputStream unpacked = new java.io.ByteArrayOutputStream();
            try (java.util.zip.GZIPInputStream gzIn = new java.util.zip.GZIPInputStream(bin)) {
                byte[] b = new byte[4096];
                int n;
                while ((n = gzIn.read(b)) > 0) unpacked.write(b, 0, n);
            }
            check(java.util.Arrays.equals(unpacked.toByteArray(), jsBytes), "gzip: распакованный поток равен исходному файлу");

            /* второй gzip-запрос — тот же ответ из кэша сжатых байтов */
            java.net.http.HttpResponse<byte[]> cached = getRaw(portG, "/app.js", "Accept-Encoding", "gzip");
            check(java.util.Arrays.equals(cached.body(), packed.body()), "gzip: повторный запрос отдаёт те же сжатые байты (кэш)");

            /* бинарное (img) не сжимается даже с gzip-заголовком */
            java.net.http.HttpResponse<byte[]> img = getRaw(portG, "/img/x.jpg", "Accept-Encoding", "gzip");
            check(img.statusCode() == 200, "gzip: GET /img/x.jpg — 200, а не " + img.statusCode());
            check(img.headers().firstValue("Content-Encoding").isEmpty(), "gzip: бинарное img не сжимается");
            check(java.util.Arrays.equals(img.body(), jpgBytes), "gzip: img тело не тронуто");

            /* JSON API (/stats) тоже сжимается при gzip и распаковывается в валидный JSON */
            java.net.http.HttpResponse<byte[]> statsGz = getRaw(portG, "/stats?token=contract-test-token", "Accept-Encoding", "gzip");
            check(statsGz.statusCode() == 200, "gzip: GET /stats с gzip — 200, а не " + statsGz.statusCode());
            check("gzip".equals(statsGz.headers().firstValue("Content-Encoding").orElse(null)), "gzip: JSON API сжат");
            Map<String, Object> statsJson = Json.map(Json.parse(
                new String(unpack(statsGz.body()), java.nio.charset.StandardCharsets.UTF_8)));
            check(statsJson != null, "gzip: распакованный /stats — валидный JSON");
            java.net.http.HttpResponse<byte[]> statsPlain = getRaw(portG, "/stats?token=contract-test-token");
            check(statsPlain.headers().firstValue("Content-Encoding").isEmpty(), "gzip: /stats без gzip — несжатый");
        } catch (Exception gzipErr) {
            throw new AssertionError("CONTRACT FAIL: gzip " + gzipErr);
        }

        System.out.println("CONTRACT OK");
        System.exit(0);
    }

    /* [ONB-T2] initData, подписанный по правилам Telegram: checkString строится по
       декодированным значениям, отсортированным по ключу (так читает их WebServer.validateInitData);
       secret = HMAC-SHA256(token, "WebAppData"), hash = HMAC-SHA256(secret, checkString) */
    static String tgInitData(String token, long userId) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("WebAppData".getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] secret = mac.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String userJson = "{\"id\":" + userId + ",\"first_name\":\"Test\"}";
        java.util.TreeMap<String, String> p = new java.util.TreeMap<>();
        p.put("auth_date", "1700000000");
        p.put("user", userJson);
        StringBuilder check = new StringBuilder();
        for (java.util.Map.Entry<String, String> en : p.entrySet()) {
            if (check.length() > 0) check.append('\n');
            check.append(en.getKey()).append('=').append(en.getValue());
        }
        mac.init(new javax.crypto.spec.SecretKeySpec(secret, "HmacSHA256"));
        byte[] h = mac.doFinal(check.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : h) hex.append(String.format("%02x", b));
        return "auth_date=1700000000&hash=" + hex + "&user="
            + java.net.URLEncoder.encode(userJson, java.nio.charset.StandardCharsets.UTF_8);
    }

    /* POST /api/save в тестовый WebServer: rev — верхнеуровневый rev клиента (как у doSave) */
    static java.net.http.HttpResponse<String> postSave(int port, String initData, long rev, String dataJson) throws Exception {
        String payload = "{\"initData\":\"" + initData + "\",\"rev\":" + rev + ",\"data\":" + dataJson + "}";
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + port + "/api/save"))
            .header("Content-Type", "application/json")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload, java.nio.charset.StandardCharsets.UTF_8))
            .build();
        return java.net.http.HttpClient.newHttpClient()
            .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    /* POST /api/init в тестовый WebServer */
    static java.net.http.HttpResponse<String> postInit(int port, String initData) throws Exception {
        String payload = "{\"initData\":\"" + initData + "\"}";
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + port + "/api/init"))
            .header("Content-Type", "application/json")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload, java.nio.charset.StandardCharsets.UTF_8))
            .build();
        return java.net.http.HttpClient.newHttpClient()
            .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    /* GET произвольного пути (для /stats) */
    static java.net.http.HttpResponse<String> get(int port, String pathAndQuery) throws Exception {
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + port + pathAndQuery))
            .GET()
            .build();
        return java.net.http.HttpClient.newHttpClient()
            .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    /* GET с произвольными заголовками и сырым телом (для gzip [EXR-T7]: java.net.http
       не декомпрессирует сам — приходят ровно те байты, что послал сервер) */
    static java.net.http.HttpResponse<byte[]> getRaw(int port, String pathAndQuery, String... headers) throws Exception {
        java.net.http.HttpRequest.Builder b = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + port + pathAndQuery));
        for (int i = 0; i + 1 < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        return java.net.http.HttpClient.newHttpClient()
            .send(b.GET().build(), java.net.http.HttpResponse.BodyHandlers.ofByteArray());
    }

    /* распаковка gzip-тела ответа */
    static byte[] unpack(byte[] packed) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (java.util.zip.GZIPInputStream gzIn = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(packed))) {
            byte[] b = new byte[4096];
            int n;
            while ((n = gzIn.read(b)) > 0) out.write(b, 0, n);
        }
        return out.toByteArray();
    }
}
