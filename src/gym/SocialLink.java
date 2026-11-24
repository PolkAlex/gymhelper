package gym;

import java.util.LinkedHashMap;
import java.util.Map;

/* Связка «тренер ↔ подопечный» [TRN-T1] (спека [TRN-S1] §7). Гранты — согласие
   подопечного (§8): ФИНАЛ владельца 23.11 — ровно 4, «Прогресс» ВКЛ по умолчанию
   при связке (решение 12.11 №4). Поле «Здоровье» (health) отложено: чтение толерантно
   к незнакомым ключам карты grants и сохраняет их при перезаписи — будущий грант
   добавится без ломки формата. Гранты живут в связке и умирают с ней (§8.2). */
public final class SocialLink {
    public static final String SOURCE_APPLY = "apply";   /* через заявку (§7.1) */
    public static final String SOURCE_INVITE = "invite"; /* через код приглашения (§7.2) */

    public long trainer;      /* Telegram user id тренера */
    public long student;      /* Telegram user id подопечного */
    public String since = ""; /* ISO-дата установления связки */
    /* ключ гранта → вкл/выкл; известные ключи — SocialStore.GRANT_KEYS (4, финал 23.11) */
    public final Map<String, Boolean> grants = new LinkedHashMap<>();
    public String source = SOURCE_APPLY;
    /* [TRN-T4] имя подопечного (снимок из подписанного initData при связке) — для списка
       «Мои подопечные» у тренера; у подопечного нет карточки в trainers, имя неоткуда взять */
    public String studentName = "";

    /* гранты новой связки: «Прогресс» ВКЛ, остальные OFF — «ноль данных не согласилось,
       кроме сути связки» (решение владельца 12.11 №4, подтверждено 23.11) */
    public static Map<String, Boolean> defaultGrants() {
        Map<String, Boolean> g = new LinkedHashMap<>();
        g.put(SocialStore.GRANT_PROGRESS, true);
        g.put(SocialStore.GRANT_GOALS, false);
        g.put(SocialStore.GRANT_BODY, false);
        g.put(SocialStore.GRANT_KCAL, false);
        return g;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("trainer", trainer);
        m.put("student", student);
        m.put("since", since);
        Map<String, Object> g = new LinkedHashMap<>();
        /* известные 4 — в фиксированном порядке (отсутствующий progress читается как
           дефолт связки ВКЛ); незнакомые ключи (будущие гранты) — в конце карты */
        for (String k : SocialStore.GRANT_KEYS) {
            Boolean v = grants.get(k);
            g.put(k, v != null ? v : Boolean.valueOf(SocialStore.GRANT_PROGRESS.equals(k)));
        }
        for (Map.Entry<String, Boolean> e : grants.entrySet()) {
            if (!SocialStore.GRANT_KEYS.contains(e.getKey())) g.put(e.getKey(), e.getValue());
        }
        m.put("grants", g);
        m.put("source", source);
        if (!studentName.isEmpty()) m.put("studentName", studentName);
        return m;
    }

    public static SocialLink fromJson(Map<String, Object> m) {
        SocialLink l = new SocialLink();
        l.trainer = Json.lng(m.get("trainer"));
        l.student = Json.lng(m.get("student"));
        l.since = Json.str(m, "since") == null ? "" : Json.str(m, "since");
        /* дефолт связки, поверх — значения из файла (в т.ч. незнакомые ключи) */
        l.grants.putAll(defaultGrants());
        Map<String, Object> gm = Json.map(m.get("grants"));
        if (gm != null) {
            for (Map.Entry<String, Object> e : gm.entrySet()) {
                if (e.getValue() instanceof Boolean b) l.grants.put(e.getKey(), b);
            }
        }
        String src = Json.str(m, "source");
        l.source = SOURCE_INVITE.equals(src) ? SOURCE_INVITE : SOURCE_APPLY;
        l.studentName = Json.str(m, "studentName") == null ? "" : Json.str(m, "studentName");
        return l;
    }
}
