package gym;

/* Карточка тренера [TRN-T1] (спека [TRN-S1] §5.2): публичный профиль режима «Я тренер».
   Живёт в data/social.json (§4.1); ключ карты trainers — Telegram user id.
   Поля формы — клиентские (приходят в /api/social/card, сервер обрезает по лимитам);
   статус верификации и заметка модератора — server-owned: клиент их не выставляет
   (ручная проверка владельцем — [TRN-T2]). Публикация в поиске — только verified (§6.2). */
public final class TrainerCard {
    /* статусы карточки (§5.3); hidden — режим «Я тренер» выключен (§5.4): из поиска
       исчезает (search берёт только verified), связи сохраняются, заявки невозможны */
    public static final String STATUS_DRAFT = "draft";
    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_VERIFIED = "verified";
    public static final String STATUS_REJECTED = "rejected";
    public static final String STATUS_HIDDEN = "hidden";

    /* [TRN-T2] повторная отправка карточки после отказа — через 30 дней
       (решение владельца 23.11; момент отказа — rejectedAt) */
    public static final int RESUBMIT_COOLDOWN_DAYS = 30;
    /* заметка модератора (причина отказа §14.5) — до 200 символов */
    public static final int MAX_NOTE = 200;

    /* лимиты формы §5.2 — серверная сторона валидации (обрезка хвоста, как initUserName) */
    public static final int MAX_NAME = 40;
    public static final int MAX_BIO = 300;
    public static final int MAX_CITY = 40;
    public static final int MAX_GYMS = 80;
    public static final int MAX_LIST_ITEMS = 5;   /* достижения и образование: до 5 × 80 */
    public static final int MAX_ITEM_LEN = 80;
    public static final int MAX_SCHEDULE_ITEMS = 3; /* расписание: до 3 × 60, текстом */
    public static final int MAX_SCHEDULE_LEN = 60;
    public static final int MAX_SPECS = 3;        /* специализаций не больше 3 */
    public static final int MAX_YEARS = 60;       /* стаж, лет: 0–60 */

    /* фиксированный набор специализаций §5.2 (id стабильные, названия — UI) */
    public static final java.util.Set<String> SPEC_IDS =
        java.util.Set.of("rehab", "loss", "mass", "comp", "power", "begin", "mobility", "group");
    /* лимит подопечных: чипы 3/5/10/20, по умолчанию 5 (§5.2) */
    public static final java.util.Set<Integer> CAPS = java.util.Set.of(3, 5, 10, 20);
    public static final int DEFAULT_CAP = 5;

    public String displayName = "";
    public String bio = "";
    public final java.util.List<String> specs = new java.util.ArrayList<>();
    public String city = "";
    public String gyms = "";
    public int years;
    public final java.util.List<String> achievements = new java.util.ArrayList<>();
    public final java.util.List<String> education = new java.util.ArrayList<>();
    public final java.util.List<String> schedule = new java.util.ArrayList<>();
    public int cap = DEFAULT_CAP;
    public boolean useTgAvatar = true; /* «Показывать мой аватар Telegram» — по умолчанию ВКЛ (§5.2) */
    /* server-owned поля: клиентом не выставляются */
    public String status = STATUS_DRAFT;
    public String statusNote = "";
    public String updatedAt = "";      /* ISO-дата-время последней правки содержимого */
    public String verifiedAt = "";     /* момент подтверждения (/trainer_ok); пусто — не подтверждена */
    public String rejectedAt = "";     /* [TRN-T2] момент отказа (/trainer_no) — старт 30-дневного кулдауна */
    public String photoUrl = "";       /* [TRN-T3] аватар Telegram: photo_url из подписанного initData (server-owned) */
    /* [TRN-T4, решение №5] Telegram-username тренера (без @, lowercase) — СНИМОК из
       подписанного initData при каждом сохранении карточки, симметрично photoUrl:
       пустой/скрытый username initData прежнее значение НЕ затирает. Служебное поле:
       в публичную проекцию (search) НЕ попадает, отдаётся только связанному
       подопечному — контакт раскрывается после связки (§13.1) */
    public String tgUsername = "";

