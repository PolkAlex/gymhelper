package gym;

import java.util.LinkedHashMap;
import java.util.Map;

/* [UX-S19] отметка книги учёта уведомлений (спека §12.1): d — ISO-дата отправки,
   t — тип {unf, cb, goal, dg, first}. Книгу пишет ТОЛЬКО сервер (часовой тик):
   значения из payload /api/save не принимаются никогда (§12.3) — иначе стэил-вкладка
   вернула бы старый stage и тик отправил бы дубль. Класс уровня Goal: маленькая
   запись с toJson; чтение — в GymData.fromJson (валидация + трим до 7). */
public final class NotifyMark {
    public String d;
    public String t;

    public NotifyMark() { }

    public NotifyMark(String d, String t) {
        this.d = d;
        this.t = t;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("d", d);
        m.put("t", t);
        return m;
    }
}
