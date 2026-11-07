package gym;

/* Упражнение шаблона: имя + план-подсказка w/s/r (последний блок на момент сохранения).
   План используется только в превью, записи при старте из шаблона стартуют пустыми. */
public final class TemplateExercise {
    public String name;
    public String w = "";
    public int s = 1;
    public String r = "";
}
