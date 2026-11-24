package gym;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;

/* Заявка в подопечные [TRN-T1] (спека [TRN-S1] §7.1): подопечный → тренеру.
   Дубль активной заявки на пару запрещён; заявка «висит» 14 дней, затем сама
   исчезает (§7.1) — истёкшие гасятся при мутациях/чтении (purgeExpiredRequests). */
public final class SocialRequest {
    public static final long TTL_MS = 14L * 24 * 60 * 60 * 1000;
    public static final int MAX_COMMENT = 200; /* комментарий заявки (§6.3) */

    public long trainer;    /* Telegram user id тренера (кому заявка) */
    public long student;    /* Telegram user id подопечного (от кого) */
    public String comment = "";
    public String createdAt = ""; /* ISO-дата-время */

    /* истекла ли заявка на момент nowMs (epoch); неразборчивая дата считается истекшей.
       createdAt — локальное серверное время (как LocalDateTime.now()) → зона системная */
    public boolean expired(long nowMs) {
        try {
            long until = LocalDateTime.parse(createdAt).plus(Duration.ofMillis(TTL_MS))
                .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
            return until < nowMs;
        } catch (DateTimeParseException e) {
            return true;
        }
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("trainer", trainer);
        m.put("student", student);
        m.put("comment", comment);
        m.put("createdAt", createdAt);
        return m;
    }

    public static SocialRequest fromJson(Map<String, Object> m) {
        SocialRequest r = new SocialRequest();
        r.trainer = Json.lng(m.get("trainer"));
        r.student = Json.lng(m.get("student"));
        r.comment = Json.str(m, "comment") == null ? "" : Json.str(m, "comment");
        r.createdAt = Json.str(m, "createdAt") == null ? "" : Json.str(m, "createdAt");
        return r;
    }
}
