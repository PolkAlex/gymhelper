package gym;

import java.util.ArrayList;
import java.util.List;

public final class ExerciseEntry {
    public String name;
    public String startedAt;
    public String endedAt;
    public final List<SetEntry> sets = new ArrayList<>();

    public ExerciseEntry(String name) {
        this.name = name;
    }
}
