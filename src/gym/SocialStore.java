package gym;

import java.util.List;

/* Хранилище соцслоя «Тренер» [TRN-T1] (спека [TRN-S1] docs/spec-trn-s1-trainer.md §4):
   единый файл data/social.json — в chat_<id>.json соцданные жить не могут (файл одного
   пользователя не содержит чужих данных, §4.1). Один экземпляр на процесс, владелец —
   Storage (storage.social()); состояние держится в памяти (§4.3 — при 6 пользователях
   этого достаточно), чтение — ленивое при первом доступе, запись — полная перезапись
   через Storage (бэкап ПЕРЕД перезаписью и ротация, как у чат-файлов).
   Право на забвение (152-ФЗ, §4.1/§13.3): deleteUser() вычищает все соцданные
   пользователя при /delete_my_data; social.json глобальный — tombstone не нужен.
   18+ для соцфункций решено владельцем 12.11 (№12) — замок в приложении/боте [TRN-T2],
   в схеме хранилища не требуется (возраст вычисляется из даты рождения GymData). */
public final class SocialStore {
    /* версия формата social.json; чтение более старых файлов — толерантное
       (опциональные поля), незнакомые ключи не валит */
    public static final int FORMAT_VER = 1;

    /* Гранты подопечного — ФИНАЛ владельца 23.11 (спека, блок «Решения 23.11»): ровно 4.
       «Прогресс» ВКЛ по умолчанию при связке (решение 12.11 №4). Поле «Здоровье»
       (health) ОТЛОЖЕНО: когда понадобится, добавляется новым ключом карты grants
       без ломки формата — чтение сохраняет незнакомые ключи (см. SocialLink). */
    public static final String GRANT_PROGRESS = "progress"; /* активность: тренировки/объём/рекорд */
    public static final String GRANT_GOALS = "goals";       /* цели [GOA-I1] */
    public static final String GRANT_BODY = "bodyMetrics";  /* вес и рост профиля */
    public static final String GRANT_KCAL = "kcal";         /* расход ккал от тренировок */
    public static final List<String> GRANT_KEYS =
        List.of(GRANT_PROGRESS, GRANT_GOALS, GRANT_BODY, GRANT_KCAL);

    private final Storage storage;
    private SocialData data;
    private boolean loaded;

    SocialStore(Storage storage) {
        this.storage = storage;
    }

    /* текущее состояние соцслоя (ленивая загрузка; отсутствующий/старый/битый файл → пустое) */
    public synchronized SocialData get() {
        if (!loaded) {
            String json = storage.loadSocialJson();
            try {
                data = json == null || json.isBlank()
                    ? new SocialData()
                    : SocialData.fromJson(Json.map(Json.parse(json)));
            } catch (Exception e) {
                /* битый файл не валит бот/сервер: начинаем с пустого;
                   прежнее содержимое уйдёт в бэкап при первой перезаписи */
                System.out.println("[warn] social load: " + e.getMessage());
                data = new SocialData();
            }
            loaded = true;
        }
        return data;
    }

    /* полная перезапись social.json (Storage делает бэкап прежнего содержимого) */
    public synchronized void save() {
        storage.saveSocialJson(Json.write(get().toJson()));
    }

    /* [TRN-T1] право на забвение (§4.1): /delete_my_data удаляет ВСЕ соцданные
       пользователя — карточку тренера, заявки (его и к нему), связки с его участием
       (гранты умирают вместе со связкой, §8.2), коды приглашений, жалобы;
       у контрагентов связка исчезает без следов. */
    public synchronized void deleteUser(long userId) {
        SocialData d = get();
        d.trainers.remove(userId);
        d.links.removeIf(l -> l.trainer == userId || l.student == userId);
        d.requests.removeIf(r -> r.trainer == userId || r.student == userId);
        d.invites.removeIf(i -> i.trainer == userId);
        d.reports.removeIf(r -> r.by == userId || r.about == userId);
        save();
    }
}
