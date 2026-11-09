package gym;

import java.util.ArrayList;
import java.util.List;

public final class UserState {
    public enum Mode { MENU, WORKOUT, EX_WEIGHT, EX_SETS, EX_REPS, EDIT_EX, EDIT_ENTRY, EDIT_FIELD, RENAME, TITLE, NUTR, TIME, PROFILE, PROFILE_MONTH, TPL_NAME }

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
    /* старт из шаблона при активной тренировке: применится после «Удалить и начать новую» [UX-T7 §4.6] */
    public long pendingTplId;
    /* «Повторить прошлую» при активной тренировке: id завершённой, ждущей применения */
    public long pendingRepWid;
    /* [UX-E5] план-подсказка текущего упражнения (снимок из шаблона/повтора); null — плана нет */
    public TemplateExercise sugPlan;
    /* [UX-T29] год-режим профиля: значения строки «пол X рост вес» до выбора месяца (bm:1..12);
       storage.save только после выбора месяца, «🏠 Меню» отменяет */
    public String pBirthSex = "";
    public int pBirthYear;
    public int pBirthHeight;
    public double pBirthWeight;
}
