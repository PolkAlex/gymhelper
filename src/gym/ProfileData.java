package gym;

public final class ProfileData {
    public String sex = "м";
    public int age;
    public int height;
    public double weight;
    /* [UX-T29] дата рождения: год (0 = не указан) и месяц 1–12 (0 = не указан).
       Правило «оба-или-ничего» — ключи в JSON пишутся/читаются только парой */
    public int birthYear;
    public int birthMonth;

    /* [UX-T29] единый источник возраста (веб и бот): валидная дата → вычисленный
       (возраст наступает 1-го числа месяца рождения, день не хранится);
       даты нет → прежнее статическое age. age-зеркало нужно только старым читателям */
    public int ageOf() {
        if (birthYear > 0 && birthMonth >= 1 && birthMonth <= 12) {
            java.time.LocalDate today = java.time.LocalDate.now();
            return today.getYear() - birthYear - (today.getMonthValue() < birthMonth ? 1 : 0);
        }
        return age;
    }
}
