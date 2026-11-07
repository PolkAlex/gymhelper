import gym.BotLogic;
import gym.ExerciseEntry;
import gym.GymData;
import gym.Json;
import gym.Records;
import gym.SetEntry;
import gym.Storage;
import gym.Template;
import gym.TemplateExercise;
import gym.Workout;

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

        /* Storage.chatIds [UX-T16]: id из имён chat_<id>.json, чужие/мусорные файлы и бэкапы не попадают */
        try {
            java.nio.file.Path tmpChats = java.nio.file.Files.createTempDirectory("gymchats");
            Storage stChats = new Storage(tmpChats);
            java.nio.file.Files.writeString(tmpChats.resolve("chat_111.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_222.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_notanumber.json"), "{}");
            java.nio.file.Files.writeString(tmpChats.resolve("chat_333.old.json"), "{}");
            java.nio.file.Files.createDirectories(tmpChats.resolve("backups"));
            java.nio.file.Files.writeString(tmpChats.resolve("backups").resolve("chat_444.1700000000000.json"), "{}");
            java.util.List<Long> ids = stChats.chatIds();
            check(ids.size() == 2 && ids.contains(111L) && ids.contains(222L),
                "chatIds: только chat_<id>.json, мусор и backups не попадают");
        } catch (Exception chatsErr) {
            throw new AssertionError("CONTRACT FAIL: chatIds " + chatsErr);
        }

        System.out.println("CONTRACT OK");
        System.exit(0);
    }
}
