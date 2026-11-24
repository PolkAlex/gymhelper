import gym.BotLogic;
import gym.ExerciseEntry;
import gym.GymData;
import gym.Goal;
import gym.Json;
import gym.ProfileData;
import gym.Records;
import gym.SetEntry;
import gym.SocialData;
import gym.SocialInvite;
import gym.SocialLink;
import gym.SocialReport;
import gym.SocialRequest;
import gym.SocialStore;
import gym.Stats;
import gym.Storage;
import gym.TelegramApi;
import gym.Template;
import gym.TemplateExercise;
import gym.TrainerCard;
import gym.Workout;
import gym.web.CardRender;
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

        /* [GOA-S1] goals/goalRemind: legacy без ключей читается и пишется байт-в-байт;
           round-trip цели без потерь; битые элементы пропускаются; goalRemind — только Boolean */
        check(d2.goals.isEmpty() && d2.goalRemind == null, "goals: legacy без ключей читается (пустой список, null)");
        String noGoalsOut = Json.write(d2.toJson());
        check(!noGoalsOut.contains("\"goals\"") && !noGoalsOut.contains("\"goalRemind\""),
            "toJson без целей не пишет ключи goals/goalRemind (legacy байт-в-байт)");
        String goalJson = "{\"nextId\":24,\"goals\":[" +
            "{\"id\":17,\"type\":1,\"ex\":\"Жим лёжа\",\"target\":100,\"start\":\"2026-11-13\",\"end\":\"2026-12-31\",\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":18,\"type\":2,\"target\":12,\"start\":\"2026-11-01\",\"end\":\"2026-11-30\",\"status\":2,\"doneDate\":\"2026-11-28\",\"doneValue\":13}," +
            "{\"id\":19,\"type\":1,\"ex\":\"Становая\",\"target\":140,\"start\":\"2026-11-13\",\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":20,\"type\":9,\"target\":5,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":21,\"type\":1,\"target\":0,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":22,\"type\":1,\"target\":80,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "\"мусор\"," +
            "{\"id\":23,\"type\":2,\"target\":10,\"start\":\"2026-11-01\",\"end\":\"2026-12-31\",\"status\":1,\"doneDate\":\"\",\"doneValue\":0,\"note\":\"x\"}" +
            "],\"goalRemind\":false,\"workouts\":[]}";
        GymData dg = GymData.fromJson((Map<String, Object>) Json.parse(goalJson));
        check(dg.goals.size() == 4, "goals: валидные читаются, битые (тип/target/ex/мусор) пропускаются, а не " + dg.goals.size());
        Goal g0 = dg.goals.get(0);
        check(g0.id == 17 && g0.type == 1 && "Жим лёжа".equals(g0.exercise) && g0.target == 100
                && "2026-11-13".equals(g0.start) && "2026-12-31".equals(g0.end) && g0.status == 1
                && "".equals(g0.doneDate) && g0.doneValue == 0,
            "goal: силовая (ex/target/start/end/status) читается как записана");
        Goal g1 = dg.goals.get(1);
        check(g1.type == 2 && g1.status == 2 && "2026-11-28".equals(g1.doneDate) && g1.doneValue == 13,
            "goal: достигнутая частота хранит doneDate/doneValue");
        check(dg.goals.get(2).id == 19 && dg.goals.get(2).end == null, "goal: ключа end нет → без срока (null)");
        check(Boolean.FALSE.equals(dg.goalRemind), "goalRemind=false читается");
        String goalOut = Json.write(dg.toJson());
        check(goalOut.contains("\"goals\":") && goalOut.contains("\"ex\":\"Жим лёжа\"") && goalOut.contains("\"goalRemind\":false"),
            "toJson пишет goals (ключ «ex») и goalRemind");
        check(!goalOut.contains("\"note\""), "toJson отбрасывает незнакомые ключи цели");
        GymData dg2 = GymData.fromJson((Map<String, Object>) Json.parse(goalOut));
        check(dg2.goals.size() == 4 && "Жим лёжа".equals(dg2.goals.get(0).exercise)
                && dg2.goals.get(1).doneValue == 13 && dg2.goals.get(2).end == null
                && Boolean.FALSE.equals(dg2.goalRemind),
            "goals/goalRemind переживают round-trip без потерь");
        GymData dgr = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":1,\"goals\":[],\"goalRemind\":\"да\",\"workouts\":[]}"));
        check(dgr.goalRemind == null, "goalRemind не-Boolean игнорируется (null = дефолт «вкл»)");
        GymData dgrTrue = GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":1,\"goalRemind\":true,\"workouts\":[]}"));
        check(Boolean.TRUE.equals(dgrTrue.goalRemind) && Json.write(dgrTrue.toJson()).contains("\"goalRemind\":true"),
            "goalRemind=true: читается и пишется");

        /* [UX-I16] shareId публичной ссылки: legacy-файл (фикстура d2 выше без ключа) читается
            как раньше; ключ пишется только у тренировок, которыми делились; round-trip без потерь */
        check(w2.shareId == null, "share: legacy тренировка без shareId читается (null)");
        check(!Json.write(d2.toJson()).contains("shareId"), "share: toJson без шеринга не пишет ключ shareId (legacy байт-в-байт)");
        GymData ds = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":3,\"workouts\":[{\"id\":1,\"date\":\"2026-11-16\",\"finished\":true,\"shareId\":\"9kQz4vTm2wR8pLd1XaBc5e\",\"exercises\":[]},{\"id\":2,\"date\":\"2026-11-17\",\"finished\":false,\"exercises\":[]}]}"));
        check("9kQz4vTm2wR8pLd1XaBc5e".equals(ds.findById(1).shareId), "share: shareId тренировки читается");
        check(ds.findById(2).shareId == null, "share: тренировка без ключа shareId → null");
        String shareOut = Json.write(ds.toJson());
        check(shareOut.contains("\"shareId\":\"9kQz4vTm2wR8pLd1XaBc5e\""), "share: toJson пишет shareId заданной тренировки");
        GymData ds2 = GymData.fromJson((Map<String, Object>) Json.parse(shareOut));
        check("9kQz4vTm2wR8pLd1XaBc5e".equals(ds2.findById(1).shareId), "share: shareId переживает round-trip");
        /* мусорное значение не валит чтение файла */
        GymData dsBad = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"workouts\":[{\"id\":1,\"finished\":true,\"shareId\":42,\"exercises\":[]}]}"));
        check(dsBad.findById(1).shareId == null, "share: shareId не-строкой игнорируется (null, без падения)");

        /* [UX-S17] заметка тренировки: legacy-файл (фикстура d2 выше без ключа) читается
            как раньше и не получает ключа при записи; round-trip строки с переносами и
            эмодзи без потерь; мусор/пустая строка → null, без падения чтения */
        check(w2.note == null, "note: legacy тренировка без note читается (null)");
        check(!Json.write(d2.toJson()).contains("\"note\""), "note: toJson без заметки не пишет ключ (legacy байт-в-байт)");
        String noteText = "Тяга пошла легче — попробовать 50 кг.\nПлечо после жима — следить 🧘 \"само пройдёт\"";
        GymData dnote = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":2,\"workouts\":[{\"id\":1,\"date\":\"2026-11-23\",\"started\":\"2026-11-23T18:30:00\"," +
            "\"finished\":true,\"title\":\"\",\"nutrition\":\"вода\"," +
            "\"note\":\"" + noteText.replace("\n", "\\n").replace("\"", "\\\"") + "\",\"exercises\":[]}]}"));
        check(noteText.equals(dnote.findById(1).note), "note: строка с переносами, эмодзи и кавычками читается как есть");
        String noteOut = Json.write(dnote.toJson());
        check(noteOut.contains("\"note\":\"Тяга пошла легче"), "note: toJson пишет заметку (после nutrition)");
        GymData dnote2 = GymData.fromJson((Map<String, Object>) Json.parse(noteOut));
        check(noteText.equals(dnote2.findById(1).note), "note: заметка переживает round-trip без потерь");
        GymData dnoteBad = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"workouts\":[{\"id\":1,\"finished\":true,\"note\":42,\"exercises\":[]}]}"));
        check(dnoteBad.findById(1).note == null, "note: не-строкой игнорируется (null, без падения)");
        check(!Json.write(dnoteBad.toJson()).contains("\"note\""), "note: toJson после мусорного значения ключ не пишет");
        GymData dnoteEmpty = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"workouts\":[{\"id\":1,\"finished\":true,\"note\":\"\",\"exercises\":[]}]}"));
        check(dnoteEmpty.findById(1).note == null && !Json.write(dnoteEmpty.toJson()).contains("\"note\""),
            "note: пустая строка = заметки нет, ключ в JSON не пишется");

        /* [UX-I16] opt-in имени владельца ссылки: ключей нет → анонимно (ПДн-минимализм §5);
            shareName — только Boolean, shareOwner — строка; пишутся только когда заданы */
        check(d2.shareName == null && d2.shareOwner == null, "shareName: legacy без ключей → null (анонимно)");
        check(!noGoalsOut.contains("shareName") && !noGoalsOut.contains("shareOwner"),
            "shareName: toJson анонимного пользователя не пишет opt-in ключи");
        GymData dn = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"shareName\":true,\"shareOwner\":\"Антон\",\"workouts\":[]}"));
        check(Boolean.TRUE.equals(dn.shareName) && "Антон".equals(dn.shareOwner), "shareName: opt-in и имя читаются");
        GymData dn2 = GymData.fromJson((Map<String, Object>) Json.parse(Json.write(dn.toJson())));
        check(Boolean.TRUE.equals(dn2.shareName) && "Антон".equals(dn2.shareOwner), "shareName: round-trip opt-in без потерь");
        GymData dnb = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"shareName\":\"да\",\"shareOwner\":42,\"workouts\":[]}"));
        check(dnb.shareName == null && dnb.shareOwner == null, "shareName: мусор (не Boolean/не строка) игнорируется без падения");

        /* [EXR-T13] customEx/favs: legacy без ключей читается (пустые списки) и пишется
            байт-в-байт; round-trip без потерь; битые элементы и дубликаты имён пропускаются */
        check(d2.customEx.isEmpty() && d2.favs.isEmpty(), "customEx/favs: legacy без ключей читается (пустые списки)");
        String noCexOut = Json.write(d2.toJson());
        check(!noCexOut.contains("customEx") && !noCexOut.contains("favs"),
            "customEx/favs: toJson без своих/любимых не пишет ключи (legacy байт-в-байт)");
        /* [EXR-T19] customExHidden (томстоны удалённых «своих»): legacy без ключа читается
            (пустой список); toJson без удалённых ключ не пишет (legacy байт-в-байт);
            непустой список читается и переживает round-trip; дубли/мусор/не-строки пропускаются */
        check(d2.customExHidden.isEmpty(), "customExHidden: legacy без ключа читается (пустой список)");
        check(!noCexOut.contains("customExHidden"), "customExHidden: toJson без удалённых не пишет ключ (legacy байт-в-байт)");
        String hidJson = "{\"nextId\":2,\"customExHidden\":[" +
            "\"жим лёжа 45\"," +
            "\"жим лёжа 45\"," +
            "\"\"," +
            "\"   \"," +
            "42," +
            "\"жим лёжа 45\"" +
            "],\"workouts\":[]}";
        GymData dhid = GymData.fromJson((Map<String, Object>) Json.parse(hidJson));
        check(dhid.customExHidden.size() == 1 && "жим лёжа 45".equals(dhid.customExHidden.get(0)),
            "customExHidden: имя томстона читается, дубли/мусор/не-строки пропускаются, а не " + dhid.customExHidden.size());
        String hidOut = Json.write(dhid.toJson());
        check(hidOut.contains("\"customExHidden\":[\"жим лёжа 45\"]"), "customExHidden: toJson пишет список томстонов");
        GymData dhid2 = GymData.fromJson((Map<String, Object>) Json.parse(hidOut));
        check(dhid2.customExHidden.size() == 1 && "жим лёжа 45".equals(dhid2.customExHidden.get(0)),
            "customExHidden переживает round-trip без потерь");
        String cexJson = "{\"nextId\":2,\"customEx\":[" +
            "{\"n\":\"Жим Свенда стоя\",\"tags\":[\"m:chest\",\"m:shoulders\"]}," +
            "{\"n\":\"Фермерская прогулка\",\"tags\":[]}," +
            "{\"n\":\"жим свенда стоя\",\"tags\":[\"m:chest\"]}," +
            "{\"n\":\"   \"}," +
            "{\"n\":\"Очень длинное имя — " + "х".repeat(70) + "\"}," +
            "\"мусор\"," +
            "{\"n\":\"Жим Свенда стоя\"}" +
            "],\"favs\":[\"Жим Свенда стоя\",\"Фермерская прогулка\",\"Жим Свенда стоя\",\"\",42],\"workouts\":[]}";
        GymData dcx = GymData.fromJson((Map<String, Object>) Json.parse(cexJson));
        check(dcx.customEx.size() == 2, "customEx: дубликаты имён (без учёта регистра) и битые элементы пропускаются, а не " + dcx.customEx.size());
        check("Жим Свенда стоя".equals(dcx.customEx.get(0).n) && dcx.customEx.get(0).tags.size() == 2
                && "m:chest".equals(dcx.customEx.get(0).tags.get(0)) && "m:shoulders".equals(dcx.customEx.get(0).tags.get(1)),
            "customEx: имя + теги групп читаются");
        check("Фермерская прогулка".equals(dcx.customEx.get(1).n) && dcx.customEx.get(1).tags.isEmpty(),
            "customEx: своё без групп (tags пуст) читается");
        check(dcx.favs.size() == 2 && "Жим Свенда стоя".equals(dcx.favs.get(0)) && "Фермерская прогулка".equals(dcx.favs.get(1)),
            "favs: имена читаются, дубли/мусор/не-строки пропускаются");
        String cexOut = Json.write(dcx.toJson());
        check(cexOut.contains("\"customEx\":[{\"n\":\"Жим Свенда стоя\",\"tags\":[\"m:chest\",\"m:shoulders\"]}")
                && cexOut.contains("\"favs\":[\"Жим Свенда стоя\",\"Фермерская прогулка\"]"),
            "customEx/favs: toJson пишет списки");
        GymData dcx2 = GymData.fromJson((Map<String, Object>) Json.parse(cexOut));
        check(dcx2.customEx.size() == 2 && dcx2.customEx.get(0).tags.size() == 2
                && "Фермерская прогулка".equals(dcx2.customEx.get(1).n)
                && dcx2.favs.size() == 2,
            "customEx/favs переживают round-trip без потерь");
        /* [FIT-T2] мусорный tags у «своего»: не массив или не-строки внутри — игнор,
            запись читается как «своё» без групп (карта мышц не падает на старых файлах) */
        String cexTrash = "{\"nextId\":1,\"customEx\":[" +
            "{\"n\":\"Тяга в своей раме\",\"tags\":\"мусор\"}," +
            "{\"n\":\"Жим в своей раме\",\"tags\":42}," +
            "{\"n\":\"Становая своя\",\"tags\":[42,null,\"\",\"   \"," + "\"" + "x".repeat(41) + "\",\"m:back\"]}," +
            "{\"n\":\"Гиперэкстензия своя\",\"tags\":[]}" +
            "],\"workouts\":[]}";
        GymData dcxt = GymData.fromJson((Map<String, Object>) Json.parse(cexTrash));
        check(dcxt.customEx.size() == 4, "customEx: мусорный tags не роняет чтение, все записи на месте, а не " + dcxt.customEx.size());
        check(dcxt.customEx.get(0).tags.isEmpty() && dcxt.customEx.get(1).tags.isEmpty(),
            "customEx: tags-не-массив игнорируется (группы не указаны)");
        check(dcxt.customEx.get(2).tags.size() == 1 && "m:back".equals(dcxt.customEx.get(2).tags.get(0)),
            "customEx: не-строки/пустые/слишком длинные теги пропускаются, валидный остаётся");
        GymData dcxt2 = GymData.fromJson((Map<String, Object>) Json.parse(Json.write(dcxt.toJson())));
        check(dcxt2.customEx.get(0).tags.isEmpty() && dcxt2.customEx.get(2).tags.size() == 1,
            "customEx: мусорный tags переживает round-trip (не-массив не пишется обратно)");

        /* [GOA-S1] переименование упражнения обновляет ex ТОЛЬКО активных силовых целей (§4.3) */
        GymData grn = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":5,\"goals\":[" +
            "{\"id\":1,\"type\":1,\"ex\":\"Жим\",\"target\":100,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":2,\"type\":1,\"ex\":\"Жим\",\"target\":100,\"status\":2,\"doneDate\":\"2026-11-15\",\"doneValue\":101}," +
            "{\"id\":3,\"type\":1,\"ex\":\"Жим\",\"target\":100,\"status\":4,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":4,\"type\":2,\"target\":12,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}," +
            "{\"id\":5,\"type\":1,\"ex\":\"Тяга\",\"target\":140,\"status\":1,\"doneDate\":\"\",\"doneValue\":0}" +
            "],\"workouts\":[]}"));
        Goal.renameExercise(grn, "жим", "Жим сидя");
        check("Жим сидя".equals(grn.goals.get(0).exercise), "rename: ex активной цели обновлён (без учёта регистра)");
        check("Жим".equals(grn.goals.get(1).exercise) && grn.goals.get(1).status == 2,
            "rename: достигнутая цель не тронута (источник строки архива — doneDate/doneValue)");
        check("Жим".equals(grn.goals.get(2).exercise) && grn.goals.get(2).status == 4,
            "rename: отменённая цель не тронута");
        check(grn.goals.get(3).exercise == null, "rename: частотная цель (ex null) — без падения");
        check("Тяга".equals(grn.goals.get(4).exercise), "rename: чужое упражнение не тронуто");
        Goal.renameExercise(grn, null, "X");
        Goal.renameExercise(grn, "Жим сидя", "Жим сидя");
        check("Жим сидя".equals(grn.goals.get(0).exercise), "rename: null/то же имя — no-op");

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

        /* [GOA-S1] merge-защита целей при /api/save: клиент с ключом goals замещает список
           целиком (создание/отмена доезжают); старый кэш JS без ключа goals цели не теряет;
           goalRemind затирается только реальным значением. Реальный WebServer на эфемерном порту. */
        try {
            java.nio.file.Path tmpGl = java.nio.file.Files.createTempDirectory("gymgoalm");
            Storage stGl = new Storage(tmpGl);
            WebServer wsGl = new WebServer("contract-test-token", stGl, tmpGl, new Stats(tmpGl.resolve("stats.json")));
            java.net.ServerSocket probeGl = new java.net.ServerSocket(0);
            int portGl = probeGl.getLocalPort();
            probeGl.close();
            wsGl.start(portGl);
            String idGl = tgInitData("contract-test-token", 424247);
            java.net.http.HttpResponse<String> rg1 = postSave(portGl, idGl, 0,
                "{\"rev\":0,\"nextId\":2,\"goals\":[{\"id\":1,\"type\":1,\"ex\":\"Жим\",\"target\":100,\"start\":\"2026-11-13\",\"end\":\"2026-12-31\",\"status\":1,\"doneDate\":\"\",\"doneValue\":0}],\"goalRemind\":false,\"workouts\":[]}");
            check(rg1.statusCode() == 200, "goals merge: save с целями — 200, а не " + rg1.statusCode());
            GymData savedGl = stGl.load(424247);
            check(savedGl.goals.size() == 1 && "Жим".equals(savedGl.goals.get(0).exercise)
                    && Boolean.FALSE.equals(savedGl.goalRemind),
                "goals merge: цель и тогл сохранены");
            java.net.http.HttpResponse<String> rg2 = postSave(portGl, idGl, 1,
                "{\"rev\":1,\"nextId\":2,\"workouts\":[]}");
            check(rg2.statusCode() == 200, "goals merge: save без ключа goals — 200, а не " + rg2.statusCode());
            GymData mergedGl = stGl.load(424247);
            check(mergedGl.goals.size() == 1 && "Жим".equals(mergedGl.goals.get(0).exercise)
                    && Boolean.FALSE.equals(mergedGl.goalRemind),
                "goals merge: старый клиент без ключа goals цели и тогл не теряет");
            java.net.http.HttpResponse<String> rg3 = postSave(portGl, idGl, 2,
                "{\"rev\":2,\"nextId\":2,\"goals\":[],\"workouts\":[]}");
            check(rg3.statusCode() == 200, "goals merge: save с пустым goals — 200, а не " + rg3.statusCode());
            check(stGl.load(424247).goals.isEmpty(), "goals merge: пустой список целей замещает старый (отмена доезжает)");
            /* регресс ревью: сырой клиентский payload с клиентским ключом «exercise»
               (без «ex») — сервер сохраняет цель, merge не теряет (§10.2) */
            java.net.http.HttpResponse<String> rg4 = postSave(portGl, idGl, 3,
                "{\"rev\":3,\"nextId\":3,\"goals\":[{\"id\":2,\"type\":1,\"exercise\":\"Тяга\",\"target\":140,\"start\":\"2026-11-18\",\"end\":\"2026-12-31\",\"status\":1,\"doneDate\":\"\",\"doneValue\":0}],\"workouts\":[]}");
            check(rg4.statusCode() == 200, "goals merge: save с ключом exercise — 200, а не " + rg4.statusCode());
            GymData wireGl = stGl.load(424247);
            check(wireGl.goals.size() == 1 && "Тяга".equals(wireGl.goals.get(0).exercise),
                "goals merge: клиентский ключ exercise не теряет цель");
            check(Json.write(wireGl.toJson()).contains("\"ex\":\"Тяга\"") && !Json.write(wireGl.toJson()).contains("\"exercise\""),
                "goals merge: toJson пишет серверный ключ ex (без exercise)");
        } catch (Exception goalErr) {
            throw new AssertionError("CONTRACT FAIL: goals merge " + goalErr);
        }

        /* [UX-T40] разминка по дефолту: GymData warmupFirst/warmupEx — legacy без ключей
            читается (null = выкл/«Разминка»), round-trip без потерь, null/пустая строка
            не пишутся в JSON; merge через /api/save: явный null «Разминки» доезжает до
            сервера, клиент без ключей серверные значения не затирает. Реальный WebServer. */
        check(d2.warmupFirst == null && d2.warmupEx == null,
            "warmup: legacy без ключей читается (null = выкл/системная «Разминка»)");
        check(!Json.write(d2.toJson()).contains("warmup"),
            "warmup: toJson без настройки не пишет ключи (legacy байт-в-байт)");
        GymData dw = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"warmupFirst\":true,\"warmupEx\":\"wcardio\",\"workouts\":[]}"));
        check(Boolean.TRUE.equals(dw.warmupFirst) && "wcardio".equals(dw.warmupEx),
            "warmup: тогл и id каталогного упражнения читаются");
        GymData dw2 = GymData.fromJson((Map<String, Object>) Json.parse(Json.write(dw.toJson())));
        check(Boolean.TRUE.equals(dw2.warmupFirst) && "wcardio".equals(dw2.warmupEx),
            "warmup: round-trip тогл+id без потерь");
        GymData dwn = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"warmupFirst\":false,\"warmupEx\":\"\",\"workouts\":[]}"));
        check(Boolean.FALSE.equals(dwn.warmupFirst) && dwn.warmupEx == null,
            "warmup: false читается, пустая строка id → null (системная «Разминка»)");
        String warmNullOut = Json.write(dwn.toJson());
        check(warmNullOut.contains("\"warmupFirst\":false") && !warmNullOut.contains("warmupEx"),
            "warmup: toJson пишет false явно («выключил» переживает сохранение), null-id — ключа нет");
        GymData dwb = GymData.fromJson((Map<String, Object>) Json.parse(
            "{\"nextId\":1,\"warmupFirst\":\"да\",\"warmupEx\":42,\"workouts\":[]}"));
        check(dwb.warmupFirst == null && dwb.warmupEx == null,
            "warmup: мусор (не Boolean/не строка) игнорируется без падения");
        try {
            java.nio.file.Path tmpW = java.nio.file.Files.createTempDirectory("gymwarm");
            Storage stW = new Storage(tmpW);
            WebServer wsW = new WebServer("contract-test-token", stW, tmpW, new Stats(tmpW.resolve("stats.json")));
            java.net.ServerSocket probeW = new java.net.ServerSocket(0);
            int portW = probeW.getLocalPort();
            probeW.close();
            wsW.start(portW);
            String idW = tgInitData("contract-test-token", 424248);
            /* клиент включает настройку и выбирает каталогное упражнение */
            java.net.http.HttpResponse<String> rw1 = postSave(portW, idW, 0,
                "{\"rev\":0,\"nextId\":1,\"warmupFirst\":true,\"warmupEx\":\"wcardio\",\"workouts\":[]}");
            check(rw1.statusCode() == 200, "warmup merge: save с настройкой — 200, а не " + rw1.statusCode());
            GymData savedW = stW.load(424248);
            check(Boolean.TRUE.equals(savedW.warmupFirst) && "wcardio".equals(savedW.warmupEx),
                "warmup merge: тогл и id сохранены");
            /* возврат к системной «Разминке» = явный null-ключ — сброс доезжает до сервера */
            java.net.http.HttpResponse<String> rw2 = postSave(portW, idW, 1,
                "{\"rev\":1,\"nextId\":1,\"warmupFirst\":true,\"warmupEx\":null,\"workouts\":[]}");
            check(rw2.statusCode() == 200, "warmup merge: save с явным null — 200, а не " + rw2.statusCode());
            GymData clearedW = stW.load(424248);
            check(clearedW.warmupEx == null && !Json.write(clearedW.toJson()).contains("warmupEx"),
                "warmup merge: явный null сбрасывает id (ключа в файле нет)");
            /* старый кэш JS: ключей нет — включённый тоггл не теряется */
            java.net.http.HttpResponse<String> rw3 = postSave(portW, idW, 2,
                "{\"rev\":2,\"nextId\":1,\"workouts\":[]}");
            check(rw3.statusCode() == 200, "warmup merge: save без ключей — 200, а не " + rw3.statusCode());
            GymData mergedW = stW.load(424248);
            check(Boolean.TRUE.equals(mergedW.warmupFirst), "warmup merge: клиент без ключей не затирает тогл");
        } catch (Exception warmErr) {
            throw new AssertionError("CONTRACT FAIL: warmup merge " + warmErr);
        }

        /* [EXR-T13] merge-защита «Своих»/«Любимых» при /api/save: клиент с ключами customEx/favs
            замещает списки целиком (создание/удаление из Любимых доезжают); старый кэш JS без
            ключей данные не теряет; пустые списки замещают старые. Реальный WebServer.
            [EXR-T19] томстоны customExHidden — та же merge-политика: с ключом замещаются,
            без ключа не затираются, пустой список очищает. */
        try {
            java.nio.file.Path tmpCx = java.nio.file.Files.createTempDirectory("gymcex");
            Storage stCx = new Storage(tmpCx);
            WebServer wsCx = new WebServer("contract-test-token", stCx, tmpCx, new Stats(tmpCx.resolve("stats.json")));
            java.net.ServerSocket probeCx = new java.net.ServerSocket(0);
            int portCx = probeCx.getLocalPort();
            probeCx.close();
            wsCx.start(portCx);
            String idCx = tgInitData("contract-test-token", 424248);
            java.net.http.HttpResponse<String> rc1 = postSave(portCx, idCx, 0,
                "{\"rev\":0,\"nextId\":1,\"customEx\":[" +
                    "{\"n\":\"Жим Свенда стоя\",\"tags\":[\"m:chest\",\"m:shoulders\"]}," +
                    "{\"n\":\"жим свенда стоя\",\"tags\":[]}],\"favs\":[\"Жим Свенда стоя\"]," +
                    "\"customExHidden\":[\"жим лёжа 45\"],\"workouts\":[]}");
            check(rc1.statusCode() == 200, "customEx merge: save со своими/любимыми — 200, а не " + rc1.statusCode());
            GymData savedCx = stCx.load(424248);
            check(savedCx.customEx.size() == 1 && "Жим Свенда стоя".equals(savedCx.customEx.get(0).n)
                    && savedCx.customEx.get(0).tags.size() == 2,
                "customEx merge: сервер хранит свои без дублей имён (уникальный ключ)");
            check(savedCx.favs.size() == 1 && "Жим Свенда стоя".equals(savedCx.favs.get(0)),
                "customEx merge: Любимые сохранены");
            check(savedCx.customExHidden.size() == 1 && "жим лёжа 45".equals(savedCx.customExHidden.get(0)),
                "customEx merge: томстон сохранён [EXR-T19]");
            /* старый кэш JS: save без ключей customEx/favs — данные не теряются */
            java.net.http.HttpResponse<String> rc2 = postSave(portCx, idCx, 1,
                "{\"rev\":1,\"nextId\":1,\"workouts\":[]}");
            check(rc2.statusCode() == 200, "customEx merge: save без ключей — 200, а не " + rc2.statusCode());
            GymData mergedCx = stCx.load(424248);
            check(mergedCx.customEx.size() == 1 && mergedCx.favs.size() == 1,
                "customEx merge: старый клиент без ключей свои/любимые не теряет");
            check(mergedCx.customExHidden.size() == 1,
                "customEx merge: старый клиент без ключа томстоны не затирает [EXR-T19]");
            /* пустые списки замещают старые (пользователь удалил все Любимые) */
            java.net.http.HttpResponse<String> rc3 = postSave(portCx, idCx, 2,
                "{\"rev\":2,\"nextId\":1,\"customEx\":[],\"favs\":[],\"customExHidden\":[],\"workouts\":[]}");
            check(rc3.statusCode() == 200, "customEx merge: save с пустыми списками — 200, а не " + rc3.statusCode());
            GymData clearedCx = stCx.load(424248);
            check(clearedCx.customEx.isEmpty() && clearedCx.favs.isEmpty(),
                "customEx merge: пустые списки замещают старые (удаление доезжает)");
            check(clearedCx.customExHidden.isEmpty(),
                "customEx merge: пустой список томстонов очищает старые [EXR-T19]");
        } catch (Exception cexErr) {
            throw new AssertionError("CONTRACT FAIL: customEx merge " + cexErr);
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

            /* [ANA-T11] активационные метрики из summary-state.json доезжают в /stats:
               файл есть (бот отправил утреннюю сводку) — activation + activationDay в ответе;
               файла нет — блок отсутствует (JSON прежний). Реальный WebServer. */
            java.nio.file.Files.writeString(tmpS.resolve("summary-state.json"),
                "{\"day\":\"2026-11-20\",\"totals\":{\"maInit\":9},\"activation\":{"
                    + "\"usersTotal\":12,\"usersEverWorkout\":5,\"usersWorkoutYesterday\":2,"
                    + "\"workoutsCompletedYesterday\":1}}", java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Object> snapAct = Json.map(Json.parse(get(portS, "/stats?token=contract-test-token").body()));
            Map<String, Object> act = Json.map(snapAct.get("activation"));
            check(act != null && Json.lng(act.get("usersTotal")) == 12 && Json.lng(act.get("usersEverWorkout")) == 5
                    && Json.lng(act.get("usersWorkoutYesterday")) == 2 && Json.lng(act.get("workoutsCompletedYesterday")) == 1,
                "stats: activation из summary-state доезжает в /stats");
            check("2026-11-20".equals(snapAct.get("activationDay")), "stats: activationDay в /stats");

            /* [ANA-T11 ревью] унаследованный summary-state от ANA-T6 (day+totals, activation
               ещё нет — до первой 09:00-сводки): осиротевшего activationDay в /stats быть
               не должно — оба ключа ставятся только вместе */
            java.nio.file.Files.writeString(tmpS.resolve("summary-state.json"),
                "{\"day\":\"2026-11-19\",\"totals\":{\"maInit\":9}}", java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Object> snapLegacy = Json.map(Json.parse(get(portS, "/stats?token=contract-test-token").body()));
            check(snapLegacy.get("activation") == null && snapLegacy.get("activationDay") == null,
                "stats: summary-state без activation — в /stats нет ни activation, ни activationDay");

            java.nio.file.Files.deleteIfExists(tmpS.resolve("summary-state.json"));
            Map<String, Object> snapNoAct = Json.map(Json.parse(get(portS, "/stats?token=contract-test-token").body()));
            check(snapNoAct.get("activation") == null, "stats: без summary-state блока activation нет (JSON прежний)");
        } catch (Exception statsErr) {
            throw new AssertionError("CONTRACT FAIL: stats " + statsErr);
        }

        /* [ANA-T5] события онбординга /api/track + сегментация init (спека ANA-S2 г1/г2):
           события и сегменты считаются в Stats (totals + недельные агрегаты), неизвестные
           имена игнорируются, GymData НЕ расширяется (chat_<id>.json при track не
           создаётся/не меняется); init-сегменты — по факту существования файла данных и
           его mtime, без чтения содержимого. Реальный WebServer на эфемерном порту. */
        try {
            java.nio.file.Path tmpT5 = java.nio.file.Files.createTempDirectory("gymt5");
            Storage stT5 = new Storage(tmpT5);
            Stats counterT5 = new Stats(tmpT5.resolve("stats.json"));
            WebServer wsT5 = new WebServer("contract-test-token", stT5, tmpT5, counterT5);
            java.net.ServerSocket probeT5 = new java.net.ServerSocket(0);
            int portT5 = probeT5.getLocalPort();
            probeT5.close();
            wsT5.start(portT5);
            String idT5 = tgInitData("contract-test-token", 424245);

            /* валидация: неверная подпись — 401; тело без events — 400 */
            check(postTrack(portT5, "garbage", "[\"onboardingStarted\"]").statusCode() == 401,
                "t5: /api/track с неверной подписью — 401");
            check(postJson(portT5, "/api/track", "{\"initData\":\"" + idT5 + "\"}").statusCode() == 400,
                "t5: /api/track без events — 400");

            /* новый пользователь: файла данных нет → maInitNew */
            check(postInit(portT5, idT5).statusCode() == 200, "t5: init нового пользователя — 200");
            /* события онбординга считаются; неизвестные имена игнорируются */
            check(postTrack(portT5, idT5,
                "[\"onboardingStarted\",\"onboardingCompleted\",\"notAnEvent\"]").statusCode() == 200,
                "t5: /api/track — 200");
            /* [ONB] §7: онбординг не пишет в данные — track не создаёт chat_<id>.json */
            check(!java.nio.file.Files.exists(tmpT5.resolve("chat_424245.json")),
                "t5: track не создаёт chat_<id>.json (GymData не расширяется)");

            /* init после save (свежий mtime файла) → maInitRepeat */
            check(postSave(portT5, idT5, 0, "{\"rev\":0,\"nextId\":1,\"workouts\":[]}").statusCode() == 200,
                "t5: save создаёт файл данных");
            check(postInit(portT5, idT5).statusCode() == 200, "t5: init после save — 200");

            /* «вернувшийся»: файл есть, mtime 8 суток назад → maInitReturn */
            stT5.save(424246, GymData.fromJson((Map<String, Object>) Json.parse("{\"nextId\":1,\"workouts\":[]}")));
            java.nio.file.Files.setLastModifiedTime(tmpT5.resolve("chat_424246.json"),
                java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - 8L * 24 * 60 * 60 * 1000));
            String idRet = tgInitData("contract-test-token", 424246);
            check(postInit(portT5, idRet).statusCode() == 200, "t5: init вернувшегося — 200");

            Map<String, Object> snapT5 = Json.map(Json.parse(get(portT5, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapT5.get("maInit")) == 3, "t5: maInit=3 после трёх init");
            check(Json.lng(snapT5.get("maInitNew")) == 1, "t5: maInitNew=1 (файла данных не было)");
            check(Json.lng(snapT5.get("maInitRepeat")) == 1, "t5: maInitRepeat=1 (init после свежего save)");
            check(Json.lng(snapT5.get("maInitReturn")) == 1, "t5: maInitReturn=1 (mtime старше 7 суток)");
            check(Json.lng(snapT5.get("onboardingStarted")) == 1, "t5: onboardingStarted=1");
            check(Json.lng(snapT5.get("onboardingCompleted")) == 1, "t5: onboardingCompleted=1");
            check(Json.lng(snapT5.get("onboardingTutorialSkipped")) == 0, "t5: onboardingTutorialSkipped=0");
            check(Json.lng(snapT5.get("maSave")) == 1, "t5: maSave не задвоен (track на save не влияет)");
            /* недельный агрегат: текущая неделя зеркалит сегменты и события */
            Map<String, Object> weeksT5 = Json.map(snapT5.get("weeks"));
            java.time.LocalDate todayT5 = java.time.LocalDate.now();
            String curWeekT5 = String.format("%04d-W%02d",
                todayT5.get(java.time.temporal.WeekFields.ISO.weekBasedYear()),
                todayT5.get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear()));
            Map<String, Object> curT5 = Json.map(weeksT5.get(curWeekT5));
            check(curT5 != null && Json.lng(curT5.get("maInitNew")) == 1 && Json.lng(curT5.get("maInitRepeat")) == 1
                    && Json.lng(curT5.get("maInitReturn")) == 1 && Json.lng(curT5.get("onboardingStarted")) == 1,
                "t5: недельный агрегат текущей недели зеркалит сегменты и события");
            /* новые ключи перечитываются из файла */
            Map<String, Object> fileT5 = new Stats(tmpT5.resolve("stats.json")).snapshot();
            check(Json.lng(fileT5.get("onboardingStarted")) == 1 && Json.lng(fileT5.get("maInitReturn")) == 1,
                "t5: новые ключи перечитываются из stats.json");
            /* обратная совместимость: stats.json без новых ключей (старый прод) читается — недостающее = 0 */
            java.nio.file.Path legacyStatsFile = tmpT5.resolve("stats-legacy.json");
            java.nio.file.Files.writeString(legacyStatsFile, "{\"maInit\":5,\"weeks\":{\"2026-W01\":{\"maInit\":5}}}",
                java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Object> legacySnap = new Stats(legacyStatsFile).snapshot();
            check(Json.lng(legacySnap.get("maInit")) == 5 && Json.lng(legacySnap.get("maInitNew")) == 0
                    && Json.lng(legacySnap.get("onboardingStarted")) == 0,
                "t5: старый stats.json без новых ключей читается (недостающее = 0)");
        } catch (Exception t5Err) {
            throw new AssertionError("CONTRACT FAIL: t5 " + t5Err);
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

        /* [EXR-T8] path traversal гвард: путь приходит декодированным (%2e%2e → ..), сегменты
           «..» запрещены, канонический путь обязан остаться внутри webDir. Раньше
           /img/%2e%2e/app.js отдавал соседний файл с 200. Сырой сокет — java.net.http и
           браузеры нормализуют «..» в URL до отправки, до сервера traversal-путь бы не доехал.
           Реальный WebServer на эфемерном порту, статика кладётся во временный webDir. */
        try {
            java.nio.file.Path baseT = java.nio.file.Files.createTempDirectory("gymtrav");
            java.nio.file.Path tmpT = baseT.resolve("web");
            java.nio.file.Files.createDirectories(tmpT.resolve("img"));
            Storage stT = new Storage(tmpT);
            WebServer wsT = new WebServer("contract-test-token", stT, tmpT, new Stats(tmpT.resolve("stats.json")));
            java.net.ServerSocket probeT = new java.net.ServerSocket(0);
            int portT = probeT.getLocalPort();
            probeT.close();
            wsT.start(portT);
            java.nio.file.Files.writeString(tmpT.resolve("app.js"), "static", java.nio.charset.StandardCharsets.UTF_8);
            java.nio.file.Files.writeString(tmpT.resolve("img").resolve("x.jpg"), "fake-jpeg", java.nio.charset.StandardCharsets.UTF_8);
            java.nio.file.Files.writeString(baseT.resolve("secret-outside.txt"), "секрет", java.nio.charset.StandardCharsets.UTF_8);

            /* легитимные запросы не изменились */
            check(rawStatus(portT, "/img/x.jpg") == 200, "traversal: легитимный /img/x.jpg — 200");
            check(rawStatus(portT, "/app.js") == 200, "traversal: легитимный /app.js — 200");
            /* раньше: 200 на соседний файл */
            check(rawStatus(portT, "/img/%2e%2e/app.js") == 404, "traversal: /img/%2e%2e/app.js → 404, а не " + rawStatus(portT, "/img/%2e%2e/app.js"));
            /* выход за пределы webDir (двойной «..») и сырой «../» — тоже 404 */
            check(rawStatus(portT, "/img/%2e%2e/%2e%2e/secret-outside.txt") == 404, "traversal: /img/../../secret → 404");
            check(rawStatus(portT, "/../secret-outside.txt") == 404, "traversal: /../secret → 404");
        } catch (Exception travErr) {
            throw new AssertionError("CONTRACT FAIL: traversal " + travErr);
        }

        /* [CNT-T1] лендинг: GET /landing, /landing/ и /landing/index.html отдают
           web/landing/index.html (безредиректный рерайт, как у / и /app), просмотры
           считаются анонимным счётчиком landingViews (агрегат без ПДн, /stats) — ровно
           по одному на запрос, без задвоений; HEAD-пробы и 404 не считаются.
           Кэш [UX-B17]: ассеты /landing/assets/ — годовой immutable (неизменяемые имена,
           по образцу /img/), сама страница — no-cache (html-документ, входная точка).
           Реальный WebServer на эфемерном порту. */
        try {
            java.nio.file.Path tmpL = java.nio.file.Files.createTempDirectory("gymland");
            java.nio.file.Files.createDirectories(tmpL.resolve("landing").resolve("assets"));
            java.nio.file.Files.writeString(tmpL.resolve("landing").resolve("index.html"),
                "<!doctype html><html lang=\"ru\"><title>GymHelper лендинг</title></html>",
                java.nio.charset.StandardCharsets.UTF_8);
            byte[] pngBytes = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
            java.nio.file.Files.write(tmpL.resolve("landing").resolve("assets").resolve("og.png"), pngBytes);
            Storage stL = new Storage(tmpL);
            Stats counterL = new Stats(tmpL.resolve("stats.json"));
            WebServer wsL = new WebServer("contract-test-token", stL, tmpL, counterL);
            java.net.ServerSocket probeL = new java.net.ServerSocket(0);
            int portL = probeL.getLocalPort();
            probeL.close();
            wsL.start(portL);

            java.net.http.HttpResponse<String> land0 = get(portL, "/landing");
            check(land0.statusCode() == 200, "landing: GET /landing (без слэша) — 200, а не " + land0.statusCode());
            check(land0.body().contains("GymHelper лендинг"), "landing: /landing отдаёт index.html без редиректа");
            java.net.http.HttpResponse<String> land1 = get(portL, "/landing/");
            check(land1.statusCode() == 200, "landing: GET /landing/ — 200, а не " + land1.statusCode());
            check(land1.body().contains("GymHelper лендинг"), "landing: /landing/ отдаёт index.html из web/landing/");
            check(land1.headers().firstValue("Content-Type").orElse("").contains("text/html"),
                "landing: Content-Type text/html");
            java.net.http.HttpResponse<String> land2 = get(portL, "/landing/index.html");
            check(land2.statusCode() == 200, "landing: GET /landing/index.html — 200, а не " + land2.statusCode());

            /* кэш [UX-B17]: ассеты лендинга — годовой immutable (неизменяемые имена),
               страница-документ (html) — no-cache: входная точка без ?v=, ре-валидация */
            java.net.http.HttpResponse<String> asset = get(portL, "/landing/assets/og.png");
            check(asset.statusCode() == 200, "landing: GET /landing/assets/og.png — 200, а не " + asset.statusCode());
            check("public, max-age=31536000, immutable".equals(asset.headers().firstValue("Cache-Control").orElse(null)),
                "landing: ассеты /landing/assets/ — годовой immutable-кэш, а не "
                    + asset.headers().firstValue("Cache-Control").orElse("—"));
            check("no-cache".equals(land1.headers().firstValue("Cache-Control").orElse(null)),
                "landing: страница лендинга (html-документ) — no-cache");

            /* 404 и HEAD просмотрами не считаются */
            check(get(portL, "/landing/nope.html").statusCode() == 404, "landing: отсутствующий файл — 404");
            check(headStatus(portL, "/landing/") == 200, "landing: HEAD /landing/ — 200");
            check(headStatus(portL, "/landing/") == 200, "landing: повторный HEAD /landing/ — 200");

            /* три GET (без слэша, со слэшем, прямой) = landingViews 3, ровно по одному */
            Map<String, Object> snapL = Json.map(Json.parse(get(portL, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapL.get("landingViews")) == 3,
                "landing: landingViews=3 после трёх GET (HEAD и 404 не считались), а не "
                    + Json.lng(snapL.get("landingViews")));
        } catch (Exception landErr) {
            throw new AssertionError("CONTRACT FAIL: landing " + landErr);
        }

        /* [UX-I16] шейринг тренировки по ссылке: POST /api/share (ленивый shareId, повтор
           возвращает тот же, чужая/незавершённая — 4xx), GET /w/<shareId> (состав §6,
           noindex-заголовки, приватность §5.2, XSS-экранирование §8.2), 404 «Тренировка
           недоступна» (мусорный id и удалённая), opt-in имени в OG, счётчики §7.3,
           robots.txt, поиск после «рестарта» (скан data/*.json). Прод-раскладка каталогов:
           root/web + root/data. */
        try {
            java.nio.file.Path root = java.nio.file.Files.createTempDirectory("gymshare");
            java.nio.file.Path webDir = root.resolve("web");
            java.nio.file.Files.createDirectories(webDir);
            java.nio.file.Files.writeString(webDir.resolve("robots.txt"), "User-agent: *\nDisallow: /w/\n");
            Storage stSh = new Storage(root.resolve("data"));
            Stats counterSh = new Stats(root.resolve("stats.json"));
            WebServer wsSh = new WebServer("contract-test-token", stSh, webDir, counterSh);
            java.net.ServerSocket probeSh = new java.net.ServerSocket(0);
            int portSh = probeSh.getLocalPort();
            probeSh.close();
            wsSh.start(portSh);
            String idSh = tgInitData("contract-test-token", 424251);
            /* seed: завершённая тренировка с рекордным весом, кастомным названием,
               питанием и XSS-именем упражнения (§8.2); незавершённая — для негатива */
            GymData seedSh = new GymData();
            seedSh.nextId = 3;
            seedSh.rev = 1;
            ProfileData pSh = new ProfileData();
            pSh.sex = "м";
            pSh.age = 30;
            pSh.height = 180;
            pSh.weight = 80;
            seedSh.profile = pSh;
            Workout wSh = new Workout();
            wSh.id = 1;
            wSh.date = "2025-03-14";
            wSh.startedAt = "2025-03-14T09:30:00";
            wSh.endedAt = "2025-03-14T10:30:00";
            wSh.finished = true;
            wSh.title = "Тренировка с Машей";
            wSh.nutrition = "вода и соль";
            ExerciseEntry eSh = new ExerciseEntry("Жим <img src=x onerror=alert(1)>");
            eSh.sets.add(new SetEntry("120", 3, "8"));
            eSh.sets.add(new SetEntry("100", 3, "8"));
            wSh.exercises.add(eSh);
            seedSh.workouts.add(wSh);
            Workout wAct = new Workout();
            wAct.id = 2;
            wAct.date = "2025-03-15";
            wAct.finished = false;
            seedSh.workouts.add(wAct);
            stSh.save(424251, seedSh);

            /* чужая тренировка (другой initData) → 404; незавершённая → 400 */
            String idOther = tgInitData("contract-test-token", 424252);
            check(postJson(portSh, "/api/share", "{\"initData\":\"" + idOther + "\",\"wid\":1}").statusCode() == 404,
                "share: чужой wid → 404");
            check(postJson(portSh, "/api/share", "{\"initData\":\"" + idSh + "\",\"wid\":2}").statusCode() == 400,
                "share: незавершённая тренировка → 400");

            java.net.http.HttpResponse<String> rs1 = postJson(portSh, "/api/share", "{\"initData\":\"" + idSh + "\",\"wid\":1}");
            check(rs1.statusCode() == 200, "share: завершённая — 200, а не " + rs1.statusCode());
            Map<String, Object> ms1 = Json.map(Json.parse(rs1.body()));
            String sid = (String) ms1.get("shareId");
            check(Boolean.TRUE.equals(ms1.get("ok")) && sid != null && sid.matches("[0-9a-zA-Z]{22}"),
                "share: shareId — 22 символа base62, а не «" + sid + "»");
            check(("https://app.gym-helper.com/w/" + sid).equals(ms1.get("url")), "share: url = " + ms1.get("url"));

            java.net.http.HttpResponse<String> rs2 = postJson(portSh, "/api/share", "{\"initData\":\"" + idSh + "\",\"wid\":1}");
            check(rs2.statusCode() == 200 && sid.equals(Json.str(Json.map(Json.parse(rs2.body())), "shareId")),
                "share: повторный POST возвращает ТОТ ЖЕ shareId (§4.2)");

            /* страница: 200, noindex-заголовки, состав §6, ПДн-минимализм §5.2, XSS-экранирование */
            java.net.http.HttpResponse<String> rp = get(portSh, "/w/" + sid);
            check(rp.statusCode() == 200, "share: GET /w/<id> — 200, а не " + rp.statusCode());
            check("noindex, nofollow".equals(rp.headers().firstValue("X-Robots-Tag").orElse(null)),
                "share: X-Robots-Tag noindex, nofollow");
            check("nosniff".equals(rp.headers().firstValue("X-Content-Type-Options").orElse(null)),
                "share: X-Content-Type-Options nosniff (ревью №4)");
            check("no-referrer".equals(rp.headers().firstValue("Referrer-Policy").orElse(null)),
                "share: Referrer-Policy no-referrer (ревью №4)");
            check("no-store".equals(rp.headers().firstValue("Cache-Control").orElse(null)), "share: Cache-Control no-store (живой рендер)");
            check(rp.body().contains("noindex, nofollow"), "share: meta robots noindex в HTML");
            check(rp.body().contains("og:title") && rp.body().contains("Тренировка · 14 марта 2025"),
                "share: og:title «Тренировка · 14 марта 2025» (год не текущий — edge 13)");
            check(rp.body().contains("только просмотр"), "share: пилюля «только просмотр»");
            check(rp.body().contains("5 280"), "share: герой-число с группировкой тысяч («5 280 кг»)");
            check(rp.body().contains("1:00") && rp.body().contains("ккал") && rp.body().contains("<b>6</b><span>подходов</span>"),
                "share: агрегаты время/ккал/подходы");
            check(rp.body().contains("120 кг × 3×8"), "share: строка подхода «120 кг × 3×8»");
            check(rp.body().contains("🏆 рекорд"), "share: бейдж лучшего сета");
            check(!rp.body().contains("Новый рекорд"), "share: плашки рекорда нет — база прошлых пуста (первое выполнение)");
            check(!rp.body().contains("Серия:"), "share: серии нет при N < 2 (edge 17)");
            check(!rp.body().contains("Тренировка с Машей") && !rp.body().contains("вода и соль"),
                "share: кастомное название и питание НЕ утекают (§5.2)");
            check(rp.body().contains("&lt;img src=x onerror=alert(1)&gt;") && !rp.body().contains("<img src=x"),
                "share: XSS-имя упражнения экранировано, не исполняется (§8.2)");
            /* [UX-B14] CTA /w/<id>: фолбэк (env не задан) — настоящий юзернейм бота
               MyHelperGymBot; старый GymHelper_bot — чужой бот */
            check(rp.body().contains("t.me/MyHelperGymBot/app"), "share: sticky CTA — фолбэк на нашего бота MyHelperGymBot (UX-B14)");
            /* [UX-B14] заданный username (env в JVM-процессе неизменяем — инжект вторым
               конструктором) вытесняет фолбэк: кнопка /w/<id> ведёт на заданного бота.
               Stats отдельный — GET /w/<id> не должен трогать счётчики linkView выше;
               shareIndex у этого сервера пуст → сработает ленивый скан data/*.json */
            Stats counterBt = new Stats(root.resolve("stats-bt.json"));
            WebServer wsBt = new WebServer("contract-test-token", stSh, webDir, counterBt, "ContractBot");
            java.net.ServerSocket probeBt = new java.net.ServerSocket(0);
            int portBt = probeBt.getLocalPort();
            probeBt.close();
            wsBt.start(portBt);
            java.net.http.HttpResponse<String> rpBt = get(portBt, "/w/" + sid);
            check(rpBt.statusCode() == 200, "share: GET /w/<id> на сервере с заданным username — 200");
            check(rpBt.body().contains("t.me/ContractBot/app"), "share: CTA использует заданный botUsername (env/инжект)");
            check(!rpBt.body().contains("t.me/MyHelperGymBot/app"), "share: заданный botUsername вытесняет фолбэк");
            /* HEAD — заголовки без тела, linkView не растёт */
            check(headStatus(portSh, "/w/" + sid) == 200, "share: HEAD /w/<id> — 200");

            /* opt-in имени (§11.1, ревью №2/№3): имя — ТОЛЬКО из проверенного initData
               (user.first_name), клиентский payload «name» не доверенный; лимит 60 символов */
            check(postJson(portSh, "/api/share", "{\"initData\":\"" + idSh + "\",\"wid\":1,\"shareName\":true,\"name\":\"ПОДМЕНА\"}").statusCode() == 200,
                "share: opt-in true — 200");
            java.net.http.HttpResponse<String> rpOn = get(portSh, "/w/" + sid);
            check(rpOn.statusCode() == 200 && rpOn.body().contains("Тренировка · 14 марта 2025 · Test"),
                "share: og:title с именем из initData при opt-in");
            check(!rpOn.body().contains("ПОДМЕНА"),
                "share: клиентский payload «name» игнорируется (server-owned ПДн)");
            check("Test".equals(stSh.load(424251).shareOwner),
                "share: в файле — имя из подписанного initData");
            check(postJson(portSh, "/api/share", "{\"initData\":\"" + idSh + "\",\"wid\":1,\"shareName\":false}").statusCode() == 200,
                "share: opt-in false — 200");
            java.net.http.HttpResponse<String> rpOff = get(portSh, "/w/" + sid);
            check(rpOff.statusCode() == 200 && !rpOff.body().contains("Test"),
                "share: opt-in выключен — имени на странице нет");
            check(!Json.write(stSh.load(424251).toJson()).contains("shareOwner"),
                "share: opt-in выключен — имя удалено из данных (ПДн-минимализм)");
            /* ревью №2: длинный first_name initData обрезается до 60 символов до записи */
            GymData seedCap = new GymData();
            seedCap.nextId = 2;
            seedCap.rev = 1;
            Workout wCap = new Workout();
            wCap.id = 1;
            wCap.date = "2026-11-18";
            wCap.finished = true;
            seedCap.workouts.add(wCap);
            stSh.save(424256, seedCap);
            StringBuilder longName = new StringBuilder();
            for (int i = 0; i < 100; i++) longName.append('А');
            String idLong = tgInitData("contract-test-token", 424256, longName.toString());
            check(postJson(portSh, "/api/share", "{\"initData\":\"" + idLong + "\",\"wid\":1,\"shareName\":true}").statusCode() == 200,
                "share: opt-in с длинным именем — 200");
            GymData capSaved = stSh.load(424256);
            check(capSaved.shareOwner != null && capSaved.shareOwner.length() == 60,
                "share: shareOwner обрезан до 60 символов, а не "
                    + (capSaved.shareOwner == null ? "null" : String.valueOf(capSaved.shareOwner.length())));

            /* клиентские события воронки через /api/track (§7.3, [UX-I14] §5):
               неизвестные игнорируются */
            check(postTrack(portSh, idSh,
                    "[\"linkCopy\",\"linkSend\",\"shareClick\",\"shareOk\",\"shareDownload\",\"bogusEvent\"]").statusCode() == 200,
                "share: /api/track принимает linkCopy/linkSend и shareClick/shareOk/shareDownload");

            /* смерть ссылки: удаление данных владельца → та же 404 «Тренировка недоступна» (§6.3) */
            stSh.deleteChat(424251);
            java.net.http.HttpResponse<String> rGone = get(portSh, "/w/" + sid);
            check(rGone.statusCode() == 404, "share: после удаления — 404, а не " + rGone.statusCode());
            check(rGone.body().contains("Тренировка недоступна"), "share: 404-страница «Тренировка недоступна»");
            check("noindex, nofollow".equals(rGone.headers().firstValue("X-Robots-Tag").orElse(null)),
                "share: 404-страница тоже noindex");
            check(get(portSh, "/w/garbage0123456789abcdefgh").statusCode() == 404,
                "share: мусорный shareId — та же 404 (без оракула, §4.3)");
            check(get(portSh, "/robots.txt").body().contains("Disallow: /w/"), "share: robots.txt Disallow /w/");

            /* позитивные ветки рендера: рекорд реальным весом (база = прошлые тренировки)
               и серия ≥ 2, заканчивающаяся датой тренировки (§6.1/§6.2) */
            GymData seedStreak = new GymData();
            seedStreak.nextId = 3;
            seedStreak.rev = 1;
            java.time.LocalDate todaySt = java.time.LocalDate.now();
            java.time.LocalDate yest = todaySt.minusDays(1);
            Workout wY = new Workout();
            wY.id = 1;
            wY.date = yest.toString();
            wY.startedAt = yest + "T09:30:00";
            wY.endedAt = yest + "T10:30:00";
            wY.finished = true;
            ExerciseEntry eY = new ExerciseEntry("Жим штанги лёжа");
            eY.sets.add(new SetEntry("100", 3, "8"));
            wY.exercises.add(eY);
            seedStreak.workouts.add(wY);
            Workout wT = new Workout();
            wT.id = 2;
            wT.date = todaySt.toString();
            wT.startedAt = todaySt + "T09:30:00";
            wT.endedAt = todaySt + "T10:30:00";
            wT.finished = true;
            ExerciseEntry eT = new ExerciseEntry("Жим штанги лёжа");
            eT.sets.add(new SetEntry("120", 3, "8"));
            wT.exercises.add(eT);
            seedStreak.workouts.add(wT);
            stSh.save(424254, seedStreak);
            String idStreak = tgInitData("contract-test-token", 424254);
            java.net.http.HttpResponse<String> rs3 = postJson(portSh, "/api/share", "{\"initData\":\"" + idStreak + "\",\"wid\":2}");
            check(rs3.statusCode() == 200, "share: рекорд/серия seed — 200");
            String sidStreak = Json.str(Json.map(Json.parse(rs3.body())), "shareId");
            java.net.http.HttpResponse<String> rpStreak = get(portSh, "/w/" + sidStreak);
            check(rpStreak.statusCode() == 200 && rpStreak.body().contains("Новый рекорд")
                    && rpStreak.body().contains("120") && rpStreak.body().contains("реальный вес подхода"),
                "share: плашка рекорда реальным весом (120 > 100 из прошлой тренировки)");
            check(rpStreak.body().contains("Серия: 2 тренировки подряд"),
                "share: серия N ≥ 2 — «Серия: 2 тренировки подряд» (§6.2)");
            check(rpStreak.body().contains("беспрерывно с " + yest.getDayOfMonth() + " "),
                "share: подстрока серии «беспрерывно с <день> <месяц>»");

            /* edge 8 (§5.1/§9.8): калистеника (веса «»/0, объём 0) → герой = сумма повторений,
               строки подходов без «кг» */
            GymData seedBw = new GymData();
            seedBw.nextId = 2;
            seedBw.rev = 1;
            Workout wBw = new Workout();
            wBw.id = 1;
            wBw.date = "2026-11-18";
            wBw.startedAt = "2026-11-18T09:30:00";
            wBw.endedAt = "2026-11-18T10:30:00";
            wBw.finished = true;
            ExerciseEntry eBw = new ExerciseEntry("Подтягивания");
            eBw.sets.add(new SetEntry("", 4, "8"));
            eBw.sets.add(new SetEntry("0", 3, "10"));
            wBw.exercises.add(eBw);
            seedBw.workouts.add(wBw);
            stSh.save(424255, seedBw);
            String idBw = tgInitData("contract-test-token", 424255);
            java.net.http.HttpResponse<String> rsBw = postJson(portSh, "/api/share", "{\"initData\":\"" + idBw + "\",\"wid\":1}");
            check(rsBw.statusCode() == 200, "share: калистеника seed — 200, а не " + rsBw.statusCode());
            String sidBw = Json.str(Json.map(Json.parse(rsBw.body())), "shareId");
            java.net.http.HttpResponse<String> rpBw = get(portSh, "/w/" + sidBw);
            check(rpBw.statusCode() == 200
                    && rpBw.body().contains("<div class=\"hero-num\">62<small>повторений</small></div>"),
                "share: герой калистеники = сумма повторений (4×8 + 3×10 = 62), а не «0» (edge 8)");
            check(rpBw.body().contains("4×8") && rpBw.body().contains("3×10") && !rpBw.body().contains(" кг ×"),
                "share: строки подходов калистеники без «кг» (edge 8)");

            /* счётчики воронки §7.3: linkCreate = каждый успешный POST (7), linkView = только
               GET 200 (страница + opt-in вкл/выкл + рекорд/серия + калистеника + рестарт ниже = 6);
               HEAD и 404 не считаются */
            check(get(portSh, "/w/@bad").statusCode() == 404, "share: /w/ без id — 404");

            /* поиск после «рестарта» процесса: shareId в файле (создан не этим экземпляром
               сервера) находится ленивым сканом data/*.json (§8.1) */
            GymData seed2 = new GymData();
            seed2.nextId = 2;
            seed2.rev = 1;
            Workout w2Sh = new Workout();
            w2Sh.id = 1;
            w2Sh.date = "2026-11-16";
            w2Sh.finished = true;
            w2Sh.shareId = "restartScan0AbCdEfGhIj";
            ExerciseEntry e2 = new ExerciseEntry("Приседания");
            e2.sets.add(new SetEntry("130", 4, "6"));
            w2Sh.exercises.add(e2);
            seed2.workouts.add(w2Sh);
            stSh.save(424253, seed2);
            WebServer wsRe = new WebServer("contract-test-token", stSh, webDir, counterSh);
            java.net.ServerSocket probeRe = new java.net.ServerSocket(0);
            int portRe = probeRe.getLocalPort();
            probeRe.close();
            wsRe.start(portRe);
            java.net.http.HttpResponse<String> rRe = get(portRe, "/w/restartScan0AbCdEfGhIj");
            check(rRe.statusCode() == 200 && rRe.body().contains("Приседания"),
                "share: shareId из файла (после рестарта) находится сканом — 200, а не " + rRe.statusCode());

            Map<String, Object> snapSh = Json.map(Json.parse(get(portSh, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapSh.get("linkCreate")) == 7,
                "share: linkCreate=7 (успешные POST), а не " + Json.lng(snapSh.get("linkCreate")));
            check(Json.lng(snapSh.get("linkView")) == 6,
                "share: linkView=6 (только GET 200; HEAD и 404 не считаются), а не " + Json.lng(snapSh.get("linkView")));
            check(Json.lng(snapSh.get("linkCopy")) == 1 && Json.lng(snapSh.get("linkSend")) == 1,
                "share: linkCopy/linkSend через /api/track=1, bogus — мимо белого списка");
            check(Json.lng(snapSh.get("shareClick")) == 1 && Json.lng(snapSh.get("shareOk")) == 1
                    && Json.lng(snapSh.get("shareDownload")) == 1,
                "share: shareClick/shareOk/shareDownload через /api/track=1 ([UX-I14] §5)");
        } catch (Exception shareErr) {
            throw new AssertionError("CONTRACT FAIL: share " + shareErr);
        }

        /* [UX-S16] постер тренировки v2: POST /api/card (initData в теле; 401 без/мусор;
            404 нет тренировки; 400 незавершённая/0 упражнений; 429 антиспам 3/час —
            слот тратит только успех, 502/503 откатывают) → PNG в data/cards (магия,
            IHDR 1080×1920, токен 22 base62), GET /card/<token>.png — публичная раздача
            (200 image/png, тело байт-в-байт, HEAD; мусорный/короткий токен, traversal
            и истёкший mtime — 404), TTL 1 ч (ленивая чистка при записи + гвард выдачи),
            кап каталога 503. Рендер CardRender —
            в контракте (headless Java 2D + bundled шрифты), caption из дня тренировки
            (§7.3), воронка cardClick/cardOk/cardErr в /api/track. sendPhoto —
            заглушка (реальной сети в тесте нет). */
        try {
            java.nio.file.Path rootCa = java.nio.file.Files.createTempDirectory("gymposter");
            java.nio.file.Path webDirCa = rootCa.resolve("web");
            java.nio.file.Files.createDirectories(webDirCa);
            Storage stCa = new Storage(rootCa.resolve("data"));
            Stats counterCa = new Stats(rootCa.resolve("stats.json"));
            final java.util.concurrent.atomic.AtomicBoolean sendOk = new java.util.concurrent.atomic.AtomicBoolean(true);
            final java.util.List<String> sentCa = new java.util.ArrayList<>();
            TelegramApi stubCa = new TelegramApi("contract-stub") {
                @Override
                public boolean sendPhotoByUrl(long chatId, String photoUrl, String caption) {
                    sentCa.add(chatId + "|" + photoUrl + "|" + caption);
                    return sendOk.get();
                }
            };
            WebServer wsCa = new WebServer("contract-test-token", stCa, webDirCa, counterCa, null, stubCa);
            java.net.ServerSocket probeCa = new java.net.ServerSocket(0);
            int portCa = probeCa.getLocalPort();
            probeCa.close();
            wsCa.start(portCa);

            /* seed: прошлые тренировки (база рекорда: приседания 110, жим 90) и
               рекордная 18.11 (приседания 120 — рекорд, жим 100, тяга, планка) */
            GymData seedCa = new GymData();
            seedCa.nextId = 5;
            seedCa.rev = 1;
            Workout wBaseCa = new Workout();
            wBaseCa.id = 1;
            wBaseCa.date = "2026-11-10";
            wBaseCa.finished = true;
            ExerciseEntry beCa = new ExerciseEntry("Жим лёжа");
            beCa.sets.add(new SetEntry("90", 3, "5"));
            wBaseCa.exercises.add(beCa);
            ExerciseEntry beCa2 = new ExerciseEntry("Приседания");
            beCa2.sets.add(new SetEntry("110", 3, "8"));
            wBaseCa.exercises.add(beCa2);
            Workout wRecCa = new Workout();
            wRecCa.id = 2;
            wRecCa.date = "2026-11-18";
            wRecCa.startedAt = "2026-11-18T09:00:00";
            wRecCa.endedAt = "2026-11-18T10:10:00";
            wRecCa.finished = true;
            ExerciseEntry reCa = new ExerciseEntry("Приседания");
            reCa.sets.add(new SetEntry("120", 3, "8"));
            wRecCa.exercises.add(reCa);
            ExerciseEntry reCa2 = new ExerciseEntry("Жим лёжа");
            reCa2.sets.add(new SetEntry("100", 5, "5"));
            wRecCa.exercises.add(reCa2);
            ExerciseEntry reCa3 = new ExerciseEntry("Тяга штанги");
            reCa3.sets.add(new SetEntry("80", 3, "10"));
            wRecCa.exercises.add(reCa3);
            ExerciseEntry reCa4 = new ExerciseEntry("Планка");
            reCa4.sets.add(new SetEntry("", 3, "60 сек"));
            wRecCa.exercises.add(reCa4);
            Workout wActiveCa = new Workout();
            wActiveCa.id = 3;
            wActiveCa.date = "2026-11-19";
            wActiveCa.finished = false;
            ExerciseEntry aeCa = new ExerciseEntry("Жим лёжа");
            aeCa.sets.add(new SetEntry("60", 1, "10"));
            wActiveCa.exercises.add(aeCa);
            Workout wEmptyCa = new Workout();
            wEmptyCa.id = 4;
            wEmptyCa.date = "2026-11-19";
            wEmptyCa.finished = true;
            wEmptyCa.exercises.add(new ExerciseEntry("Брусья"));
            seedCa.workouts.add(wBaseCa);
            seedCa.workouts.add(wRecCa);
            seedCa.workouts.add(wActiveCa);
            seedCa.workouts.add(wEmptyCa);
            stCa.save(424259, seedCa);
            String idCa = tgInitData("contract-test-token", 424259);
            java.nio.file.Path cardsDirCa = rootCa.resolve("data").resolve("cards");

            /* авторизация */
            check(postJson(portCa, "/api/card", "{\"wid\":2}").statusCode() == 401,
                "poster: /api/card без initData — 401");
            check(postJson(portCa, "/api/card", "{\"initData\":\"garbage\",\"wid\":2}").statusCode() == 401,
                "poster: /api/card с мусорным initData — 401");
            /* защита §7.4 */
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCa + "\",\"wid\":99}").statusCode() == 404,
                "poster: нет тренировки — 404");
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCa + "\",\"wid\":3}").statusCode() == 400,
                "poster: незавершённая — 400");
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCa + "\",\"wid\":4}").statusCode() == 400,
                "poster: 0 упражнений (пустые подходы) — 400");
            check(sentCa.isEmpty(), "poster: отказы до отправки в Telegram не доезжают");

            /* позитив: 200 + файл с магией PNG и IHDR 1080×1920 + sendPhoto заглушке */
            java.net.http.HttpResponse<String> rPost1 = postJson(portCa, "/api/card",
                "{\"initData\":\"" + idCa + "\",\"wid\":2}");
            check(rPost1.statusCode() == 200, "poster: POST /api/card — 200, а не " + rPost1.statusCode());
            check(sentCa.size() == 1, "poster: sendPhoto вызван 1 раз, а не " + sentCa.size());
            String sentLine = sentCa.get(0);
            check(sentLine.startsWith("424259|https://"), "poster: photo уходит в чат владельца по https: " + sentLine);
            check(sentLine.endsWith("|Постер тренировки за 18.11 — перешли друзьям 💪"),
                "poster: caption из дня тренировки (§7.3): " + sentLine);
            String cardToken = sentLine.split("\\|")[1];
            cardToken = cardToken.substring(cardToken.lastIndexOf('/') + 1, cardToken.lastIndexOf('.'));
            check(cardToken.matches("[0-9a-zA-Z]{22}"), "poster: токен 22 base62: " + cardToken);
            java.nio.file.Path cardFile = cardsDirCa.resolve(cardToken + ".png");
            check(java.nio.file.Files.isRegularFile(cardFile), "poster: файл data/cards/<token>.png записан");
            byte[] stored = java.nio.file.Files.readAllBytes(cardFile);
            check(stored.length > 8 && stored[0] == (byte) 0x89 && stored[1] == 0x50 && stored[2] == 0x4E && stored[3] == 0x47,
                "poster: файл — PNG (магия)");
            check(stored.length > 30_000, "poster: постер 1080×1920 ожидаемо десятки КБ, а не " + stored.length);
            check((stored[16] & 0xff) == 0 && (stored[17] & 0xff) == 0 && (stored[18] & 0xff) == 4 && (stored[19] & 0xff) == 0x38
                    && (stored[20] & 0xff) == 0 && (stored[21] & 0xff) == 0 && (stored[22] & 0xff) == 7 && (stored[23] & 0xff) == 0x80,
                "poster: IHDR 1080×1920 (§3)");

            /* публичная раздача: 200 image/png, тело байт-в-байт; мусор — 404 */
            java.net.http.HttpResponse<byte[]> rCard = getRaw(portCa, "/card/" + cardToken + ".png");
            check(rCard.statusCode() == 200, "poster: GET /card/<token>.png — 200, а не " + rCard.statusCode());
            check("image/png".equals(rCard.headers().firstValue("Content-Type").orElse(null)),
                "poster: Content-Type image/png, а не " + rCard.headers().firstValue("Content-Type").orElse("—"));
            check(java.util.Arrays.equals(rCard.body(), stored), "poster: тело GET = файлу байт-в-байт");
            check("noindex, nofollow".equals(rCard.headers().firstValue("X-Robots-Tag").orElse(null)),
                "poster: X-Robots-Tag noindex, nofollow");
            check(headStatus(portCa, "/card/" + cardToken + ".png") == 200, "poster: HEAD — 200");
            check(get(portCa, "/card/garbage0123456789abcdefgh.png").statusCode() == 404,
                "poster: несуществующий токен — 404");
            check(get(portCa, "/card/short.png").statusCode() == 404, "poster: короткий токен — 404");
            check(get(portCa, "/card/@bad").statusCode() == 404, "poster: не-токен — 404");
            check(rawStatus(portCa, "/card/%2e%2e%2fsecret.png") == 404, "poster: traversal — 404");

            /* TTL-гвард при выдаче (ревью [UX-S16]): истёкший (mtime 2 ч), но ещё не
               вычищенный файл отдаёт 404; свежая карточка живёт */
            java.nio.file.Path expCard = cardsDirCa.resolve("expiresXXXXXXXXXXXXXXX.png");
            java.nio.file.Files.write(expCard, stored);
            java.nio.file.Files.setLastModifiedTime(expCard,
                java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - 2 * 60 * 60 * 1000));
            check(get(portCa, "/card/expiresXXXXXXXXXXXXXXX.png").statusCode() == 404,
                "poster: TTL-гвард выдачи — истёкший файл 404, а не 200");
            check(get(portCa, "/card/" + cardToken + ".png").statusCode() == 200,
                "poster: свежая карточка живёт после TTL-гварды");

            /* TTL: файл со старым mtime (2 ч) удаляется ленивой чисткой при следующем
               POST; свежие карточки живут */
            java.nio.file.Path oldCard = cardsDirCa.resolve("oldcardXXXXXXXXXXXXXXX.png");
            java.nio.file.Files.write(oldCard, stored);
            java.nio.file.Files.setLastModifiedTime(oldCard,
                java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - 2 * 60 * 60 * 1000));
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCa + "\",\"wid\":2}").statusCode() == 200,
                "poster: повторный POST — 200");
            check(!java.nio.file.Files.exists(oldCard), "poster: TTL — файл старше 1 ч удалён при записи");

            /* антиспам: 3-й POST за час ещё ок, 4-й — 429 (лимит на чат) */
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCa + "\",\"wid\":2}").statusCode() == 200,
                "poster: 3-й POST в окно — 200");
            java.net.http.HttpResponse<String> rSpam = postJson(portCa, "/api/card",
                "{\"initData\":\"" + idCa + "\",\"wid\":2}");
            check(rSpam.statusCode() == 429, "poster: 4-й POST — 429, а не " + rSpam.statusCode());
            check(Json.map(Json.parse(rSpam.body())).get("error") != null,
                "poster: 429 с человекочитаемой ошибкой");

            /* 502 не съедает слот антиспама (ревью [UX-S16]): 3 отказа Telegram подряд →
               502 ×3, затем успешный вызов проходит БЕЗ 429 */
            sendOk.set(false);
            stCa.save(424260, seedCa); /* свой файл данных: лимит 429 — на чат, B отдельный */
            String idCaB = tgInitData("contract-test-token", 424260);
            for (int i = 0; i < 3; i++) {
                java.net.http.HttpResponse<String> rFail = postJson(portCa, "/api/card",
                    "{\"initData\":\"" + idCaB + "\",\"wid\":2}");
                check(rFail.statusCode() == 502, "poster: отказ sendPhoto — 502, а не " + rFail.statusCode());
                check(Json.map(Json.parse(rFail.body())).get("error") != null, "poster: 502 с человекочитаемой ошибкой");
            }
            sendOk.set(true);
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCaB + "\",\"wid\":2}").statusCode() == 200,
                "poster: 3 неудачных sendPhoto не съели слот — успешный вызов без 429");
            /* успешные вызовы лимитируются по-прежнему: 4-й успех за окно — 429 */
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCaB + "\",\"wid\":2}").statusCode() == 200,
                "poster: 2-й успешный POST B — 200");
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCaB + "\",\"wid\":2}").statusCode() == 200,
                "poster: 3-й успешный POST B — 200");
            java.net.http.HttpResponse<String> rSpamB = postJson(portCa, "/api/card",
                "{\"initData\":\"" + idCaB + "\",\"wid\":2}");
            check(rSpamB.statusCode() == 429, "poster: 4-й успешный POST B — 429, а не " + rSpamB.statusCode());
            check(Json.map(Json.parse(rSpamB.body())).get("error") != null,
                "poster: 429 с человекочитаемой ошибкой");

            /* кап каталога (по образцу [UX-T41]): > CARD_DIR_MAX_FILES файлов — 503;
               503 тоже не съедает слот (ревью): у C второй вызов — снова 503, не 429 */
            stCa.save(424261, seedCa);
            String idCaC = tgInitData("contract-test-token", 424261);
            for (int i = 0; i < 1001; i++) {
                java.nio.file.Files.write(cardsDirCa.resolve("cap" + i + ".png"), stored);
            }
            java.net.http.HttpResponse<String> rCap = postJson(portCa, "/api/card",
                "{\"initData\":\"" + idCaC + "\",\"wid\":2}");
            check(rCap.statusCode() == 503, "poster: кап каталога >1000 файлов — 503, а не " + rCap.statusCode());
            check(postJson(portCa, "/api/card", "{\"initData\":\"" + idCaC + "\",\"wid\":2}").statusCode() == 503,
                "poster: 503 не съедает слот — повтор снова 503, а не 429");

            /* рендер: формулы/склонения/дата/caption + падение на пустых (§5–7) */
            byte[] pngR = CardRender.render(seedCa, wRecCa);
            check(pngR[0] == (byte) 0x89 && pngR[1] == 0x50 && pngR.length > 30_000, "poster: CardRender.render — PNG");

            /* [UX-B19] длинное имя упражнения в рекорде: полный рендер с переносом
               заголовка на 2 строки (карточка y=740 h=290) — PNG без исключения;
               до фикса этот путь вообще не покрывался (recLine выше — короткий) */
            GymData longCa = new GymData();
            longCa.nextId = 2;
            longCa.rev = 1;
            Workout wLongBaseCa = new Workout();
            wLongBaseCa.id = 1;
            wLongBaseCa.date = "2026-11-10";
            wLongBaseCa.finished = true;
            ExerciseEntry lbeCa = new ExerciseEntry("Подтягивания параллельным хватом");
            lbeCa.sets.add(new SetEntry("6", 3, "8"));
            wLongBaseCa.exercises.add(lbeCa);
            Workout wLongRecCa = new Workout();
            wLongRecCa.id = 2;
            wLongRecCa.date = "2026-11-21";
            wLongRecCa.startedAt = "2026-11-21T09:00:00";
            wLongRecCa.endedAt = "2026-11-21T10:00:00";
            wLongRecCa.finished = true;
            ExerciseEntry lreCa = new ExerciseEntry("Подтягивания параллельным хватом");
            lreCa.sets.add(new SetEntry("8", 4, "10"));
            wLongRecCa.exercises.add(lreCa);
            longCa.workouts.add(wLongBaseCa);
            longCa.workouts.add(wLongRecCa);
            byte[] pngLongCa = CardRender.render(longCa, wLongRecCa);
            check(pngLongCa[0] == (byte) 0x89 && pngLongCa[1] == 0x50 && pngLongCa.length > 30_000,
                "poster: рендер с длинным именем рекорда (перенос на 2 строки) — PNG ([UX-B19])");

            /* [UX-B19] wrapRecTitle (рефлексия — метод приватный): короткая строка —
               1:1 без изменений; длинная — 2 строки, ОБЕ в пределах ширины карточки
               (это и есть фикс «заголовок вылезает за край»: старый код рисовал
               строку шире карточки, не падая); остаток строки 2 — с «…»; «слово»
               без пробелов режется по символам без потери остатка (§4.1, §6.3) */
            java.awt.Font boldCa = contractFontCa("DejaVuSans-Bold.ttf");
            java.awt.image.BufferedImage miCa = new java.awt.image.BufferedImage(
                1, 1, java.awt.image.BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D mgCa = miCa.createGraphics();
            mgCa.setRenderingHint(java.awt.RenderingHints.KEY_TEXT_ANTIALIASING,
                java.awt.RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            mgCa.setRenderingHint(java.awt.RenderingHints.KEY_FRACTIONALMETRICS,
                java.awt.RenderingHints.VALUE_FRACTIONALMETRICS_ON);
            java.awt.FontMetrics fmCa = mgCa.getFontMetrics(boldCa.deriveFont(48f));
            int availCa = 936 - 36 - 36;
            try {
                java.lang.reflect.Method wrapCa = CardRender.class.getDeclaredMethod(
                    "wrapRecTitle", java.awt.FontMetrics.class, String.class, int.class);
                wrapCa.setAccessible(true);
                String[] fitCa = (String[]) wrapCa.invoke(null, fmCa, "Приседания — 120 кг × 8", availCa);
                check(fitCa.length == 1 && fitCa[0].equals("Приседания — 120 кг × 8"),
                    "poster: короткий рекорд — одна строка 1:1 ([UX-B19])");
                String[] twoCa = (String[]) wrapCa.invoke(null, fmCa,
                    "Подтягивания параллельным хватом — 8 кг × 10", availCa);
                check(twoCa.length == 2, "poster: длинное имя — 2 строки, а не " + twoCa.length + " ([UX-B19])");
                check(fmCa.stringWidth(twoCa[0]) <= availCa && fmCa.stringWidth(twoCa[1]) <= availCa,
                    "poster: обе строки рекорда в пределах карточки — не вылезают за край ([UX-B19])");
                check("Подтягивания параллельным хватом — 8 кг × 10".startsWith(twoCa[0]),
                    "poster: строка 1 — целые слова начала строки рекорда ([UX-B19]): " + twoCa[0]);
                String[] dotsCa = (String[]) wrapCa.invoke(null, fmCa,
                    "Подтягивания параллельным хватом с отягощением на поясе и лямках — 8 кг × 10", availCa);
                check(dotsCa.length == 2 && dotsCa[1].endsWith("…"),
                    "poster: остаток строки 2 усечён «…» ([UX-B19]): " + dotsCa[1]);
                String[] wordCa = (String[]) wrapCa.invoke(null, fmCa,
                    "Тяга".repeat(60) + " — 8 кг × 10", availCa);
                check(wordCa.length == 2 && fmCa.stringWidth(wordCa[0]) <= availCa
                        && fmCa.stringWidth(wordCa[1]) <= availCa,
                    "poster: слово без пробелов режется по символам, обе строки в карточке ([UX-B19])");
            } finally {
                mgCa.dispose();
            }

            check(CardRender.russianDate("2026-11-21").equals("21 ноября 2026, суббота"), "poster: russianDate POC-формат");
            check(CardRender.russianDate("мусор").equals("мусор"), "poster: russianDate фолбэк — строка как есть (§5.1)");
            check(CardRender.russianDate(null).isEmpty(), "poster: russianDate(null) — пусто");
            check(CardRender.durationCompact(null).equals("—") && CardRender.durationCompact(0L).equals("—"),
                "poster: длительность null/0 — «—» (§6.7)");
            check(CardRender.durationCompact(48L).equals("48 мин") && CardRender.durationCompact(60L).equals("1 ч")
                    && CardRender.durationCompact(70L).equals("1 ч 10 мин"),
                "poster: компактная длительность (§10.1)");
            check(CardRender.exWord(1).equals("упражнение") && CardRender.exWord(2).equals("упражнения")
                    && CardRender.exWord(5).equals("упражнений") && CardRender.exWord(21).equals("упражнение"),
                "poster: склонение упражнений (§10.2)");
            check(CardRender.repeatWord(1).equals("повторение") && CardRender.repeatWord(2).equals("повторения")
                    && CardRender.repeatWord(38).equals("повторений"),
                "poster: склонение повторений (§5.3)");
            check(CardRender.weightAvgText(125.0).equals("125") && CardRender.weightAvgText(82.5).equals("82,5")
                    && CardRender.weightAvgText(82.25).equals("82,25"),
                "poster: среднее веса — запятая, без хвостовых нулей (§6.8)");
            Workout oldCa = new Workout();
            oldCa.date = "2025-03-14";
            check(WebServer.cardCaption(oldCa).equals("Постер тренировки за 14.03.2025 — перешли друзьям 💪"),
                "poster: caption не текущего года — dd.MM.yyyy (§7.3)");
            Workout emptyCa = new Workout();
            emptyCa.exercises.add(new ExerciseEntry("X"));
            try {
                CardRender.render(seedCa, emptyCa);
                throw new AssertionError("CONTRACT FAIL: poster — рендер не упал на 0 упражнений");
            } catch (IllegalArgumentException expected) {
                /* ожидаемо: делиться нечем */
            }

            /* счётчики: cardSend = принятые (A:3 + B:3×502+3×200 + C:2×503 = 11),
               cardSendOk = успешные sendPhoto (A:3 + B:3 = 6), cardSendErr = отказы
               Telegram (B:3); воронка cardClick/cardOk/cardErr через /api/track,
               bogus — мимо белого списка */
            postTrack(portCa, idCa, "[\"cardClick\",\"cardOk\",\"cardErr\",\"bogusEvent\"]").statusCode();
            Map<String, Object> snapCa = Json.map(Json.parse(get(portCa, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapCa.get("cardSend")) == 11,
                "poster: cardSend=11 (принятые POST), а не " + Json.lng(snapCa.get("cardSend")));
            check(Json.lng(snapCa.get("cardSendOk")) == 6,
                "poster: cardSendOk=6 (успешные sendPhoto), а не " + Json.lng(snapCa.get("cardSendOk")));
            check(Json.lng(snapCa.get("cardSendErr")) == 3,
                "poster: cardSendErr=3 (отказы Telegram), а не " + Json.lng(snapCa.get("cardSendErr")));
            check(Json.lng(snapCa.get("cardClick")) == 1 && Json.lng(snapCa.get("cardOk")) == 1
                    && Json.lng(snapCa.get("cardErr")) == 1 && Json.lng(snapCa.get("bogusEvent")) == 0,
                "poster: cardClick/cardOk/cardErr через /api/track=1, bogus — мимо белого списка");
        } catch (Exception posterErr) {
            throw new AssertionError("CONTRACT FAIL: poster " + posterErr);
        }

        /* [TRN-T1] social.json (соцслой «Тренер», спека [TRN-S1] §4): отсутствующий/старый/
           битый файл читается; гранты — 4 фиксированных ключа (финал владельца 23.11,
           «Здоровье» отложено, формат расширяем); round-trip; бэкапы с ротацией как у чатов;
           чистка при /delete_my_data (право на забвение §4.1); API-каркас §4.2. */
        try {
            java.nio.file.Path tmpSo = java.nio.file.Files.createTempDirectory("gymsocial");
            Storage stSo = new Storage(tmpSo);
            /* отсутствующий файл → пустое состояние без падения */
            check(stSo.social().get().trainers.isEmpty() && stSo.social().get().links.isEmpty(),
                "social: отсутствующий файл читается (пустое состояние)");

            /* seed: полный набор сущностей → round-trip через новый экземпляр Storage */
            SocialData sd1 = stSo.social().get();
            TrainerCard tc = new TrainerCard();
            tc.displayName = "Игорь Соколов";
            tc.bio = "Реабилитация и осанка";
            tc.specs.add("rehab");
            tc.specs.add("mobility");
            tc.city = "Минск";
            tc.gyms = "«Атлет»";
            tc.years = 6;
            tc.achievements.add("КМС по пауэрлифтингу, 2019");
            tc.education.add("РГУФК, 2015");
            tc.schedule.add("Пн–Пт 07:00–21:00");
            tc.cap = 10;
            tc.status = TrainerCard.STATUS_VERIFIED;
            tc.verifiedAt = "2026-11-23T10:00:00";
            tc.updatedAt = "2026-11-23T10:00:00";
            sd1.trainers.put(101L, tc);
            SocialLink sl = new SocialLink();
            sl.trainer = 101;
            sl.student = 202;
            sl.since = "2026-11-23";
            sl.grants.putAll(SocialLink.defaultGrants());
            sl.grants.put(SocialStore.GRANT_KCAL, true);
            sd1.links.add(sl);
            SocialRequest sr = new SocialRequest();
            sr.trainer = 101;
            sr.student = 303;
            sr.comment = "Хочу похудеть к лету";
            sr.createdAt = "2026-11-23T09:00:00";
            sd1.requests.add(sr);
            SocialInvite si = new SocialInvite();
            si.trainer = 101;
            si.code = "K7RM2X";
            sd1.invites.add(si);
            SocialReport srep = new SocialReport();
            srep.by = 303;
            srep.about = 101;
            srep.at = "2026-11-23T09:30:00";
            srep.text = "спам в описании";
            sd1.reports.add(srep);
            stSo.social().save();
            check(java.nio.file.Files.exists(tmpSo.resolve("social.json")), "social: файл создан");

            SocialData sd2 = new Storage(tmpSo).social().get();
            TrainerCard tc2 = sd2.trainers.get(101L);
            check(tc2 != null && "Игорь Соколов".equals(tc2.displayName) && tc2.years == 6
                    && tc2.specs.contains("rehab") && tc2.cap == 10 && tc2.useTgAvatar
                    && TrainerCard.STATUS_VERIFIED.equals(tc2.status)
                    && "2026-11-23T10:00:00".equals(tc2.verifiedAt),
                "social: карточка переживает round-trip без потерь");
            check(sd2.links.size() == 1 && sd2.links.get(0).trainer == 101 && sd2.links.get(0).student == 202
                    && "apply".equals(sd2.links.get(0).source) && "2026-11-23".equals(sd2.links.get(0).since),
                "social: связка переживает round-trip");
            /* гранты: ровно 4 фиксированных ключа (финал 23.11), значения на месте */
            Map<String, Boolean> g = sd2.links.get(0).grants;
            check(g.size() == 4 && Boolean.TRUE.equals(g.get(SocialStore.GRANT_PROGRESS))
                    && Boolean.FALSE.equals(g.get(SocialStore.GRANT_GOALS))
                    && Boolean.FALSE.equals(g.get(SocialStore.GRANT_BODY))
                    && Boolean.TRUE.equals(g.get(SocialStore.GRANT_KCAL)),
                "social: гранты — 4 фиксированных ключа, значения переживают round-trip");
            check(sd2.requests.size() == 1 && "Хочу похудеть к лету".equals(sd2.requests.get(0).comment),
                "social: заявка переживает round-trip");
            check(sd2.invites.size() == 1 && "K7RM2X".equals(sd2.invites.get(0).code),
                "social: код приглашения переживает round-trip");
            check(sd2.reports.size() == 1 && sd2.reports.get(0).by == 303 && sd2.reports.get(0).about == 101,
                "social: жалоба переживает round-trip");

            /* старый/минимальный файл: связка без grants-ключа → дефолт связки (progress ВКЛ) */
            java.nio.file.Files.writeString(tmpSo.resolve("social.json"),
                "{\"ver\":1,\"links\":[{\"trainer\":5,\"student\":6}]}",
                java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Boolean> gOld = new Storage(tmpSo).social().get().links.get(0).grants;
            check(gOld.size() == 4 && Boolean.TRUE.equals(gOld.get(SocialStore.GRANT_PROGRESS))
                    && Boolean.FALSE.equals(gOld.get(SocialStore.GRANT_GOALS)),
                "social: старый файл без grants → 4 ключа, «Прогресс» ВКЛ (дефолт связки)");

            /* мусорный ключ карты trainers пропускается, валидный читается */
            java.nio.file.Files.writeString(tmpSo.resolve("social.json"),
                "{\"ver\":1,\"trainers\":{\"абс\":{\"displayName\":\"X\"},\"7\":{\"displayName\":\"Y\"}}}",
                java.nio.charset.StandardCharsets.UTF_8);
            SocialData sdK = new Storage(tmpSo).social().get();
            check(sdK.trainers.size() == 1 && "Y".equals(sdK.trainers.get(7L).displayName),
                "social: мусорный ключ карты trainers пропускается без падения");

            /* будущий грант (health) в файле: чтение толерантно, ключ переживает перезапись —
               «Здоровье» добавится позже без ломки формата (решение владельца 23.11) */
            java.nio.file.Files.writeString(tmpSo.resolve("social.json"),
                "{\"ver\":1,\"links\":[{\"trainer\":5,\"student\":6,\"grants\":{\"progress\":true,\"goals\":true,\"health\":true}}]}",
                java.nio.charset.StandardCharsets.UTF_8);
            SocialData sdF = new Storage(tmpSo).social().get();
            check(Boolean.TRUE.equals(sdF.links.get(0).grants.get("health")),
                "social: незнакомый грант health читается без падения");
            check(Boolean.FALSE.equals(sdF.links.get(0).grants.get(SocialStore.GRANT_KCAL)),
                "social: отсутствующий kcal в файле → OFF (дефолт)");
            new Storage(tmpSo).social().save();
            String socialOut = java.nio.file.Files.readString(tmpSo.resolve("social.json"),
                java.nio.charset.StandardCharsets.UTF_8);
            check(socialOut.contains("\"health\":true"),
                "social: незнакомый грант переживает перезапись (формат расширяем)");
            check(socialOut.contains("\"ver\":1"), "social: файл с версионированием формата (ver)");

            /* битый файл → пустое состояние без падения; уходит в бэкап при перезаписи */
            java.nio.file.Path tmpBad = java.nio.file.Files.createTempDirectory("gymsocialbad");
            java.nio.file.Files.writeString(tmpBad.resolve("social.json"), "{битый",
                java.nio.charset.StandardCharsets.UTF_8);
            Storage stBad = new Storage(tmpBad);
            check(stBad.social().get().links.isEmpty(), "social: битый файл → пустое состояние без падения");
            stBad.social().save();
            int badBackups = 0;
            try (java.nio.file.DirectoryStream<java.nio.file.Path> dsBadSo =
                     java.nio.file.Files.newDirectoryStream(tmpBad.resolve("backups"), "social.*.json")) {
                for (java.nio.file.Path p : dsBadSo) badBackups++;
            }
            check(badBackups == 1, "social: битый прежний файл уехал в бэкап при первой перезаписи");

            /* бэкап ПЕРЕД перезаписью + ротация BACKUPS_TO_KEEP — как у чат-файлов */
            Storage stBk = new Storage(tmpSo);
            stBk.social().get().trainers.put(999L, new TrainerCard());
            for (int i = 0; i < Storage.BACKUPS_TO_KEEP + 3; i++) {
                Thread.sleep(3);
                stBk.social().save();
            }
            int socBackups = 0;
            try (java.nio.file.DirectoryStream<java.nio.file.Path> dsBk =
                     java.nio.file.Files.newDirectoryStream(tmpSo.resolve("backups"), "social.*.json")) {
                for (java.nio.file.Path p : dsBk) socBackups++;
            }
            check(socBackups == Storage.BACKUPS_TO_KEEP,
                "social: ротация держит " + Storage.BACKUPS_TO_KEEP + " бэкапов, а не " + socBackups);
            check(new Storage(tmpSo).social().get().trainers.containsKey(999L),
                "social: основной файл читается после ротации");

            /* право на забвение (§4.1): /delete_my_data вычищает все соцданные пользователя */
            java.nio.file.Path tmpFor = java.nio.file.Files.createTempDirectory("gymsocialdel");
            Storage stFor = new Storage(tmpFor);
            SocialData fd = stFor.social().get();
            TrainerCard fc = new TrainerCard();
            fc.displayName = "Удаляемый";
            fd.trainers.put(404L, fc);
            TrainerCard fc2 = new TrainerCard();
            fc2.displayName = "Остаётся";
            fd.trainers.put(405L, fc2);
            SocialLink fl1 = new SocialLink();
            fl1.trainer = 404;
            fl1.student = 505;
            fl1.grants.putAll(SocialLink.defaultGrants());
            SocialLink fl2 = new SocialLink();
            fl2.trainer = 606;
            fl2.student = 404;
            fl2.grants.putAll(SocialLink.defaultGrants());
            SocialLink fl3 = new SocialLink();
            fl3.trainer = 405;
            fl3.student = 505;
            fl3.grants.putAll(SocialLink.defaultGrants());
            fd.links.add(fl1);
            fd.links.add(fl2);
            fd.links.add(fl3);
            SocialRequest fr1 = new SocialRequest();
            fr1.trainer = 405;
            fr1.student = 404;
            SocialRequest fr2 = new SocialRequest();
            fr2.trainer = 404;
            fr2.student = 505;
            fd.requests.add(fr1);
            fd.requests.add(fr2);
            SocialInvite fi = new SocialInvite();
            fi.trainer = 404;
            fi.code = "AAAABB";
            SocialInvite fi2 = new SocialInvite();
            fi2.trainer = 405;
            fi2.code = "CCCCDD";
            fd.invites.add(fi);
            fd.invites.add(fi2);
            SocialReport fp1 = new SocialReport();
            fp1.by = 404;
            fp1.about = 405;
            SocialReport fp2 = new SocialReport();
            fp2.by = 405;
            fp2.about = 404;
            SocialReport fp3 = new SocialReport();
            fp3.by = 405;
            fp3.about = 505;
            fd.reports.add(fp1);
            fd.reports.add(fp2);
            fd.reports.add(fp3);
            stFor.social().deleteUser(404);
            SocialData fd2 = new Storage(tmpFor).social().get();
            check(!fd2.trainers.containsKey(404L) && fd2.trainers.containsKey(405L),
                "social del: карточка удалена, чужая осталась");
            check(fd2.links.size() == 1 && fd2.links.get(0).trainer == 405,
                "social del: обе связки с участием пользователя удалены (гранты умерли с ними)");
            check(fd2.requests.isEmpty(), "social del: заявки с его участием удалены");
            check(fd2.invites.size() == 1 && fd2.invites.get(0).trainer == 405,
                "social del: его код приглашения удалён, чужой остался");
            check(fd2.reports.size() == 1 && fd2.reports.get(0).about == 505,
                "social del: жалобы с его участием удалены, чужая осталась");
            check(fd2.links.get(0).grants.size() == 4,
                "social del: гранты оставшейся (чужой) связки не тронуты");
        } catch (Exception soErr) {
            throw new AssertionError("CONTRACT FAIL: social " + soErr);
        }

        /* [TRN-T1] API-каркас §4.2 (реальный WebServer на эфемерном порту): initData-гейт,
           карточка (лимиты/фильтр specs/server-owned статус), search только verified,
           заявка/приём (дефолт грантов), grants, invite, break, report; /api/social/health
           не реализован («Здоровье» отложено). */
        try {
            java.nio.file.Path tmpApi = java.nio.file.Files.createTempDirectory("gymsocapi");
            Storage stApi = new Storage(tmpApi);
            WebServer wsSo = new WebServer("contract-test-token", stApi, tmpApi, new Stats(tmpApi.resolve("stats.json")));
            java.net.ServerSocket probeSo = new java.net.ServerSocket(0);
            int portSo = probeSo.getLocalPort();
            probeSo.close();
            wsSo.start(portSo);
            String idT = tgInitData("contract-test-token", 501);
            String idS = tgInitData("contract-test-token", 502);
            String idX = tgInitData("contract-test-token", 503);

            /* [TRN-T2] 18+ гейт соцслоя: участникам нужны взрослые профили (birth-данные) */
            GymData prof501 = new GymData();
            prof501.nextId = 1;
            prof501.profile = new ProfileData();
            prof501.profile.sex = "м";
            prof501.profile.age = 36;
            prof501.profile.height = 178;
            prof501.profile.weight = 78;
            prof501.profile.birthYear = 1990;
            prof501.profile.birthMonth = 11;
            stApi.save(501, prof501);
            GymData prof502 = new GymData();
            prof502.nextId = 1;
            prof502.profile = new ProfileData();
            prof502.profile.sex = "ж";
            prof502.profile.age = 28;
            prof502.profile.height = 165;
            prof502.profile.weight = 58;
            prof502.profile.birthYear = 1998;
            prof502.profile.birthMonth = 3;
            stApi.save(502, prof502);
            GymData prof503 = new GymData();
            prof503.nextId = 1;
            prof503.profile = new ProfileData();
            prof503.profile.sex = "м";
            prof503.profile.age = 30;
            prof503.profile.height = 182;
            prof503.profile.weight = 84;
            prof503.profile.birthYear = 1996;
            prof503.profile.birthMonth = 7;
            stApi.save(503, prof503);

            /* гейт: мусорная подпись — 401; GET — 405; отложенный health — 404 */
            check(postJson(portSo, "/api/social/me", "{\"initData\":\"garbage\"}").statusCode() == 401,
                "social api: неверная подпись — 401");
            check(get(portSo, "/api/social/me").statusCode() == 405,
                "social api: GET вместо POST — 405");
            check(postJson(portSo, "/api/social/health", "{\"initData\":\"" + idT + "\"}").statusCode() == 404,
                "social api: /api/social/health не реализован («Здоровье» отложено, 23.11)");

            /* карточка: лимиты обрезаются, specs фильтруются, cap вне набора → дефолт */
            java.net.http.HttpResponse<String> rc1 = postJson(portSo, "/api/social/card",
                "{\"initData\":\"" + idT + "\",\"card\":{\"displayName\":\"" + "И".repeat(60)
                    + "\",\"bio\":\"Реабилитация\",\"specs\":[\"rehab\",\"мусор\"],\"city\":\"Минск\","
                    + "\"gyms\":\"«Атлет»\",\"years\":120,\"cap\":7,\"achievements\":[\"КМС\"],"
                    + "\"schedule\":[\"Пн–Пт 07:00\"],\"useTgAvatar\":false}}");
            check(rc1.statusCode() == 200, "social api: card save — 200, а не " + rc1.statusCode());
            TrainerCard savedT = stApi.social().get().trainers.get(501L);
            check(savedT != null && savedT.displayName.length() == TrainerCard.MAX_NAME
                    && savedT.specs.size() == 1 && "rehab".equals(savedT.specs.get(0))
                    && savedT.years == TrainerCard.MAX_YEARS && savedT.cap == TrainerCard.DEFAULT_CAP
                    && !savedT.useTgAvatar && TrainerCard.STATUS_DRAFT.equals(savedT.status),
                "social api: карточка обрезана по лимитам, specs фильтрованы, статус draft (server-owned)");

            /* клиент не выставляет статус; неприсланные клиентские поля замещаются */
            check(postJson(portSo, "/api/social/card",
                "{\"initData\":\"" + idT + "\",\"card\":{\"displayName\":\"Игорь\",\"status\":\"verified\",\"statusNote\":\"сам\"}}").statusCode() == 200,
                "social api: повторный card save — 200");
            TrainerCard updT = stApi.social().get().trainers.get(501L);
            check(TrainerCard.STATUS_DRAFT.equals(updT.status) && updT.statusNote.isEmpty(),
                "social api: статус/статусNote клиент не выставляет (server-owned)");
            check(updT.bio.isEmpty() && updT.specs.isEmpty(),
                "social api: карточка замещается присланными полями (bio/specs сброшены)");

            /* поиск: draft не виден; заявка на draft — 404 */
            java.net.http.HttpResponse<String> rsearch = postJson(portSo, "/api/social/search",
                "{\"initData\":\"" + idS + "\"}");
            check(rsearch.statusCode() == 200 && !rsearch.body().contains("Игорь"),
                "social api: не-verified карточка в поиске не видна");
            check(postJson(portSo, "/api/social/apply",
                "{\"initData\":\"" + idS + "\",\"trainerId\":501,\"comment\":\"пустите\"}").statusCode() == 404,
                "social api: заявка на draft-карточку — 404");

            /* «верификация» — эмуляция будущей /trainer_ok [TRN-T2]: правка статуса в хранилище */
            stApi.social().get().trainers.get(501L).status = TrainerCard.STATUS_VERIFIED;
            stApi.social().get().trainers.get(501L).verifiedAt = "2026-11-23T11:00:00";
            java.net.http.HttpResponse<String> rsearch2 = postJson(portSo, "/api/social/search",
                "{\"initData\":\"" + idS + "\"}");
            check(rsearch2.statusCode() == 200 && rsearch2.body().contains("Игорь")
                    && !rsearch2.body().contains("statusNote") && !rsearch2.body().contains("\"cap\""),
                "social api: verified найден; публичная проекция без statusNote/cap");

            /* заявка: к себе — 400; дубль — 409; accept не-тренером — 404 */
            check(postJson(portSo, "/api/social/apply",
                "{\"initData\":\"" + idS + "\",\"trainerId\":501,\"comment\":\"Хочу похудеть к лету. Грыжа\"}").statusCode() == 200,
                "social api: заявка — 200");
            check(postJson(portSo, "/api/social/apply",
                "{\"initData\":\"" + idS + "\",\"trainerId\":501}").statusCode() == 409,
                "social api: дубль активной заявки — 409 (§7.1)");
            check(postJson(portSo, "/api/social/apply",
                "{\"initData\":\"" + idS + "\",\"trainerId\":502}").statusCode() == 400,
                "social api: заявка к себе — 400");
            check(postJson(portSo, "/api/social/link",
                "{\"initData\":\"" + idS + "\",\"action\":\"accept\",\"userId\":503}").statusCode() == 404,
                "social api: accept не-тренером (заявки нет) — 404");

            /* входящая видна тренеру; accept создаёт связку с грантами «Прогресс» ВКЛ */
            java.net.http.HttpResponse<String> rmeT = postJson(portSo, "/api/social/me",
                "{\"initData\":\"" + idT + "\"}");
            check(rmeT.statusCode() == 200 && rmeT.body().contains("Хочу похудеть к лету. Грыжа"),
                "social api: входящая заявка видна тренеру в /api/social/me");
            java.net.http.HttpResponse<String> rlink = postJson(portSo, "/api/social/link",
                "{\"initData\":\"" + idT + "\",\"action\":\"accept\",\"userId\":502}");
            check(rlink.statusCode() == 200 && rlink.body().contains("\"progress\":true")
                    && rlink.body().contains("\"goals\":false") && rlink.body().contains("\"bodyMetrics\":false")
                    && rlink.body().contains("\"kcal\":false"),
                "social api: accept — связка, гранты по дефолту «Прогресс» ВКЛ (финал 23.11)");
            check(postJson(portSo, "/api/social/link",
                "{\"initData\":\"" + idT + "\",\"action\":\"accept\",\"userId\":502}").statusCode() == 404,
                "social api: заявка после accept исчезла — 404");
            java.net.http.HttpResponse<String> rmeS = postJson(portSo, "/api/social/me",
                "{\"initData\":\"" + idS + "\"}");
            check(rmeS.body().contains("\"peerName\":\"Игорь\""),
                "social api: подопечный видит связку с именем контрагента");

            /* grants: меняет только подопечный своей связки; мусорные ключи игнорируются */
            check(postJson(portSo, "/api/social/grants",
                "{\"initData\":\"" + idS + "\",\"trainerId\":501,\"grants\":{\"goals\":true,\"мусор\":true}}").statusCode() == 200,
                "social api: grants update — 200");
            SocialLink gl = stApi.social().get().linkBetween(501, 502);
            check(Boolean.TRUE.equals(gl.grants.get(SocialStore.GRANT_GOALS))
                    && Boolean.TRUE.equals(gl.grants.get(SocialStore.GRANT_PROGRESS))
                    && gl.grants.size() == 4,
                "social api: goals ВКЛ, progress сохранён, незнакомые ключи клиента отброшены");
            check(postJson(portSo, "/api/social/grants",
                "{\"initData\":\"" + idT + "\",\"trainerId\":501,\"grants\":{\"goals\":true}}").statusCode() == 404,
                "social api: тренер не может менять гранты (решает подопечный, §8)");

            /* invite: create → 6 символов алфавита без похожих; use связанным — 409;
               use третьим — связка сразу, код гаснет (§7.2) */
            java.net.http.HttpResponse<String> rinv = postJson(portSo, "/api/social/invite",
                "{\"initData\":\"" + idT + "\",\"action\":\"create\"}");
            check(rinv.statusCode() == 200, "social api: invite create — 200");
            String invCode = Json.str(Json.map(Json.parse(rinv.body())), "code");
            check(invCode != null && invCode.length() == SocialInvite.CODE_LEN
                    && invCode.matches("[ABCDEFGHJKLMNPRTUVWXY23456789]+"),
                "social api: код 6 символов из алфавита без похожих, а не «" + invCode + "»");
            check(postJson(portSo, "/api/social/invite",
                "{\"initData\":\"" + idS + "\",\"action\":\"use\",\"code\":\"" + invCode + "\"}").statusCode() == 409,
                "social api: use кода при существующей связке — 409");
            check(postJson(portSo, "/api/social/invite",
                "{\"initData\":\"" + idX + "\",\"action\":\"use\",\"code\":\"" + invCode + "\"}").statusCode() == 200,
                "social api: use кода третьим — связка сразу без заявки (§7.2)");
            check(stApi.social().get().linkBetween(501, 503) != null
                    && stApi.social().get().linkBetween(501, 503).source.equals(SocialLink.SOURCE_INVITE)
                    && Boolean.TRUE.equals(stApi.social().get().linkBetween(501, 503).grants.get(SocialStore.GRANT_PROGRESS)),
                "social api: связка по коду с дефолтными грантами (Прогресс ВКЛ)");
            check(postJson(portSo, "/api/social/invite",
                "{\"initData\":\"" + idX + "\",\"action\":\"use\",\"code\":\"" + invCode + "\"}").statusCode() == 404,
                "social api: код одноразовый — гаснет применением");

            /* break: подопечный разрывает связь; гранты умирают со связкой */
            check(postJson(portSo, "/api/social/link",
                "{\"initData\":\"" + idX + "\",\"action\":\"break\",\"userId\":501}").statusCode() == 200,
                "social api: break подопечным — 200 (§7.5)");
            check(stApi.social().get().linkBetween(501, 503) == null,
                "social api: связка после break удалена");

            /* report: жалоба пишется; на себя — 400 */
            check(postJson(portSo, "/api/social/report",
                "{\"initData\":\"" + idS + "\",\"about\":501,\"text\":\"спам в карточке\"}").statusCode() == 200,
                "social api: жалоба — 200");
            check(stApi.social().get().reports.size() == 1
                    && stApi.social().get().reports.get(0).by == 502
                    && stApi.social().get().reports.get(0).about == 501,
                "social api: жалоба записана в social.json");
            check(postJson(portSo, "/api/social/report",
                "{\"initData\":\"" + idS + "\",\"about\":502,\"text\":\"на себя\"}").statusCode() == 400,
                "social api: жалоба на себя — 400");
        } catch (Exception soErr) {
            throw new AssertionError("CONTRACT FAIL: social api " + soErr);
        }

        /* [TRN-T2] режим «Я тренер»: переходы статусов (draft → pending → verified →
           pending при правке; rejected + 30-дневный кулдаун), 18+ гейт по birth-данным,
           выключение режима (hidden, warning при связках), аватар из initData,
           уведомление владельцу о новой заявке, счётчики /stats (§17). */
        try {
            java.nio.file.Path tmpT2 = java.nio.file.Files.createTempDirectory("gymsocialt2");
            Storage stT2 = new Storage(tmpT2);
            WebServer wsT2 = new WebServer("contract-test-token", stT2, tmpT2, new Stats(tmpT2.resolve("stats.json")));
            java.net.ServerSocket probeT2 = new java.net.ServerSocket(0);
            int portT2 = probeT2.getLocalPort();
            probeT2.close();
            wsT2.start(portT2);
            /* 701 — взрослый (birth 1990-11), 702 — 15 лет, 703 — взрослый без карточки */
            GymData adultT2 = new GymData();
            adultT2.nextId = 1;
            adultT2.profile = new ProfileData();
            adultT2.profile.sex = "м";
            adultT2.profile.age = 36;
            adultT2.profile.height = 178;
            adultT2.profile.weight = 78;
            adultT2.profile.birthYear = 1990;
            adultT2.profile.birthMonth = 11;
            stT2.save(701, adultT2);
            GymData minorT2 = new GymData();
            minorT2.nextId = 1;
            minorT2.profile = new ProfileData();
            minorT2.profile.sex = "ж";
            minorT2.profile.age = 15;
            minorT2.profile.height = 160;
            minorT2.profile.weight = 50;
            minorT2.profile.birthYear = java.time.LocalDate.now().getYear() - 15;
            minorT2.profile.birthMonth = 1;
            stT2.save(702, minorT2);
            GymData adult3T2 = new GymData();
            adult3T2.nextId = 1;
            adult3T2.profile = new ProfileData();
            adult3T2.profile.sex = "м";
            adult3T2.profile.age = 30;
            adult3T2.profile.height = 180;
            adult3T2.profile.weight = 80;
            stT2.save(703, adult3T2);
            String idA = tgInitData("contract-test-token", 701);
            String idM = tgInitData("contract-test-token", 702);
            String idC = tgInitData("contract-test-token", 703);

            /* 18+ гейт: 15 лет → 403 reason age; возраст неизвестен → тоже 403 */
            java.net.http.HttpResponse<String> rminor = postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idM + "\",\"card\":{\"displayName\":\"Мала\"}}");
            check(rminor.statusCode() == 403 && "age".equals(Json.str(Json.map(Json.parse(rminor.body())), "reason")),
                "t2: карточка 15-летнего — 403 reason age, а не " + rminor.statusCode());
            String idNo = tgInitData("contract-test-token", 704);
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idNo + "\",\"card\":{\"displayName\":\"БезВозраста\"}}").statusCode() == 403,
                "t2: без birth-данных — 403 (18+ гейт, решение 12.11 №12)");

            /* draft: черновик сохраняется, socialTrainerOn=1 (§17) */
            java.net.http.HttpResponse<String> rc2 = postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idA + "\",\"card\":{\"displayName\":\"Игорь Соколов\",\"city\":\"Минск\","
                    + "\"specs\":[\"rehab\"],\"years\":6,\"education\":[\"РГУФК, 2015\"]}}");
            check(rc2.statusCode() == 200 && TrainerCard.STATUS_DRAFT.equals(stT2.social().get().trainers.get(701L).status),
                "t2: новая карточка — draft");
            Map<String, Object> snapT2 = Json.map(Json.parse(get(portT2, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapT2.get("socialTrainerOn")) == 1, "t2: socialTrainerOn=1 (включение режима)");

            /* submit-only → pending (черновик уже у сервера, поля не повторяются) */
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + idA + "\",\"submit\":true}").statusCode() == 200,
                "t2: submit-only — 200");
            check(TrainerCard.STATUS_PENDING.equals(stT2.social().get().trainers.get(701L).status),
                "t2: submit → pending (§5.2)");
            snapT2 = Json.map(Json.parse(get(portT2, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapT2.get("socialCardPending")) == 1, "t2: socialCardPending=1");

            /* «верификация» (эмуляция /trainer_ok [TRN-T2]): verified; правка → снова pending */
            TrainerCard v701 = stT2.social().get().trainers.get(701L);
            v701.status = TrainerCard.STATUS_VERIFIED;
            v701.verifiedAt = "2026-11-23T11:00:00";
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idA + "\",\"card\":{\"displayName\":\"Игорь С.\"}}").statusCode() == 200,
                "t2: правка verified-карточки — 200");
            check(TrainerCard.STATUS_PENDING.equals(stT2.social().get().trainers.get(701L).status),
                "t2: правка содержимого вернула verified в pending (§5.3)");

            /* отказ (эмуляция /trainer_no) → 30-дневный кулдаун повторной отправки */
            TrainerCard r701 = stT2.social().get().trainers.get(701L);
            r701.status = TrainerCard.STATUS_REJECTED;
            r701.statusNote = "нет подтверждения стажа";
            r701.rejectedAt = java.time.LocalDateTime.now().withNano(0).toString();
            java.net.http.HttpResponse<String> rcool = postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idA + "\",\"submit\":true}");
            check(rcool.statusCode() == 403 && "cooldown".equals(Json.str(Json.map(Json.parse(rcool.body())), "reason")),
                "t2: submit сразу после отказа — 403 cooldown");
            long retry = Json.lng(Json.map(Json.parse(rcool.body())).get("retryInDays"));
            check(retry >= 29 && retry <= 30, "t2: retryInDays ≈ 30, а не " + retry);
            r701.rejectedAt = java.time.LocalDateTime.now().minusDays(31).withNano(0).toString();
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + idA + "\",\"submit\":true}").statusCode() == 200,
                "t2: submit после истечения 30 дней — 200");

            /* выключение режима: verified → hidden; вне поиска; заявки невозможны;
               при связке — warning (связи сохраняются, §5.4) */
            stT2.social().get().trainers.get(701L).status = TrainerCard.STATUS_VERIFIED;
            SocialLink lkT2 = new SocialLink();
            lkT2.trainer = 701;
            lkT2.student = 703;
            lkT2.grants.putAll(SocialLink.defaultGrants());
            stT2.social().get().links.add(lkT2);
            java.net.http.HttpResponse<String> roff = postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idA + "\",\"enabled\":false}");
            check(roff.statusCode() == 200 && TrainerCard.STATUS_HIDDEN.equals(stT2.social().get().trainers.get(701L).status),
                "t2: enabled=false → hidden (§5.4)");
            Map<String, Object> mOff = Json.map(Json.parse(roff.body()));
            check(mOff.get("warning") != null && String.valueOf(mOff.get("warning")).contains("Связи сохранены"),
                "t2: выключение при связке вернуло warning");
            check(!postJson(portT2, "/api/social/search", "{\"initData\":\"" + idC + "\"}").body().contains("Игорь"),
                "t2: hidden карточка не видна в поиске");
            check(postJson(portT2, "/api/social/apply", "{\"initData\":\"" + idC + "\",\"trainerId\":701}").statusCode() == 404,
                "t2: заявка на hidden — 404 (только verified, §6.4)");
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + idA + "\",\"enabled\":true}").statusCode() == 200
                    && TrainerCard.STATUS_DRAFT.equals(stT2.social().get().trainers.get(701L).status),
                "t2: enabled=true → draft (повторная отправка через submit)");

            /* аватар: photo_url из подписанного initData попадает в карточку и в publicMap;
               клиентский payload «photo» не доверенный */
            GymData adult5 = new GymData();
            adult5.nextId = 1;
            adult5.profile = new ProfileData();
            adult5.profile.sex = "м";
            adult5.profile.age = 30;
            adult5.profile.height = 180;
            adult5.profile.weight = 82;
            adult5.profile.birthYear = 1996;
            adult5.profile.birthMonth = 5;
            stT2.save(705, adult5);
            String idPh = tgInitData("contract-test-token", 705, "Павел", "https://t.me/i/userphoto.jpg");
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + idPh + "\",\"card\":{\"displayName\":\"Павел\",\"city\":\"Гродно\","
                    + "\"specs\":[\"mass\"],\"years\":9,\"photo\":\"ПОДМЕНА\"}}").statusCode() == 200,
                "t2: карточка с аватаром в initData — 200");
            TrainerCard phCard = stT2.social().get().trainers.get(705L);
            check("https://t.me/i/userphoto.jpg".equals(phCard.photoUrl),
                "t2: photoUrl из подписанного initData");
            phCard.status = TrainerCard.STATUS_VERIFIED;
            java.net.http.HttpResponse<String> rsh2 = postJson(portT2, "/api/social/search", "{\"initData\":\"" + idC + "\"}");
            check(rsh2.body().contains("\"photoUrl\":\"https://t.me/i/userphoto.jpg\""),
                "t2: search отдаёт photoUrl verified-карточки");
            snapT2 = Json.map(Json.parse(get(portT2, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapT2.get("socialSearch")) == 2, "t2: socialSearch=2 (§17)");

            /* уведомление владельцу о «на проверке»: 7-параметровый конструктор + заглушка TelegramApi */
            SpyApi spy = new SpyApi();
            WebServer wsN = new WebServer("contract-test-token", stT2, tmpT2, new Stats(tmpT2.resolve("stats-n.json")), null, spy, 9999);
            java.net.ServerSocket probeN = new java.net.ServerSocket(0);
            int portN = probeN.getLocalPort();
            probeN.close();
            wsN.start(portN);
            check(postJson(portN, "/api/social/card", "{\"initData\":\"" + idA + "\",\"submit\":true}").statusCode() == 200,
                "t2: submit на сервере с ownerChatId — 200");
            check(spy.sent.size() == 1 && spy.sent.get(0).startsWith("9999:") && spy.sent.get(0).contains("на проверку"),
                "t2: владельцу 9999 ушла карточка на проверку (§5.2 → §14.5)");

            /* ===== фиксы ревью батча T1–T3 ===== */

            /* замечание 4: повторный submit при уже-pending — тихий успех без второго пуша */
            check(postJson(portN, "/api/social/card", "{\"initData\":\"" + idA + "\",\"submit\":true}").statusCode() == 200,
                "fix4: повторный submit при pending — 200 (успех)");
            check(spy.sent.size() == 1, "fix4: владелец уведомлён один раз, а не " + spy.sent.size());
            Map<String, Object> snapN = Json.map(Json.parse(get(portN, "/stats?token=contract-test-token").body()));
            check(Json.lng(snapN.get("socialCardPending")) == 1,
                "fix4: socialCardPending не задвоился, а не " + Json.lng(snapN.get("socialCardPending")));

            /* фикс блокера 1: enabled=false → true не теряют контент карточки и photoUrl */
            stT2.save(710, adultProfile(27));
            String id10 = tgInitData("contract-test-token", 710, "Мария", "https://t.me/i/maria.jpg");
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id10 + "\",\"card\":{\"displayName\":\"Мария\",\"bio\":\"Нутрициолог\","
                    + "\"specs\":[\"loss\"],\"city\":\"Брест\",\"years\":4}}").statusCode() == 200,
                "fix1: полная карточка — 200");
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + id10 + "\",\"enabled\":false}").statusCode() == 200,
                "fix1: enabled=false — 200");
            TrainerCard mHidden = stT2.social().get().trainers.get(710L);
            check(TrainerCard.STATUS_HIDDEN.equals(mHidden.status) && "Мария".equals(mHidden.displayName)
                    && "Нутрициолог".equals(mHidden.bio) && mHidden.specs.contains("loss")
                    && "Брест".equals(mHidden.city) && "https://t.me/i/maria.jpg".equals(mHidden.photoUrl),
                "fix1: выключение режима не трогает displayName/bio/specs/city/photoUrl");
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + id10 + "\",\"enabled\":true}").statusCode() == 200,
                "fix1: enabled=true — 200");
            TrainerCard mOn = stT2.social().get().trainers.get(710L);
            check(TrainerCard.STATUS_DRAFT.equals(mOn.status) && "Мария".equals(mOn.displayName)
                    && mOn.specs.contains("loss") && "https://t.me/i/maria.jpg".equals(mOn.photoUrl),
                "fix1: включение режима тоже сохраняет контент");

            /* фикс блокера 2a: у студента со связкой accept/invite-use вторым тренером — 409 */
            stT2.save(711, adultProfile(30));
            stT2.save(712, adultProfile(25));
            stT2.save(713, adultProfile(33));
            String id11 = tgInitData("contract-test-token", 711);
            String id12 = tgInitData("contract-test-token", 712);
            String id13 = tgInitData("contract-test-token", 713);
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id11 + "\",\"card\":{\"displayName\":\"Тренер Один\",\"city\":\"Минск\","
                    + "\"specs\":[\"power\"],\"years\":5}}").statusCode() == 200, "fix2a: карточка тренера 711 — 200");
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id13 + "\",\"card\":{\"displayName\":\"Тренер Два\",\"city\":\"Гродно\","
                    + "\"specs\":[\"mass\"],\"years\":8}}").statusCode() == 200, "fix2a: карточка тренера 713 — 200");
            stT2.social().get().trainers.get(711L).status = TrainerCard.STATUS_VERIFIED;
            stT2.social().get().trainers.get(713L).status = TrainerCard.STATUS_VERIFIED;
            check(postJson(portT2, "/api/social/apply", "{\"initData\":\"" + id12 + "\",\"trainerId\":711}").statusCode() == 200,
                "fix2a: заявка к первому тренеру — 200");
            check(postJson(portT2, "/api/social/link",
                "{\"initData\":\"" + id11 + "\",\"action\":\"accept\",\"userId\":712}").statusCode() == 200,
                "fix2a: первый accept — 200");
            check(postJson(portT2, "/api/social/apply", "{\"initData\":\"" + id12 + "\",\"trainerId\":713}").statusCode() == 200,
                "fix2a: заявка ко второму тренеру проходит (гейт — на accept)");
            check(postJson(portT2, "/api/social/link",
                "{\"initData\":\"" + id13 + "\",\"action\":\"accept\",\"userId\":712}").statusCode() == 409,
                "fix2a: accept вторым тренером при действующей связке — 409 (§7.4)");
            java.net.http.HttpResponse<String> rinv13 = postJson(portT2, "/api/social/invite",
                "{\"initData\":\"" + id13 + "\",\"action\":\"create\"}");
            check(rinv13.statusCode() == 200, "fix2a: код второго тренера — 200");
            String code13 = Json.str(Json.map(Json.parse(rinv13.body())), "code");
            check(postJson(portT2, "/api/social/invite",
                "{\"initData\":\"" + id12 + "\",\"action\":\"use\",\"code\":\"" + code13 + "\"}").statusCode() == 409,
                "fix2a: use кода вторым тренером при действующей связке — 409 (§7.4)");

            /* фикс блокера 2b: hidden-тренер — accept/invite create/use отказ */
            stT2.save(714, adultProfile(35));
            stT2.save(715, adultProfile(22));
            String id14 = tgInitData("contract-test-token", 714);
            String id15 = tgInitData("contract-test-token", 715);
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id14 + "\",\"card\":{\"displayName\":\"Тайный\"}}").statusCode() == 200,
                "fix2b: карточка 714 — 200");
            stT2.social().get().trainers.get(714L).status = TrainerCard.STATUS_VERIFIED;
            check(postJson(portT2, "/api/social/apply", "{\"initData\":\"" + id15 + "\",\"trainerId\":714}").statusCode() == 200,
                "fix2b: заявка активному тренеру — 200");
            java.net.http.HttpResponse<String> rinv14 = postJson(portT2, "/api/social/invite",
                "{\"initData\":\"" + id14 + "\",\"action\":\"create\"}");
            check(rinv14.statusCode() == 200, "fix2b: код активного тренера — 200");
            String code14 = Json.str(Json.map(Json.parse(rinv14.body())), "code");
            check(postJson(portT2, "/api/social/card", "{\"initData\":\"" + id14 + "\",\"enabled\":false}").statusCode() == 200,
                "fix2b: тренер 714 выключился (hidden)");
            check(postJson(portT2, "/api/social/link",
                "{\"initData\":\"" + id14 + "\",\"action\":\"accept\",\"userId\":715}").statusCode() == 409,
                "fix2b: accept скрытым тренером — 409 (§5.4)");
            check(postJson(portT2, "/api/social/invite",
                "{\"initData\":\"" + id15 + "\",\"action\":\"use\",\"code\":\"" + code14 + "\"}").statusCode() == 409,
                "fix2b: use кода скрытого тренера — 409 (§5.4)");
            check(postJson(portT2, "/api/social/invite",
                "{\"initData\":\"" + id14 + "\",\"action\":\"create\"}").statusCode() == 403,
                "fix2b: раздача кода скрытым тренером — 403 (§5.4)");

            /* замечание 1: 18+ гейтист ВЕСЬ соцслой — search/me для несовершеннолетнего 403 */
            java.net.http.HttpResponse<String> rsearchM = postJson(portT2, "/api/social/search",
                "{\"initData\":\"" + idM + "\"}");
            check(rsearchM.statusCode() == 403 && "age".equals(Json.str(Json.map(Json.parse(rsearchM.body())), "reason")),
                "fix: search для 15-летнего — 403 reason age (решение 12.11 №12)");
            check(postJson(portT2, "/api/social/me", "{\"initData\":\"" + idM + "\"}").statusCode() == 403,
                "fix: me для несовершеннолетнего — 403");

            /* замечание 3: возраст self-declared — поле age работает без birth-данных */
            GymData a706 = new GymData();
            a706.nextId = 1;
            a706.profile = new ProfileData();
            a706.profile.sex = "м";
            a706.profile.age = 30;
            a706.profile.height = 180;
            a706.profile.weight = 82;
            stT2.save(706, a706);
            String id706 = tgInitData("contract-test-token", 706);
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id706 + "\",\"card\":{\"displayName\":\"Статический Возраст\"}}").statusCode() == 200,
                "fix: 18+ гейт пропускает self-declared age=30 без birth-данных");
            GymData a707 = new GymData();
            a707.nextId = 1;
            a707.profile = new ProfileData();
            a707.profile.sex = "ж";
            a707.profile.age = 17;
            a707.profile.height = 165;
            a707.profile.weight = 52;
            stT2.save(707, a707);
            String id707 = tgInitData("contract-test-token", 707);
            check(postJson(portT2, "/api/social/card",
                "{\"initData\":\"" + id707 + "\",\"card\":{\"displayName\":\"Семнадцать\"}}").statusCode() == 403,
                "fix: self-declared age=17 — 403 (оба пути ageOf зафиксированы)");

            /* замечание 5a: TTL заявки — границы 13.9 / 14 / 14.1 дня (§7.1) */
            long nowFix = System.currentTimeMillis();
            java.time.LocalDateTime baseFix = java.time.LocalDateTime.ofInstant(
                java.time.Instant.ofEpochMilli(nowFix), java.time.ZoneId.systemDefault());
            SocialRequest tr13 = new SocialRequest();
            tr13.createdAt = baseFix.minusSeconds((long) (13.9 * 86400)).toString();
            SocialRequest tr14 = new SocialRequest();
            tr14.createdAt = baseFix.minusDays(14).toString(); /* until == nowFix: граница включительно */
            SocialRequest tr141 = new SocialRequest();
            tr141.createdAt = baseFix.minusSeconds((long) (14.1 * 86400)).toString();
            check(!tr13.expired(nowFix), "fix: заявка 13.9 дня — жива (TTL 14 дней, §7.1)");
            check(!tr14.expired(nowFix), "fix: заявка ровно 14 дней — ещё жива (исчезает после)");
            check(tr141.expired(nowFix), "fix: заявка 14.1 дня — истекла");

            /* замечание 5b: кулдаун повторной отправки — граница ровно 30 дней */
            java.time.LocalDateTime rbase = java.time.LocalDateTime.now().withNano(0);
            TrainerCard cd701 = stT2.social().get().trainers.get(701L);
            cd701.status = TrainerCard.STATUS_REJECTED;
            cd701.statusNote = "граница";
            cd701.rejectedAt = rbase.minusDays(30).plusMinutes(5).toString();
            java.net.http.HttpResponse<String> rb1 = postJson(portN, "/api/social/card",
                "{\"initData\":\"" + idA + "\",\"submit\":true}");
            check(rb1.statusCode() == 403 && Json.lng(Json.map(Json.parse(rb1.body())).get("retryInDays")) == 1,
                "fix: кулдаун 30 дней − 5 минут → 403, retryInDays=1");
            cd701.rejectedAt = rbase.minusDays(30).minusMinutes(5).toString();
            check(postJson(portN, "/api/social/card", "{\"initData\":\"" + idA + "\",\"submit\":true}").statusCode() == 200,
                "fix: кулдаун 30 дней + 5 минут → submit проходит (граница включительно)");

            /* замечание 2: HTML в displayName экранируется в уведомлении владельцу */
            stT2.save(720, adultProfile(29));
            String idXss = tgInitData("contract-test-token", 720, "<b>XSS</b>");
            check(postJson(portN, "/api/social/card",
                "{\"initData\":\"" + idXss + "\",\"card\":{\"displayName\":\"<b>XSS</b>\"}}").statusCode() == 200,
                "fix: карточка с HTML в имени — 200");
            check(postJson(portN, "/api/social/card", "{\"initData\":\"" + idXss + "\",\"submit\":true}").statusCode() == 200,
                "fix: submit XSS-карточки — 200");
            check(spy.sent.size() == 3 && spy.sent.get(2).startsWith("9999:")
                    && spy.sent.get(2).contains("#720 · &lt;b&gt;XSS&lt;/b&gt;") && !spy.sent.get(2).contains("<b>XSS"),
                "fix: уведомление владельцу с экранированным именем (esc)");
        } catch (Exception t2Err) {
            throw new AssertionError("CONTRACT FAIL: t2 " + t2Err);
        }

        System.out.println("CONTRACT OK");
        System.exit(0);
    }

    /* [ONB-T2] initData, подписанный по правилам Telegram: checkString строится по
       декодированным значениям, отсортированным по ключу (так читает их WebServer.validateInitData);
       secret = HMAC-SHA256(token, "WebAppData"), hash = HMAC-SHA256(secret, checkString) */
    static String tgInitData(String token, long userId) throws Exception {
        return tgInitData(token, userId, "Test");
    }

    /* вариант с кастомным first_name ([UX-I16] ревью №3: имя сервер берёт из initData) */
    static String tgInitData(String token, long userId, String firstName) throws Exception {
        return tgInitDataUser(token, userId,
            "{\"id\":" + userId + ",\"first_name\":\"" + firstName + "\"}");
    }

    /* [TRN-T3] вариант с photo_url: аватар карточки сервер берёт ТОЛЬКО из подписанного initData */
    static String tgInitData(String token, long userId, String firstName, String photoUrl) throws Exception {
        return tgInitDataUser(token, userId,
            "{\"id\":" + userId + ",\"first_name\":\"" + firstName + "\",\"photo_url\":\"" + photoUrl + "\"}");
    }

    /* подпись initData по правилам Telegram по готовому user-json (см. WebServer.validateInitData) */
    private static String tgInitDataUser(String token, long userId, String userJson) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("WebAppData".getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] secret = mac.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
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

    /* [TRN-T2] взрослый профиль: birth-пара «сегодня минус age лет», месяц = текущий —
       ageOf() даёт ровно age (18+ гейт). Возраст self-declared: работает и через поле
       age без birth — оба пути покрыты в фикс-тестах ревью */
    static GymData adultProfile(int age) {
        GymData d = new GymData();
        d.nextId = 1;
        d.profile = new ProfileData();
        d.profile.sex = "м";
        d.profile.height = 180;
        d.profile.weight = 80;
        java.time.LocalDate b = java.time.LocalDate.now().minusYears(age);
        d.profile.birthYear = b.getYear();
        d.profile.birthMonth = java.time.LocalDate.now().getMonthValue();
        return d;
    }

    /* заглушка TelegramApi для проверки уведомлений WebServer ([TRN-T2]): «chatId:text» — в sent */
    static final class SpyApi extends TelegramApi {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        SpyApi() {
            super("contract-test-token");
        }
        @Override
        public void sendMessage(long chatId, String text, java.util.List<java.util.List<Map<String, Object>>> keyboard) {
            sent.add(chatId + ":" + text);
        }
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

    /* POST произвольного тела в произвольный api-путь (для /api/track [ANA-T5], в т.ч. негативных кейсов) */
    static java.net.http.HttpResponse<String> postJson(int port, String path, String payload) throws Exception {
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + port + path))
            .header("Content-Type", "application/json")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload, java.nio.charset.StandardCharsets.UTF_8))
            .build();
        return java.net.http.HttpClient.newHttpClient()
            .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    /* POST /api/track в тестовый WebServer [ANA-T5]: eventsJson — JSON-массив имён событий */
    static java.net.http.HttpResponse<String> postTrack(int port, String initData, String eventsJson) throws Exception {
        return postJson(port, "/api/track", "{\"initData\":\"" + initData + "\",\"events\":" + eventsJson + "}");
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

    /* GET «сырым» сокетом, статус ответа [EXR-T8]: HTTP-клиенты (java.net.http, браузеры,
       WHATWG-URL) схлопывают %2e%2e в «..» до отправки — traversal-гвард проверяем ровно
       на том пути, что реально придёт на сервер */
    static int rawStatus(int port, String pathAndQuery) throws Exception {
        return requestStatus("GET", port, pathAndQuery);
    }

    /* HEAD «сырым» сокетом, статус ответа [CNT-T1]: java.net.http с BodyHandlers на HEAD
       бросает исключение — читаем строку статуса вручную */
    static int headStatus(int port, String pathAndQuery) throws Exception {
        return requestStatus("HEAD", port, pathAndQuery);
    }

    static int requestStatus(String method, int port, String pathAndQuery) throws Exception {
        try (java.net.Socket s = new java.net.Socket("127.0.0.1", port)) {
            s.setSoTimeout(5000);
            java.io.OutputStream out = s.getOutputStream();
            out.write((method + " " + pathAndQuery + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            out.flush();
            java.io.BufferedReader in = new java.io.BufferedReader(
                new java.io.InputStreamReader(s.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
            String line = in.readLine();
            return Integer.parseInt(line.split(" ")[1]);
        }
    }

    /* bundled-шрифт для проверки переноса заголовка рекорда ([UX-B19]): тот же TTF,
       что грузит CardRender (classpath-ресурс; fallback файловая система для точечной
       компиляции) — метрики совпадают с продовым рендером */
    static java.awt.Font contractFontCa(String name) throws Exception {
        java.io.InputStream res = CardRender.class.getResourceAsStream("/gym/web/fonts/" + name);
        java.io.InputStream in = res != null ? res
            : java.nio.file.Files.newInputStream(java.nio.file.Path.of("src", "gym", "web", "fonts", name));
        try (in) {
            return java.awt.Font.createFont(java.awt.Font.TRUETYPE_FONT, in);
        }
    }
}
