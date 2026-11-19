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
    /* [UX-I16] id публичной ссылки /w/<shareId>; null у старых тренировок (создаётся лениво,
       при первом шеринга в Mini App) — ключ «shareId» в JSON пишется только когда задан */
    public String shareId;
    public final List<ExerciseEntry> exercises = new ArrayList<>();
}
