package gym.web;

import gym.ExerciseEntry;
import gym.GymData;
import gym.Records;
import gym.SetEntry;
import gym.Workout;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;

/**
 * [UX-S16] серверный рендер PNG-постера тренировки 1080×1920 (Amber Glass).
 * Визуал — одобренный владельцем POC [UX-T44] (координаты/палитра 1:1,
 * docs/spec-ux-s16-card-v2.md §4); адаптации под реальные данные — §10 спеки.
 * Headless Java 2D, шрифты — только bundled DejaVu (classpath-ресурс
 * gym/web/fonts/; fallback файловая система src/gym/web/fonts/ для точечной
 * компиляции), системные шрифты ОС не используются (урок POC: Docker).
 * Формулы чисел — SharePage/Records (§8 спеки: паритет с приложением и /w/<id>).
 * Имя пользователя на постере не показывается (решение владельца 21.11).
 */
public final class CardRender {
    private static final int W = 1080;
    private static final int H = 1920;
    private static final int MARGIN = 72;
    private static final int CARD_W = 936; /* W - MARGIN*2 */
    private static final int STAT_CARD_W = 454;
    private static final int STAT_CARD_H = 170;
    private static final int STAT_GAP = 28;
    private static final int EX_CARD_H = 130;
    private static final int EX_GAP = 24;
    private static final int REC_Y = 770;
    private static final int REC_H = 230;
    /* строки списка: с рекордом — 1150 (лимит 4), без — 830 (лимит 6) (§4.1) */
    private static final int ROWS_Y_REC = 1150;
    private static final int ROWS_Y_PLAIN = 830;
    private static final int ROWS_LIMIT_REC = 4;
    private static final int ROWS_LIMIT_PLAIN = 6;

    /* Палитра «Amber Glass» (§4.2 — токены POC) */
    private static final Color BG_TOP = new Color(0x14, 0x10, 0x0C);
    private static final Color BG_BOTTOM = new Color(0x24, 0x1A, 0x10);
    private static final Color ACCENT = new Color(0xF5, 0xB9, 0x42);
    private static final Color TEXT_MAIN = new Color(0xF2, 0xEA, 0xDD);
    private static final Color TEXT_MUTED = new Color(0xB8, 0xA8, 0x8F);
    private static final Color CARD_FILL = new Color(0xFF, 0xF6, 0xE5, 18);
    private static final Color CARD_FILL_HI = new Color(0xF5, 0xB9, 0x42, 28);

    private CardRender() {
    }

    /* ---------- рендер ---------- */

    /* PNG-байты постера завершённой тренировки. data — полный файл владельца
       (нужен для базы рекорда — прошлые тренировки). IllegalArgumentException —
       делиться нечем (0 упражнений с подходами; вызывающий проверяет это раньше). */
    public static byte[] render(GymData data, Workout w) throws IOException, java.awt.FontFormatException {
        List<ExerciseEntry> exs = w.exercises.stream().filter(e -> !e.sets.isEmpty()).toList();
        if (exs.isEmpty()) throw new IllegalArgumentException("нет упражнений для постера");

        /* рекорд (§5.3): весовой приоритетен, без него — объём повторений; строки карточки */
        String recLine = recordLine(data, w, exs);

        /* статистика 2×2 (§5.2, формулы SharePage) */
        long volume = Math.round(SharePage.volumeOf(w));
        String[] volCard = volume > 0
            ? new String[]{SharePage.fmtNum(volume) + " кг", "объём тренировки"}
            : new String[]{SharePage.fmtNum(SharePage.totalReps(w)), "повторений"};
        String[][] stats = {
            volCard,
            new String[]{SharePage.fmtNum(exs.size()), exWord(exs.size())},
            new String[]{SharePage.fmtNum(SharePage.setsTotal(w)), SharePage.setsWord(SharePage.setsTotal(w))},
            new String[]{durationCompact(SharePage.durationMin(w)), "длительность"},
        };

        Font sans = loadFont("DejaVuSans.ttf");
        Font bold = loadFont("DejaVuSans-Bold.ttf");

        BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);

