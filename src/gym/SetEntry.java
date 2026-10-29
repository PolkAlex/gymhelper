package gym;

public final class SetEntry {
    public final String weight;
    public final int sets;
    public final String reps;
    public final String t;

    public SetEntry(String weight, int sets, String reps) {
        this(weight, sets, reps, null);
    }

    public SetEntry(String weight, int sets, String reps, String t) {
        this.weight = weight;
        this.sets = sets;
        this.reps = reps;
        this.t = t;
    }
}
