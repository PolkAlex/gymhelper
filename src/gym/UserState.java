package gym;

import java.util.ArrayList;
import java.util.List;

public final class UserState {
    public enum Mode { MENU, WORKOUT, EX_WEIGHT, EX_SETS, EX_REPS, EDIT_EX, EDIT_ENTRY, EDIT_FIELD, RENAME, TITLE, NUTR, TIME, PROFILE }

    public Mode mode = Mode.MENU;
    public String currentExercise;
    public int histPage;
    public List<String> sugWeights = new ArrayList<>();
    public String sugPop;
    public List<String> sugReps = new ArrayList<>();
    public String pendingWeight = "";
    public int pendingSets;
    public boolean editing;
    public String editName;
    public int editIdx;
    public long editWorkoutId;
}
