package gym;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/* Содержимое data/social.json [TRN-T1] (спека [TRN-S1] §4.1): карточки тренеров,
   связки, заявки, коды приглашений, жалобы. Ключ карты trainers — Telegram user id
   (не chat_id, §4.1). Заметка «Здоровье» (healthNotes черновика спеки) отложена
   решением владельца 23.11 и не реализована; когда появится — новый ключ карты
   читается толерантно (опциональные поля), формат не ломается. */
public final class SocialData {
    public int ver = SocialStore.FORMAT_VER;
    public final Map<Long, TrainerCard> trainers = new LinkedHashMap<>();
    public final List<SocialLink> links = new ArrayList<>();
    public final List<SocialRequest> requests = new ArrayList<>();
    public final List<SocialInvite> invites = new ArrayList<>();
    public final List<SocialReport> reports = new ArrayList<>();
    /* [TRN-T5] журнал согласий §13.2: факты изменения грантов (кто/когда/что) — опциональное
       поле (не пишется, когда пуст; старые файлы без ключа читаются, формат не ломается).
       Кап — последние SocialStore.GRANT_LOG_CAP записей НА пользователя (trimGrantLog) */
    public final List<GrantLogEntry> grantLog = new ArrayList<>();

    /* запись журнала согласий §13.2: только РЕАЛЬНЫЕ изменения (no-op не пишет) */
    public static final class GrantLogEntry {
        public long by;                 /* Telegram user id подопечного (чей грант) */
        public long trainer;            /* Telegram user id тренера (кому видимость) */
        public String at = "";          /* ISO-дата-время */
        /* включённое/выключенное: ключ гранта → новое значение (только изменившиеся) */
        public final Map<String, Boolean> changes = new LinkedHashMap<>();

        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("by", by);
            m.put("trainer", trainer);
            m.put("at", at);
            m.put("changes", new LinkedHashMap<>(changes));
            return m;
        }

