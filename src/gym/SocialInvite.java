package gym;

import java.util.LinkedHashMap;
import java.util.Map;

/* Код приглашения тренера [TRN-T1] (спека [TRN-S1] §7.2): 6 символов, одноразовый.
   Код = выраженное тренером согласие заранее — связка создаётся сразу, без стадии
   заявки. «Новый код» гасит прежний (у тренера один активный код). */
public final class SocialInvite {
    public static final int CODE_LEN = 6;

    public long trainer; /* Telegram user id тренера — владельца кода */
    public String code = "";

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("trainer", trainer);
        m.put("code", code);
        return m;
    }

    public static SocialInvite fromJson(Map<String, Object> m) {
        SocialInvite i = new SocialInvite();
        i.trainer = Json.lng(m.get("trainer"));
        i.code = Json.str(m, "code") == null ? "" : Json.str(m, "code");
        return i;
    }
}
