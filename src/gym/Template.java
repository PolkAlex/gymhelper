package gym;

import java.util.ArrayList;
import java.util.List;

/* Шаблон тренировки [UX-T6/T7]: снимок списка упражнений на момент сохранения
   (docs/spec-sprint1-features.md §0.2). Лимит — 20 на пользователя. */
public final class Template {
    public long id;
    public String name;
    public String createdAt;
    public final List<TemplateExercise> exercises = new ArrayList<>();
}
