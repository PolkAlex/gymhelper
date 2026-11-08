package gym;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class BotLogic {
    private static final DateTimeFormatter DF = DateTimeFormatter.ofPattern("dd.MM.yyyy");
    private static final DateTimeFormatter DDM = DateTimeFormatter.ofPattern("dd-MM");
    private static final DateTimeFormatter HF = DateTimeFormatter.ofPattern("HH:mm");
    private static final String[] DOW = {"Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"};
    private static final Pattern LINE_PATTERN = Pattern.compile("^(.*?)\\s*(\\d{1,2})\\s+по\\s+(.+)$");
    private static final Pattern NUM_PATTERN = Pattern.compile("\\d+(?:[.,]\\d+)?");
    private static final Pattern WEIGHT_PATTERN = Pattern.compile("^[0-9.,\\-\\s]+$");
    private static final Pattern TIME_PATTERN = Pattern.compile("^(\\d{1,2}):(\\d{2})$");
    private static final int KCAL_MAX_MIN = 240;
    /* шаблоны тренировок [UX-T6/T7]: лимиты из спеки §0.2 */
    private static final int TPL_LIMIT = 20;
    private static final int TPL_EX_LIMIT = 20;
    /* таймер отдыха [UX-T5]: тик 1 с, обычная фаза — правка раз в 5 с, финальные 15 с — раз в 1 с */
    private static final int REST_BAR_CELLS = 18;
    private static final int REST_FINAL_PHASE = 15;
    private static final long REST_EDIT_MS = 5000;
    private static final long REST_EDIT_FINAL_MS = 1000;
    private static final long REST_FREEZE_MS = 5 * 60 * 1000; /* юзер молчит 5 мин — правки замирают */
    /* [ONB-T2] удаление данных: окно подтверждения /delete_my_data_confirm — 5 минут */
    private static final long DELETE_CONFIRM_MS = 5 * 60 * 1000L;
    private static final String PRIVACY_URL = "https://gym-helper.com/privacy.html";

    private final TelegramApi api;
    private final Storage storage;
    private final String webAppUrl;
    private final String appLink;
    /* [UX-T16] рассылка владельцем: chat id владельца; 0 — admin-команды недоступны */
    private final long adminChatId;
    private final Map<Long, UserState> states = new ConcurrentHashMap<>();
    private final Map<Long, RestSession> rests = new ConcurrentHashMap<>();
    /* [ONB-T2] ожидающие подтверждения удаления: chatId → время запроса, только память процесса
       (после рестарта бота подтверждение просто «истекло» — юзер начинает заново) */
    private final Map<Long, Long> pendingDeletes = new ConcurrentHashMap<>();
    private final ScheduledExecutorService restScheduler;

    public BotLogic(TelegramApi api, Storage storage, String webAppUrl, String appLink, long adminChatId) {
        this.api = api;
        this.storage = storage;
        this.webAppUrl = webAppUrl;
        this.appLink = appLink;
        this.adminChatId = adminChatId;
        /* daemon-поток: фоновые правки не должны мешать long polling и не держат JVM */
        this.restScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "rest-timer");
            t.setDaemon(true);
            return t;
        });
        this.restScheduler.scheduleAtFixedRate(this::restTickSafe, 1, 1, TimeUnit.SECONDS);
    }

    /* Сессия таймера одного чата — только в памяти (§2.9): после рестарта бота сообщение
       просто замирает, следующий лог подхода создаст новое. Поля, мутируемые из разных
       потоков (callback-поток и планировщик), — volatile. */
    private static final class RestSession {
        volatile long messageId;      /* 0 — сообщение не отправилось, правки не идут */
        volatile long end;            /* абсолютная метка окончания, epoch ms — заморозка её не сдвигает */
        volatile long dur;            /* полная длительность шкалы, сек (+30 сек удлиняет) */
        volatile String ex;           /* название упражнения в подписи */
        volatile String push;         /* «75 кг × 8» для тихого пуша; null — блок без веса */
        volatile long lastActivity;   /* любой update юзера (сообщение/callback), epoch ms */
        volatile long lastEdit;       /* последняя правка сообщения, epoch ms */
        volatile String lastText;     /* последний отправленный текст — защита «message is not modified» */
        volatile boolean frozen;      /* юзер молчит > 5 мин — правки заморожены до его возврата */
        volatile boolean stopped;     /* сессия завершена (финал/стоп/5 неудачных правок) */
        volatile int fails;           /* неудачные правки подряд */
    }

    private void restTickSafe() {
        try {
            restTick();
        } catch (Exception e) {
            System.out.println("[warn] rest tick: " + e.getMessage());
        }
    }

    private void restTick() {
        long now = System.currentTimeMillis();
        for (Map.Entry<Long, RestSession> en : rests.entrySet()) {
            long chatId = en.getKey();
            RestSession s = en.getValue();
            if (s.stopped) {
                rests.remove(chatId);
                continue;
            }
            if (now - s.lastActivity > REST_FREEZE_MS) {
                s.frozen = true; /* правки замирают, финальный пуш не отправляется (§2.6) */
                continue;
            }
            if (s.frozen) continue; /* разморозка — одна ресинк-правка в touchRest при любом update */
            long left = restLeft(s, now);
            if (left <= 0) {
                restFinalize(chatId, s, true);
                continue;
            }
            long interval = left <= REST_FINAL_PHASE ? REST_EDIT_FINAL_MS : REST_EDIT_MS;
            if (now - s.lastEdit < interval) continue;
            restEdit(chatId, s, restCountdownText(s.ex, left, s.dur), restKb());
        }
    }

    private static long restLeft(RestSession s, long now) {
        return Math.max(0, (s.end - now + 999) / 1000);
    }

    /* текст отсчёта: «⏱ Отдых: 1:22» + бар из 18 ячеек + упражнение */
    static String restCountdownText(String ex, long left, long dur) {
        int filled = (int) Math.round(REST_BAR_CELLS * Math.min(left, dur) / (double) Math.max(dur, 1));
        StringBuilder bar = new StringBuilder();
        for (int i = 0; i < REST_BAR_CELLS; i++) bar.append(i < filled ? '▰' : '▱');
        return "⏱ Отдых: " + (left / 60) + ":" + String.format("%02d", left % 60)
            + "\n" + bar
            + "\n" + esc(ex == null ? "" : ex) + " — следующий подход";
    }

    private static List<List<Map<String, Object>>> restKb() {
        return List.of(List.of(
            TelegramApi.button("+30 сек", "rest:more"),
            TelegramApi.button("⏹ Стоп", "rest:stop")
        ));
    }

    /* клавиатура удаляется: Telegram убирает inline-клавиатуру только по пустой */
    private static final List<List<Map<String, Object>>> REST_NO_KB = List.of();

    private static final String REST_FINAL_TEXT = "✅ Отдых окончен — подход сам себя не сделает";

    /* правка с защитой «message is not modified»; подряд 5 неудач — сообщение удалено юзером,
       сессия мертва: следующий лог создаст новое сообщение (§2.3) */
    private void restEdit(long chatId, RestSession s, String text, List<List<Map<String, Object>>> kb) {
        if (s.stopped) return; /* гонка «Стоп → оживание»: финал/стоп уже был — правки не идут */
        if (s.messageId <= 0) return;
        if (text.equals(s.lastText)) return;
        long now = System.currentTimeMillis();
        if (api.editMessageText(chatId, s.messageId, text, kb)) {
            s.lastText = text;
            s.lastEdit = now;
            s.fails = 0;
        } else if (++s.fails >= 5) {
            s.stopped = true;
        }
    }

    /* финал: правка отсчёта в итоговый вид; пуш — только по истечении времени, не по «Стоп» */
    private void restFinalize(long chatId, RestSession s, boolean push) {
        s.stopped = true;
        String desc = s.push;
        restEditFinal(chatId, s, REST_FINAL_TEXT);
        if (push) {
            api.sendMessageSilent(chatId, desc == null
                ? "⏰ Перерыв окончен — подходы ждут продолжения"
                : "⏰ Перерыв окончен — " + desc + " ждут продолжения");
        }
    }

    /* финальная правка идёт мимо защиты «text changed» (текст совпадать не должен, но
       повторный финал не должен и спамить) — прямо через api */
    private void restEditFinal(long chatId, RestSession s, String text) {
        if (s.messageId > 0) api.editMessageText(chatId, s.messageId, text, REST_NO_KB);
    }

    /* запуск/перезапуск отсчёта: одно сообщение на сессию, перезапуск правит его же (§2.3) */
    private void restStart(long chatId, GymData data, String exercise, SetEntry block) {
        int dur = data.restSec != null ? data.restSec : 90;
        if (dur <= 0) return; /* «выкл» [UX-T13]: после подхода отсчёт не запускается */
        long now = System.currentTimeMillis();
        RestSession s = rests.get(chatId);
        if (s == null || s.stopped || s.messageId <= 0) {
            s = new RestSession();
            String text = restCountdownText(exercise, dur, dur);
            s.messageId = api.sendMessageGetId(chatId, text, restKb());
            if (s.messageId <= 0) return;
            s.lastText = text;
            s.lastEdit = now;
            rests.put(chatId, s);
        } else {
            restEdit(chatId, s, restCountdownText(exercise, dur, dur), restKb());
        }
        s.end = now + dur * 1000L;
        s.dur = dur;
        s.ex = exercise;
        s.push = restPushDesc(block);
        s.lastActivity = now;
        s.frozen = false;
        s.stopped = false;
        s.fails = 0;
    }

    /* «75 кг × 8» для финального пуша; блок без веса — описания не даёт */
    static String restPushDesc(SetEntry block) {
        if (block == null || block.weight == null || block.weight.isEmpty()) return null;
        return block.weight + " кг × " + block.reps;
    }

    /* любой update юзера: активность продлевает окно правок, после заморозки — одна ресинк-правка */
    private void touchRest(long chatId) {
        RestSession s = rests.get(chatId);
        if (s == null) return;
        long now = System.currentTimeMillis();
        s.lastActivity = now;
        if (!s.frozen) return;
        s.frozen = false;
        long left = restLeft(s, now);
        if (left <= 0) {
            /* время истекло, пока юзера не было: финальный вид без пуша, сессия закрывается */
            restEditFinal(chatId, s, REST_FINAL_TEXT);
            s.stopped = true;
            return;
        }
        restEdit(chatId, s, restCountdownText(s.ex, left, s.dur), restKb());
    }

    /* остановка без пуша: «⏹ Стоп», завершение/отмена тренировки */
    private void restStop(long chatId) {
        RestSession s = rests.get(chatId);
        if (s != null && !s.stopped) restFinalize(chatId, s, false);
    }

    public void handle(Map<String, Object> update) {
        Map<String, Object> cb = Json.map(update.get("callback_query"));
        if (cb != null) {
            Map<String, Object> msg = Json.map(cb.get("message"));
            Map<String, Object> chat = Json.map(msg == null ? null : msg.get("chat"));
            if (chat == null) return;
            long chatId = Json.lng(chat.get("id"));
            long messageId = Json.lng(msg.get("message_id"));
            String data = Json.str(cb, "data");
            String cbId = Json.str(cb, "id");
            touchRest(chatId);
            try {
                onCallback(chatId, messageId, data);
            } catch (Exception e) {
                api.answerCallbackQuery(cbId, "Ошибка, попробуй ещё раз");
                System.out.println("[warn] callback '" + data + "': " + e.getMessage());
                return;
            }
            api.answerCallbackQuery(cbId, null);
            return;
        }

        Map<String, Object> msg = Json.map(update.get("message"));
        if (msg == null) return;
        Map<String, Object> chat = Json.map(msg.get("chat"));
        long chatId = Json.lng(chat.get("id"));
        touchRest(chatId);
        String text = Json.str(msg, "text");
        if (text == null) {
            api.sendMessage(chatId, "Я понимаю только текст 🙂 Открой меню командой /start", null);
            return;
        }
        try {
            onMessage(chatId, text.trim());
        } catch (Exception e) {
            api.sendMessage(chatId, "Что-то пошло не так 😕 Попробуй ещё раз или начни с /start", null);
            System.out.println("[warn] message: " + e.getMessage());
        }
    }

    private void onMessage(long chatId, String text) {
        UserState st = states.computeIfAbsent(chatId, k -> new UserState());
        GymData data = storage.load(chatId);
        String low = text.toLowerCase();

        if (low.startsWith("/start") || low.startsWith("/menu")) {
            showMenu(chatId, null, data, st);
            return;
        }
        if (low.startsWith("/workout")) {
            openWorkout(chatId, null, data, st);
            return;
        }
        if (low.startsWith("/view")) {
            viewWorkout(chatId, null, data, st);
            return;
        }
        if (low.startsWith("/history")) {
            showHistory(chatId, null, data, st, 0);
            return;
        }
        if (low.startsWith("/stats")) {
            showStats(chatId, null, data, st);
            return;
        }
        if (low.startsWith("/profile")) {
            startProfile(chatId, null, data, st);
            return;
        }
        /* строго, как /rest: /exports не матчится (§2.7) */
        if (low.equals("/export") || low.startsWith("/export ")) {
            exportCsv(chatId, null, data, st);
            return;
        }
        /* строго: /rest и /rest N; /restx и /restfoo не матчатся (§2.7) */
        if (low.equals("/rest") || low.startsWith("/rest ")) {
            showRest(chatId, null, data, text);
            return;
        }
        /* строго, как /rest: /templatesX не матчится (§2.7) */
        if (low.equals("/templates") || low.startsWith("/templates ")) {
            showTemplates(chatId, null, data, st);
            return;
        }
        /* строго, как /rest: /helpx не матчится (§2.7) */
        if (low.equals("/help") || low.startsWith("/help ")) {
            showHelp(chatId, null, data, st);
            return;
        }
        /* рассылка владельцем [UX-T16]: строго, /announcex и /announce_dryx не матчатся */
        String[] ann = parseAnnounce(text);
        if (ann != null) {
            handleAnnounce(chatId, ann[1], ann[0]);
            return;
        }
        /* удаление своих данных по запросу [ONB-T2]: строго, /delete_my_datax не матчится */
        String delCmd = parseDeleteData(text);
        if (delCmd != null) {
            handleDeleteData(chatId, "confirm".equals(delCmd));
            return;
        }
        if (low.startsWith("/app")) {
            showMenu(chatId, null, data, st);
            return;
        }
        if (low.startsWith("/")) {
            showMenu(chatId, null, data, st);
            return;
        }

        switch (st.mode) {
            case EX_WEIGHT -> handleWeightInput(chatId, null, data, st, text);
            case EX_SETS -> handleSetsInput(chatId, null, data, st, text);
            case EX_REPS -> handleRepsInput(chatId, null, data, st, text);
            case RENAME -> handleRenameInput(chatId, null, data, st, text);
            case TITLE -> handleTitleInput(chatId, null, data, st, text);
            case NUTR -> handleNutrInput(chatId, null, data, st, text);
            case TIME -> handleTimeInput(chatId, null, data, st, text);
            case PROFILE -> handleProfileInput(chatId, null, data, st, text);
            case TPL_NAME -> handleTplNameInput(chatId, null, data, st, text);
            case WORKOUT -> renderWorkoutScreen(chatId, null, data, st, data.active() == null ? 0 : data.active().id);
            default -> showMenu(chatId, null, data, st);
        }
    }

    private void onCallback(long chatId, long messageId, String data) {
        if (data == null) data = "home";
        GymData dataModel = storage.load(chatId);
        UserState st = states.computeIfAbsent(chatId, k -> new UserState());

        switch (data) {
            case "home", "menu" -> showMenu(chatId, messageId, dataModel, st);
            case "menu:start" -> openWorkout(chatId, messageId, dataModel, st);
            case "menu:view" -> viewWorkout(chatId, messageId, dataModel, st);
            case "menu:hist" -> showHistory(chatId, messageId, dataModel, st, 0);
            case "menu:stats" -> showStats(chatId, messageId, dataModel, st);
            case "menu:tpl" -> showTemplates(chatId, messageId, dataModel, st);
            case "wk:editmode" -> {
                Workout a = dataModel.active();
                if (a == null) {
                    showMenu(chatId, messageId, dataModel, st);
                    return;
                }
                st.editWorkoutId = a.id;
                st.editing = false;
                st.editName = null;
                showEditEx(chatId, messageId, dataModel, st);
            }
            case "pr" -> startProfile(chatId, messageId, dataModel, st);
            case "wk:resume" -> {
                st.pendingTplId = 0;
                st.pendingRepWid = 0;
                showWorkout(chatId, messageId, dataModel, st);
            }
            case "wk:discard" -> {
                Workout a = dataModel.active();
                if (a != null) dataModel.workouts.remove(a);
                storage.save(chatId, dataModel);
                /* «Удалить и начать новую» после старта из шаблона/повтора — применяем отложенное (§4.6) */
                long tplId = st.pendingTplId;
                long repWid = st.pendingRepWid;
                st.pendingTplId = 0;
                st.pendingRepWid = 0;
                Template tpl = tplId > 0 ? findTemplate(dataModel, tplId) : null;
                if (tpl != null) {
                    startFromTemplate(chatId, messageId, dataModel, st, tpl, null);
                    return;
                }
                if (repWid > 0) {
                    tplRepeat(chatId, messageId, dataModel, st, repWid);
                    return;
                }
                openWorkout(chatId, messageId, dataModel, st);
            }
            case "wk:add" -> {
                st.editWorkoutId = 0;
                st.editing = false;
                showCatalog(chatId, messageId, st);
            }
            case "wk:finish" -> {
                restStop(chatId);
                finishWorkout(chatId, messageId, dataModel, st);
            }
            case "wk:cancel" -> confirmCancel(chatId, messageId, dataModel);
            case "wk:cancelok" -> {
                restStop(chatId);
                Workout a = dataModel.active();
                if (a != null) dataModel.workouts.remove(a);
                storage.save(chatId, dataModel);
                showMenu(chatId, messageId, dataModel, st);
            }
            case "rest:more" -> {
                RestSession s = rests.get(chatId);
                if (s != null && !s.stopped) {
                    long now = System.currentTimeMillis();
                    s.end += 30000;
                    s.dur += 30;
                    s.lastActivity = now;
                    s.frozen = false;
                    restEdit(chatId, s, restCountdownText(s.ex, restLeft(s, now), s.dur), restKb());
                }
            }
            case "rest:stop" -> restStop(chatId);
            case "tpl:canc" -> showMenu(chatId, messageId, dataModel, st);
            case "tpl:back" -> showTemplates(chatId, messageId, dataModel, st);
            case "wk:cancelno" -> showWorkout(chatId, messageId, dataModel, st);
            case "ex:back", "set:done" -> {
                closeCurrentExercise(chatId, dataModel, st);
                backToWorkoutScreen(chatId, messageId, dataModel, st);
            }
            case "w:back" -> {
                st.mode = UserState.Mode.EX_WEIGHT;
                send(chatId, messageId, weightPromptText(st), weightKb(st, "ex:back"));
            }
            case "s:back" -> goSets(chatId, messageId);
            case "w:p" -> {
                st.pendingWeight = st.sugPop == null ? "" : st.sugPop;
                if (st.editing) applyEditWeight(chatId, messageId, dataModel, st);
                else goSets(chatId, messageId);
            }
            case "w:none" -> {
                st.pendingWeight = "";
                if (st.editing) applyEditWeight(chatId, messageId, dataModel, st);
                else goSets(chatId, messageId);
            }
            case "w:plan" -> {
                /* рассинхрон (editing-сессия / план не актуален) — игнор с перерисовкой экрана веса [UX-E5 §5.1] */
                if (st.editing || st.sugPlan == null || st.sugPlan.r.isEmpty()) {
                    st.mode = UserState.Mode.EX_WEIGHT;
                    send(chatId, messageId, weightPromptText(st), weightKb(st, st.editing ? "ef:menu" : "ex:back"));
                    return;
                }
                /* мгновенная запись блока целиком — дальше «✅ Записано…» + таймер отдыха, как обычно */
                confirmEntry(chatId, messageId, dataModel, st,
                    new SetEntry(st.sugPlan.w, st.sugPlan.s, st.sugPlan.r));
            }
            case "w:again" -> pickExercise(chatId, messageId, dataModel, st, st.currentExercise);
            case "hist:back" -> showHistory(chatId, messageId, dataModel, st, st.histPage);
            case "nu:clear" -> {
                Workout w = resolveWorkout(dataModel, st);
                if (w != null) {
                    w.nutrition = null;
                    storage.save(chatId, dataModel);
                }
                backToWorkoutScreen(chatId, messageId, dataModel, st);
            }
            case "ti:auto" -> {
                Workout w = resolveWorkout(dataModel, st);
                if (w != null) {
                    w.title = null;
                    storage.save(chatId, dataModel);
                }
                backToWorkoutScreen(chatId, messageId, dataModel, st);
            }
            case "exq:back" -> showEditEx(chatId, messageId, dataModel, st);
            case "en:back" -> showEditEntry(chatId, messageId, dataModel, st);
            case "ef:menu" -> showEditField(chatId, messageId, dataModel, st);
            case "ed:done" -> {
                st.editing = false;
                st.editName = null;
                st.editIdx = 0;
                st.editWorkoutId = 0;
                backToWorkoutScreen(chatId, messageId, dataModel, st);
            }
            case "en:add" -> {
                st.editing = false;
                pickExercise(chatId, messageId, dataModel, st, st.editName);
            }
            case "ef:w" -> startEditField(chatId, messageId, dataModel, st, "w");
            case "ef:s" -> startEditField(chatId, messageId, dataModel, st, "s");
            case "ef:r" -> startEditField(chatId, messageId, dataModel, st, "r");
            case "ef:n" -> {
                st.mode = UserState.Mode.RENAME;
                send(chatId, messageId, "Текущее название: " + esc(st.editName) + "\nВведи новое название упражнения:", renameKb());
            }
            case "ef:del" -> deleteEntry(chatId, messageId, dataModel, st);
            default -> {
                if (data.startsWith("ex:i_")) {
                    pickExercise(chatId, messageId, dataModel, st, Exercises.CATALOG[Integer.parseInt(data.substring(5))]);
                } else if (data.startsWith("w:l_")) {
                    int idx = Integer.parseInt(data.substring(4));
                    if (idx < 0 || idx >= st.sugWeights.size()) {
                        st.mode = UserState.Mode.EX_WEIGHT;
                        send(chatId, messageId, weightPromptText(st), weightKb(st, st.editing ? "ef:menu" : "ex:back"));
                        return;
                    }
                    st.pendingWeight = st.sugWeights.get(idx);
                    if (st.editing) applyEditWeight(chatId, messageId, dataModel, st);
                    else goSets(chatId, messageId);
                } else if (data.startsWith("r:l_")) {
                    int idx = Integer.parseInt(data.substring(4));
                    if (idx < 0 || idx >= st.sugReps.size()) {
                        goReps(chatId, messageId, dataModel, st);
                        return;
                    }
                    if (st.editing) applyEditReps(chatId, messageId, dataModel, st, st.sugReps.get(idx));
                    else confirmEntry(chatId, messageId, dataModel, st,
                        new SetEntry(st.pendingWeight, st.pendingSets, st.sugReps.get(idx)));
                } else if (data.startsWith("exq_")) {
                    st.editName = null;
                    showEditEntryByIdx(chatId, messageId, dataModel, st, Integer.parseInt(data.substring(4)));
                } else if (data.startsWith("enq_")) {
                    st.editIdx = Integer.parseInt(data.substring(4));
                    showEditField(chatId, messageId, dataModel, st);
                } else if (data.startsWith("ed_")) {
                    st.editWorkoutId = Long.parseLong(data.substring(3));
                    st.editing = false;
                    st.editName = null;
                    showEditEx(chatId, messageId, dataModel, st);
                } else if (data.startsWith("nu_")) {
                    st.editWorkoutId = Long.parseLong(data.substring(3));
                    st.mode = UserState.Mode.NUTR;
                    Workout w = resolveWorkout(dataModel, st);
                    String cur = w != null && w.nutrition != null && !w.nutrition.isBlank()
                        ? "\nТекущее: " + esc(w.nutrition) : "";
                    send(chatId, messageId, "🥤 Питание во время тренировки" + cur
                        + "\n\nВведи, что пил и что ел (одним сообщением):", nutrKb(st.editWorkoutId));
                } else if (data.startsWith("ti_")) {
                    st.editWorkoutId = Long.parseLong(data.substring(3));
                    st.mode = UserState.Mode.TITLE;
                    Workout w = resolveWorkout(dataModel, st);
                    String cur = w != null && w.title != null && !w.title.isBlank()
                        ? "\nТекущее:\n" + titleHtml(w) : "\nСейчас название автоматическое.";
                    send(chatId, messageId, "✏️ Название тренировки" + cur
                        + "\n\nВведи своё название (первая строка станет жирной) или нажми «Авто»:", titleKb(st.editWorkoutId));
                } else if (data.startsWith("tm_")) {
                    st.editWorkoutId = Long.parseLong(data.substring(3));
                    st.mode = UserState.Mode.TIME;
                    Workout w = resolveWorkout(dataModel, st);
                    String cur = w != null && w.startedAt != null ? "\nТекущее начало: " + HF.format(parseDT(w.startedAt)) : "";
                    send(chatId, messageId, "⏱ Время начала тренировки" + cur
                        + "\n\nВведи время в формате ЧЧ:ММ (например 17:30):", timeKb(st.editWorkoutId));
                } else if (data.startsWith("kc_")) {
                    showKcal(chatId, messageId, dataModel, Long.parseLong(data.substring(3)));
                } else if (data.startsWith("pg_")) {
                    showProgress(chatId, messageId, dataModel, Long.parseLong(data.substring(3)));
                } else if (data.startsWith("scr_")) {
                    renderWorkoutScreen(chatId, messageId, dataModel, st, Long.parseLong(data.substring(4)));
                } else if (data.startsWith("hist:p_")) {
                    showHistory(chatId, messageId, dataModel, st, Integer.parseInt(data.substring(7)));
                } else if (data.startsWith("hist:v_")) {
                    renderWorkoutScreen(chatId, messageId, dataModel, st, Long.parseLong(data.substring(7)));
                } else if (data.startsWith("hist:d_")) {
                    confirmDelete(chatId, messageId, dataModel, st, Long.parseLong(data.substring(7)));
                } else if (data.startsWith("hist:dok_")) {
                    deleteWorkout(chatId, messageId, dataModel, st, Long.parseLong(data.substring(9)));
                } else if (data.startsWith("tpl:new_")) {
                    tplNew(chatId, messageId, dataModel, st, Long.parseLong(data.substring(8)));
                } else if (data.startsWith("tpl:auto_")) {
                    tplAutoSave(chatId, messageId, dataModel, st, Long.parseLong(data.substring(9)));
                } else if (data.startsWith("tpl:start_")) {
                    tplStart(chatId, messageId, dataModel, st, Long.parseLong(data.substring(10)));
                } else if (data.startsWith("tpl:rep_")) {
                    tplRepeat(chatId, messageId, dataModel, st, Long.parseLong(data.substring(8)));
                } else if (data.startsWith("tpl:delok_")) {
                    tplDelete(chatId, messageId, dataModel, st, Long.parseLong(data.substring(10)));
                } else if (data.startsWith("tpl:del_")) {
                    tplDelAsk(chatId, messageId, dataModel, st, Long.parseLong(data.substring(8)));
                } else {
                    showMenu(chatId, messageId, dataModel, st);
                }
            }
        }
    }

    private void showMenu(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        st.pendingTplId = 0;
        st.pendingRepWid = 0;
        StringBuilder b = new StringBuilder("💪 Мой дневник тренировок\n\n");
        b.append("Завершённых тренировок: ").append(countFinished(data));
        Workout active = data.active();
        if (active != null) {
            b.append("\n⚠️ Есть незавершённая тренировка от ").append(fmtDate(active.date));
        }
        if (webAppUrl != null) {
            b.append("\n\n📱 Все возможности — в приложении: кнопка «🏋️ Открыть приложение» внизу или ☰ у поля ввода");
        }
        /* [ONB-T2] ссылка на политику данных в приветствии */
        b.append("\n\n📜 Политика данных: ").append(PRIVACY_URL);
        b.append("\n\nВыбери действие 👇");
        if (mid == null && webAppUrl != null) {
            api.sendMessageWithKeyboard(chatId, b.toString(), TelegramApi.appKeyboard(webAppUrl));
        } else {
            send(chatId, mid, b.toString(), mainKb());
        }
    }

    private List<List<Map<String, Object>>> mainKb() {
        List<List<Map<String, Object>>> kb = new ArrayList<>(List.of(
            List.of(TelegramApi.button("🏋️ Начать тренировку", "menu:start")),
            List.of(TelegramApi.button("👀 Посмотреть тренировку", "menu:view")),
            List.of(
                TelegramApi.button("📜 История", "menu:hist"),
                TelegramApi.button("📊 Статистика", "menu:stats")
            ),
            List.of(TelegramApi.button("📋 Шаблоны", "menu:tpl")),
            List.of(TelegramApi.button("⚙️ Профиль", "pr"))
        ));
        if (appLink != null) {
            kb.add(1, List.of(TelegramApi.urlButton("📱 Открыть приложение", appLink)));
        }
        return kb;
    }

    private void openWorkout(long chatId, Long mid, GymData data, UserState st) {
        Workout active = data.active();
        if (active != null && st.mode != UserState.Mode.WORKOUT) {
            List<List<Map<String, Object>>> kb = List.of(
                List.of(TelegramApi.button("▶️ Продолжить", "wk:resume")),
                List.of(TelegramApi.button("🗑 Удалить и начать новую", "wk:discard")),
                List.of(TelegramApi.button("🏠 Меню", "home"))
            );
            send(chatId, mid, "У тебя есть незавершённая тренировка от " + fmtDate(active.date) + ". Что делаем?", kb);
            return;
        }
        if (active == null) {
            active = new Workout();
            active.id = data.nextId++;
            active.date = LocalDate.now().toString();
            active.startedAt = LocalDateTime.now().toString();
            data.workouts.add(active);
            storage.save(chatId, data);
        }
        st.editWorkoutId = 0;
        st.editing = false;
        renderWorkoutScreen(chatId, mid, data, st, active.id);
    }

    private void showWorkout(long chatId, Long mid, GymData data, UserState st) {
        Workout w = data.active();
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        renderWorkoutScreen(chatId, mid, data, st, w.id);
    }

    private void renderWorkoutScreen(long chatId, Long mid, GymData data, UserState st, long id) {
        renderWorkoutScreen(chatId, mid, data, st, id, null);
    }

    /* header — разовая шапка поверх текста экрана (шаблон применён / повторяем), только при первом рендере */
    private void renderWorkoutScreen(long chatId, Long mid, GymData data, UserState st, long id, String header) {
        Workout w = id > 0 ? data.findById(id) : data.active();
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        List<List<Map<String, Object>>> kb;
        if (w.finished) {
            kb = List.of(
                List.of(TelegramApi.button("✏️ Редактировать", "ed_" + w.id), TelegramApi.button("🥤 Питание", "nu_" + w.id)),
                List.of(TelegramApi.button("⏱ Время", "tm_" + w.id), TelegramApi.button("🏷 Название", "ti_" + w.id)),
                List.of(TelegramApi.button("📈 Прогресс", "pg_" + w.id), TelegramApi.button("🔥 Ккал", "kc_" + w.id)),
                List.of(TelegramApi.button("🔁 Повторить", "tpl:rep_" + w.id), TelegramApi.button("💾 В шаблоны", "tpl:new_" + w.id)),
                List.of(TelegramApi.button("🗑 Удалить", "hist:d_" + w.id)),
                List.of(TelegramApi.button("↩️ К истории", "hist:back"), TelegramApi.button("🏠 Меню", "home"))
            );
            st.mode = UserState.Mode.MENU;
        } else {
            kb = List.of(
                List.of(TelegramApi.button("➕ Добавить упражнение", "wk:add")),
                List.of(TelegramApi.button("✏️ Редактировать", "ed_" + w.id), TelegramApi.button("🥤 Питание", "nu_" + w.id)),
                List.of(TelegramApi.button("⏱ Время", "tm_" + w.id), TelegramApi.button("🏷 Название", "ti_" + w.id)),
                List.of(TelegramApi.button("📈 Прогресс", "pg_" + w.id), TelegramApi.button("🔥 Ккал", "kc_" + w.id)),
                List.of(TelegramApi.button("✅ Завершить", "wk:finish"), TelegramApi.button("❌ Отменить", "wk:cancel"))
            );
            st.mode = UserState.Mode.WORKOUT;
        }
        st.currentExercise = null;
        send(chatId, mid, (header == null ? "" : header) + screenText(w), kb);
    }

    private void backToWorkoutScreen(long chatId, Long mid, GymData data, UserState st) {
        long id = st.editWorkoutId;
        if (id <= 0) {
            Workout a = data.active();
            id = a == null ? 0 : a.id;
        }
        renderWorkoutScreen(chatId, mid, data, st, id);
    }

    private void showCatalog(long chatId, Long mid, UserState st) {
        st.mode = UserState.Mode.WORKOUT;
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        for (int i = 0; i < Exercises.CATALOG.length; i++) {
            rows.add(List.of(TelegramApi.button(Exercises.CATALOG[i], "ex:i_" + i)));
        }
        rows.add(List.of(TelegramApi.button("↩️ К тренировке", "ex:back")));
        send(chatId, mid, "Выбери упражнение:", rows);
    }

    private void pickExercise(long chatId, Long mid, GymData data, UserState st, String name) {
        Workout w = resolveWorkout(data, st);
        if (w == null || name == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        /* [UX-B6] завершённая тренировка — только просмотр: вежливый отказ вместо добавления */
        if (w.finished) {
            send(chatId, mid, "Тренировка завершена — доступен просмотр, «Повторить» и «В шаблоны».",
                List.of(List.of(TelegramApi.button("↩️ К тренировке", "scr_" + w.id))));
            return;
        }
        ExerciseEntry e = findExercise(w, name);
        boolean isNew = e == null;
        if (isNew) {
            e = new ExerciseEntry(name);
            w.exercises.add(e);
        }
        if (e.startedAt == null) e.startedAt = LocalDateTime.now().toString();
        st.currentExercise = name;
        st.editing = false;
        st.sugWeights = lastWeights(data, name);
        st.sugPop = popularWeight(data, name);
        /* [UX-E5] план из шаблона/повтора — пока у упражнения в этой тренировке нет записей */
        st.sugPlan = (e.sets.isEmpty() && e.planS >= 1) ? planOf(e) : null;
        st.pendingWeight = "";
        st.mode = UserState.Mode.EX_WEIGHT;
        storage.save(chatId, data);
        String head = isNew ? "«" + esc(name) + "» добавлено.\n\n" : "";
        send(chatId, mid, head + weightPromptText(st), weightKb(st, "ex:back"));
    }

    /* [UX-E5] план записи → TemplateExercise (переиспользуем класс для подсказки вес-шага) */
    private static TemplateExercise planOf(ExerciseEntry e) {
        TemplateExercise te = new TemplateExercise();
        te.name = e.name;
        te.w = e.planW;
        te.s = e.planS;
        te.r = e.planR;
        return te;
    }

    /* ядро подсказки плана [UX-E5 §5.1]: «60 кг, 3 по 10» / «без веса, 3 по 10» / «60 кг × 3» (без повторений) */
    public static String planCore(TemplateExercise te) {
        String w = te.w == null || te.w.isEmpty() ? "без веса" : te.w.replace('.', ',') + " кг";
        if (te.r == null || te.r.isEmpty()) return w + " × " + te.s;
        return w + ", " + te.s + " по " + te.r;
    }

    private static String weightPromptText(UserState st) {
        StringBuilder b = new StringBuilder("Введи вес (кг) или выбери:");
        /* [UX-E5] строка плана — первой; в редактировании записи плана нет */
        if (st.sugPlan != null && !st.editing) {
            b.append("\n📋 По плану: ").append(esc(planCore(st.sugPlan)));
        }
        if (!st.sugWeights.isEmpty()) {
            b.append("\nПрошлый раз: ").append(String.join("кг, ", st.sugWeights)).append("кг");
        }
        if (st.sugPop != null) {
            b.append("\nПопулярный: ").append(st.sugPop).append("кг");
        }
        return b.toString();
    }

    private List<List<Map<String, Object>>> weightKb(UserState st, String backData) {
        List<List<Map<String, Object>>> kb = new ArrayList<>();
        /* [UX-E5] кнопка мгновенной записи блока по плану — первым рядом; блок без повторений
           невалиден, кнопки для него нет; в редактировании план-ряда не бывает */
        if (!st.editing && st.sugPlan != null && !st.sugPlan.r.isEmpty()) {
            kb.add(List.of(TelegramApi.button("📋 " + planCore(st.sugPlan), "w:plan")));
        }
        List<Map<String, Object>> row = new ArrayList<>();
        for (int i = 0; i < st.sugWeights.size(); i++) {
            row.add(TelegramApi.button(st.sugWeights.get(i) + "кг", "w:l_" + i));
            if (row.size() == 2) {
                kb.add(row);
                row = new ArrayList<>();
            }
        }
        if (st.sugPop != null && !st.sugWeights.contains(st.sugPop)) {
            row.add(TelegramApi.button(st.sugPop + "кг ★", "w:p"));
        }
        if (!row.isEmpty()) kb.add(row);
        kb.add(List.of(TelegramApi.button("🚫 Без веса", "w:none")));
        kb.add(List.of(TelegramApi.button("↩️ Назад", backData)));
        return kb;
    }

    private void handleWeightInput(long chatId, Long mid, GymData data, UserState st, String text) {
        String low = text.toLowerCase();
        if (low.equals("готово") || low.equals("done")) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        if (st.editing) {
            Workout w = resolveWorkout(data, st);
            ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
            if (e == null || st.editIdx >= e.sets.size()) {
                backToWorkoutScreen(chatId, mid, data, st);
                return;
            }
            SetEntry old = e.sets.get(st.editIdx);
            SetEntry quick = parseLine(text);
            if (quick != null) {
                e.sets.set(st.editIdx, new SetEntry(quick.weight, quick.sets, quick.reps, old.t));
                storage.save(chatId, data);
                showEditField(chatId, mid, data, st);
                return;
            }
            String t = normalizeWeight(text);
            if (t.length() > 25 || !WEIGHT_PATTERN.matcher(t).matches() || !NUM_PATTERN.matcher(t).find()) {
                send(chatId, mid, "Не понял вес 🤔 Введи в кг, например: 45", weightEditKb(st));
                return;
            }
            e.sets.set(st.editIdx, new SetEntry(t, old.sets, old.reps, old.t));
            storage.save(chatId, data);
            showEditField(chatId, mid, data, st);
            return;
        }

        Workout w = data.active();
        ExerciseEntry e = w == null ? null : findExercise(w, st.currentExercise);
        if (e == null) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        if (text.contains(" по ")) {
            SetEntry quick = parseLine(text);
            if (quick != null) {
                confirmEntry(chatId, mid, data, st, quick);
                return;
            }
        }
        String t = normalizeWeight(text);
        if (t.isEmpty() || t.length() > 25 || !WEIGHT_PATTERN.matcher(t).matches() || !NUM_PATTERN.matcher(t).find()) {
            send(chatId, mid, "Не понял вес 🤔 Введи в кг, например: 45\nИли одной строкой: 45кг, 4 по 12", weightKb(st, "ex:back"));
            return;
        }
        st.pendingWeight = t;
        goSets(chatId, mid);
    }

    private List<List<Map<String, Object>>> weightEditKb(UserState st) {
        return weightKb(st, "ef:menu");
    }

    private void goSets(long chatId, Long mid) {
        UserState st = states.computeIfAbsent(chatId, k -> new UserState());
        st.mode = UserState.Mode.EX_SETS;
        String wtxt = st.pendingWeight.isEmpty() ? "Запись без веса" : "Вес: " + st.pendingWeight + "кг";
        send(chatId, mid, wtxt + "\nСколько подходов? Введи число (например 4)", setsKb());
    }

    private List<List<Map<String, Object>>> setsKb() {
        return List.of(
            List.of(TelegramApi.button("↩️ Назад", "w:back")),
            List.of(TelegramApi.button("↩️ К тренировке", "ex:back"))
        );
    }

    private void handleSetsInput(long chatId, Long mid, GymData data, UserState st, String text) {
        String low = text.toLowerCase();
        if (low.equals("готово") || low.equals("done")) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        int sets;
        try {
            sets = Integer.parseInt(text.trim());
        } catch (NumberFormatException ex) {
            send(chatId, mid, "Введи число подходов, например: 4", setsKb());
            return;
        }
        if (sets < 1 || sets > 30) {
            send(chatId, mid, "Число подходов от 1 до 30 🤔", setsKb());
            return;
        }
        if (st.editing) {
            Workout w = resolveWorkout(data, st);
            ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
            if (e != null && st.editIdx < e.sets.size()) {
                SetEntry old = e.sets.get(st.editIdx);
                e.sets.set(st.editIdx, new SetEntry(old.weight, sets, old.reps, old.t));
                storage.save(chatId, data);
            }
            showEditField(chatId, mid, data, st);
            return;
        }
        st.pendingSets = sets;
        goReps(chatId, mid, data, st);
    }

    private void goReps(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.EX_REPS;
        st.sugReps = lastReps(data, st.currentExercise);
        StringBuilder b = new StringBuilder(st.pendingWeight.isEmpty() ? "Без веса" : "Вес: " + st.pendingWeight + "кг");
        b.append(", подходов: ").append(st.pendingSets);
        b.append("\nСколько повторений?");
        if (!st.sugReps.isEmpty()) {
            b.append("\nПрошлый раз: ").append(String.join(", ", st.sugReps));
        } else {
            b.append("\nНапример: 12, 8-10");
        }
        send(chatId, mid, b.toString(), repsKb(st));
    }

    private List<List<Map<String, Object>>> repsKb(UserState st) {
        List<List<Map<String, Object>>> kb = new ArrayList<>();
        if (!st.sugReps.isEmpty()) {
            List<Map<String, Object>> row = new ArrayList<>();
            for (int i = 0; i < st.sugReps.size(); i++) {
                row.add(TelegramApi.button(st.sugReps.get(i), "r:l_" + i));
                if (row.size() == 3) {
                    kb.add(row);
                    row = new ArrayList<>();
                }
            }
            if (!row.isEmpty()) kb.add(row);
        }
        kb.add(List.of(TelegramApi.button("↩️ Назад", "s:back")));
        kb.add(List.of(TelegramApi.button("↩️ К тренировке", "ex:back")));
        return kb;
    }

    private void handleRepsInput(long chatId, Long mid, GymData data, UserState st, String text) {
        String low = text.toLowerCase();
        if (low.equals("готово") || low.equals("done")) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        String reps = text.trim();
        if (reps.isEmpty() || reps.length() > 15) {
            send(chatId, mid, "Введи количество повторений, например: 12, 8-10", repsKb(st));
            return;
        }
        if (st.editing) {
            Workout w = resolveWorkout(data, st);
            ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
            if (e != null && st.editIdx < e.sets.size()) {
                SetEntry old = e.sets.get(st.editIdx);
                e.sets.set(st.editIdx, new SetEntry(old.weight, old.sets, reps, old.t));
                storage.save(chatId, data);
            }
            showEditField(chatId, mid, data, st);
            return;
        }
        confirmEntry(chatId, mid, data, st, new SetEntry(st.pendingWeight, st.pendingSets, reps));
    }

    private void confirmEntry(long chatId, Long mid, GymData data, UserState st, SetEntry block) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.currentExercise);
        if (e == null) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        if (block.t == null) block = new SetEntry(block.weight, block.sets, block.reps, LocalDateTime.now().toString());
        /* живой рекорд [UX-T2]: проверяем ДО добавления блока — база только из прошлых
           тренировок, а записанные блоки этой тренировки показывают, не праздновали ли уже */
        String pr = Records.congratulation(data, w, e.name, block);
        e.sets.add(block);
        storage.save(chatId, data);
        st.mode = UserState.Mode.WORKOUT;
        String msg = "✅ Записано: " + esc(renderLine(e.name, block));
        if (pr != null) msg += "\n" + esc(pr);
        send(chatId, mid, msg, entryDoneKb());
        /* таймер отдыха: запуск/перезапуск после каждого нового лога подхода [UX-T5] */
        restStart(chatId, data, e.name, block);
    }

    private List<List<Map<String, Object>>> entryDoneKb() {
        return List.of(
            List.of(TelegramApi.button("➕ Ещё запись", "w:again")),
            List.of(TelegramApi.button("✏️ Редактировать записи", "wk:editmode")),
            List.of(TelegramApi.button("🏁 Закончить упражнение", "set:done")),
            List.of(TelegramApi.button("↩️ К тренировке", "ex:back"))
        );
    }

    private void applyEditWeight(long chatId, Long mid, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e == null || st.editIdx >= e.sets.size()) {
            showEditField(chatId, mid, data, st);
            return;
        }
        SetEntry old = e.sets.get(st.editIdx);
        e.sets.set(st.editIdx, new SetEntry(st.pendingWeight, old.sets, old.reps));
        storage.save(chatId, data);
        showEditField(chatId, mid, data, st);
    }

    private void applyEditReps(long chatId, Long mid, GymData data, UserState st, String reps) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e == null || st.editIdx >= e.sets.size()) {
            showEditField(chatId, mid, data, st);
            return;
        }
        SetEntry old = e.sets.get(st.editIdx);
        e.sets.set(st.editIdx, new SetEntry(old.weight, old.sets, reps));
        storage.save(chatId, data);
        showEditField(chatId, mid, data, st);
    }

    private void showEditEx(long chatId, Long mid, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        st.mode = UserState.Mode.EDIT_EX;
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        int idx = 0;
        for (ExerciseEntry e : w.exercises) {
            if (e.sets.isEmpty()) continue;
            List<Map<String, Object>> row = new ArrayList<>();
            row.add(TelegramApi.button(e.name + " (" + e.sets.size() + ")", "exq_" + idx));
            rows.add(row);
            idx++;
        }
        rows.add(List.of(TelegramApi.button("✅ Готово", "ed:done")));
        send(chatId, mid, "✏️ Редактирование\nВыбери упражнение:", rows);
    }

    private void showEditEntryByIdx(long chatId, Long mid, GymData data, UserState st, int idx) {
        Workout w = resolveWorkout(data, st);
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        List<ExerciseEntry> list = editableExercises(w);
        if (idx < 0 || idx >= list.size()) {
            showEditEx(chatId, mid, data, st);
            return;
        }
        st.editName = list.get(idx).name;
        showEditEntry(chatId, mid, data, st);
    }

    private void showEditEntry(long chatId, Long mid, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e == null || e.sets.isEmpty()) {
            showEditEx(chatId, mid, data, st);
            return;
        }
        st.mode = UserState.Mode.EDIT_ENTRY;
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        for (int i = 0; i < e.sets.size(); i++) {
            rows.add(List.of(TelegramApi.button(renderLine(e.name, e.sets.get(i)), "enq_" + i)));
        }
        /* [UX-B6] у завершённой тренировки добавления записей нет — только просмотр и правка */
        if (!w.finished) rows.add(List.of(TelegramApi.button("➕ Добавить запись", "en:add")));
        rows.add(List.of(TelegramApi.button("↩️ К упражнениям", "exq:back"), TelegramApi.button("✅ Готово", "ed:done")));
        send(chatId, mid, "«" + esc(e.name) + "» — выбери запись:", rows);
    }

    private void showEditField(long chatId, Long mid, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e == null || st.editIdx >= e.sets.size()) {
            showEditEntry(chatId, mid, data, st);
            return;
        }
        st.mode = UserState.Mode.EDIT_FIELD;
        st.editing = false;
        SetEntry s = e.sets.get(st.editIdx);
        List<List<Map<String, Object>>> kb = List.of(
            List.of(TelegramApi.button("⚖️ Вес", "ef:w"), TelegramApi.button("🔢 Подходы", "ef:s")),
            List.of(TelegramApi.button("🔁 Повторения", "ef:r"), TelegramApi.button("🏷 Имя упражнения", "ef:n")),
            List.of(TelegramApi.button("🗑 Удалить запись", "ef:del")),
            List.of(TelegramApi.button("↩️ К записям", "en:back"), TelegramApi.button("✅ Готово", "ed:done"))
        );
        send(chatId, mid, "✏️ " + esc(renderLine(e.name, s)) + "\n\nЧто изменить?", kb);
    }

    private void startEditField(long chatId, Long mid, GymData data, UserState st, String field) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e == null || st.editIdx >= e.sets.size()) {
            showEditEntry(chatId, mid, data, st);
            return;
        }
        SetEntry s = e.sets.get(st.editIdx);
        st.editing = true;
        switch (field) {
            case "w" -> {
                st.mode = UserState.Mode.EX_WEIGHT;
                st.sugWeights = lastWeights(data, e.name);
                st.sugPop = popularWeight(data, e.name);
                send(chatId, mid, "Текущий вес: " + (s.weight.isEmpty() ? "без веса" : s.weight + "кг")
                    + "\n\n" + weightPromptText(st), weightEditKb(st));
            }
            case "s" -> {
                st.mode = UserState.Mode.EX_SETS;
                send(chatId, mid, "Текущее количество подходов: " + s.sets
                    + "\nВведи новое число (1–30):", editBackKb());
            }
            default -> {
                st.mode = UserState.Mode.EX_REPS;
                st.sugReps = lastReps(data, e.name);
                StringBuilder b = new StringBuilder("Текущие повторения: ").append(s.reps).append("\nВведи новые (например 12, 8-10)");
                if (!st.sugReps.isEmpty()) b.append("\nПрошлый раз: ").append(String.join(", ", st.sugReps));
                List<List<Map<String, Object>>> kb = new ArrayList<>();
                if (!st.sugReps.isEmpty()) {
                    List<Map<String, Object>> row = new ArrayList<>();
                    for (int i = 0; i < st.sugReps.size(); i++) {
                        row.add(TelegramApi.button(st.sugReps.get(i), "r:l_" + i));
                        if (row.size() == 3) {
                            kb.add(row);
                            row = new ArrayList<>();
                        }
                    }
                    if (!row.isEmpty()) kb.add(row);
                }
                kb.add(List.of(TelegramApi.button("↩️ Назад", "ef:menu")));
                send(chatId, mid, b.toString(), kb);
            }
        }
    }

    private List<List<Map<String, Object>>> editBackKb() {
        return List.of(List.of(TelegramApi.button("↩️ Назад", "ef:menu")));
    }

    private List<List<Map<String, Object>>> renameKb() {
        return List.of(List.of(TelegramApi.button("↩️ Назад", "en:back")));
    }

    private void handleRenameInput(long chatId, Long mid, GymData data, UserState st, String text) {
        if (text.equalsIgnoreCase("отмена")) {
            showEditEntry(chatId, mid, data, st);
            return;
        }
        if (text.isEmpty() || text.length() > 60) {
            send(chatId, mid, "Название от 1 до 60 символов 🤔", renameKb());
            return;
        }
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e != null) {
            ExerciseEntry existing = findExercise(w, text);
            if (existing != null && existing != e) {
                existing.sets.addAll(e.sets);
                w.exercises.remove(e);
            } else {
                e.name = text;
            }
            storage.save(chatId, data);
        }
        st.editName = text;
        st.currentExercise = text;
        showEditEntry(chatId, mid, data, st);
    }

    private void deleteEntry(long chatId, Long mid, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.editName);
        if (e != null && st.editIdx < e.sets.size()) {
            e.sets.remove(st.editIdx);
            if (e.sets.isEmpty()) {
                w.exercises.remove(e);
                st.editName = null;
                storage.save(chatId, data);
                showEditEx(chatId, mid, data, st);
                return;
            }
            storage.save(chatId, data);
            if (st.editIdx >= e.sets.size()) st.editIdx = e.sets.size() - 1;
        }
        showEditEntry(chatId, mid, data, st);
    }

    private void handleTitleInput(long chatId, Long mid, GymData data, UserState st, String text) {
        Workout w = resolveWorkout(data, st);
        if (w == null) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        if (text.equalsIgnoreCase("авто")) {
            w.title = null;
        } else if (text.isEmpty() || text.length() > 200) {
            send(chatId, mid, "Название от 1 до 200 символов 🤔", titleKb(st.editWorkoutId));
            return;
        } else {
            w.title = text;
        }
        storage.save(chatId, data);
        backToWorkoutScreen(chatId, mid, data, st);
    }

    private List<List<Map<String, Object>>> titleKb(long id) {
        return List.of(
            List.of(TelegramApi.button("↺ Авто", "ti:auto")),
            List.of(TelegramApi.button("↩️ Назад", "scr_" + id))
        );
    }

    private void handleNutrInput(long chatId, Long mid, GymData data, UserState st, String text) {
        Workout w = resolveWorkout(data, st);
        if (w == null) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        if (text.isEmpty() || text.length() > 500) {
            send(chatId, mid, "Текст от 1 до 500 символов 🤔", nutrKb(st.editWorkoutId));
            return;
        }
        w.nutrition = text;
        storage.save(chatId, data);
        backToWorkoutScreen(chatId, mid, data, st);
    }

    private List<List<Map<String, Object>>> nutrKb(long id) {
        return List.of(
            List.of(TelegramApi.button("🚫 Очистить", "nu:clear")),
            List.of(TelegramApi.button("↩️ Назад", "scr_" + id))
        );
    }

    private void handleTimeInput(long chatId, Long mid, GymData data, UserState st, String text) {
        Workout w = resolveWorkout(data, st);
        if (w == null) {
            backToWorkoutScreen(chatId, mid, data, st);
            return;
        }
        Matcher m = TIME_PATTERN.matcher(text.trim());
        if (!m.matches()) {
            send(chatId, mid, "Введи время в формате ЧЧ:ММ, например 17:30", timeKb(st.editWorkoutId));
            return;
        }
        int h = Integer.parseInt(m.group(1));
        int min = Integer.parseInt(m.group(2));
        if (h > 23 || min > 59) {
            send(chatId, mid, "Некорректное время 🤔 Например: 17:30", timeKb(st.editWorkoutId));
            return;
        }
        LocalDate d = parseDate(w.date);
        if (d == null) d = LocalDate.now();
        LocalDateTime dt = LocalDateTime.of(d, LocalTime.of(h, min));
        w.startedAt = dt.toString();
        w.date = dt.toLocalDate().toString();
        storage.save(chatId, data);
        backToWorkoutScreen(chatId, mid, data, st);
    }

    private List<List<Map<String, Object>>> timeKb(long id) {
        return List.of(List.of(TelegramApi.button("↩️ Назад", "scr_" + id)));
    }

    private void startProfile(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.PROFILE;
        StringBuilder b = new StringBuilder("⚙️ Профиль\n\n");
        if (data.profile != null) {
            b.append(profileSummary(data.profile)).append("\n\n");
        } else {
            b.append("Нужен для расчёта калорий 🔥\n\n");
        }
        b.append("Введи одной строкой: пол возраст рост вес\nНапример: м 30 180 82");
        send(chatId, mid, b.toString(), List.of(List.of(TelegramApi.button("🏠 Меню", "home"))));
    }

    private void handleProfileInput(long chatId, Long mid, GymData data, UserState st, String text) {
        String[] parts = text.trim().split("[\\s,;]+");
        if (parts.length != 4) {
            send(chatId, mid, "Нужно 4 значения: пол возраст рост вес\nНапример: м 30 180 82", List.of(List.of(TelegramApi.button("🏠 Меню", "home"))));
            return;
        }
        String sex = parts[0].toLowerCase();
        if (!sex.equals("м") && !sex.equals("ж") && !sex.equals("m") && !sex.equals("f")) {
            send(chatId, mid, "Пол: м или ж\nНапример: м 30 180 82", List.of(List.of(TelegramApi.button("🏠 Меню", "home"))));
            return;
        }
        try {
            ProfileData p = new ProfileData();
            p.sex = sex.equals("ж") || sex.equals("f") ? "ж" : "м";
            p.age = Integer.parseInt(parts[1]);
            p.height = Integer.parseInt(parts[2]);
            p.weight = Double.parseDouble(parts[3].replace(',', '.'));
            if (p.age < 10 || p.age > 100 || p.height < 100 || p.height > 250 || p.weight < 30 || p.weight > 300) {
                send(chatId, mid, "Проверь значения: возраст 10–100, рост 100–250 см, вес 30–300 кг", List.of(List.of(TelegramApi.button("🏠 Меню", "home"))));
                return;
            }
            data.profile = p;
            storage.save(chatId, data);
            send(chatId, mid, "✅ Профиль сохранён\n\n" + profileSummary(p), mainKb());
            st.mode = UserState.Mode.MENU;
        } catch (NumberFormatException e) {
            send(chatId, mid, "Не понял числа 🤔 Формат: пол возраст рост вес\nНапример: м 30 180 82", List.of(List.of(TelegramApi.button("🏠 Меню", "home"))));
        }
    }

    private String profileSummary(ProfileData p) {
        return "Пол: " + p.sex.toUpperCase() + " · Возраст: " + p.age + " · Рост: " + p.height
            + " см · Вес: " + fmtW(p.weight) + " кг"
            + "\nBMR ≈ " + Math.round(bmr(p)) + " ккал/сут (Mifflin-St Jeor)";
    }

    private void finishWorkout(long chatId, Long mid, GymData data, UserState st) {
        Workout w = data.active();
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        w.exercises.removeIf(e -> e.sets.isEmpty());
        if (w.exercises.isEmpty()) {
            send(chatId, mid, "Сначала добавь хотя бы одно упражнение 💪", workoutKb(w.id));
            return;
        }
        for (ExerciseEntry e : w.exercises) {
            if (e.startedAt != null && e.endedAt == null) e.endedAt = LocalDateTime.now().toString();
        }
        w.finished = true;
        w.endedAt = LocalDateTime.now().toString();
        storage.save(chatId, data);
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        send(chatId, mid, "🎉 Тренировка завершена!\n\n" + screenText(w), finishedKb(w.id));
    }

    /* клавиатура после завершения: первым рядом — сохранить как шаблон [UX-T6 §4.3] */
    private List<List<Map<String, Object>>> finishedKb(long wid) {
        List<List<Map<String, Object>>> kb = new ArrayList<>(mainKb());
        kb.add(0, List.of(TelegramApi.button("💾 Сохранить как шаблон", "tpl:new_" + wid)));
        return kb;
    }

    private List<List<Map<String, Object>>> workoutKb(long id) {
        return List.of(
            List.of(TelegramApi.button("➕ Добавить упражнение", "wk:add")),
            List.of(
                TelegramApi.button("✅ Завершить", "wk:finish"),
                TelegramApi.button("❌ Отменить", "wk:cancel")
            )
        );
    }

    private void confirmCancel(long chatId, Long mid, GymData data) {
        Workout w = data.active();
        if (w == null) {
            showMenu(chatId, mid, data, states.computeIfAbsent(chatId, k -> new UserState()));
            return;
        }
        List<List<Map<String, Object>>> kb = List.of(
            List.of(
                TelegramApi.button("🗑 Да, удалить", "wk:cancelok"),
                TelegramApi.button("↩️ Нет, продолжить", "wk:cancelno")
            )
        );
        send(chatId, mid, "Удалить тренировку от " + fmtDate(w.date) + "? Все записи пропадут.", kb);
    }

    private void viewWorkout(long chatId, Long mid, GymData data, UserState st) {
        st.currentExercise = null;
        String today = LocalDate.now().toString();
        Workout target = null;
        Workout active = data.active();
        if (active != null && today.equals(active.date)) target = active;
        if (target == null) {
            for (Workout w : data.workouts) {
                if (today.equals(w.date) && w.finished) target = w;
            }
        }
        if (target == null && !data.workouts.isEmpty()) {
            target = data.workouts.get(data.workouts.size() - 1);
        }
        if (target == null) {
            send(chatId, mid, "Пока нет тренировок 💪", mainKb());
            return;
        }
        renderWorkoutScreen(chatId, mid, data, st, target.id);
    }

    private void showHistory(long chatId, Long mid, GymData data, UserState st, int page) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        List<Workout> fin = new ArrayList<>();
        for (Workout w : data.workouts) {
            if (w.finished) fin.add(w);
        }
        if (fin.isEmpty()) {
            send(chatId, mid, "Пока нет завершённых тренировок 💪", mainKb());
            return;
        }
        Collections.reverse(fin);
        int perPage = 6;
        int pages = (fin.size() + perPage - 1) / perPage;
        page = Math.min(Math.max(page, 0), pages - 1);
        st.histPage = page;

        StringBuilder b = new StringBuilder("📜 История тренировок (").append(fin.size()).append(")\n\n");
        List<List<Map<String, Object>>> kb = new ArrayList<>();
        List<Map<String, Object>> row = new ArrayList<>();
        int from = page * perPage;
        for (int i = from; i < Math.min(from + perPage, fin.size()); i++) {
            Workout w = fin.get(i);
            int records = 0;
            for (ExerciseEntry e : w.exercises) records += e.sets.size();
            b.append(esc(firstLineText(w)))
                .append(" — ").append(w.exercises.size()).append(" упр., ")
                .append(records).append(" зап.\n");
            row.add(TelegramApi.button("📅 " + firstLineText(w), "hist:v_" + w.id));
            if (row.size() == 2) {
                kb.add(row);
                row = new ArrayList<>();
            }
        }
        if (!row.isEmpty()) kb.add(row);
        List<Map<String, Object>> nav = new ArrayList<>();
        if (page > 0) nav.add(TelegramApi.button("◀️", "hist:p_" + (page - 1)));
        if (page < pages - 1) nav.add(TelegramApi.button("▶️", "hist:p_" + (page + 1)));
        if (!nav.isEmpty()) kb.add(nav);
        kb.add(List.of(TelegramApi.button("🏠 Меню", "home")));
        send(chatId, mid, b.toString(), kb);
    }

    private void confirmDelete(long chatId, Long mid, GymData data, UserState st, long id) {
        Workout w = data.findById(id);
        if (w == null) {
            showHistory(chatId, mid, data, st, 0);
            return;
        }
        List<List<Map<String, Object>>> kb = List.of(
            List.of(
                TelegramApi.button("🗑 Да, удалить", "hist:dok_" + id),
                TelegramApi.button("↩️ Нет", "hist:back")
            )
        );
        send(chatId, mid, "Удалить тренировку " + esc(firstLineText(w)) + "? Действие необратимо.", kb);
    }

    private void deleteWorkout(long chatId, Long mid, GymData data, UserState st, long id) {
        Workout w = data.findById(id);
        if (w != null) {
            data.workouts.remove(w);
            storage.save(chatId, data);
        }
        showHistory(chatId, mid, data, st, 0);
    }

    /* /export — выгрузка дневника CSV-файлом в чат.
       Выгружаются только ЗАВЕРШЁННЫЕ тренировки (как в /history и /stats): у незавершённой
       ещё нет финального набора записей, дублировать её в файл и отдельным файлом не считаю
       нужным — пользователь может завершить тренировку и выгрузить снова.
       Приватность: имя пользователя и id чата в файл не попадают, только данные тренировок. */
    private void exportCsv(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        List<Workout> fin = new ArrayList<>();
        for (Workout w : data.workouts) {
            if (w.finished) fin.add(w);
        }
        if (fin.isEmpty()) {
            send(chatId, mid, "Пока нет завершённых тренировок — выгружать нечего 💪\nЗаверши первую тренировку и попробуй снова.", mainKb());
            return;
        }
        StringBuilder csv = new StringBuilder("Дата;Название тренировки;Упражнение;Подходы\r\n");
        int rows = 0;
        for (Workout w : fin) {
            String title = csvTitle(w);
            for (ExerciseEntry e : w.exercises) {
                if (e.sets.isEmpty()) continue;
                csv.append(csvField(fmtDate(w.date))).append(';')
                    .append(csvField(title)).append(';')
                    .append(csvField(e.name)).append(';')
                    .append(csvField(csvSets(e))).append("\r\n");
                rows++;
            }
        }
        /* UTF-8 BOM: без него Excel на русской Windows открывает файл как cp1251 — кириллица в кракозябрах */
        byte[] text = csv.toString().getBytes(StandardCharsets.UTF_8);
        byte[] body = new byte[3 + text.length];
        body[0] = (byte) 0xEF;
        body[1] = (byte) 0xBB;
        body[2] = (byte) 0xBF;
        System.arraycopy(text, 0, body, 3, text.length);
        String filename = "gymhelper_export_" + LocalDate.now() + ".csv";
        String caption = "🏋️ Выгрузка дневника: " + fin.size() + " " + plural(fin.size(), "тренировка", "тренировки", "тренировок")
            + ", " + rows + " " + plural(rows, "запись", "записи", "записей") + ".";
        try {
            api.sendDocument(chatId, filename, body, caption);
        } catch (Exception e) {
            System.out.println("[warn] export: " + e.getMessage());
            send(chatId, mid, "Не получилось отправить файл 😕 Попробуй ещё раз.", mainKb());
        }
    }

    /* /rest — просмотр и установка длительности отдыха (общее GymData.restSec с Mini App); 0 = «выкл» [UX-T13] */
    private void showRest(long chatId, Long mid, GymData data, String text) {
        UserState st = states.computeIfAbsent(chatId, k -> new UserState());
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        String arg = text.length() > 6 ? text.substring(6).trim() : "";
        if (arg.isEmpty()) {
            int cur = data.restSec != null ? data.restSec : 90;
            if (cur == 0) {
                send(chatId, mid, "⏱ Таймер отдыха: выключен."
                    + "\nВключить: /rest 180 (от 30 до 600)."
                    + "\nПосле записи подхода отсчёт не запускается.", mainKb());
            } else {
                send(chatId, mid, "⏱ Длительность отдыха: " + cur + " сек."
                    + "\nИзменить: /rest 180 (от 30 до 600). Выключить: /rest 0."
                    + "\nТаймер запускается автоматически после записи подхода.", mainKb());
            }
            return;
        }
        int n;
        try {
            n = Integer.parseInt(arg);
        } catch (NumberFormatException e) {
            send(chatId, mid, "Число 0 (выкл) или от 30 до 600, например: /rest 180", mainKb());
            return;
        }
        if (n != 0 && (n < 30 || n > 600)) {
            send(chatId, mid, "Число 0 (выкл) или от 30 до 600, например: /rest 180", mainKb());
            return;
        }
        data.restSec = n;
        storage.save(chatId, data);
        if (n == 0) {
            restStop(chatId); /* идущий отсчёт останавливаем — таймер выключен [UX-T13] */
            send(chatId, mid, "⏱ Таймер отдыха выключен. Включить: /rest 180.", mainKb());
            return;
        }
        /* если отсчёт идёт — перезапуск на новую длительность одной правкой (§2.7) */
        RestSession s = rests.get(chatId);
        if (s != null && !s.stopped) {
            long now = System.currentTimeMillis();
            s.dur = n;
            s.end = now + n * 1000L;
            s.lastActivity = now;
            s.frozen = false;
            restEdit(chatId, s, restCountdownText(s.ex, n, n), restKb());
        }
        send(chatId, mid, "✅ Отдых: " + n + " сек.", mainKb());
    }

    /* ================= Шаблоны тренировок [UX-T6/T7] (спека §4) ================= */

    private static Template findTemplate(GymData data, long id) {
        for (Template t : data.templates) {
            if (t.id == id) return t;
        }
        return null;
    }

    /* /templates и «📋 Шаблоны»: список с запуском и удалением [§4.4], новые сверху */
    private void showTemplates(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        st.pendingTplId = 0;
        st.pendingRepWid = 0;
        if (data.templates.isEmpty()) {
            send(chatId, mid, "📋 Шаблонов пока нет.\n\nЗаверши тренировку и нажми «💾 Сохранить как шаблон» — "
                + "в следующий раз начнёшь с готового списка упражнений.", mainKb());
            return;
        }
        List<Template> tpls = new ArrayList<>(data.templates);
        tpls.sort((a, b) -> String.valueOf(b.createdAt).compareTo(String.valueOf(a.createdAt)));
        /* план под каждым шаблоном [UX-E5 §5.3]: нумерация = порядку кнопок (новые сверху) */
        StringBuilder b = new StringBuilder("📋 Шаблоны · ").append(tpls.size()).append(" из ").append(TPL_LIMIT).append("\n");
        int num = 1;
        for (Template t : tpls) {
            b.append("\n").append(num++).append(". ").append(esc(t.name)).append(" — ")
                .append(t.exercises.size()).append(" упр.");
            String plan = templatePlanLine(t);
            if (!plan.isEmpty()) b.append("\n   ").append(esc(plan));
        }
        b.append("\n\nТапни по названию, чтобы начать тренировку.");
        List<List<Map<String, Object>>> kb = new ArrayList<>();
        for (Template t : tpls) {
            kb.add(List.of(
                TelegramApi.button("▶️ " + t.name, "tpl:start_" + t.id),
                TelegramApi.button("🗑", "tpl:del_" + t.id)
            ));
        }
        kb.add(List.of(TelegramApi.button("↩️ Меню", "home")));
        send(chatId, mid, b.toString(), kb);
    }

    /* «💾 Сохранить как шаблон»: диалог имени [§4.3] */
    private void tplNew(long chatId, Long mid, GymData data, UserState st, long wid) {
        Workout w = data.findById(wid);
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        if (data.templates.size() >= TPL_LIMIT) {
            send(chatId, mid, "Лимит — " + TPL_LIMIT + " шаблонов. Удали лишний: /templates", mainKb());
            return;
        }
        if (templateFromWorkout(data, w).exercises.isEmpty()) {
            send(chatId, mid, "В этой тренировке нет записей — сохранять нечего 💪", mainKb());
            return;
        }
        st.editWorkoutId = wid;
        st.mode = UserState.Mode.TPL_NAME;
        send(chatId, mid, "💾 Сохраним тренировку как шаблон.\n\nНазвание (до 60 символов), например: Спина и бицепс",
            List.of(
                List.of(
                    TelegramApi.button("🔤 Авто-имя", "tpl:auto_" + wid),
                    TelegramApi.button("↩️ Отмена", "tpl:canc")
                )
            ));
    }

    /* ввод имени шаблона [§4.3]; дубликаты имён разрешены (различимы по составу) */
    private void handleTplNameInput(long chatId, Long mid, GymData data, UserState st, String text) {
        Workout w = data.findById(st.editWorkoutId);
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        String name = text.trim();
        if (name.isEmpty() || name.length() > 60) {
            send(chatId, mid, "Название от 1 до 60 символов 🤔", List.of(
                List.of(
                    TelegramApi.button("🔤 Авто-имя", "tpl:auto_" + w.id),
                    TelegramApi.button("↩️ Отмена", "tpl:canc")
                )
            ));
            return;
        }
        if (data.templates.size() >= TPL_LIMIT) {
            st.mode = UserState.Mode.MENU;
            send(chatId, mid, "Лимит — " + TPL_LIMIT + " шаблонов. Удали лишний: /templates", mainKb());
            return;
        }
        Template t = templateFromWorkout(data, w);
        if (t.exercises.isEmpty()) {
            st.mode = UserState.Mode.MENU;
            send(chatId, mid, "В этой тренировке нет записей — сохранять нечего 💪", mainKb());
            return;
        }
        t.name = name;
        tplSaved(chatId, mid, data, st, t);
    }

    /* «🔤 Авто-имя»: сохранить без ввода текста [§4.3] */
    private void tplAutoSave(long chatId, Long mid, GymData data, UserState st, long wid) {
        Workout w = data.findById(wid);
        if (w == null) {
            showMenu(chatId, mid, data, st);
            return;
        }
        if (data.templates.size() >= TPL_LIMIT) {
            st.mode = UserState.Mode.MENU;
            send(chatId, mid, "Лимит — " + TPL_LIMIT + " шаблонов. Удали лишний: /templates", mainKb());
            return;
        }
        Template t = templateFromWorkout(data, w);
        if (t.exercises.isEmpty()) {
            st.mode = UserState.Mode.MENU;
            send(chatId, mid, "В этой тренировке нет записей — сохранять нечего 💪", mainKb());
            return;
        }
        t.name = trimName(templateAutoName(w));
        tplSaved(chatId, mid, data, st, t);
    }

    private void tplSaved(long chatId, Long mid, GymData data, UserState st, Template t) {
        data.templates.add(t);
        storage.save(chatId, data);
        st.mode = UserState.Mode.MENU;
        send(chatId, mid, "✅ Шаблон «" + esc(t.name) + "» сохранён (" + data.templates.size() + " из " + TPL_LIMIT + ")."
            + "\n\nНачать из него: /templates или кнопка «📋 Шаблоны»."
            + "\nПри старте план последнего подхода подставится одним тапом.", mainKb());
    }

    /* авто-имя: своя первая строка названия → первые 2 упражнения через « · » → «Тренировка ДД-ММ» [§4.3] */
    static String templateAutoName(Workout w) {
        if (w.title != null && !w.title.isBlank()) return w.title.split("\n")[0].trim();
        StringBuilder b = new StringBuilder();
        int n = 0;
        for (ExerciseEntry e : w.exercises) {
            if (e.sets.isEmpty()) continue;
            if (n > 0) b.append(" · ");
            b.append(e.name);
            if (++n == 2) break;
        }
        if (n > 0) return b.toString();
        LocalDate d = parseDate(w.date);
        return "Тренировка " + (d == null ? "" : d.format(DDM));
    }

    static String trimName(String raw) {
        String n = raw == null ? "" : raw.trim();
        return n.length() > 60 ? n.substring(0, 60).trim() : n;
    }

    /* снимок тренировки → шаблон: упражнения с записями по порядку, план = последний блок [§4.2] */
    private static Template templateFromWorkout(GymData data, Workout w) {
        Template t = new Template();
        long maxId = 0;
        for (Template x : data.templates) maxId = Math.max(maxId, x.id);
        t.id = maxId + 1;
        t.createdAt = LocalDateTime.now().toString();
        for (ExerciseEntry e : w.exercises) {
            if (e.sets.isEmpty() || t.exercises.size() >= TPL_EX_LIMIT) continue;
            TemplateExercise te = new TemplateExercise();
            te.name = e.name;
            SetEntry last = e.sets.get(e.sets.size() - 1);
            te.w = last.weight;
            te.s = last.sets;
            te.r = last.reps;
            t.exercises.add(te);
        }
        return t;
    }

    /* строка плана шаблона [UX-E5 §5.3]: первые 3 упражнения + «+N», имя > 16 симв. клипается;
       пустая, если ни у одного упражнения нет осмысленного плана (рукотворный JSON) */
    static String templatePlanLine(Template t) {
        StringBuilder b = new StringBuilder();
        int n = 0;
        for (TemplateExercise te : t.exercises) {
            if (n < 3 && hasPlan(te)) {
                if (b.length() > 0) b.append(" · ");
                b.append(shortName(te.name)).append(" ").append(compactPlan(te));
            }
            n++;
        }
        if (b.length() == 0) return "";
        if (n > 3) b.append(" · +").append(n - 3);
        return b.toString();
    }

    /* план осмысленный: есть вес, повторения или больше одного подхода (голое имя планом не считается) */
    private static boolean hasPlan(TemplateExercise te) {
        return (te.w != null && !te.w.isEmpty()) || (te.r != null && !te.r.isEmpty()) || te.s > 1;
    }

    /* компактный план: «60×3×10», без веса «3×10», без повторений «60×3» [UX-E5 §4.3]; вес с запятой */
    static String compactPlan(TemplateExercise te) {
        String w = te.w == null ? "" : te.w.replace('.', ',');
        String r = te.r == null ? "" : te.r;
        if (!w.isEmpty() && !r.isEmpty()) return w + "×" + te.s + "×" + r;
        if (!w.isEmpty()) return w + "×" + te.s;
        if (!r.isEmpty()) return te.s + "×" + r;
        return String.valueOf(te.s);
    }

    static String shortName(String name) {
        String n = name == null ? "" : name;
        return n.length() > 16 ? n.substring(0, 15) + "…" : n;
    }

    /* старт из шаблона [§4.6]: при активной тренировке — стандартный диалог, шаблон применится
       после «Удалить и начать новую» */
    private void tplStart(long chatId, Long mid, GymData data, UserState st, long tplId) {
        Template t = findTemplate(data, tplId);
        if (t == null) {
            showTemplates(chatId, mid, data, st);
            return;
        }
        if (data.active() != null) {
            st.pendingTplId = tplId;
            st.pendingRepWid = 0;
            send(chatId, mid, "У тебя есть незавершённая тренировка от " + fmtDate(data.active().date)
                + ". Что делаем?", activeConflictKb());
            return;
        }
        String header = "📋 Шаблон «" + esc(t.name) + "» применён — " + t.exercises.size() + " "
            + plural(t.exercises.size(), "упражнение", "упражнения", "упражнений")
            + ". Вес и подходы из плана подскажу по каждому упражнению.\n\n";
        startFromTemplate(chatId, mid, data, st, t, header);
    }

    /* «Повторить прошлую тренировку» [§4.5]: временный шаблон из завершённой, в список не пишется */
    private void tplRepeat(long chatId, Long mid, GymData data, UserState st, long wid) {
        Workout src = data.findById(wid);
        if (src == null || !src.finished) {
            showMenu(chatId, mid, data, st);
            return;
        }
        if (data.active() != null) {
            st.pendingTplId = 0;
            st.pendingRepWid = wid;
            send(chatId, mid, "У тебя есть незавершённая тренировка от " + fmtDate(data.active().date)
                + ". Что делаем?", activeConflictKb());
            return;
        }
        String header = "🔁 Повторяем тренировку от " + firstLineText(src)
            + ". Фактические веса и подходы подскажу по каждому упражнению.\n\n";
        startFromTemplate(chatId, mid, data, st, templateFromWorkout(data, src), header);
    }

    private static List<List<Map<String, Object>>> activeConflictKb() {
        return List.of(
            List.of(TelegramApi.button("▶️ Продолжить", "wk:resume")),
            List.of(TelegramApi.button("🗑 Удалить и начать новую", "wk:discard")),
            List.of(TelegramApi.button("🏠 Меню", "home"))
        );
    }

    /* создание незавершённой тренировки из шаблона: упражнения списком, записи пустые [§4.6] */
    private void startFromTemplate(long chatId, Long mid, GymData data, UserState st, Template t, String header) {
        Workout w = new Workout();
        w.id = data.nextId++;
        w.date = LocalDate.now().toString();
        w.startedAt = LocalDateTime.now().toString();
        for (TemplateExercise te : t.exercises) {
            ExerciseEntry e = new ExerciseEntry(te.name);
            e.startedAt = w.startedAt;
            /* [UX-E5] снимок плана в запись: подсказки переживут удаление шаблона и рестарт;
               «Повторить прошлую» едет через тот же метод — план = фактический последний блок */
            e.planW = te.w == null ? "" : te.w;
            e.planS = Math.max(te.s, 0);
            e.planR = te.r == null ? "" : te.r;
            w.exercises.add(e);
        }
        data.workouts.add(w);
        storage.save(chatId, data);
        st.editWorkoutId = 0;
        st.editing = false;
        st.pendingTplId = 0;
        st.pendingRepWid = 0;
        renderWorkoutScreen(chatId, mid, data, st, w.id, header);
    }

    /* удаление: confirm на том же сообщении [§4.4] */
    private void tplDelAsk(long chatId, Long mid, GymData data, UserState st, long tplId) {
        Template t = findTemplate(data, tplId);
        if (t == null) {
            showTemplates(chatId, mid, data, st);
            return;
        }
        send(chatId, mid, "Удалить шаблон «" + esc(t.name) + "»?", List.of(
            List.of(
                TelegramApi.button("🗑 Да, удалить", "tpl:delok_" + tplId),
                TelegramApi.button("↩️ Отмена", "tpl:back")
            )
        ));
    }

    private void tplDelete(long chatId, Long mid, GymData data, UserState st, long tplId) {
        data.templates.removeIf(t -> t.id == tplId);
        storage.save(chatId, data);
        showTemplates(chatId, mid, data, st);
    }

    private void showHelp(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        StringBuilder b = new StringBuilder("ℹ️ Справка по командам\n\n");
        b.append("/start — главное меню\n");
        b.append("/workout — начать или продолжить тренировку\n");
        b.append("/view — посмотреть тренировку\n");
        b.append("/history — история тренировок\n");
        b.append("/stats — статистика\n");
        b.append("/templates — шаблоны тренировок\n");
        b.append("/rest — таймер отдыха: /rest 180\n");
        b.append("/export — выгрузить дневник CSV-файлом\n");
        b.append("/profile — профиль: пол, возраст, рост, вес\n");
        b.append("/delete_my_data — удалить все свои данные\n");
        if (webAppUrl != null) {
            b.append("/app — открыть приложение\n");
        }
        b.append("\nВсё то же самое доступно кнопками меню 💪");
        send(chatId, mid, b.toString(), mainKb());
    }

    /* ===== рассылка владельцем [UX-T16] ===== */

    /* разбор команды рассылки: {"1", текст} для /announce_dry, {"0", текст} для /announce;
       null — не команда рассылки. Строго: /announcex и /announce_dryx не матчатся.
       static — для контрактного теста без конструктора (он поднимает планировщик таймеров). */
    public static String[] parseAnnounce(String text) {
        if (text == null) return null;
        String low = text.toLowerCase();
        boolean dry = low.startsWith("/announce_dry");
        String cmd = dry ? "/announce_dry" : "/announce";
        if (!low.equals(cmd) && !low.startsWith(cmd + " ")) return null;
        return new String[]{dry ? "1" : "0", text.substring(cmd.length()).trim()};
    }

    /* /announce <текст> — рассылка всем чатам из data/, /announce_dry <текст> — только отчёт владельцу.
       Доступ: только chat id владельца из env GYM_ADMIN_CHAT_ID (0/чужой id — тихо игнорируем,
       чтобы команду нельзя было прощупать). Ошибка отправки в один чат рассылку не прерывает.
       Пауза 50 мс между отправками — запас к глобальному лимиту Telegram (~25-30 msg/сек). */
    private void handleAnnounce(long chatId, String text, String dryFlag) {
        boolean dry = "1".equals(dryFlag);
        if (adminChatId <= 0 || chatId != adminChatId) return;
        if (text.isEmpty()) {
            /* без угловых скобок: sendMessage шлёт в HTML-режиме, «<текст>» даёт 400 can't parse entities */
            api.sendMessage(chatId, "Формат: /announce текст\n"
                + "Предпросмотр без отправки: /announce_dry текст\n"
                + "Рассылка уйдёт во все чаты, где бот уже работал.", null);
            return;
        }
        List<Long> chats = storage.chatIds();
        /* HTML-режим sendMessage: текст владельца экранируется, иначе < и > ломают разбор у Telegram */
        String body = esc(text);
        if (dry) {
            api.sendMessage(chatId, "🔍 Dry-run — ничего не отправлено.\n"
                + "Ушло бы сообщений: " + chats.size() + " (" + plural(chats.size(), "чат", "чата", "чатов") + ")"
                + "\n\nТекст рассылки:\n" + body, null);
            return;
        }
        int sent = 0, failed = 0;
        List<String> errs = new ArrayList<>();
        for (int i = 0; i < chats.size(); i++) {
            if (i > 0) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            String err = api.sendMessageResult(chats.get(i), body);
            if (err == null) sent++;
            else {
                failed++;
                if (errs.size() < 5) errs.add(err);
            }
        }
        StringBuilder rep = new StringBuilder("📣 Рассылка завершена\n\n")
            .append("Отправлено: ").append(sent)
            .append("\nОшибок: ").append(failed);
        if (!errs.isEmpty()) {
            rep.append("\n\nПервые ошибки:");
            for (String e : errs) rep.append("\n• ").append(esc(e));
        }
        api.sendMessage(chatId, rep.toString(), null);
        System.out.println("[announce] sent=" + sent + " failed=" + failed);
    }

    /* ===== удаление данных по запросу [ONB-T2] ===== */

    /* разбор команды удаления: "confirm" — /delete_my_data_confirm, "ask" — /delete_my_data;
       null — не команда удаления. Строго: /delete_my_datax и /delete_my_data_confirmx не матчатся.
       static — для контрактного теста без конструктора (он поднимает планировщик таймеров). */
    public static String parseDeleteData(String text) {
        if (text == null) return null;
        String low = text.toLowerCase();
        if (low.equals("/delete_my_data_confirm")) return "confirm";
        if (low.equals("/delete_my_data")) return "ask";
        return null;
    }

    /* двухшаговое подтверждение: /delete_my_data запоминает запрос на DELETE_CONFIRM_MS,
       повторная /delete_my_data_confirm в этом окне стирает chat_<id>.json безвозвратно.
       Пользователь удаляет только СВОИ данные: chatId берётся из входящего сообщения,
       чужой файл из чата удалить невозможно — это by design. */
    private void handleDeleteData(long chatId, boolean confirm) {
        long now = System.currentTimeMillis();
        if (!confirm) {
            /* протухшие записи (окно подтверждения вышло) подчищаем, чтобы карта не росла */
            pendingDeletes.entrySet().removeIf(e -> now - e.getValue() > DELETE_CONFIRM_MS);
            pendingDeletes.put(chatId, now);
            api.sendMessage(chatId, "⚠️ Будут безвозвратно удалены все твои тренировки и профиль."
                + "\nДля подтверждения в течение 5 минут отправь /delete_my_data_confirm", null);
            return;
        }
        Long asked = pendingDeletes.remove(chatId);
        if (asked == null) {
            /* confirm без предшествующего /delete_my_data — не «истекло», а просто не запрашивали */
            api.sendMessage(chatId, "Сначала отправь /delete_my_data", null);
            return;
        }
        if (now - asked > DELETE_CONFIRM_MS) {
            api.sendMessage(chatId, "Время подтверждения истекло, начни заново: /delete_my_data", null);
            return;
        }
        storage.deleteChat(chatId);
        api.sendMessage(chatId, "🗑 Все твои данные удалены."
            + "\nВернуться — просто напиши боту или открой Mini App", null);
    }

    private void showKcal(long chatId, Long mid, GymData data, long id) {
        Workout w = data.findById(id);
        if (w == null) {
            showMenu(chatId, mid, data, states.computeIfAbsent(chatId, k -> new UserState()));
            return;
        }
        StringBuilder b = new StringBuilder("🔥 Расчёт калорий\n\n");
        Long mins = durationMin(w, LocalDateTime.now());
        if (mins == null) {
            b.append("Время начала не зафиксировано — нажми «⏱ Время» и введи его.");
            send(chatId, mid, b.toString(), List.of(List.of(TelegramApi.button("↩️ Назад", "scr_" + id))));
            return;
        }
        double calcMin = Math.min(mins, KCAL_MAX_MIN);
        double vol = workoutVolume(w);
        double perMin = vol / Math.max(calcMin, 1);
        double met;
        String intensity;
        if (perMin < 120) {
            met = 3.5;
            intensity = "низкая";
        } else if (perMin <= 300) {
            met = 5.0;
            intensity = "средняя";
        } else {
            met = 6.0;
            intensity = "высокая";
        }
        b.append("⏱ Длительность: ").append(durationText(mins));
        if (mins > KCAL_MAX_MIN) b.append(" (в расчёте учтено ").append(KCAL_MAX_MIN).append(" мин)");
        b.append("\n🏋️ Объём: ≈").append(fmtW(vol)).append(" кг (").append(fmtW(perMin)).append(" кг/мин)")
            .append("\nИнтенсивность: ").append(intensity).append(" (").append(met).append(" MET)");
        ProfileData p = data.profile;
        if (p == null || p.weight <= 0) {
            b.append("\n\n⚠️ Задай профиль — нужен твой вес:");
            send(chatId, mid, b.toString(), List.of(
                List.of(TelegramApi.button("⚙️ Профиль", "pr")),
                List.of(TelegramApi.button("↩️ Назад", "scr_" + id))
            ));
            return;
        }
        long kcal = calcKcal(p, w, LocalDateTime.now());
        b.append("\nВес: ").append(fmtW(p.weight)).append(" кг (из профиля)")
            .append("\nФормула: MET × 3.5 × вес ÷ 200 × минуты")
            .append("\n\n🔥 Расход: ≈").append(kcal).append(" ккал");
        send(chatId, mid, b.toString(), List.of(List.of(TelegramApi.button("↩️ Назад", "scr_" + id))));
    }

    private void showProgress(long chatId, Long mid, GymData data, long id) {
        Workout w = data.findById(id);
        if (w == null) {
            showMenu(chatId, mid, data, states.computeIfAbsent(chatId, k -> new UserState()));
            return;
        }
        int idx = data.workouts.indexOf(w);
        Workout prev = idx > 0 ? data.workouts.get(idx - 1) : null;
        StringBuilder b = new StringBuilder("📈 Прогресс\n\n");
        if (prev == null) {
            b.append("Это первая тренировка — сравнивать не с чем.");
        } else {
            b.append("Сравнение с ").append(esc(firstLineText(prev))).append("\n\n");
            Long d1 = durationMin(w, LocalDateTime.now());
            Long d0 = durationMin(prev, LocalDateTime.now());
            if (d1 != null && d0 != null) {
                b.append("⏱ Длительность: ").append(durationText(d0)).append(" → ").append(durationText(d1))
                    .append(diff(d1 - d0, " мин")).append("\n");
            }
            ProfileData p = data.profile;
            if (p != null && p.weight > 0) {
                long k1 = calcKcal(p, w, LocalDateTime.now());
                long k0 = calcKcal(p, prev, LocalDateTime.now());
                if (k0 >= 0 && k1 >= 0) {
                    b.append("🔥 Ккал: ").append(k0).append(" → ").append(k1).append(diff(k1 - k0, "")).append("\n");
                }
            } else {
                b.append("🔥 Ккал: задай профиль ⚙️ для расчёта\n");
            }
            b.append("\nУпражнения:");
            for (ExerciseEntry e : w.exercises) {
                if (e.sets.isEmpty()) continue;
                ExerciseEntry pe = findExercise(prev, e.name);
                if (pe == null || pe.sets.isEmpty()) {
                    b.append("\n• ").append(esc(e.name)).append(": новое упражнение");
                    continue;
                }
                double cur = maxWeightOf(e);
                double pw = maxWeightOf(pe);
                int cs = setsCount(e);
                int ps = setsCount(pe);
                b.append("\n• ").append(esc(e.name)).append(": ");
                if (pw > 0 || cur > 0) {
                    b.append(fmtW(pw)).append(" → ").append(fmtW(cur)).append("кг").append(diff(Math.round(cur - pw), "кг"));
                } else {
                    b.append("без веса");
                }
                if (ps != cs) {
                    b.append(", подходов ").append(ps).append(" → ").append(cs);
                }
            }
        }
        send(chatId, mid, b.toString(), List.of(List.of(TelegramApi.button("↩️ Назад", "scr_" + id))));
    }

    private void showStats(long chatId, Long mid, GymData data, UserState st) {
        st.mode = UserState.Mode.MENU;
        st.currentExercise = null;
        List<Workout> fin = new ArrayList<>();
        for (Workout w : data.workouts) {
            if (w.finished) fin.add(w);
        }
        if (fin.isEmpty()) {
            send(chatId, mid, "Нет данных для статистики. Заверши первую тренировку! 💪", mainKb());
            return;
        }
        int monthCount = 0;
        String month = LocalDate.now().toString().substring(0, 7);
        Map<String, ExStat> byEx = new LinkedHashMap<>();
        long totalMin = 0;
        int totalSets = 0;
        for (Workout w : fin) {
            if (w.date != null && w.date.startsWith(month)) monthCount++;
            Long m = durationMin(w, LocalDateTime.now());
            if (m != null) totalMin += m;
            for (ExerciseEntry e : w.exercises) {
                totalSets += e.sets.size();
                ExStat s = byEx.computeIfAbsent(e.name, k -> new ExStat());
                s.sessions++;
                for (SetEntry block : e.sets) {
                    double mw = maxWeight(block.weight);
                    if (mw > s.maxW) s.maxW = mw;
                    if (mw > 0) s.hasW = true;
                    double er = Records.e1rm(block);
                    if (er > s.e1rm) s.e1rm = er;
                    s.lastLine = renderLine(e.name, block);
                    s.lastDate = w.date;
                }
            }
        }
        List<Map.Entry<String, ExStat>> top = new ArrayList<>(byEx.entrySet());
        top.sort((a, b) -> Integer.compare(b.getValue().sessions, a.getValue().sessions));

        StringBuilder b = new StringBuilder("📊 Статистика\n\n");
        b.append("Тренировок всего: ").append(fin.size());
        b.append("\nВ этом месяце: ").append(monthCount);
        if (totalMin > 0) b.append("\nОбщее время: ").append(durationText(totalMin));
        b.append("\nПодходов всего: ").append(totalSets);
        b.append("\n\n🏆 Упражнения:");
        int limit = Math.min(top.size(), 15);
        for (int i = 0; i < limit; i++) {
            String name = top.get(i).getKey();
            ExStat s = top.get(i).getValue();
            b.append("\n\n• ").append(esc(name)).append(" (").append(s.sessions).append(" раз.)");
            b.append("\n  Максимум: ").append(s.hasW ? fmtW(s.maxW) + " кг" : "без веса");
            if (s.e1rm > 0) b.append("\n  1ПМ ≈ ").append(Math.round(s.e1rm)).append(" кг");
            if (s.lastLine != null) {
                b.append("\n  Последний: ").append(esc(s.lastLine));
                if (s.lastDate != null) b.append(" (").append(fmtDate(s.lastDate)).append(")");
            }
        }
        send(chatId, mid, b.toString(), mainKb());
    }

    private static final class ExStat {
        int sessions;
        double maxW;
        boolean hasW;
        double e1rm;
        String lastLine;
        String lastDate;
    }

    private String screenText(Workout w) {
        StringBuilder b = new StringBuilder(titleHtml(w)).append("\n").append(timeLine(w)).append("\n");
        if (w.nutrition != null && !w.nutrition.isBlank()) {
            b.append("🥤 ").append(esc(w.nutrition)).append("\n");
        }
        List<String> groups = new ArrayList<>();
        for (ExerciseEntry e : w.exercises) {
            if (e.sets.isEmpty()) {
                groups.add("• " + esc(e.name) + ": нет записей");
                continue;
            }
            StringBuilder g = new StringBuilder();
            for (SetEntry s : e.sets) {
                if (g.length() > 0) g.append("\n");
                g.append(esc(renderLine(e.name, s)));
            }
            groups.add(g.toString());
        }
        if (groups.isEmpty()) {
            b.append("\nПока нет упражнений. Добавь первое!");
        } else {
            b.append("\n").append(String.join("\n\n", groups));
        }
        return b.toString();
    }

    static String titleHtml(Workout w) {
        String t = w.title != null && !w.title.isBlank() ? w.title : autoTitle(w);
        String[] lines = t.split("\n");
        StringBuilder b = new StringBuilder("<b>").append(esc(lines[0].trim())).append("</b>");
        for (int i = 1; i < lines.length; i++) {
            String ln = lines[i].trim();
            if (!ln.isEmpty()) b.append("\n").append(esc(ln));
        }
        return b.toString();
    }

    static String autoTitle(Workout w) {
        StringBuilder b = new StringBuilder(firstLineText(w));
        int n = 0;
        for (ExerciseEntry e : w.exercises) {
            if (e.sets.isEmpty()) continue;
            b.append("\n").append(e.name);
            if (++n == 3) break;
        }
        return b.toString();
    }

    static String firstLineText(Workout w) {
        LocalDate d = parseDate(w.date);
        if (d == null) return w.date == null ? "Тренировка" : w.date;
        return d.format(DDM) + " " + DOW[d.getDayOfWeek().getValue() - 1];
    }

    private String timeLine(Workout w) {
        LocalDateTime started = parseDT(w.startedAt);
        if (started == null) return "⏱ время не зафиксировано";
        Long mins = durationMin(w, LocalDateTime.now());
        String dur = mins == null ? "" : " · " + durationText(mins);
        if (w.finished) {
            LocalDateTime ended = parseDT(w.endedAt);
            if (ended != null) return "⏱ " + HF.format(started) + "–" + HF.format(ended) + dur;
        }
        return "⏱ начало " + HF.format(started) + dur;
    }

    static Long durationMin(Workout w, LocalDateTime now) {
        LocalDateTime started = parseDT(w.startedAt);
        if (started == null) return null;
        LocalDateTime end = w.finished && w.endedAt != null ? parseDT(w.endedAt) : now;
        if (end == null) end = now;
        long mins = Duration.between(started, end).toMinutes();
        return Math.max(mins, 0);
    }

    static String durationText(long mins) {
        long h = mins / 60;
        long m = mins % 60;
        if (h > 0) return h + "ч " + m + "м";
        return m + "м";
    }

    static long calcKcal(ProfileData p, Workout w, LocalDateTime now) {
        if (p == null || p.weight <= 0) return -1;
        Long mins = durationMin(w, now);
        if (mins == null) return -1;
        double calcMin = Math.min(mins, KCAL_MAX_MIN);
        double vol = workoutVolume(w);
        double perMin = vol / Math.max(calcMin, 1);
        double met = perMin < 120 ? 3.5 : (perMin <= 300 ? 5.0 : 6.0);
        return Math.round(met * 3.5 * p.weight / 200.0 * calcMin);
    }

    static double bmr(ProfileData p) {
        double base = 10 * p.weight + 6.25 * p.height - 5.0 * p.age;
        return p.sex.equalsIgnoreCase("ж") ? base - 161 : base + 5;
    }

    static double workoutVolume(Workout w) {
        double v = 0;
        for (ExerciseEntry e : w.exercises) {
            for (SetEntry s : e.sets) {
                v += maxWeight(s.weight) * s.sets * repsNum(s.reps);
            }
        }
        return v;
    }

    static int repsNum(String reps) {
        Matcher m = NUM_PATTERN.matcher(reps == null ? "" : reps);
        if (!m.find()) return 10;
        return (int) Double.parseDouble(m.group().replace(',', '.'));
    }

    private static double maxWeightOf(ExerciseEntry e) {
        double max = 0;
        for (SetEntry s : e.sets) {
            double w = maxWeight(s.weight);
            if (w > max) max = w;
        }
        return max;
    }

    private static int setsCount(ExerciseEntry e) {
        int n = 0;
        for (SetEntry s : e.sets) n += s.sets;
        return n;
    }

    private static String diff(long delta, String unit) {
        if (delta == 0) return "";
        return " (" + (delta > 0 ? "+" : "") + delta + unit + ")";
    }

    public static String renderLine(String name, SetEntry s) {
        if (s.weight.isEmpty()) return name + ", " + s.sets + " " + setsWord(s.sets) + repsPhrase(s.reps);
        return name + " " + s.weight + " кг, " + s.sets + " " + setsWord(s.sets) + repsPhrase(s.reps);
    }

    /* «2 подхода», «5 подходов» — склонение числа подходов */
    static String setsWord(int n) {
        n = Math.abs(n);
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "подход";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "подхода";
        return "подходов";
    }

    /* «по 4 повторения», «по 12 повторений», «по макс» — склонение по последнему числу в строке */
    static String repsPhrase(String reps) {
        String str = reps == null ? "" : reps.trim();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d+").matcher(str);
        int last = -1;
        while (m.find()) last = Integer.parseInt(m.group());
        if (last < 0) return " по " + str;
        if (last == 1) return " по " + str + " повторению";
        int m10 = last % 10, m100 = last % 100;
        String word = (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? "повторения" : "повторений";
        return " по " + str + " " + word;
    }

    /* Название тренировки для CSV: кастомное одной строкой (переводы строк → « / »),
       иначе автоматическое «ДД-ММ ДН» — то, что бот и показывает как имя тренировки. */
    private static String csvTitle(Workout w) {
        if (w.title != null && !w.title.isBlank()) {
            return w.title.replaceAll("\\r\\n|\\r|\\n", " / ").trim();
        }
        return firstLineText(w);
    }

    /* Подходы одной строкой. В данных один блок = вес + число подходов + повторения, поэтому:
       45×12            — одиночный подход с весом (пирамида: «45×12, 50×10»)
       45×12 (4 подхода) — блок из 4 подходов с весом 45 по 12 повторений
       4×12             — без веса (подходы×повторы) */
    private static String csvSets(ExerciseEntry e) {
        List<String> parts = new ArrayList<>();
        for (SetEntry s : e.sets) {
            if (s.weight.isEmpty()) {
                parts.add(s.sets + "×" + s.reps);
            } else if (s.sets == 1) {
                parts.add(s.weight + "×" + s.reps);
            } else {
                parts.add(s.weight + "×" + s.reps + " (" + s.sets + " " + setsWord(s.sets) + ")");
            }
        }
        return String.join(", ", parts);
    }

    /* RFC 4180: поле берём в кавычки, если содержит ; " или перевод строки.
       CSV-инъекция формулами: Excel выполняет ячейку, начинающуюся с = + - @, как формулу —
       опасный первый символ экранируется апострофом (стандартная защита экспортёров).
       Даты и числа (fmtDate/csvSets) с таких символов не начинаются — не затрагиваются. */
    public static String csvField(String v) {
        if (v == null) return "";
        if (!v.isEmpty()) {
            char c = v.charAt(0);
            if (c == '=' || c == '+' || c == '-' || c == '@') v = "'" + v;
        }
        if (v.indexOf(';') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
            return '"' + v.replace("\"", "\"\"") + '"';
        }
        return v;
    }

    /* «1 тренировка», «2 тренировки», «5 тренировок» — общее склонение для подписей */
    public static String plural(int n, String one, String few, String many) {
        n = Math.abs(n);
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    private static Workout resolveWorkout(GymData data, UserState st) {
        if (st.editWorkoutId > 0) {
            Workout w = data.findById(st.editWorkoutId);
            if (w != null) return w;
        }
        return data.active();
    }

    private static List<ExerciseEntry> editableExercises(Workout w) {
        List<ExerciseEntry> out = new ArrayList<>();
        for (ExerciseEntry e : w.exercises) {
            if (!e.sets.isEmpty()) out.add(e);
        }
        return out;
    }

    private static Workout lastWorkoutWith(GymData data, String name) {
        Workout last = null;
        for (Workout w : data.workouts) {
            for (ExerciseEntry e : w.exercises) {
                if (e.name.equalsIgnoreCase(name) && !e.sets.isEmpty()) {
                    last = w;
                    break;
                }
            }
        }
        return last;
    }

    static List<String> lastWeights(GymData data, String name) {
        Workout last = lastWorkoutWith(data, name);
        List<String> out = new ArrayList<>();
        if (last == null) return out;
        for (ExerciseEntry e : last.exercises) {
            if (!e.name.equalsIgnoreCase(name)) continue;
            for (SetEntry s : e.sets) {
                if (!s.weight.isEmpty() && !out.contains(s.weight)) out.add(s.weight);
            }
        }
        if (out.size() > 4) out = new ArrayList<>(out.subList(0, 4));
        return out;
    }

    static List<String> lastReps(GymData data, String name) {
        Workout last = lastWorkoutWith(data, name);
        List<String> out = new ArrayList<>();
        if (last == null) return out;
        for (ExerciseEntry e : last.exercises) {
            if (!e.name.equalsIgnoreCase(name)) continue;
            for (SetEntry s : e.sets) {
                if (!out.contains(s.reps)) out.add(s.reps);
            }
        }
        if (out.size() > 4) out = new ArrayList<>(out.subList(0, 4));
        return out;
    }

    static String popularWeight(GymData data, String name) {
        Map<String, Integer> cnt = new LinkedHashMap<>();
        for (Workout w : data.workouts) {
            for (ExerciseEntry e : w.exercises) {
                if (!e.name.equalsIgnoreCase(name)) continue;
                for (SetEntry s : e.sets) {
                    if (!s.weight.isEmpty()) cnt.merge(s.weight, 1, Integer::sum);
                }
            }
        }
        String best = null;
        int bestCount = 0;
        for (Map.Entry<String, Integer> en : cnt.entrySet()) {
            if (en.getValue() >= bestCount) {
                bestCount = en.getValue();
                best = en.getKey();
            }
        }
        return best;
    }

    static SetEntry parseLine(String line) {
        Matcher m = LINE_PATTERN.matcher(line);
        if (!m.matches()) return null;
        int sets = Integer.parseInt(m.group(2));
        if (sets < 1 || sets > 30) return null;
        String reps = m.group(3).trim();
        if (reps.isEmpty() || reps.length() > 15) return null;
        String weight = normalizeWeight(m.group(1));
        if (weight.length() > 25) return null;
        return new SetEntry(weight, sets, reps);
    }

    static String normalizeWeight(String raw) {
        String t = raw.trim();
        while (t.endsWith(",") || t.endsWith(".") || t.endsWith(";")) {
            t = t.substring(0, t.length() - 1).trim();
        }
        if (t.toLowerCase().endsWith("кг")) {
            t = t.substring(0, t.length() - 2).trim();
        }
        while (t.endsWith(",") || t.endsWith(";")) {
            t = t.substring(0, t.length() - 1).trim();
        }
        return t;
    }

    static double maxWeight(String weightText) {
        double max = 0;
        Matcher m = NUM_PATTERN.matcher(weightText == null ? "" : weightText);
        while (m.find()) {
            double v = Double.parseDouble(m.group().replace(',', '.'));
            if (v > max) max = v;
        }
        return max;
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static ExerciseEntry findExercise(Workout w, String name) {
        if (w == null || name == null) return null;
        for (ExerciseEntry e : w.exercises) {
            if (e.name.equalsIgnoreCase(name)) return e;
        }
        return null;
    }

    private void closeCurrentExercise(long chatId, GymData data, UserState st) {
        Workout w = resolveWorkout(data, st);
        ExerciseEntry e = w == null ? null : findExercise(w, st.currentExercise);
        if (e != null && e.startedAt != null && e.endedAt == null) {
            e.endedAt = LocalDateTime.now().toString();
            storage.save(chatId, data);
        }
    }

    private static int countFinished(GymData data) {
        int n = 0;
        for (Workout w : data.workouts) {
            if (w.finished) n++;
        }
        return n;
    }

    private static String fmtDate(String iso) {
        if (iso == null) return "—";
        try {
            return DF.format(LocalDate.parse(iso));
        } catch (DateTimeParseException e) {
            return iso;
        }
    }

    private static LocalDate parseDate(String iso) {
        if (iso == null) return null;
        try {
            return LocalDate.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static LocalDateTime parseDT(String iso) {
        if (iso == null) return null;
        try {
            return LocalDateTime.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static String fmtW(double w) {
        if (w == Math.floor(w) && !Double.isInfinite(w)) return String.valueOf((long) w);
        return String.valueOf(w);
    }

    private void send(long chatId, Long mid, String text, List<List<Map<String, Object>>> kb) {
        if (mid == null) api.sendMessage(chatId, text, kb);
        else api.editMessageText(chatId, mid, text, kb);
    }
}