        public static GrantLogEntry fromJson(Map<String, Object> m) {
            GrantLogEntry e = new GrantLogEntry();
            e.by = Json.lng(m.get("by"));
            e.trainer = Json.lng(m.get("trainer"));
            e.at = Json.str(m, "at") == null ? "" : Json.str(m, "at");
            Map<String, Object> cm = Json.map(m.get("changes"));
            if (cm != null) {
                for (Map.Entry<String, Object> c : cm.entrySet()) {
                    if (c.getValue() instanceof Boolean b) e.changes.put(c.getKey(), b);
                }
            }
            return e;
        }
    }

    public static SocialData fromJson(Map<String, Object> m) {
        SocialData d = new SocialData();
        int v = (int) Json.lng(m.get("ver"));
        if (v >= 1) d.ver = v;
        Map<String, Object> tr = Json.map(m.get("trainers"));
        if (tr != null) {
            for (Map.Entry<String, Object> e : tr.entrySet()) {
                long uid;
                try {
                    uid = Long.parseLong(e.getKey());
                } catch (NumberFormatException ex) {
                    continue; /* мусорный ключ карты не валит чтение файла */
                }
                Map<String, Object> cm = Json.map(e.getValue());
                if (cm == null) continue;
                d.trainers.put(uid, TrainerCard.fromJson(cm));
            }
        }
        for (Object o : list(m.get("links"))) {
            if (o instanceof Map) d.links.add(SocialLink.fromJson(Json.map(o)));
        }
        for (Object o : list(m.get("requests"))) {
            if (o instanceof Map) d.requests.add(SocialRequest.fromJson(Json.map(o)));
        }
        for (Object o : list(m.get("invites"))) {
            if (o instanceof Map) d.invites.add(SocialInvite.fromJson(Json.map(o)));
        }
        for (Object o : list(m.get("reports"))) {
            if (o instanceof Map) d.reports.add(SocialReport.fromJson(Json.map(o)));
        }
        for (Object o : list(m.get("grantLog"))) {
            if (o instanceof Map) d.grantLog.add(GrantLogEntry.fromJson(Json.map(o)));
        }
        return d;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ver", ver);
        Map<String, Object> tr = new LinkedHashMap<>();
        for (Map.Entry<Long, TrainerCard> e : trainers.entrySet()) {
            tr.put(String.valueOf(e.getKey()), e.getValue().toMap());
        }
        m.put("trainers", tr);
        List<Object> ls = new ArrayList<>();
        for (SocialLink l : links) ls.add(l.toJson());
        m.put("links", ls);
        List<Object> rs = new ArrayList<>();
        for (SocialRequest r : requests) rs.add(r.toJson());
        m.put("requests", rs);
        List<Object> is = new ArrayList<>();
        for (SocialInvite i : invites) is.add(i.toJson());
        m.put("invites", is);
        List<Object> ps = new ArrayList<>();
        for (SocialReport r : reports) ps.add(r.toJson());
        m.put("reports", ps);
        if (!grantLog.isEmpty()) {
            List<Object> gl = new ArrayList<>();
            for (GrantLogEntry e : grantLog) gl.add(e.toJson());
            m.put("grantLog", gl);
        }
        return m;
    }

    /* есть ли у пользователя связка в роли подопечного (§7.4 MVP: один активный тренер) */
    public boolean hasTrainer(long userId) {
        for (SocialLink l : links) {
            if (l.student == userId) return true;
        }
        return false;
    }

    /* активная (не истёкшая) заявка пары тренер→подопечный; null — нет */
    public SocialRequest activeRequest(long trainer, long student, long nowMs) {
        for (SocialRequest r : requests) {
            if (r.trainer == trainer && r.student == student && !r.expired(nowMs)) return r;
        }
        return null;
    }

    /* связка пары (роли в любом порядке — одна на пару: у подопечного один тренер, §7.4) */
    public SocialLink linkBetween(long a, long b) {
        for (SocialLink l : links) {
            if ((l.trainer == a && l.student == b) || (l.trainer == b && l.student == a)) return l;
        }
        return null;
    }

    /* сколько подопечных у тренера — проверка лимита карточки (§6.4 «Набор закрыт») */
    public int studentCount(long trainer) {
        int n = 0;
        for (SocialLink l : links) {
            if (l.trainer == trainer) n++;
        }
        return n;
    }

    /* имя тренера для текстов бота/пушей: из карточки; той нет — безличное */
    public static String trainerNameOf(SocialData d, long trainerId) {
        TrainerCard c = d.trainers.get(trainerId);
        return c == null || c.displayName.isEmpty() ? "Тренер" : c.displayName;
    }

    /* активный код приглашения тренера; null — кода нет */
    public SocialInvite inviteOf(long trainer) {
        for (SocialInvite i : invites) {
            if (i.trainer == trainer) return i;
        }
        return null;
    }

    /* код по строке (применение подопечным); null — не найден */
    public SocialInvite inviteByCode(String code) {
        for (SocialInvite i : invites) {
            if (i.code.equals(code)) return i;
        }
        return null;
    }

    /* гашение истёкших заявок (§7.1: 14 дней — тихо, без уведомлений) — перед мутациями */
    public void purgeExpiredRequests(long nowMs) {
        requests.removeIf(r -> r.expired(nowMs));
    }

    /* [TRN-T5] журнал согласий §13.2: добавляет запись и подрезает по капу
       (последние GRANT_LOG_CAP записей на пользователя) */
    public void addGrantLog(GrantLogEntry e) {
        grantLog.add(e);
        trimGrantLog(e.by);
    }

    /* держим не более SocialStore.GRANT_LOG_CAP записей пользователя by — старейшие удаляются */
    public void trimGrantLog(long by) {
        int mine = 0;
        for (GrantLogEntry e : grantLog) {
            if (e.by == by) mine++;
        }
        if (mine <= SocialStore.GRANT_LOG_CAP) return;
        int extra = mine - SocialStore.GRANT_LOG_CAP;
        for (GrantLogEntry e : grantLog) {
            if (extra <= 0) break;
            if (e.by == by) {
                grantLog.remove(e);
                extra--;
            }
        }
    }

    private static List<Object> list(Object v) {
        List<Object> l = Json.list(v);
        return l == null ? List.of() : l;
    }
}