            /* фон: вертикальный градиент + мягкое янтарное свечение у верхнего правого угла (POC) */
            g.setPaint(new java.awt.GradientPaint(0, 0, BG_TOP, 0, H, BG_BOTTOM));
            g.fillRect(0, 0, W, H);
            for (int i = 5; i >= 1; i--) {
                int r = 140 + i * 130;
                g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.020f));
                g.setColor(ACCENT);
                g.fillOval(W - r / 2, -r / 3, r, r);
            }
            g.setComposite(AlphaComposite.SrcOver);

            /* 1 · дата-шапка — строго из w.date (урок UX-B14) */
            g.setColor(TEXT_MAIN);
            g.setFont(bold.deriveFont(48f));
            g.drawString(russianDate(w.date), MARGIN, 184);

            /* 2 · акцентная линия */
            g.setColor(ACCENT);
            g.setStroke(new BasicStroke(4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.drawLine(MARGIN, 232, MARGIN + 168, 232);

            /* 3 · статистика 2×2 */
            for (int i = 0; i < stats.length; i++) {
                int col = i % 2;
                int row = i / 2;
                int x = MARGIN + col * (STAT_CARD_W + STAT_GAP);
                int y = 310 + row * (STAT_CARD_H + STAT_GAP);
                roundCard(g, x, y, STAT_CARD_W, STAT_CARD_H, CARD_FILL, null);
                g.setColor(ACCENT);
                g.setFont(bold.deriveFont(56f));
                g.drawString(stats[i][0], x + 32, y + 74);
                g.setColor(TEXT_MUTED);
                g.setFont(sans.deriveFont(30f));
                g.drawString(stats[i][1], x + 32, y + 128);
            }

            int rowsY;
            int rowsLimit;
            if (recLine != null) {
                /* 4 · карточка «РЕКОРД!» */
                roundCard(g, MARGIN, REC_Y, CARD_W, REC_H, CARD_FILL_HI, ACCENT);
                g.setColor(ACCENT);
                g.setFont(bold.deriveFont(36f));
                g.drawString("РЕКОРД!", MARGIN + 36, REC_Y + 62);
                g.setColor(TEXT_MAIN);
                g.setFont(bold.deriveFont(48f));
                g.drawString(recLine, MARGIN + 36, REC_Y + 140);
                g.setColor(TEXT_MUTED);
                g.setFont(sans.deriveFont(30f));
                g.drawString("личный результат по этому упражнению", MARGIN + 36, REC_Y + 188);
                rowsY = ROWS_Y_REC;
                rowsLimit = ROWS_LIMIT_REC;
            } else {
                /* §6.1: без рекорда список сдвигается вверх */
                rowsY = ROWS_Y_PLAIN;
                rowsLimit = ROWS_LIMIT_PLAIN;
            }

            /* 5 · «УПРАЖНЕНИЯ» */
            g.setColor(TEXT_MUTED);
            g.setFont(bold.deriveFont(30f));
            g.drawString("УПРАЖНЕНИЯ", MARGIN, rowsY - 30);

            /* 6 · строки упражнений (порядок пользователя, лучший подход §5.5) */
            int shown = Math.min(exs.size(), rowsLimit);
            for (int i = 0; i < shown; i++) {
                ExerciseEntry e = exs.get(i);
                SetEntry s = e.sets.get(posterBestSetIdx(e));
                int y = rowsY + i * (EX_CARD_H + EX_GAP);
                roundCard(g, MARGIN, y, CARD_W, EX_CARD_H, CARD_FILL, null);
                FontMetrics rfm = g.getFontMetrics();
                String right = SharePage.setLine(s);
                /* значение справа приоритетно: не сжимается, усекается только имя (§6.3) */
                int avail = CARD_W - 36 - 36 - rfm.stringWidth(right) - 24;
                g.setFont(sans.deriveFont(42f));
                FontMetrics nfm = g.getFontMetrics();
                g.setColor(TEXT_MAIN);
                g.drawString(truncateName(nfm, e.name, avail), MARGIN + 36, y + 80);
                g.setColor(TEXT_MUTED);
                g.setFont(sans.deriveFont(38f));
                FontMetrics vfm = g.getFontMetrics();
                g.drawString(right, MARGIN + CARD_W - 36 - vfm.stringWidth(right), y + 79);
            }

            /* 7 · «+ K ещё» */
            int hidden = exs.size() - shown;
            if (hidden > 0) {
                g.setColor(TEXT_MUTED);
                g.setFont(sans.deriveFont(30f));
                int lastY = rowsY + (shown - 1) * (EX_CARD_H + EX_GAP);
                g.drawString("+ " + hidden + " ещё", MARGIN, lastY + EX_CARD_H + 44);
            }

            /* 8 · футер */
            g.setColor(TEXT_MUTED);
            g.setFont(sans.deriveFont(30f));
            String footer = "GymHelper — дневник тренировок";
            FontMetrics ffm = g.getFontMetrics();
            g.drawString(footer, (W - ffm.stringWidth(footer)) / 2f, 1818);
        } finally {
            g.dispose();
        }

        ByteArrayOutputStream buf = new ByteArrayOutputStream(256 * 1024);
        ImageIO.write(img, "png", buf);
        return buf.toByteArray();
    }

    /* ---------- модель: рекорд и строки (§5.3, §5.5) ---------- */

    /* строка карточки «РЕКОРД!» («Жим лёжа — 100 кг × 5» / «Подтягивания — 38 повторений»),
       null — рекорда нет (карточка не рисуется, список сдвигается вверх). Весовой
       рекорд приоритетен над объёмным (§6.9). */
    private static String recordLine(GymData data, Workout w, List<ExerciseEntry> exs) {
        double maxW = 0;
        String maxEx = null;
        SetEntry maxSet = null;
        for (ExerciseEntry e : exs) {
            for (SetEntry s : e.sets) {
                double v = Records.avgWeight(s.weight);
                if (v > maxW) {
                    maxW = v;
                    maxEx = e.name;
                    maxSet = s;
                }
            }
        }
        if (maxW > 0 && maxEx != null && SharePage.isRealWeightRecord(data, w, maxEx, maxW)) {
            return maxEx + " — " + weightAvgText(maxW) + " кг × " + repsText(maxSet);
        }
        /* объёмный рекорд повторений: безвесовые упражнения, суммарный объём за тренировку
           строго больше максимального суммарного объёма прошлых тренировок (база непуста) */
        int idx = data.workouts.indexOf(w);
        if (idx < 0) return null;
        for (ExerciseEntry e : exs) {
            if (hasWeight(e)) continue;
            String nl = e.name.toLowerCase();
            int vol = volumeOfName(w, nl);
            if (vol <= 0) continue;
            int baseVol = 0;
            boolean baseHas = false;
            for (int i = 0; i < idx; i++) {
                int v = volumeOfName(data.workouts.get(i), nl);
                if (v > 0) {
                    baseHas = true;
                    if (v > baseVol) baseVol = v;
                }
            }
            if (baseHas && vol > baseVol) return e.name + " — " + vol + " " + repeatWord(vol);
        }
        return null;
    }

    private static boolean hasWeight(ExerciseEntry e) {
        for (SetEntry s : e.sets) {
            if (Records.avgWeight(s.weight) > 0) return true;
        }
        return false;
    }

    /* суммарный объём повторений упражнения по всем его блокам тренировки (§5.3) */
    private static int volumeOfName(Workout w, String nameLower) {
        int vol = 0;
        for (ExerciseEntry e : w.exercises) {
            if (!e.name.toLowerCase().equals(nameLower)) continue;
            for (SetEntry s : e.sets) vol += Math.max(s.sets, 0) * Records.repsAvg(s.reps);
        }
        return vol;
    }

    /* лучший подход строки постера: с весами — макс avgWeight, при равенстве макс
       repsAvg, при равенстве первый; без весов — макс подходы×repsAvg (§5.5.1) */
    private static int posterBestSetIdx(ExerciseEntry e) {
        if (e.sets.isEmpty()) return -1;
        boolean weighted = hasWeight(e);
        int best = 0;
        double bestW = -1;
        int bestR = -1;
        int bestV = -1;
        for (int i = 0; i < e.sets.size(); i++) {
            SetEntry s = e.sets.get(i);
            if (weighted) {
                double ww = Records.avgWeight(s.weight);
                int rr = Records.repsAvg(s.reps);
                if (ww > bestW || (ww == bestW && rr > bestR)) {
                    best = i;
                    bestW = ww;
                    bestR = rr;
                }
            } else {
                int vol = Math.max(s.sets, 0) * Records.repsAvg(s.reps);
                if (vol > bestV) {
                    best = i;
                    bestV = vol;
                }
            }
        }
        return best;
    }

    /* повторы карточки рекорда: текст подхода как введён («5», «8-10», «5+1»);
       нечисловой текст («макс») → 10 (repsAvg, §5.3) */
    private static String repsText(SetEntry s) {
        String r = s.reps == null ? "" : s.reps.trim();
        return r.matches(".*\\d.*") ? r : String.valueOf(Records.repsAvg(s.reps));
    }

    /* средний вес карточки рекорда: целое — без дроби («125»), дробное — с запятой
       («82,5»), хвостовые нули срезаются (§6.8) */
    public static String weightAvgText(double v) {
        if (v == Math.rint(v)) return String.valueOf((long) v);
        String s = String.format(Locale.US, "%.2f", v);
        while (s.endsWith("0")) s = s.substring(0, s.length() - 1);
        return s.replace('.', ',');
    }

    /* ---------- форматирование (склонения §7, длительность §10.1, дата §5.1) ---------- */

    public static String exWord(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "упражнение";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "упражнения";
        return "упражнений";
    }

    public static String repeatWord(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "повторение";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "повторения";
        return "повторений";
    }

    /* компактная длительность («1 ч 10 мин», §10.1); null или 0 → «—» (§6.7) */
    public static String durationCompact(Long mins) {
        if (mins == null || mins <= 0) return "—";
        long h = mins / 60;
        long m = mins % 60;
        if (h == 0) return m + " мин";
        if (m == 0) return h + " ч";
        return h + " ч " + m + " мин";
    }

    /* «21 ноября 2026, суббота» — вручную, без Locale-зависимостей (POC);
       нераспарсимая дата → строка как есть (§5.1) */
    public static String russianDate(String iso) {
        if (iso != null) {
            try {
                return russianDate(LocalDate.parse(iso.trim()));
            } catch (Exception e) {
                /* фолбэк ниже */
            }
        }
        return iso == null ? "" : iso;
    }

    private static String russianDate(LocalDate d) {
        String[] months = {
            "января", "февраля", "марта", "апреля", "мая", "июня",
            "июля", "августа", "сентября", "октября", "ноября", "декабря"
        };
        String[] weekdays = {
            "понедельник", "вторник", "среда", "четверг",
            "пятница", "суббота", "воскресенье"
        };
        /* ISO: 1 = понедельник ... 7 = воскресенье */
        String weekday = weekdays[d.getDayOfWeek().getValue() - 1];
        return d.getDayOfMonth() + " " + months[d.getMonthValue() - 1]
            + " " + d.getYear() + ", " + weekday;
    }

    /* усечение имени по фактической ширине (§6.3): имя + «…» влезает в avail */
    private static String truncateName(FontMetrics fm, String name, int avail) {
        if (fm.stringWidth(name) <= avail) return name;
        String dots = "…";
        int dotsW = fm.stringWidth(dots);
        int end = name.length();
        while (end > 1 && fm.stringWidth(name.substring(0, end)) + dotsW > avail) end--;
        return name.substring(0, end) + dots;
    }

    /* ---------- графические примитивы и шрифты (POC 1:1) ---------- */

    /* скруглённая полупрозрачная карточка (стекло) с опциональной рамкой */
    private static void roundCard(Graphics2D g, int x, int y, int w, int h, Color fill, Color border) {
        var rr = new RoundRectangle2D.Float(x, y, w, h, 28, 28);
        g.setColor(fill);
        g.fill(rr);
        if (border != null) {
            g.setColor(border);
            g.setStroke(new BasicStroke(2f));
            g.draw(rr);
        }
    }

    /* загрузка шрифта строго из bundled TTF — никаких системных шрифтов */
    private static Font loadFont(String name) throws IOException, java.awt.FontFormatException {
        try (InputStream in = CardRender.class.getResourceAsStream("/gym/web/fonts/" + name)) {
            if (in != null) return Font.createFont(Font.TRUETYPE_FONT, in);
        }
        /* fallback точечной компиляции (javac -d out, AGENTS.md): шрифты рядом с исходниками */
        Path p = Path.of("src", "gym", "web", "fonts", name);
        if (Files.isRegularFile(p)) {
            try (InputStream in = Files.newInputStream(p)) {
                return Font.createFont(Font.TRUETYPE_FONT, in);
            }
        }
        throw new IOException("Bundled font not found: gym/web/fonts/" + name);
    }
}
