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
    public final List<ExerciseEntry> exercises = new ArrayList<>();
}
