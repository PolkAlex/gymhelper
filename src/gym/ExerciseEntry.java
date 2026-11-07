package gym;

import java.util.ArrayList;
import java.util.List;

public final class ExerciseEntry {
    public String name;
    public String startedAt;
    public String endedAt;
    public final List<SetEntry> sets = new ArrayList<>();
    /* [UX-E5] план-подсказка из шаблона/повтора; ps == 0 → плана нет (старые данные) */
    public String planW = "";
    public int planS = 0;
    public String planR = "";

    public ExerciseEntry(String name) {
        this.name = name;
    }
}
