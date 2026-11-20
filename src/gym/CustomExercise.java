package gym;

import java.util.ArrayList;
import java.util.List;

/* [EXR-T13] «Своё» упражнение: имя (уникальный ключ, до 60 символов) + теги групп
   мышц m:* (мультивыбор при создании, может быть пустым — спека EXR-E3 §5). */
public final class CustomExercise {
    public String n;
    public final List<String> tags = new ArrayList<>();
}
