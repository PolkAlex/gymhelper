package gym;

/* Карточка тренера [TRN-T1] (спека [TRN-S1] §5.2): публичный профиль режима «Я тренер».
   Живёт в data/social.json (§4.1); ключ карты trainers — Telegram user id.
   Поля формы — клиентские (приходят в /api/social/card, сервер обрезает по лимитам);
   статус верификации и заметка модератора — server-owned: клиент их не выставляет
   (ручная проверка владельцем — [TRN-T2]). Публикация в поиске — только verified (§6.2). */
public final class TrainerCard {
    /* статусы карточки (§5.3) */
    public static final String STATUS_DRAFT = "draft";
    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_VERIFIED = "verified";
    public static final String STATUS_REJECTED = "rejected";

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
    public String verifiedAt = "";     /* момент подтверждения (/trainer_ok [TRN-T2]); пусто — не подтверждена */

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
        m.put("useTgAvatar", useTgAvatar);
        return m;
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
