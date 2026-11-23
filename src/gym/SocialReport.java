package gym;

import java.util.LinkedHashMap;
import java.util.Map;

/* Жалоба на участника соцслоя [TRN-T1] (спека [TRN-S1] §13.4): кнопка «Пожаловаться»
   дублируется владельцу через существующий feedback-канал (deep-link на клиенте),
   здесь — только запись в social.json. Разбор жалоб — админ-команды [TRN-T2]. */
public final class SocialReport {
    public static final int MAX_TEXT = 500;

    public long by;    /* Telegram user id автора жалобы */
    public long about; /* Telegram user id, на которого жалуются */
    public String at = "";
    public String text = "";

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("by", by);
        m.put("about", about);
        m.put("at", at);
        m.put("text", text);
        return m;
    }

    public static SocialReport fromJson(Map<String, Object> m) {
        SocialReport r = new SocialReport();
        r.by = Json.lng(m.get("by"));
        r.about = Json.lng(m.get("about"));
        r.at = Json.str(m, "at") == null ? "" : Json.str(m, "at");
        r.text = Json.str(m, "text") == null ? "" : Json.str(m, "text");
        return r;
    }
}
