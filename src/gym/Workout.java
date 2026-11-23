package gym;

import java.util.ArrayList;
import java.util.List;

public final class Workout {
    public long id;
    public String date;
    public String startedAt;
    public String endedAt;
    public boolean finished;
    public String title;
    public String nutrition;
    /* [UX-S17] свободная заметка к тренировке (Mini App); null = заметки нет — ключ «note»
       в JSON пишется только когда непустая (файлы без заметок байт-в-байт прежние) */
    public String note;
    /* [UX-I16] id публичной ссылки /w/<shareId>; null у старых тренировок (создаётся лениво,
       при первом шеринга в Mini App) — ключ «shareId» в JSON пишется только когда задан */
    public String shareId;
    public final List<ExerciseEntry> exercises = new ArrayList<>();
}