    /* полная проекция — для /api/social/me (свою карточку владелец видит целиком) */
    public java.util.Map<String, Object> toMap() {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("displayName", displayName);
        m.put("bio", bio);
        m.put("specs", new java.util.ArrayList<>(specs));
        m.put("city", city);
        m.put("gyms", gyms);
        m.put("years", years);
        m.put("achievements", new java.util.ArrayList<>(achievements));
        m.put("education", new java.util.ArrayList<>(education));
        m.put("schedule", new java.util.ArrayList<>(schedule));
        m.put("cap", cap);
        m.put("useTgAvatar", useTgAvatar);
        m.put("status", status);
        m.put("statusNote", statusNote);
        if (!verifiedAt.isEmpty()) m.put("verifiedAt", verifiedAt);
        if (!rejectedAt.isEmpty()) m.put("rejectedAt", rejectedAt);
        if (!photoUrl.isEmpty()) m.put("photoUrl", photoUrl);
        if (!tgUsername.isEmpty()) m.put("tgUsername", tgUsername);
        m.put("updatedAt", updatedAt);
        return m;
    }

    /* публичная проекция (§13.1): только поля формы — статус модерации, лимит подопечных
       и служебные даты не раскрываются; в поиске попадает только verified (делает caller) */
    public java.util.Map<String, Object> publicMap() {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("displayName", displayName);
        m.put("bio", bio);
        m.put("specs", new java.util.ArrayList<>(specs));
        m.put("city", city);
        m.put("gyms", gyms);
        m.put("years", years);
        m.put("achievements", new java.util.ArrayList<>(achievements));
        m.put("education", new java.util.ArrayList<>(education));
        m.put("schedule", new java.util.ArrayList<>(schedule));
        /* [TRN-T3] аватар Telegram: ссылка отдаётся только при включённом тогле —
           иначе в карточке инициалы, ссылка не раскрывается (§5.2) */
        if (useTgAvatar && !photoUrl.isEmpty()) m.put("photoUrl", photoUrl);
        m.put("useTgAvatar", useTgAvatar);
        return m;
    }

    /* [TRN-T2 фикс ревью] полная копия карточки: путь «только статус» (submit/enabled
       без card) обязан сохранять контент — иначе enabled=false затирал бы содержимое */
    public static TrainerCard copyOf(TrainerCard p) {
        TrainerCard c = new TrainerCard();
        if (p == null) return c;
        c.displayName = p.displayName;
        c.bio = p.bio;
        c.specs.addAll(p.specs);
        c.city = p.city;
        c.gyms = p.gyms;
        c.years = p.years;
        c.achievements.addAll(p.achievements);
        c.education.addAll(p.education);
        c.schedule.addAll(p.schedule);
        c.cap = p.cap;
        c.useTgAvatar = p.useTgAvatar;
        c.status = p.status;
        c.statusNote = p.statusNote;
        c.updatedAt = p.updatedAt;
        c.verifiedAt = p.verifiedAt;
        c.rejectedAt = p.rejectedAt;
        c.photoUrl = p.photoUrl;
        c.tgUsername = p.tgUsername;
        return c;
    }

    public static TrainerCard fromJson(java.util.Map<String, Object> m) {
        TrainerCard c = new TrainerCard();
        c.displayName = orEmpty(Json.str(m, "displayName"));
        c.bio = orEmpty(Json.str(m, "bio"));
        fillList(c.specs, Json.list(m.get("specs")));
        c.city = orEmpty(Json.str(m, "city"));
        c.gyms = orEmpty(Json.str(m, "gyms"));
        c.years = (int) Json.lng(m.get("years"));
        fillList(c.achievements, Json.list(m.get("achievements")));
        fillList(c.education, Json.list(m.get("education")));
        fillList(c.schedule, Json.list(m.get("schedule")));
        int cap = (int) Json.lng(m.get("cap"));
        c.cap = CAPS.contains(cap) ? cap : DEFAULT_CAP;
        Object av = m.get("useTgAvatar");
        if (av instanceof Boolean b) c.useTgAvatar = b;
        c.status = orEmpty(Json.str(m, "status"));
        if (c.status.isEmpty()) c.status = STATUS_DRAFT;
        c.statusNote = orEmpty(Json.str(m, "statusNote"));
        c.updatedAt = orEmpty(Json.str(m, "updatedAt"));
        c.verifiedAt = orEmpty(Json.str(m, "verifiedAt"));
        c.rejectedAt = orEmpty(Json.str(m, "rejectedAt"));
        c.photoUrl = orEmpty(Json.str(m, "photoUrl"));
        c.tgUsername = orEmpty(Json.str(m, "tgUsername"));
        return c;
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static void fillList(java.util.List<String> dst, java.util.List<Object> src) {
        if (src == null) return;
        for (Object o : src) {
            if (o instanceof String s) dst.add(s);
        }
    }
}
