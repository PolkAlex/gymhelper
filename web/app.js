'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
let INIT = '';
let G = null;
let tab = 'history';
let viewWid = 0;
let modalCtx = null;
let PENDING = null;
let CUR = null;
let PICKER = null;
let TECH = { section: 'all', cat: null, open: null, q: '', fMuscle: [], fGear: [], fCats: [] };
let profileSex = 'м';
let editSnap = null;
let pendingTab = null;
let __delExerciseCtx = null;
let __delSetCtx = null;
let railOpen = false;
/* [UX-T27] экран «Настройки» [UX-S4]: подэкран-оверлей поверх вкладки. Вкладка-источник
   сохраняется сама (tab не сбрасывается при открытии, viewWid карточки не трогается) —
   «←» (closeSettings) возвращает на неё, тап по табу закрывает Настройки */
let settingsOpen = false;
/* [UX-S6] календарь тренировок: подэкран-оверлей как Настройки. calOpen — в памяти,
   месяц — CAL {y, m, sel}, переживает закрытие через localStorage gymCalMonth [§3.4, §7.3] */
let calOpen = false;
let CAL = { y: 0, m: 0, sel: null };
/* [UX-S6] вкладка-источник календаря: «← Назад» возвращает на неё [ред. 5, §3.4] */
let calFromTab = 'history';
/* [UX-S6] фиксированные пределы листания месяцев (от данных не зависят) [§7.1] */
const MIN_MONTH = '2020-01';
const MAX_MONTH = '2030-12';
/* [UX-S6] подсказки пустых месяцев («Предыдущая тренировка — <дата>») — ЗАГОТОВКА:
   ветка рендера написана, но выключена решением владельца 09.11 («скрыто, вернёмся
   позже»); включение показа — перевести в true [§8, §12, §13] */
const SHOW_MONTH_HINTS = false;
/* таймер отдыха [UX-T4]: состояние в localStorage gymRest по абсолютной метке end */
let REST = null;          /* {end, dur, paused, left, mini, ex} — см. спеку §1.7 */
let REST_CUSTOM = false;  /* поле «Своё…» в Профиле открыто */
let __restAudio = null;   /* ленивый AudioContext (мобильные браузеры блокируют звук) */
let __restExpiredFired = false; /* сигнал «истёк» — один раз на цикл отсчёта */
/* [ONB-T3..T7] онбординг (docs/spec-onb-onboarding.md ред. 5): флаги в localStorage
   (формат data/*.json не затрагивается, §8). Всё скипаемое; тон — на «Вы» */
let obOpen = false;   /* приветствие-карусель поверх приложения */
let obSlide = 0;      /* текущий слайд 0..2 */
let obTracked = false; /* [ANA-T5] идёт настоящий онбординг (не «Повторить подсказки» из Помощи): события шлём только в нём */
let tutOpen = false;  /* туториал: спотлайты поверх реальных экранов */
let tutStep = 0;      /* шаг 0..3: FAB → .ex-add → пара [ 📅 ][ ⚙ ] → таб «Статистика» */
let helpOpen = false; /* подэкран «Помощь» (паттерн Настроек: поверх вкладки) */
let helpFaq = 0;      /* открытый вопрос аккордеона (-1 — все закрыты) */
let srvState = '';    /* проверка сервера: '' | 'checking' | 'ok' | 'fail' */
let wnOpen = false;   /* модалка «Что нового» */
let wnRel = null;     /* показываемый релиз {ver, items:[{t, d}]} */
let BOT_NAME = 'GymHelper_bot'; /* [ONB-T6] deep-link feedback; сервер может прислать свой в /api/init */

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/* [UX-S6] падежные формы месяцев и полные дни недели для календаря [§8, §12] */
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

/* старые темы из прошлых версий: маппинг на тёмную/светлую (совместимость localStorage) */
const OLD_THEME_LIGHT = ['sage', 'peach', 'lavender', 'rose', 'mint', 'ice', 'coffee'];
const OLD_THEME_DARK = ['forest', 'khaki', 'pine', 'graphite', 'midnight', 'stockline'];

/* ============ [ONB] контент онбординга (тексты — макет ред. 5 + спека §3, тон на «Вы») ============ */
/* версия сборки: подвал Помощи («GymHelper 1.33 · 11.11.2026») */
const APP_VERSION = '1.33';
const APP_BUILD = '11.11.2026';
const SUPPORT_EMAIL = 'support.gymhelper@gmail.com';
/* слайды приветствия (макет, экраны 1–3, решение 1 — вариант B «Карусель») */
const OB_SLIDES = [
    { ico: '🏋', title: 'Дневник за секунды', text: 'Вес, подходы и повторения — в несколько тапов. Кнопки подсказывают значения с прошлой тренировки, ничего не нужно вводить с нуля.' },
    { ico: '🏆', title: 'Прогресс и рекорды', text: 'Сравнение с прошлой тренировкой, оценка 1ПМ по Эпли и живой рекорд — когда побит личный максимум.' },
    { ico: '📅', title: 'Календарь и статистика', text: 'Месяц с отметками тренировок, объём, время и калории — весь прогресс под рукой.' }
];
/* шаги туториала — подсказки поверх реальных экранов (решение 2) */
const TUT_STEPS = [
    { label: 'Шаг 1 из 4 · Новая тренировка', title: 'Начать — жёлтый «+» внизу', text: 'Тап по кнопке открывает пошаговый ввод: упражнение → вес → подходы. В конце — «✓ Завершить».' },
    { label: 'Шаг 2 из 4 · Подходы', title: 'Тонкий «+» у названия упражнения — запись подхода', text: 'Вес подставится с прошлого раза — просто поправьте, если нужно. Тап по записанной строке — правка, чип 🏆 — новый рекорд.' },
    { label: 'Шаг 3 из 4 · Календарь и настройки', title: '📅 — месяц тренировок, ⚙️ — настройки', text: 'В календаре видны все дни с тренировками, в настройках — тема, таймер отдыха, звук и «Что нового».' },
    { label: 'Шаг 4 из 4 · Прогресс', title: 'Статистика — второй таб слева', text: 'Рекорды недели, оценка 1ПМ по Эпли, объём и время — прогресс виден сразу.' }
];
/* FAQ — 7 вопросов (решение 6: без вопроса про тему, «Как считаются калории?»), спека §3.3 */
const FAQ_ITEMS = [
    { q: 'Как изменить вес или подходы?', a: 'Откройте тренировку в Истории и тапните по строке записи — можно поправить вес и повторения или удалить её. Правки сохраняются сами; работает и для завершённых тренировок.' },
    { q: 'Как удалить тренировку?', a: 'Откройте карточку тренировки в Истории — внизу кнопка «🗑 Удалить». Приложение спросит подтверждение; восстановить удалённое нельзя.' },
    { q: 'Что такое 1ПМ?', a: 'Одноповторный максимум — вес, который Вы теоретически можете поднять один раз. Приложение оценивает его по формуле Эпли из рабочих подходов. Побили свою оценку — увидите тост 🏆 и чип у записи; в Статистике — блок «Оценка 1ПМ · Эпли».' },
    { q: 'Как считаются калории?', a: 'По формуле MET: интенсивность — из тоннажа и времени, плюс Ваш вес из Профиля. Чтобы калории считались, заполните профиль (пол, возраст, рост, вес).' },
    { q: 'Можно начать тренировку с прошлого раза?', a: 'Да: жёлтый «+» → «🔁 Повторить» прошлую тренировку или шаблон — упражнения уже в списке, останется записать подходы.' },
    { q: 'Начали в боте — продолжите в приложении?', a: 'Бот и приложение смотрят в один дневник. Начатая в чате тренировка появится в приложении сама — дописывайте подходы и завершайте где удобно.' },
    { q: 'Как удалить все свои данные?', a: 'Полное удаление — командой /delete_my_data в чате с ботом (бот попросит подтвердить). Условия хранения — «Политика конфиденциальности» в Настройках.' }
];
/* [ONB-T7] «Что нового»: значимые релизы. ПУСТОЙ МАССИВ = ВЫКЛЮЧАТЕЛЬ — модалка
   не показывается. Первый показ — со СЛЕДУЮЩЕГО значимого релиза после онбординга
   (ретроактивно 1.30/1.31 НЕ показываем — решение владельца, спека §3.4): при
   релизе добавить запись { ver: '1.32', items: [{ t: 'Заголовок', d: 'Описание' }, …] };
   технические релизы просто не добавляются. Пропущенные релизы — показывается
   только последний (последняя запись массива). Текст предлагает lead, утверждает владелец.
   ⚠️ ЧЕК-ЛИСТ ПРИ РЕЛИЗЕ: добавить запись в RELNOTES и бампнуть APP_VERSION/APP_BUILD
   (+ cache-версии ?v= в web/index.html). */
const RELNOTES = [
    {
        ver: '1.32',
        items: [
            { t: 'Онбординг', d: 'Приветствие и подсказки при первом входе — знакомство с приложением. Повторить можно в разделе «Помощь».' },
            { t: 'Фото упражнений', d: 'Фото вместо иконок — в Технике, Истории и Статистике (база расширена до 100 упражнений).' },
            { t: 'Обратная связь', d: 'Нашли проблему — напишите разработчику прямо из раздела «Помощь».' }
        ]
    },
    {
        ver: '1.33',
        items: [
            { t: 'Новая база упражнений', d: 'Каталог расширен до 243 упражнений: Смит, Ягодицы, Трицепс, Бицепс, Плечи, Ноги, Грудь, Пресс и кор — с описаниями техники.' },
            { t: 'Умные фильтры', d: 'Группы мышц и инвентарь с мультивыбором, плюс Кардио, Растяжка, Разминка и заминка, Стретчинг.' },
            { t: 'Фото везде', d: 'Фото упражнений — теперь и в Истории, Статистике и пикере, а не только в Технике.' },
            { t: 'Быстрее загружается', d: 'Приложение сжато: статики передаётся на 75% меньше.' }
        ]
    }
];

/* ============ утилиты ============ */
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* экранизация значения внутри HTML-атрибута: как esc + кавычки */
function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtW(w) {
    if (w == null || isNaN(w)) return '0';
    return Number.isInteger(+w) ? String(+w) : String(w);
}
function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function nowLocalISO() {
    const d = new Date();
    return todayISO() + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function parseDateISO(s) {
    if (!s) return null;
    const p = String(s).split('-');
    if (p.length < 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
}
function firstLine(w) {
    const d = parseDateISO(w.date);
    if (!d) return w.date || 'Тренировка';
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ', ' + DOW[(d.getDay() + 6) % 7];
}
function titleLines(w) {
    if (w.title && w.title.trim()) return w.title.split('\n').map(s => s.trim()).filter(Boolean);
    const lines = [firstLine(w)];
    let n = 0;
    for (const e of (w.exercises || [])) {
        if (!e.sets || !e.sets.length) continue;
        lines.push(e.name);
        if (++n === 3) break;
    }
    return lines;
}
function maxNum(t) {
    let max = 0;
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(t || '')) !== null) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (v > max) max = v;
    }
    return max;
}
/* среднее по числам строки: «75-175» → 125, «50, 80» → 65, «100» → 100 */
function avgNum(t) {
    const nums = [];
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(t || '')) !== null) nums.push(parseFloat(m[1].replace(',', '.')));
    if (!nums.length) return 0;
    if (nums.length >= 2 && /-/.test(String(t))) {
        const mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
        return (mn + mx) / 2;
    }
    let sum = 0;
    for (const v of nums) sum += v;
    return sum / nums.length;
}
/* среднее число повторений: «8-10» → 9, «5+1» → 6, нечисловой текст → 10, «12» → 12 */
function repsAvg(r) {
    const str = String(r || '');
    const nums = [];
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(str)) !== null) nums.push(Math.round(parseFloat(m[1].replace(',', '.'))));
    if (!nums.length) return 10;
    let sum = 0;
    for (const v of nums) sum += v;
    if (str.indexOf('+') >= 0) return sum; /* «5+1» = дроп-сет: суммарно 6 */
    if (nums.length >= 2 && str.indexOf('-') >= 0) {
        const mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
        return Math.round((mn + mx) / 2);
    }
    return nums.length > 1 ? Math.round(sum / nums.length) : nums[0]; /* округление как Math.round в Java-Records */
}
function repsNum(r) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(r || '');
    return m ? Math.round(parseFloat(m[1].replace(',', '.'))) : 10;
}
function maxWeightOf(e) {
    let max = 0;
    for (const s of e.sets) max = Math.max(max, maxNum(s.w));
    return max;
}
function setsCount(e) {
    let n = 0;
    for (const s of e.sets) n += +s.s || 0;
    return n;
}
function workoutVolume(w) {
    let v = 0;
    for (const e of (w.exercises || [])) {
        for (const s of e.sets) v += avgNum(s.w) * (+s.s || 0) * repsAvg(s.r);
    }
    return v;
}
/* e1RM блока по Эпли: вес × (1 + повторения ÷ 30); 0 — блок без веса [UX-T2] */
function e1rmOf(s) {
    const w = avgNum(s.w);
    if (!w) return 0;
    return w * (1 + repsAvg(s.r) / 30);
}
/* метрики упражнения в одной тренировке: лучший e1RM блока + объём (подходы × повторения) */
function workoutExMetrics(w, nameLower) {
    let bestE = 0, vol = 0, hasW = false, hasSets = false;
    for (const e of (w.exercises || [])) {
        if (e.name.toLowerCase() !== nameLower || !e.sets.length) continue;
        hasSets = true;
        for (const s of e.sets) {
            const er = e1rmOf(s);
            if (er > bestE) bestE = er;
            if (er > 0) hasW = true;
            vol += (+s.s || 0) * repsAvg(s.r);
        }
    }
    return { bestE: bestE, vol: vol, hasW: hasW, hasSets: hasSets };
}
/* проверка живого рекорда нового блока [UX-T2]: база — только прошлые тренировки
   (индекс строго меньше текущей); первый подход упражнения (база пуста) и равный
   результат не празднуются; если упражнение в этой тренировке уже побило базу —
   поздравление уже прозвучало (максимум 1 на упражнение за тренировку). null — не рекорд */
function prCheck(w, name, block) {
    const idx = G.workouts.indexOf(w);
    if (idx < 0) return null;
    const nl = String(name).toLowerCase();
    let baseE = 0, baseHasE = false, baseVol = 0, baseHasVol = false;
    /* база — только прошлые тренировки (i < idx), как в prChipSetIdx и Java-Records */
    for (let i = 0; i < idx; i++) {
        const m = workoutExMetrics(G.workouts[i], nl);
        if (m.hasW) { baseHasE = true; if (m.bestE > baseE) baseE = m.bestE; }
        if (m.hasSets) { baseHasVol = true; if (m.vol > baseVol) baseVol = m.vol; }
    }
    const here = workoutExMetrics(w, nl);
    if (avgNum(block.w) > 0) {
        const v = e1rmOf(block);
        if (!baseHasE || v <= baseE || (here.hasW && here.bestE > baseE)) return null;
        return { type: 'e1rm', val: v, prev: baseE };
    }
    const vol = (+block.s || 0) * repsAvg(block.r);
    if (!baseHasVol || vol <= baseVol || here.vol > baseVol) return null;
    return { type: 'vol', val: vol };
}
/* чип 🏆 у подхода-рекордсмена в карточке тренировки [UX-T2]: лучший e1RM блока
   этой тренировки строго больше базы прошлых; у записей без веса чипа нет */
function prChipSetIdx(w, e) {
    const idx = G.workouts.indexOf(w);
    if (idx < 0) return -1;
    let best = 0, bestIdx = -1;
    e.sets.forEach(function (s, si) {
        const v = e1rmOf(s);
        if (v > best) { best = v; bestIdx = si; }
    });
    if (bestIdx < 0) return -1;
    const nl = e.name.toLowerCase();
    for (let i = 0; i < idx; i++) {
        if (workoutExMetrics(G.workouts[i], nl).bestE >= best) return -1;
    }
    return bestIdx;
}
function durationMin(w) {
    if (!w.started) return null;
    const s = new Date(w.started);
    const end = (w.finished && w.ended) ? new Date(w.ended) : new Date();
    return Math.max(Math.round((end - s) / 60000), 0);
}
function durationText(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h > 0 && m > 0) return h + ' ч ' + m + ' м';
    if (h > 0) return h + ' ч';
    return m + ' м';
}
function setsWord(n) {
    n = Math.abs(+n || 0);
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'подход';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'подхода';
    return 'подходов';
}
/* [UX-T29] дата рождения: возраст вычисляется, склонения, бейдж месяца рождения */
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function ageOf(p, now) {
    if (!p) return 0;
    if (!(p.birthYear >= 1900 && p.birthYear <= 2100) || !(p.birthMonth >= 1 && p.birthMonth <= 12)) return p.age || 0;
    now = now || new Date();
    return now.getFullYear() - p.birthYear - ((now.getMonth() + 1) < p.birthMonth ? 1 : 0);
}
function ageWord(n) {
    n = Math.abs(+n || 0);
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'год';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
    return 'лет';
}
function isBirthMonth(p, now) {
    if (!p) return false;
    now = now || new Date();
    return p.birthMonth >= 1 && p.birthMonth <= 12 && (now.getMonth() + 1) === p.birthMonth;
}
function bmr(p) {
    /* [UX-T29] возраст из ageOf: при валидной дате — вычисленный, а не age-зеркало */
    const base = 10 * p.weight + 6.25 * p.height - 5 * ageOf(p);
    return p.sex === 'ж' ? base - 161 : base + 5;
}
function activeW() { return G.workouts.find(w => !w.finished) || null; }
function findW(id) { return G.workouts.find(w => w.id === id) || null; }
function prevOf(w) {
    const i = G.workouts.indexOf(w);
    return i > 0 ? G.workouts[i - 1] : null;
}
function findEx(w, name) {
    if (!w || name == null) return null;
    return w.exercises.find(e => e.name.toLowerCase() === String(name).toLowerCase()) || null;
}
function entryLine(s) {
    const w = s.w ? String(s.w).replace('.', ',') : '';
    return (w ? w + ' кг, ' : '') + s.s + ' ' + setsWord(s.s) + repsPhrase(s.r);
}
function repsPhrase(r) {
    const str = String(r || '').trim();
    if (!/\d/.test(str)) return ' по ' + str;
    const nums = str.match(/\d+/g) || [];
    const last = nums.length ? Math.abs(+nums[nums.length - 1]) : 0;
    let word;
    if (last === 1) word = 'повторению';
    else {
        const m10 = last % 10, m100 = last % 100;
        word = (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? 'повторения' : 'повторений';
    }
    return ' по ' + str + ' ' + word;
}
function isCustomEx(name) {
    return !findCatalog(name);
}
function dayPart(w) {
    if (!w.started) return null;
    const hh = +String(w.started).slice(11, 13);
    /* границы: 5-11 утро, 11-17 день, 17-23 вечер, иначе ночь.
       [UX-T20] рендер иконки в карточках убран (не понравилась владельцу) — функция
       и ключи ICONS остаются в коде «до лучших времён» */
    if (hh >= 5 && hh < 11) return { n: 'утро', i: 'sunrise' };
    if (hh >= 11 && hh < 17) return { n: 'день', i: 'sun' };
    if (hh >= 17 && hh < 23) return { n: 'вечер', i: 'evening' };
    return { n: 'ночь', i: 'moon' };
}
function isWarmupName(name) {
    const c = findCatalog(name);
    /* [EXR-T4] в новой схеме тег cat:warmup (exTagMatch ловит и legacy-плоский «warmup») */
    return c ? exTagMatch(c, 'cat:warmup') : /^разминка/i.test(name);
}

/* ============ тайминг и калории ============ */
function closeCurrentExercise() {
    if (!CUR) return;
    const w = findW(CUR.wid);
    const e = w ? findEx(w, CUR.name) : null;
    if (e && !e.en) e.en = nowLocalISO();
    CUR = null;
}
function startExercise(w, name) {
    let e = findEx(w, name);
    if (!e) {
        e = { name, sets: [], st: nowLocalISO(), en: '' };
        w.exercises.push(e);
    } else if (!e.st) {
        e.st = nowLocalISO();
    }
    CUR = { wid: w.id, name };
    return e;
}
function exMinutes(e) {
    if (!e.st) return null;
    const s = new Date(e.st);
    const end = e.en ? new Date(e.en) : new Date();
    return Math.max(Math.round((end - s) / 60000), 0);
}
function exStats(e) {
    if (!e.st) return null;
    const mins = exMinutes(e);
    let restSec = null;
    const ts = (e.sets || []).map(x => x.t ? new Date(x.t) : null).filter(Boolean);
    if (ts.length >= 2) {
        let tot = 0, cnt = 0;
        for (let i = 1; i < ts.length; i++) {
            const d = (ts[i] - ts[i - 1]) / 1000;
            if (d > 0 && d < 1800) { tot += d; cnt++; }
        }
        if (cnt) restSec = Math.round(tot / cnt);
    }
    return { mins, restSec };
}
function calcWorkoutKcal(p, w) {
    if (!p || !(p.weight > 0)) return null;
    const exs = (w.exercises || []).filter(e => e.sets.length);
    if (!exs.length) return { total: 0, lines: [], met: 0, perMin: 0 };
    const wminRaw = durationMin(w);
    const wmin = wminRaw != null ? Math.min(wminRaw, 240) : null;
    const totalSets = exs.reduce((a, e) => a + e.sets.length, 0) || 1;
    /* объём нагрузки: средний вес подхода × подходы × средние повторения */
    let vol = 0;
    const vols = [];
    for (const e of exs) {
        let v = 0;
        for (const s of e.sets) v += avgNum(s.w) * (+s.s || 0) * repsAvg(s.r);
        vols.push(v);
        vol += v;
    }
    const perMin = vol / Math.max(wmin != null ? wmin : 1, 1);
    const met = perMin < 120 ? 3.5 : (perMin <= 300 ? 5.0 : 6.0);
    const kcalTotal = (wmin != null && wmin > 0) ? Math.round(met * 3.5 * p.weight / 200 * wmin) : 0;
    let total = 0;
    const lines = [];
    exs.forEach((e, i) => {
        const share = vol > 0 ? vols[i] / vol : 1 / exs.length;
        const m = wmin != null ? Math.round(wmin * (e.sets.length / totalSets)) : null;
        const kcal = kcalTotal > 0 ? Math.round(kcalTotal * share) : null;
        if (kcal != null) total += kcal;
        lines.push({ name: e.name, m, met, kcal });
    });
    return { total, lines, met, perMin: Math.round(perMin) };
}

/* ============ сохранение (очередь) ============ */
let __saveChain = Promise.resolve();
let __saveBusy = false;
function save() {
    const run = __saveChain.then(function () { return doSave(); });
    __saveChain = run.catch(function () { });
    return run;
}
async function doSave() {
    __saveBusy = true;
    try {
        const r = await fetch('/api/save', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT, rev: G.rev || 0, data: G })
        });
        let j = {};
        try { j = await r.json(); } catch (e2) { /* noop */ }
        if (j.ok && typeof j.rev === 'number') { G.rev = j.rev; return 'ok'; }
        if (r.status === 409) {
            /* [ONB-T2] сервер пуст (rev 0): данные были удалены /delete_my_data, а вкладка
               прислала старый G. Сохранение не выполняется; перечитываем /api/init начисто
               (без слияния локальных тренировок — они уже удалены безвозвратно),
               вкладка опустевает сама. */
            console.error('save rejected 409: server data was deleted');
            toast('Данные были удалены — приложение обновлено', true);
            await reloadSilently(true, true);
            /* [UX-T28] не 'err': свои тосты про «Нет связи» при 409 не показывать —
               тот уже от doSave; остальные 'err'-путей это не касается */
            return 'conflict';
        }
        console.error('save failed', r.status);
        toast('Ошибка сохранения: сервер ответил ' + r.status, true);
        return 'err';
    } catch (e) {
        console.error('save failed', e);
        toast('Ошибка сохранения: нет связи с сервером', true);
        return 'err';
    } finally {
        __saveBusy = false;
    }
}
async function reloadSilently(force, adoptServer) {
    if (!force && __saveBusy) return;
    if (!force && tab === 'history' && viewWid) return;
    try {
        const r = await fetch('/api/init', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT })
        });
        const j = await r.json();
        if (j.ok && j.data) {
            /* не теряем локальные тренировки, которых сервер ещё не видел (сбой сохранения);
               [ONB-T2] adoptServer (409 после удаления) — наоборот: серверное состояние
               применяем как есть, «удалённое» с сервера локально не восстанавливаем */
            let localOnly = [];
            let localNextId = 0;
            if (!adoptServer) {
                const serverIds = new Set((j.data.workouts || []).map(w => w.id));
                const serverDel = new Set(j.data.del || []);
                localOnly = G ? G.workouts.filter(w => !serverIds.has(w.id) && !serverDel.has(w.id)) : [];
                localNextId = G ? G.nextId : 0;
            }
            G = j.data;
            for (const w of localOnly) {
                G.workouts.push(w);
                if (w.id >= G.nextId) G.nextId = w.id + 1;
            }
            if (!G.workouts) G.workouts = [];
            if (!G.del) G.del = [];
            if (!G.templates) G.templates = [];
            /* nextId не откатывается ниже локально известного — защита от id-коллизий */
            if (G.nextId < localNextId) G.nextId = localNextId;
            for (const w of G.workouts) if (w.id >= G.nextId) G.nextId = w.id + 1;
            for (const d of (G.del || [])) if (d >= G.nextId) G.nextId = d + 1;
            if (G.nextId < 1) G.nextId = 1;
            if (G.profile) profileSex = G.profile.sex;
            render();
        }
    } catch (e) { /* noop */ }
}
document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !(tab === 'history' && viewWid)) reloadSilently();
});
window.addEventListener('focus', function () {
    if (!(tab === 'history' && viewWid)) reloadSilently();
});

/* ============ доставка действий ============ */
/* кнопки без дедупа: быстрый повторный тап легален (ввод значений, ретрай после ошибки);
   [UX-T29] saveProfile — тоже: поправил дату после тоста-ошибки и сразу жмёшь «Сохранить» */
const NO_DEDUP = {
    wAdd: 1, wSet: 1, wClr: 1, setsSet: 1, repsSet: 1, repsAdd: 1, rClr: 1, sClr: 1, saveEntry: 1, planTake: 1,
    saveProfile: 1
};
function dispatchFromEl(el, ev) {
    const act0 = el.getAttribute('data-act');
    /* кнопки ввода и сохранения: без дедупа — быстрый повторный тап после ошибки валидации легален
       (двойной вызов предотвращается на уровне touchend preventDefault) */
    if (!(act0 && NO_DEDUP[act0]) && Date.now() - (el.__gymFired || 0) < 400) return;
    el.__gymFired = Date.now();
    const fav = el.getAttribute('data-fav');
    if (fav) { toggleFav(fav); return; }
    const act = el.getAttribute('data-act');
    if (act === 'modalBackdrop') {
        if (!ev || ev.target === el) {
            /* [EXR-T4 fix] шит фильтров Техники закрыт фоновым тапом — чипы-счётчики
               и мини-чипы на экране устарели: перерисовываем (прочие модалки — нет) */
            const sheetOpen = !!document.querySelector('#modal.open .frow');
            closeModal();
            if (sheetOpen && tab === 'tech' && !TECH.open) render();
        }
        return;
    }
    /* [ONB-T7] тап по фону модалки «Что нового» закрывает её (решение 9) */
    if (act === 'wnBackdrop') {
        if (!ev || ev.target === el) wnClose();
        return;
    }
    const fn = ACTIONS[act];
    if (typeof fn === 'function') {
        fn(el.getAttribute('data-a'), el.getAttribute('data-b'), el.getAttribute('data-c'));
    }
}
window.addEventListener('click', function (ev) {
    /* [UX-T14] сразу после перетаскивания синтетический клик не должен ничего открыть */
    if (__dragClickGuard && Date.now() - __dragClickGuard < 450) return;
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-fav],[data-act]') : null;
    if (el) dispatchFromEl(el, ev);
}, true);

/* тап vs скролл: действие только для чистого тапа (без движения, короче 500 мс) */
let __tap = null;
document.addEventListener('touchstart', function (ev) {
    if (ev.touches.length > 1) { __tap = null; return; }
    const t = ev.touches[0];
    __tap = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
}, { passive: true });
document.addEventListener('touchmove', function (ev) {
    if (!__tap) return;
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - __tap.x) > 15 || Math.abs(t.clientY - __tap.y) > 15) __tap.moved = true;
}, { passive: true });
document.addEventListener('touchend', function (ev) {
    const info = __tap;
    __tap = null;
    const t = ev.target;
    /* андроид-баг: поле остаётся «в фокусе» после закрытия клавиатуры — тап вне поля снимает фокус */
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && !(t && t.closest && t.closest('input,textarea'))) {
        try { ae.blur(); } catch (e0) { /* noop */ }
    }
    if (t && t.closest && t.closest('input,textarea')) return; /* поля ввода: не мешаем фокусу и каретке */
    const el = t && t.closest ? t.closest('[data-fav],[data-act]') : null;
    if (!el) return;
    if (!info || info.moved || Date.now() - info.time > 500) return; /* это был скролл, не тап */
    if (__dragClickGuard && Date.now() - __dragClickGuard < 450) return; /* [UX-T14] отпускание после drag — не тап */
    if (ev.cancelable) ev.preventDefault();
    dispatchFromEl(el, ev);
}, false);
window.addEventListener('error', function (ev) {
    dbgMsg('ОШИБКА JS: ' + (ev && ev.message || '?') + ' @' + (ev && ev.lineno || '?'));
});
function dbgMsg(t) {
    const d = document.getElementById('dbg');
    if (d) d.textContent = t;
}
let __toastTimer = null;
function toast(msg, isErr) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    if (__toastTimer) clearTimeout(__toastTimer);
    __toastTimer = setTimeout(function () { t.className = 'toast'; }, 2200);
}
/* PR-поздравление [UX-T2]: янтарный тост 3.5 с (обычный 2.2 с) + хаптика success */
function toastPr(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show pr';
    if (tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred) {
        try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* noop */ }
    }
    if (__toastTimer) clearTimeout(__toastTimer);
    __toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
}

/* ============ таймер отдыха [UX-T4] ============ */
/* остаток всегда вычисляется от абсолютной метки end — вкладки, сон устройства и
   перезагрузка не уводят отсчёт (спека §1.7). Схема gymRest: {end, dur, paused, left, mini, ex} */
function restRead() {
    try { return JSON.parse(localStorage.getItem('gymRest') || 'null'); } catch (e) { return null; }
}
function restWrite() {
    if (!REST) return;
    try { localStorage.setItem('gymRest', JSON.stringify(REST)); } catch (e) { /* noop */ }
}
function restClear() {
    REST = null;
    try { localStorage.removeItem('gymRest'); } catch (e) { /* noop */ }
    renderRestbar();
}
function restFmt(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
}
function restSoundOn() {
    try { return localStorage.getItem('gymRestSound') !== 'off'; } catch (e) { return true; }
}
/* фактическая длительность отдыха: настройки нет → дефолт 90; 0 = «выкл» [UX-T13] */
function restDur() {
    return G && G.restSec != null ? G.restSec : 90;
}
/* запуск/перезапуск: лог нового подхода всегда начинает полный отсчёт (§1.8) */
function restStart(sec, ex) {
    REST = { end: Date.now() + sec * 1000, dur: sec, paused: false, mini: false, ex: ex || '' };
    __restExpiredFired = false;
    restWrite();
    renderRestbar();
}
/* восстановление при старте: пауза → показать left; идёт → продолжить; истёк < 60 с → «Истёк»;
   иначе ключ протух и стирается (§1.7) */
function restInitState() {
    REST = restRead();
    /* повреждённый ключ (нет ни end, ни paused): без guard в отсчёте остаётся NaN */
    if (!REST || (!REST.paused && !(REST.end > 0))) REST = null;
    if (REST) {
        const now = Date.now();
        if (REST.paused) {
            if (!(REST.left > 0)) REST = null;
        } else if (!(REST.end > now) && now - REST.end >= 60000) {
            REST = null;
        }
    }
    if (REST) restWrite();
    else { try { localStorage.removeItem('gymRest'); } catch (e) { /* noop */ } }
    renderRestbar();
    setInterval(restTick, 1000);
}
function restTick() {
    if (!REST) return;
    const now = Date.now();
    if (REST.paused) return; /* остаток заморожен */
    const left = Math.ceil((REST.end - now) / 1000);
    if (left <= 0) {
        if (!__restExpiredFired) {
            __restExpiredFired = true;
            restSignal();
            toast('⏱ Отдых окончен');
            renderRestbar(); /* состояние «Истёк»: glow + «Скрыть» */
        }
        if (now - REST.end > 30000) restClear(); /* авто-скрытие через 30 с без тапа */
        return;
    }
    /* у свёрнутой пилюли нет #rbTime/#rbFill — обновляем её перерисовкой */
    if (REST.mini) renderRestbar();
    else restUpdateDom();
}
function restLeftSec() {
    if (!REST) return 0;
    return REST.paused ? (REST.left || 0) : Math.max(0, Math.ceil((REST.end - Date.now()) / 1000));
}
/* панель над навигацией; на экране с backbar — стопкой выше (§1.3). [UX-T23] backbar
   теперь у обеих карточек (активной и завершённой) — панель поднимается на обеих */
function restRaised() {
    const w = (tab === 'history' && viewWid) ? findW(viewWid) : null;
    return !!w || (tab === 'tech' && !!TECH.open);
}
function renderRestbar() {
    const el = document.getElementById('restbar');
    if (!el) return;
    if (!REST) { el.className = 'restbar hidden'; el.innerHTML = ''; return; }
    const now = Date.now();
    const expired = !REST.paused && REST.end <= now;
    const cls = 'restbar' + (restRaised() ? ' raised' : '');
    if (REST.mini && !expired) {
        el.className = cls;
        el.innerHTML = '<div class="rb-pillrow"><button class="rb-pill" data-act="restUnfold">⏱ ' + restFmt(restLeftSec()) +
            ' <small>развернуть ⌃</small></button></div>';
        return;
    }
    el.className = cls;
    if (expired) {
        el.innerHTML = '<div class="rb-main glow"><div class="rb-done"><span class="ok">✅</span>' +
            '<span class="txt">Перерыв окончен — время работать 💪</span>' +
            '<button class="hidebtn" data-act="restHide">Скрыть</button></div></div>';
        return;
    }
    const left = restLeftSec();
    const pct = Math.max(2, Math.min(100, Math.round(left / Math.max(REST.dur, 1) * 100)));
    /* [UX-T17] компактная панель — ОДНА строка: [⏱][отсчёт][пауза][+30][✕][⌄], кнопки одного
       размера; подпись «Отдых · Упражнение» — в title панели; прогресс — линия 3px по низу */
    el.innerHTML = '<div class="rb-main" title="Отдых' + (REST.ex ? ' · ' + esc(REST.ex) : '') + '">' +
        '<div class="rb-row">' +
        '<span class="rb-ico">⏱</span>' +
        '<span class="rb-time' + (REST.paused ? ' paused' : '') + '" id="rbTime">' + restFmt(left) + '</span>' +
        '<span class="rb-btns">' +
        '<button class="rb-sqbtn" data-act="restPause" title="' + (REST.paused ? 'Продолжить' : 'Пауза') + '" aria-label="' + (REST.paused ? 'Продолжить' : 'Пауза') + '">' + (REST.paused ? '▶' : '⏸') + '</button>' +
        '<button class="rb-sqbtn rb-sm" data-act="restMore" title="+30 сек" aria-label="Добавить 30 секунд">+30</button>' +
        '<button class="rb-sqbtn" data-act="restReset" title="Закрыть" aria-label="Закрыть таймер">✕</button>' +
        '<button class="rb-sqbtn" data-act="restFold" title="Свернуть" aria-label="Свернуть панель">⌄</button>' +
        '</span></div>' +
        '<div class="rb-line"><i id="rbFill" style="width:' + pct + '%"></i></div>' +
        '</div>';
}
/* дешёвое обновление цифр/шкалы раз в секунду, без перерисовки панели */
function restUpdateDom() {
    const t = document.getElementById('rbTime');
    if (!t) return;
    const left = restLeftSec();
    t.textContent = restFmt(left);
    const f = document.getElementById('rbFill');
    if (f) f.style.width = Math.max(2, Math.min(100, Math.round(left / Math.max(REST.dur, 1) * 100))) + '%';
}
/* сигнал по окончании: хаптика → вибрация всегда; бип — если звук включён (§1.6) */
function restSignal() {
    if (tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred) {
        try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) { /* noop */ }
    } else if (navigator.vibrate) {
        try { navigator.vibrate([180, 90, 180]); } catch (e) { /* noop */ }
    }
    if (restSoundOn()) restBeep();
}
function restAudioUnlock() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!__restAudio) __restAudio = new AC();
        if (__restAudio.state === 'suspended') __restAudio.resume().catch(function () { /* noop */ });
    } catch (e) { /* noop */ }
}
/* 3 коротких бипа 880/880/1318 Гц по ~0.18 с (последний выше — «финиш») */
function restBeep() {
    try {
        restAudioUnlock();
        if (!__restAudio) return;
        const ac = __restAudio;
        const t0 = ac.currentTime + 0.02;
        [[880, 0], [880, 0.28], [1318, 0.56]].forEach(function (b) {
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.type = 'sine';
            o.frequency.value = b[0];
            g.gain.setValueAtTime(0.0001, t0 + b[1]);
            g.gain.exponentialRampToValueAtTime(0.22, t0 + b[1] + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + b[1] + 0.18);
            o.connect(g);
            g.connect(ac.destination);
            o.start(t0 + b[1]);
            o.stop(t0 + b[1] + 0.2);
        });
    } catch (e) { /* тихо: только визуал */ }
}
/* разблокировка звука на первом тапе (мобильные браузеры) */
document.addEventListener('pointerdown', restAudioUnlock, { once: true, passive: true });
/* синхронизация вкладок: ключ gymRest один, последняя запись побеждает (§1.8) */
window.addEventListener('storage', function (ev) {
    if (ev.key !== 'gymRest') return;
    REST = restRead();
    __restExpiredFired = false;
    renderRestbar();
});

/* кнопки панели: пауза хранит остаток в left и удаляет end (§1.7) */
function restFold() {
    if (!REST) return;
    REST.mini = true;
    restWrite();
    renderRestbar();
}
function restUnfold() {
    if (!REST) return;
    REST.mini = false;
    restWrite();
    renderRestbar();
}
function restPause() {
    if (!REST) return;
    if (REST.paused) {
        REST.end = Date.now() + (REST.left || 0) * 1000;
        REST.paused = false;
        delete REST.left;
        __restExpiredFired = false;
    } else {
        REST.left = Math.max(0, Math.ceil((REST.end - Date.now()) / 1000));
        REST.paused = true;
        delete REST.end;
    }
    restWrite();
    renderRestbar();
}
function restMore() {
    if (!REST) return;
    if (REST.paused) REST.left = (REST.left || 0) + 30;
    else REST.end += 30000;
    REST.dur += 30; /* шкала удлиняется */
    __restExpiredFired = false;
    restWrite();
    renderRestbar();
}
/* настройка длительности в Профиле: чипы 60/90/120/180, «Своё…» (§1.5) и «Выкл» = 0 [UX-T13] */
function restSet(n) {
    if (n !== 0 && !(n >= 30 && n <= 600)) return;
    REST_CUSTOM = false;
    G.restSec = n;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); render(); });
}

function restCustomSave() {
    const v = parseInt(String((document.getElementById('restCustomSec') || {}).value || ''), 10);
    if (!(v >= 30 && v <= 600)) { toast('Число от 30 до 600', true); return; }
    REST_CUSTOM = false;
    G.restSec = v;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); render(); });
}

/* ============ темы: тёмная (базовая) и светлая «Amber Glass» ============ */
function bgLum(hex) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
/* подсказка темы от клиента Telegram (themeParams) */
function themeHint() {
    if (tg && tg.colorScheme === 'light') return 'light';
    if (tg && tg.colorScheme === 'dark') return 'dark';
    if (tg && tg.themeParams && tg.themeParams.bg_color) {
        const lum = bgLum(tg.themeParams.bg_color);
        if (lum != null) return lum > 0.55 ? 'light' : 'dark';
    }
    return 'dark';
}
/* сохранённый выбор пользователя: новые значения или старые темы (маппинг) */
function savedTheme() {
    let v = null;
    try { v = localStorage.getItem('gymTheme'); } catch (e) { /* noop */ }
    if (v === 'dark' || v === 'light') return v;
    if (OLD_THEME_DARK.indexOf(v) >= 0) return 'dark';
    if (OLD_THEME_LIGHT.indexOf(v) >= 0) return 'light';
    return null;
}
function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id === 'light' ? 'light' : 'dark');
    if (tg && tg.setHeaderColor) { try { tg.setHeaderColor('secondary_bg_color'); } catch (e) { /* noop */ } }
}
function setTheme(id) {
    applyTheme(id);
    try { localStorage.setItem('gymTheme', id === 'light' ? 'light' : 'dark'); } catch (e) { /* noop */ }
}
function loadTheme() {
    const saved = savedTheme();
    if (saved) { applyTheme(saved); return; }
    /* выбора нет — берём подсказку от клиента Telegram */
    applyTheme(themeHint());
    if (tg && tg.onEvent) {
        try {
            tg.onEvent('themeChanged', function () {
                if (!savedTheme()) applyTheme(themeHint());
            });
        } catch (e) { /* noop */ }
    }
}

/* [UX-T25] полноэкранный режим Mini App: состояние в localStorage gymFullscreen ('1'/'0'),
   по умолчанию выключен; нужен Telegram 8.0+ — на старом клиенте requestFullscreen
   бросает исключение: показываем только тост и флаг не ставим.
   isFullscreen НЕ проверяем синхронно: клиент подтверждает вход асинхронно
   (событие fullscreenChanged) — синхронная проверка ложно ругалась бы на 8.0+ */
function fullscreenOn() {
    let v = '0';
    try { v = localStorage.getItem('gymFullscreen') || '0'; } catch (e) { /* noop */ }
    return v === '1';
}
function fullscreenToggle() {
    if (!tg || !tg.requestFullscreen) { toast('Не поддерживается этим Telegram'); return; }
    if (!fullscreenOn()) {
        try { tg.requestFullscreen(); } catch (e1) { toast('Не поддерживается этим Telegram'); return; }
        /* вызов принят: вход подтвердится событием fullscreenChanged; при неудаче
           флаг просто повторно применится при следующем старте (см. init) */
        try { localStorage.setItem('gymFullscreen', '1'); } catch (e2) { /* noop */ }
        toast('Полноэкранный режим включён');
    } else {
        try { tg.exitFullscreen(); } catch (e3) { /* noop */ }
        try { localStorage.setItem('gymFullscreen', '0'); } catch (e4) { /* noop */ }
        toast('Обычный режим');
    }
}

/* [UX-B10] fullscreen safe-area: класс fs на body + переменная --fs-inset-top на :root.
   Вход/выход fullscreen и изменение safe-area приходят событиями (fullscreenChanged,
   safeAreaChanged); на старте isFullscreen вендор восстанавливает из sessionStorage
   синхронно. safeAreaInset.top — число px (вендор дублирует в --tg-safe-area-inset-*,
   свойство держим своё — не зависим от наличия API). Переменная ставится ВСЕГДА, поэтому
   CSS-фолбэк не срабатывает: нет корректного числа от API — пишем JS-дефолт top=28,
   но правило [UX-B11] берёт max(56px, var(--fs-inset-top, 56px)) — фактический
   минимум остаётся 56px; есть число от API — фактический inset */
function applyFsChrome() {
    let on = false, top = 28;
    try { on = !!(tg && tg.isFullscreen); } catch (e1) { /* noop */ }
    try {
        if (tg && tg.safeAreaInset && typeof tg.safeAreaInset.top === 'number') top = tg.safeAreaInset.top;
    } catch (e2) { /* noop */ }
    document.body.classList.toggle('fs', on);
    try { document.documentElement.style.setProperty('--fs-inset-top', top + 'px'); } catch (e3) { /* noop */ }
}

/* ============ ACTIONS ============ */
const ACTIONS = {
    switchTab: function (a) {
        /* [UX-T20] вход на «Технику» через навигацию: сбрасываем фильтр к «Все» — как при первом входе */
        if (a === 'tech' && tab !== 'tech') techResetState();
        /* [UX-T22] уход с открытой карточки через нижнее меню — автосейв в фоне
           (без await: смену вкладки сеть не задерживает; ошибку показывает doSave) */
        if (tab === 'history' && viewWid && isDirty()) save();
        /* [UX-T27] тап по любому табу закрывает Настройки и переходит на вкладку [UX-S4 §3] */
        settingsOpen = false;
        /* [ONB-T5] тап по любому табу закрывает и Помощь (тот же паттерн подэкрана) */
        helpOpen = false;
        /* [UX-S6] тап по любому табу закрывает и календарь [§3.4] */
        calOpen = false;
        tab = a; viewWid = 0; render();
    },
    /* [UX-T27] шестерёнка в topbar: экран «Настройки» поверх текущей вкладки [UX-S4 §3] */
    openSettings: function () {
        settingsOpen = true;
        window.scrollTo(0, 0);
        render();
    },
    closeSettings: function () {
        settingsOpen = false;
        window.scrollTo(0, 0);
        render();
    },
    /* [UX-S6] календарь тренировок — подэкран как Настройки [§3.4]; все смены месяца
       пишут gymCalMonth [§7.3] */
    openCal: function () {
        calOpen = true;
        calFromTab = tab; /* ред. 5: кнопка на всех вкладках — «Назад» вернёт на источник [§3.4] */
        calInitMonth();
        window.scrollTo(0, 0);
        render();
    },
    closeCal: function () {
        calOpen = false;
        tab = calFromTab; /* возврат на вкладку, с которой открыли календарь [§3.4] */
        window.scrollTo(0, 0);
        render();
    },
    calPrev: function () { calShift(-1); },
    calNext: function () { calShift(1); },
    calToday: function () {
        const t = new Date();
        CAL.y = t.getFullYear();
        CAL.m = t.getMonth();
        CAL.sel = null;
        calSaveMonth();
        render();
    },
    /* тап по дню: 1+ тренировок → инлайн-панель дня (карточка напрямую НЕ открывается —
       ред. 4/5: единый сценарий «сначала обзор → потом карточка»), 0 → ничего [§6] */
    calDay: function (a) {
        const list = workoutsByDate()[a] || [];
        if (!list.length) return;
        CAL.sel = CAL.sel === a ? null : a; /* повторный тап — сброс выбора */
        render();
    },
    openHistory: function (a) {
        editSnap = JSON.stringify(G);
        viewWid = +a;
        tab = 'history';
        render();
    },
    openEntryModal: function (a, b, c) { openEntryModal(+a, +b, +c); },
    /* [UX-T22] выход из карточки — всегда с тихим автосохранением: модалки
       «выйти без сохранения?» больше нет; успех — без тоста, ошибку показывает doSave;
       при сбое автосейва карточка НЕ закрывается — правки остаются для повтора выхода */
    closeHistory: async function () {
        if (isDirty()) { const r = await save(); if (r !== 'ok') return; } /* тост уже показан doSave'ом */
        editSnap = null;
        viewWid = 0;
        render();
    },
    /* [UX-T23] ACTION saveWorkout удалён вместе с иконкой 💾 из шапки завершённой:
       сохранение — автосейв при выходе (closeHistory) */
    startWorkout: function () { startWorkout(); },
    newBlank: function () { closeModal(); startBlank(); },
    newRepeat: function () { newRepeatLast(); },
    newRepeatFrom: function (a) { newRepeatFrom(+a); },
    conflictKeep: function () { conflictKeep(); },
    conflictDiscard: function () { conflictDiscard(); },
    tplStart: function (a) { tplStart(+a); },
    tplDelAsk: function (a) { tplDelAsk(+a); },
    tplDelete: function (a) { tplDelete(+a); },
    tplSaveModal: function (a) { tplSaveModal(+a); },
    tplSave: function (a) { tplSave(+a); },
    finishWorkout: function (a) { finishWorkout(+a); },
    deleteWorkout: function (a) { deleteWorkout(+a); },
    openPicker: function (a) { openPicker(+a); },
    pickerSection: function (a) { if (PICKER) { PICKER.section = a; PICKER.cat = null; renderPickerChips(); renderPickerList(); } },
    pickerCat: function (a) { if (PICKER) { PICKER.cat = PICKER.cat === a ? null : a; renderPickerChips(); renderPickerList(); } },
    pickCatEx: function (a) { pickCatEx(a); },
    customExerciseModal: function () { customExerciseModal(); },
    createCustom: function () { createCustom(); },
    openTech: function (a) { TECH.open = a; render(); },
    techBack: function () { TECH.open = null; render(); },
    /* [EXR-T4] режимы Техники: «Все» = без фильтров (мультивыбор сбрасывается),
       ★ Любимые/Своё/Коллекции — режимы поверх фильтров (выбор сохраняется) */
    techSection: function (a) {
        TECH.section = a;
        TECH.cat = null;
        if (a === 'all') techClearFilters();
        render();
    },
    techCat: function (a) { TECH.cat = TECH.cat === a ? null : a; render(); },
    /* [EXR-T4] фильтры-мультивыбор: шиты чекбоксов, одиночные категории, мини-чипы */
    techFiltersMuscle: function () { openModal(techSheetHtml('muscle')); },
    techFiltersGear: function () { openModal(techSheetHtml('gear')); },
    techSheetToggle: function (a) { techSheetToggle(a); },
    techApplyFilters: function () { closeModal(); render(); },
    techCatToggle: function (a) {
        const k = TECH.fCats.indexOf(a);
        if (k === -1) TECH.fCats.push(a); else TECH.fCats.splice(k, 1);
        render();
    },
    techGroupRemove: function (a) { const s = techGroupSel(a); if (s.k !== -1) s.arr.splice(s.k, 1); render(); },
    techGroupClear: function (a) { if (a === 'muscle') TECH.fMuscle = []; else TECH.fGear = []; render(); },
    techResetFilters: function () { techResetState(); render(); },
    /* [UX-T17] «⭐ Любимые упражнения» из Профиля: вкладка «Техника» + фильтр «★ Любимые».
       [UX-T23] lastTab-механика «Назад» убрана вместе с кнопкой tb-back */
    openFavs: function () { techResetState(); TECH.section = 'fav'; tab = 'tech'; viewWid = 0; render(); },
    wAdd: function (a) { wAdd(+a); },
    wSet: function (a) { wSet(a); },
    wClr: function () { wClr(); },
    sClr: function () { sClr(); },
    rClr: function () { rClr(); },
    setsSet: function (a) { setsSet(+a); },
    repsSet: function (a) { repsSet(a); },
    repsAdd: function (a) { repsAdd(+a); },
    planTake: function () { planTake(); },
    saveEntry: async function () { await saveEntry(); },
    deleteEntry: async function () { await deleteEntry(); },
    renameExercise: function (a, b) { renameExercise(+a, +b); },
    doRename: async function () { await doRename(); },
    deleteExercise: function (a, b) { deleteExercise(+a, +b); },
    deleteExerciseGo: function () { deleteExerciseGo(); },
    deleteSet: function (a, b, c) { deleteSet(+a, +b, +c); },
    deleteSetGo: function () { deleteSetGo(); },
    nutrModal: function (a) { nutrModal(+a); },
    saveNutr: function (a) { saveNutr(+a); },
    clearNutr: function (a) { clearNutr(+a); },
    titleModal: function (a) { titleModal(+a); },
    saveTitle: function (a) { saveTitle(+a); },
    autoTitle: function (a) { autoTitle(+a); },
    timeModal: function (a) { timeModal(+a); },
    saveTime: function (a) { saveTime(+a); },
    confirmModal: function (a, b, c) { confirmModal(a, b, +c); },
    confirmYes: function () { confirmYes(); },
    setTheme: function (a) { setTheme(a); render(); },
    setSex: function (a) { profileSex = a; render(); },
    saveProfile: function () { saveProfile(); },
    restFold: function () { restFold(); },
    restUnfold: function () { restUnfold(); },
    restPause: function () { restPause(); },
    restMore: function () { restMore(); },
    restReset: function () { restClear(); },
    restHide: function () { restClear(); },
    restSet: function (a) { restSet(+a); },
    restCustom: function () { REST_CUSTOM = true; render(); },
    restCustomSave: function () { restCustomSave(); },
    restSound: function (a) {
        try { localStorage.setItem('gymRestSound', a === 'off' ? 'off' : 'on'); } catch (e) { /* noop */ }
        render();
    },
    closeModal: function () { closeModal(); },
    /* [EXR-T4 fix] фоновый тап перехватывается в dispatchFromEl до ACTIONS —
       там же перерисовка после закрытия шита фильтров Техники */
    modalBackdrop: function () { closeModal(); },
    /* [ONB-T2] политика конфиденциальности: openLink внутри Telegram, иначе обычная вкладка */
    openPrivacy: function () {
        const url = 'https://gym-helper.com/privacy.html';
        if (tg && tg.openLink) tg.openLink(url);
        else window.open(url, '_blank');
    },
    /* ============ [ONB-T3..T7] онбординг ============ */
    /* [ONB-T3] приветствие-карусель: «Далее»→…→«Начать» / «Пропустить» (слайды 1–2) */
    obNext: function () {
        if (obSlide < OB_SLIDES.length - 1) { obSlide++; render(); obAlignTrack(); }
        else obFinish();
    },
    obSkip: function () { obFinish(); },
    /* [ONB-T4] туториал: «Дальше»/«Пропустить»; щит перехватывает тапы — ничего не делает */
    tutNext: function () { tutNext(); },
    tutSkip: function () { if (obTracked) trackOnb('onboardingTutorialSkipped'); tutFinish(); }, /* [ANA-T5] пропуск туториала */
    tutShield: function () { /* перехват: элементы под подсказкой некликабельны */ },
    /* [ONB-T5] Помощь: точка входа Настройки → «О приложении» → «Помощь и FAQ» */
    openHelp: function () {
        helpOpen = true;
        helpFaq = 0;
        srvState = '';
        lsSet('gymHelpSeen', '1'); /* пилюля «новое» видна до первого открытия (решение 13) */
        window.scrollTo(0, 0);
        render();
    },
    closeHelp: function () {
        helpOpen = false;
        settingsOpen = true; /* «← Назад» — на Настройки (точка входа) */
        window.scrollTo(0, 0);
        render();
    },
    faqToggle: function (a) { helpFaq = (helpFaq === +a) ? -1 : +a; render(); },
    /* [ONB-T4] повтор туториала из Помощи (решение 3) */
    replayTut: function () { tutStart(); },
    /* [ONB-T6] контакты: deep-link на чат с ботом (?start=feedback), копирование email */
    openFeedback: function () {
        const url = 'https://t.me/' + BOT_NAME + '?start=feedback';
        if (tg && tg.openLink) tg.openLink(url);
        else window.open(url, '_blank');
    },
    copyEmail: function () { copyText(SUPPORT_EMAIL); },
    checkServer: function () { checkServer(); },
    /* [ONB-T7] «Что нового»: ручная строка в «О приложении», «Понятно»/«Больше не показывать» */
    wnRow: function () { wnOpenManual(); },
    wnAck: function () { wnClose(); },
    wnBackdrop: function () { wnClose(); }, /* фоновый тап — перехват в dispatchFromEl (как modalBackdrop) */
    wnOff: function () {
        lsSet('gymWnOff', '1'); /* автопоказ глушится; ручная строка продолжает работать (решение 8) */
        if (wnRel) lsSet('gymWnVer', wnRel.ver);
        wnOpen = false;
        render();
    },
    wnToggle: function () {
        /* тогл «Сообщать об обновлениях» синхронен gymWnOff: включение снимает флаг (§6) */
        if (lsGet('gymWnOff') === '1') lsDel('gymWnOff');
        else lsSet('gymWnOff', '1');
        render();
    },
    pickBg: function () { const el = document.getElementById('bgFile'); if (el) el.click(); },
    clearBg: function () {
        try { localStorage.removeItem('gymBg'); } catch (e) { /* noop */ }
        document.documentElement.classList.remove('has-bg');
        toast('Фон убран');
    },
    /* [UX-T25] тогл полноэкранного режима в Настройках; render — тогл показывает
       актуальное состояние (подтверждение клиента приходит асинхронно) [UX-T27/UX-S4 §8.2] */
    fullscreenToggle: function () { fullscreenToggle(); render(); }
};

/* ============ каркас ============ */
function render() {
    const app = document.getElementById('app');
    let h = topbarHtml();
    /* [UX-T27] Настройки — подэкран поверх вкладки: контент вкладки и backbar карточки
       тренировки не рендерим, нижняя навигация остаётся [UX-S4 §3] */
    /* [UX-S6] Календарь — подэкран как Настройки; открытая карточка (viewWid) приоритетнее:
       openHistory из календаря НЕ сбрасывает calOpen, «← Назад» backbar'а возвращает
       в календарь с сохранённым месяцем и выбором [§6] */
    /* [ONB-T5] Помощь — подэкран в том же паттерне (вход из Настроек) */
    if (helpOpen) h += renderHelp();
    else if (settingsOpen) h += renderSettings();
    else if (calVisible()) h += renderCalendar();
    else {
        if (tab === 'history') h += renderHistoryTab();
        if (tab === 'tech') h += renderTechTab();
        if (tab === 'stats') h += renderStatsTab();
        if (tab === 'coach') h += renderCoachTab();
        if (tab === 'profile') h += renderProfileTab();
    }
    h += navHtml();
    /* [UX-T18] backbar у активной тренировки — три компактные кнопки;
        [UX-T22] «💾 Сохранить» убрана (выход всегда автосохраняет), порядок:
        🗑 Удалить c confirm / ✓ Завершить (жёлтая prime) / ← Назад (автосейв-выход);
        [UX-T23] у завершённой из истории — свой backbar: 🗑 Удалить c confirm /
        ↻ Повторить (newRepeatFrom, НЕ prime) / ← Назад (автосейв-выход) */
    const bw = (!settingsOpen && tab === 'history' && viewWid) ? findW(viewWid) : null;
    if (bw && !bw.finished) {
        h += '<div class="backbar"><div class="ab-row">' +
            '<button class="btn sec icbtn bb-del" data-act="confirmModal" data-a="Удалить тренировку?" data-b="deleteWorkout" data-c="' + bw.id + '" title="Удалить" aria-label="Удалить тренировку">' + ICONS.trash + '<span>Удалить</span></button>' +
            '<button class="btn prime" data-act="finishWorkout" data-a="' + bw.id + '">✓ Завершить</button>' +
            '<button class="btn sec icbtn bb-back" data-act="closeHistory" title="Назад" aria-label="Назад">' + ICONS.back + '<span>Назад</span></button>' +
            '</div></div>';
        h += '<div style="height:70px"></div>';
    }
    if (bw && bw.finished) {
        h += '<div class="backbar"><div class="ab-row">' +
            '<button class="btn sec icbtn bb-del" data-act="confirmModal" data-a="Удалить тренировку?" data-b="deleteWorkout" data-c="' + bw.id + '" title="Удалить" aria-label="Удалить тренировку">' + ICONS.trash + '<span>Удалить</span></button>' +
            '<button class="btn sec icbtn" data-act="newRepeatFrom" data-a="' + bw.id + '" title="Повторить" aria-label="Повторить">' + ICONS.repeat + '<span>Повторить</span></button>' +
            '<button class="btn sec icbtn bb-back" data-act="closeHistory" title="Назад" aria-label="Назад">' + ICONS.back + '<span>Назад</span></button>' +
            '</div></div>';
        h += '<div style="height:70px"></div>';
    }
    /* [UX-T13] «К упражнениям» переехала в шапку экрана техники компактной иконкой — backbar внизу больше не нужен */
    /* [ONB] оверлеи онбординга — поверх всего (приветствие z-60, туториал z-46..48, «Что нового» z-52) */
    if (obOpen) h += obWelcomeHtml();
    if (tutOpen) h += tutOverlayHtml();
    if (wnOpen) h += wnModalHtml();
    app.innerHTML = h;
    if (tab === 'tech' && !TECH.open) {
        const q = document.getElementById('techQ');
        /* [EXR-T4] refreshTechList: живой список + пустое состояние (раньше techListHtml была не определена) */
        if (q) q.addEventListener('input', function () { TECH.q = this.value; refreshTechList(); });
    }
    /* [UX-T29] живая строка возраста: change на select-ах даты рождения */
    if (tab === 'profile') pfBirthBind();
    renderRestbar(); /* панель/пилюля таймера переживает навигацию: класс raised и содержимое актуальны */
    /* [ONB] пост-выравнивание оверлеев: карусель по ширине контейнера, тултип по месту подсветки */
    if (obOpen) obAlignTrack();
    if (tutOpen) tutPlaceTip();
    dbgMsg('rev ' + (G ? G.rev : '-'));
}
function navHtml() {
    const left = [
        ['history', 'history', 'История'],
        ['stats', 'chart', 'Статистика']
    ];
    const right = [
        ['tech', 'pilates', 'Техника'],
        ['profile', 'user', 'Профиль']
    ];
    /* [ONB-T4] спотлайты туториала ВЛОЖЕНЫ в целевые элементы (ред. 5):
       шаг 1 — FAB (.spot.wrap.round), шаг 4 — таб «Статистика» (.spot.wrap.tab) */
    const btn = function (it) {
        const spot = (tutOpen && tutStep === 3 && it[0] === 'stats') ? '<span class="spot wrap tab" aria-hidden="true"></span>' : '';
        return '<button class="nbtn' + (tab === it[0] ? ' on' : '') + '" data-act="switchTab" data-a="' + it[0] + '">' +
            '<span class="nico">' + (ICONS[it[1]] || '') + '</span>' +
            '<span class="nlabel">' + it[2] + '</span>' + spot + '</button>';
    };
    return '<div class="nav">' + left.map(btn).join('') +
        '<button class="nfab" data-act="startWorkout" title="Начать тренировку">' + ICONS.plus +
        (tutOpen && tutStep === 0 ? '<span class="spot wrap round" aria-hidden="true"></span>' : '') + '</button>' +
        right.map(btn).join('') + '</div>';
}
/* [UX-S6] календарь виден как подэкран, если открыт и не перебит карточкой тренировки
   (viewWid) — карточка из календаря рендерится поверх с своим backbar'ом [§6] */
function calVisible() {
    return calOpen && !(tab === 'history' && viewWid);
}
function topbarHtml() {
    /* [UX-T27] вкладка profile снова подписывается «Профиль» (артефакт «Настройки» убран);
       точка входа в настройки — шестерёнка на всех вкладках [UX-S4 §3] */
    const names = { history: 'История', coach: 'Тренер', tech: 'Техника', stats: 'Статистика', profile: 'Профиль' };
    /* [ONB-T5] экран Помощи: «←» слева — возврат в Настройки (точка входа — только они, решение 7) */
    if (helpOpen) {
        return '<div class="topbar"><button class="tb-user" data-act="closeHelp" title="Назад" aria-label="Назад">' + ICONS.back + '</button>' +
            '<span class="tb-title">GymHelper · Помощь</span></div>';
    }
    /* [UX-T27] экран Настроек: «←» слева (возврат на вкладку-источник), справа пусто [UX-S4 §3] */
    if (settingsOpen) {
        return '<div class="topbar"><button class="tb-user" data-act="closeSettings" title="Назад" aria-label="Назад">' + ICONS.back + '</button>' +
            '<span class="tb-title">GymHelper · Настройки</span></div>';
    }
    /* [UX-S6] экран календаря: «←» слева (возврат на вкладку-источник), шестерёнка
       справа [ред. 5 — владелец: «не вижу Настройки. Добавляй»] [§3.4]; кнопки 📅
       при открытом календаре нет — он уже открыт */
    if (calOpen && !(tab === 'history' && viewWid)) {
        return '<div class="topbar"><button class="tb-user" data-act="closeCal" title="Назад" aria-label="Назад">' + ICONS.back + '</button>' +
            '<span class="tb-title">GymHelper · Календарь</span>' +
            '<button class="tb-user" data-act="openSettings" title="Настройки" aria-label="Настройки">' + ICONS.gear + '</button></div>';
    }
    /* [UX-T23] стрелка «←» (tb-back/goBack) убрана: топбар — «GymHelper · <вкладка>» + настройки */
    /* [UX-S6] кнопка календаря — на ВСЕХ вкладках без открытой карточки (ред. 5 —
       «как и настройки»; Настройки/календарь отсечены выше); календарь СЛЕВА,
       шестерёнка справа — пара [ 📅 ][ ⚙ ] всегда в одном месте [§3.2] */
    const calBtn = !viewWid ?
        '<button class="tb-user" data-act="openCal" title="Календарь" aria-label="Календарь">' + ICONS.calendar + '</button>' : '';
    /* [ONB-T4] пара [ 📅 ][ ⚙ ] обёрнута в .tbpair (носитель подсветки, ред. 5);
       на шаге 3 topbar поднят (tut-lift), чтобы затемнение накрыло нижнюю панель */
    const tutPairSpot = (tutOpen && tutStep === 2) ? '<span class="spot wrap pair" aria-hidden="true"></span>' : '';
    return '<div class="topbar' + (tutOpen && tutStep === 2 ? ' tut-lift' : '') + '">' +
        '<span class="tb-title">GymHelper · ' + (names[tab] || 'История') + '</span>' +
        '<span class="tbpair">' + calBtn +
        '<button class="tb-user" data-act="openSettings" title="Настройки" aria-label="Настройки">' + ICONS.gear + '</button>' +
        tutPairSpot + '</span></div>';
}

/* ---------- карточка рекорда недели ---------- */
/* топ-упражнений недели (Пн–Вс): наибольший подход с весом по каждому упражнению;
   all — личный рекорд этого упражнения за всю историю (для шкалы %) */
function weekRecords(limit) {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const byEx = {};
    for (const w of G.workouts) {
        if (!w.finished) continue;
        const d = parseDateISO(w.date);
        if (!d || d < monday) continue;
        for (const e of (w.exercises || [])) {
            for (const s of e.sets) {
                const mw = maxNum(s.w);
                if (mw > 0 && (!byEx[e.name] || mw > byEx[e.name])) byEx[e.name] = mw;
            }
        }
    }
    const list = Object.keys(byEx).map(function (name) {
        let all = 0;
        for (const w of G.workouts) {
            const e = findEx(w, name);
            if (e) for (const s of e.sets) { const mw = maxNum(s.w); if (mw > all) all = mw; }
        }
        return { name: name, w: byEx[name], all: Math.max(all, byEx[name]) };
    });
    list.sort(function (a, b) { return b.w - a.w; });
    return list.slice(0, limit || 3);
}
function recordCardHtml(rec) {
    const pct = Math.max(1, Math.min(100, Math.round(rec.w / rec.all * 100)));
    return '<div class="reccard glow">' +
        '<div class="rec-l">Рекорд недели · ' + esc(rec.name) + '</div>' +
        '<div class="rec-num">' + fmtW(rec.w) + ' <small>кг</small></div>' +
        '<div class="rec-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="rec-sub"><span>личный рекорд: ' + fmtW(rec.all) + ' кг</span><span>' + pct + '%</span></div>' +
        '</div>';
}

/* ---------- превью-карточки истории ---------- */
function previewCard(w) {
    const d = parseDateISO(w.date);
    const dateStr = firstLine(w);
    const rightTop = d ? d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] : '';
    const exs = (w.exercises || []).filter(e => e.sets.length && !isWarmupName(e.name));
    const hasTitle = w.title && w.title.trim();
    const show = exs.slice(0, 3); /* название живёт в строке даты — упражнения всегда три */
    const sets = (w.exercises || []).reduce((a, e) => a + setsCount(e), 0);
    const p = G.profile;
    const res = p && p.weight > 0 ? calcWorkoutKcal(p, w) : null;
    let h = '<div class="pcard' + (w.finished ? '' : ' glow') + '" data-act="openHistory" data-a="' + w.id + '">';
    /* [UX-T20] иконка времени суток из строки даты убрана — дата осталась текстом */
    h += '<div class="pc-daterow">' +
        '<span class="pc-date">' + esc(hasTitle ? String(w.title).split('\n')[0].trim() : dateStr) + '</span>' +
        (w.finished ? '' : '<span class="pc-pill">⚫ идёт</span>') + '</div>';
    h += '<div class="pc-dow">' + rightTop + '</div>';
    h += '<div class="pc-main">';
    if (!show.length) h += '<div class="pc-ex">Без упражнений</div>';
    for (const e of show) h += '<div class="pc-ex">' + esc(e.name) + '</div>';
    h += '</div>';
    h += '<div class="pc-right">';
    if (w.started) {
        const sT = String(w.started).slice(11, 16);
        const range = (w.finished && w.ended) ? sT + '–' + String(w.ended).slice(11, 16) : 'с ' + sT;
        h += '<span class="wpill wp-r">🕐 ' + range + '</span>';
    }
    if (res && res.total > 0) h += '<span class="wpill wp-k">🔥 ' + res.total + ' ккал</span>';
    h += '<span class="wpill wp-s">🏋 ' + sets + ' подх.</span>';
    h += '</div></div>';
    return h;
}

/* ---------- история и карточка ---------- */
function renderHistoryTab() {
    if (viewWid) {
        const w = findW(viewWid);
        if (!w) { viewWid = 0; } else {
            return workoutCard(w);
        }
    }
    const fin = G.workouts.filter(w => w.finished).slice().reverse();
    const act = activeW();
    if (!fin.length && !act) {
        return '<div class="card hero"><p class="t1">Пока пусто 💪</p>' +
            '<p class="muted">Начни первую тренировку — кнопка ниже или «+» в нижнем меню.</p>' +
            '<div class="btnrow"><button class="btn prime wide" data-act="startWorkout">🏋️ Начать тренировку</button></div></div>';
    }
    /* [UX-T31] карточка «Рекорд недели» перенесена во вкладку Статистика */
    let h = '';
    if (act) h += previewCard(act);
    for (const w of fin) h += previewCard(w);
    return h;
}
function openHistory(id) {
    editSnap = JSON.stringify(G);
    viewWid = id;
    tab = 'history';
    render();
}
/* [UX-T22] «есть несохранённые изменения» = снапшот G на входе в карточку (openHistory)
   разошёлся с текущим состоянием; выход (closeHistory) такой сдвиг тихо сохраняет */
function isDirty() { return editSnap !== null && editSnap !== JSON.stringify(G); }

/* ---------- [UX-S6] календарь тренировок ---------- */
function monthIdx(y, m) { return y * 12 + m; }
/* clamp месяца в [MIN_MONTH, MAX_MONTH] — на случай устаревшего gymCalMonth [§7.1, §10.12] */
function calClamp(y, m) {
    const p = MIN_MONTH.split('-'), q = MAX_MONTH.split('-');
    const lo = monthIdx(+p[0], +p[1] - 1), hi = monthIdx(+q[0], +q[1] - 1);
    const v = monthIdx(y, m);
    if (v < lo) return { y: +p[0], m: +p[1] - 1 };
    if (v > hi) return { y: +q[0], m: +q[1] - 1 };
    return { y: y, m: m };
}
function calSaveMonth() {
    try { localStorage.setItem('gymCalMonth', CAL.y + '-' + pad2(CAL.m + 1)); } catch (e) { /* noop */ }
}
/* начальный месяц openCal [§7.3]: валидный gymCalMonth (clamp) → дефолт «месяц последней
   тренировки» → текущий; битая строка — игнор; sel сессионный, между открытиями не хранится */
function calInitMonth() {
    const t = new Date();
    let y = t.getFullYear(), m = t.getMonth();
    let last = null;
    for (const w of G.workouts) {
        const d = parseDateISO(w.date);
        if (d && (!last || d > last)) last = d;
    }
    if (last) { y = last.getFullYear(); m = last.getMonth(); }
    try {
        const mm = /^(\d{4})-(\d{2})$/.exec(localStorage.getItem('gymCalMonth') || '');
        if (mm) { y = +mm[1]; m = +mm[2] - 1; }
    } catch (e) { /* noop */ }
    const cl = calClamp(y, m);
    CAL.y = cl.y;
    CAL.m = cl.m;
    CAL.sel = null;
    calSaveMonth();
}
/* смена месяца стрелками: переход года, clamp на границе, сброс выбора дня [§7.1, §10.9] */
function calShift(dir) {
    let y = CAL.y, m = CAL.m + dir;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    const cl = calClamp(y, m);
    if (cl.y !== y || cl.m !== m) return; /* на границе — стрелка disabled, защиты мало не бывает */
    CAL.y = cl.y;
    CAL.m = cl.m;
    CAL.sel = null;
    calSaveMonth();
    render();
}
/* map тренировок по ISO-датам за один проход O(n): активные тоже попадают (полая
   точка); тренировки с битой датой — мимо календаря (в списке как раньше) [§8, §10.1] */
function workoutsByDate() {
    const byDate = {};
    for (const w of G.workouts) {
        const d = parseDateISO(w.date);
        if (!d) continue;
        const iso = w.date.slice(0, 10);
        (byDate[iso] = byDate[iso] || []).push(w);
    }
    for (const k in byDate) {
        byDate[k].sort(function (a, b) {
            const sa = String(a.started || ''), sb = String(b.started || '');
            if (sa === sb) return a.id - b.id;
            return sa < sb ? -1 : 1;
        });
    }
    return byDate;
}
/* дата последней тренировки СТРОГО раньше 1-го числа месяца y-m — заготовка подсказки
   пустого месяца (рендер под SHOW_MONTH_HINTS = false, решение владельца 09.11) [§8] */
function prevWorkoutBefore(y, m) {
    const first = new Date(y, m, 1);
    let best = null;
    for (const w of G.workouts) {
        const d = parseDateISO(w.date);
        if (d && d < first && (!best || d > best)) best = d;
    }
    return best;
}
/* подпись строки панели дня: первая строка title → первые 2 упражнения с сетами →
   «Без упражнений» [§6.1] */
function dayRowName(w) {
    if (w.title && w.title.trim()) return String(w.title).split('\n')[0].trim();
    const exs = (w.exercises || []).filter(function (e) { return e.sets.length; });
    if (exs.length) return exs.slice(0, 2).map(function (e) { return e.name; }).join(' · ');
    return 'Без упражнений';
}
/* запятая-список до 4 подходящих упражнений для строки панели при 1 тренировке
   (фильтр как в previewCard); 5+ → первые 4 без «и ещё N», 0 → «Без упражнений»
   [ред. 7.3 S6-update6b, §6.1, §13] */
function dayRowExList(w) {
    const exs = (w.exercises || []).filter(e => e.sets.length && !isWarmupName(e.name));
    if (!exs.length) return 'Без упражнений';
    return exs.slice(0, 4).map(e => e.name).join(', ');
}
function renderCalendar() {
    const byDate = workoutsByDate();
    const now = new Date();
    const todayIso = todayISO();
    const minP = MIN_MONTH.split('-'), maxP = MAX_MONTH.split('-');
    const minIdx = monthIdx(+minP[0], +minP[1] - 1), maxIdx = monthIdx(+maxP[0], +maxP[1] - 1);
    const curIdx = monthIdx(now.getFullYear(), now.getMonth());
    const viewIdx = monthIdx(CAL.y, CAL.m);
    const chevL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
    const chevR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';
    let h = '<div class="card cal">';
    /* шапка месяца: ‹ заголовок ›; на границе — dim + disabled [§4.1, §7.1] */
    const atMin = viewIdx <= minIdx, atMax = viewIdx >= maxIdx;
    h += '<div class="cal-nav">' +
        '<button class="cal-navbtn' + (atMin ? ' dim' : '') + '" data-act="calPrev" title="Предыдущий месяц" aria-label="Предыдущий месяц"' + (atMin ? ' disabled aria-disabled="true"' : '') + '>' + chevL + '</button>' +
        '<div class="cal-title">' + MONTHS_FULL[CAL.m] + ' ' + CAL.y + '</div>' +
        '<button class="cal-navbtn' + (atMax ? ' dim' : '') + '" data-act="calNext" title="Следующий месяц" aria-label="Следующий месяц"' + (atMax ? ' disabled aria-disabled="true"' : '') + '>' + chevR + '</button>' +
        '</div>';
    /* сетка: Пн-старт, смежные дни — пустые заглушки [§4.2] */
    h += '<div class="cal-grid">';
    for (const d of DOW) h += '<div class="cal-dow">' + d + '</div>';
    const lead = (new Date(CAL.y, CAL.m, 1).getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) h += '<div class="cal-blank" aria-hidden="true"></div>';
    const daysInMonth = new Date(CAL.y, CAL.m + 1, 0).getDate();
    const monthPrefix = CAL.y + '-' + pad2(CAL.m + 1) + '-';
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = monthPrefix + pad2(d);
        const list = byDate[iso] || [];
        const isToday = iso === todayIso;
        const isSel = CAL.sel === iso;
        let dots = '';
        if (list.length) {
            dots = '<span class="cal-dots">';
            for (const w of list.slice(0, 3)) dots += '<i class="dot' + (w.finished ? '' : ' hollow') + '"></i>';
            dots += '</span>';
        }
        const going = list.length === 1 && !list[0].finished;
        const aria = list.length ? ' aria-label="' + d + ' ' + MONTHS_GEN[CAL.m] + ', ' + (going ? 'идёт тренировка' : list.length + ' ' + trainWord(list.length)) + '"' : '';
        h += '<button class="cal-d' + (list.length ? ' has' : '') + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + '" data-act="calDay" data-a="' + iso + '"' + aria + '>' +
            '<span class="n">' + d + '</span>' + dots + '</button>';
    }
    h += '</div>';
    /* инлайн-панель дня при выборе дня с 1+ тренировками — ЕДИНЫЙ вид: шапка .dph +
       строки .drow по числу тренировок [ред. 7.3 S6-update6, §6.1]; при 1 тренировке
       .nm — запятая-список упражнений и модификатор .multi (clamp-2) [S6-update6b] */
    if (CAL.sel && CAL.sel.indexOf(monthPrefix) === 0) {
        const list = byDate[CAL.sel] || [];
        if (list.length) {
            const dd = parseDateISO(CAL.sel);
            h += '<div class="daypanel" aria-live="polite">';
            h += '<div class="dph"><span>' + DOW_FULL[(dd.getDay() + 6) % 7] + ', ' + dd.getDate() + ' ' + MONTHS_GEN[CAL.m] + '</span><span class="cnt">' + list.length + ' ' + trainWord(list.length) + '</span></div>';
            for (const w of list) {
                const tm = w.started ? ((w.finished && w.ended) ? String(w.started).slice(11, 16) + '–' + String(w.ended).slice(11, 16) : 'с ' + String(w.started).slice(11, 16)) : '—';
                const sets = (w.exercises || []).reduce((a, e) => a + setsCount(e), 0);
                const multi = list.length === 1;
                h += '<button class="drow' + (multi ? ' multi' : '') + '" data-act="openHistory" data-a="' + w.id + '">' +
                    '<span class="tm">' + tm + '</span>' +
                    '<span class="nm">' + esc(multi ? dayRowExList(w) : dayRowName(w)) + '</span>' +
                    (w.finished ? '' : '<span class="live">⚫ идёт</span>') +
                    '<span class="st">🏋 ' + sets + '</span></button>';
            }
            h += '</div>';
        }
    }
    /* пустой месяц [§12]: честный текст (+ ЗАГОТОВКА подсказки под SHOW_MONTH_HINTS) */
    if (!Object.keys(byDate).some(function (iso) { return iso.indexOf(monthPrefix) === 0; })) {
        h += '<div class="calempty">' + (G.workouts.length ? 'В ' + MONTHS_PREP[CAL.m] + ' тренировок не было.' : 'Пока нет тренировок') + '</div>';
        if (SHOW_MONTH_HINTS && G.workouts.length) {
            const prev = prevWorkoutBefore(CAL.y, CAL.m);
            if (prev) h += '<div class="calhint">Предыдущая тренировка — ' + prev.getDate() + ' ' + MONTHS_GEN[prev.getMonth()] + '</div>';
        }
    }
    /* пилюля «Сегодня» — только когда просматриваемый месяц ≠ текущий [§7.2] */
    if (viewIdx !== curIdx) {
        h += '<button class="cal-today" data-act="calToday" aria-label="Вернуться к текущему месяцу">Сегодня</button>';
    }
    h += '</div>';
    return h;
}

/* ---------- карточка тренировки ---------- */
function workoutCard(w) {
    const lines = titleLines(w);
    /* [ONB-T4] шаг 2: карточка поднята (tut-lift), чтобы затемнение спотлайта
       накрыло шапку и нижнюю панель (ред. 5) */
    let h = '<div class="card' + (tutOpen && tutStep === 1 ? ' tut-lift' : '') + '" id="w' + w.id + '">';
    /* [UX-T8]: у завершённых «Повторить» переехала в шапку круглой иконкой;
       [UX-T18]: «💾 В шаблоны» из шапки убрана (сохранение шаблона — только в боте);
       [UX-T20]: иконка времени суток из заголовка убрана;
       [UX-T22]: у активной шапка без ➕/✕/✓/🗑: плюс переехал в кнопку под упражнениями,
       ✓ и 🗑 — в нижний backbar;
       [UX-T23]: шапка любой карточки — ТОЛЬКО «⏱ Время»: ←/🔁/💾/🗑 убраны, у завершённой
       действия переехали в нижний backbar (Удалить/Повторить/Назад), у активной выход —
       нижняя «← Назад» */
    h += '<div class="wchead' + (w.finished ? ' fin' : ' act') + '"><div class="wctitles" data-act="titleModal" data-a="' + w.id + '" title="Переименовать тренировку"><p class="t1">' +
        esc(lines[0]) + '</p></div>' +
        '<div class="wcicons">' +
        '<button class="barebtn" data-act="timeModal" data-a="' + w.id + '" title="Время">' + ICONS.timer + '</button>' +
        '</div></div>';
    if (w.started) {
        const sT = String(w.started).slice(11, 16);
        const range = (w.finished && w.ended) ? sT + '–' + String(w.ended).slice(11, 16) : 'с ' + sT;
        const setsTotal = (w.exercises || []).reduce((a, e) => a + setsCount(e), 0);
        let pill = '<span class="wpill wp-r">🕐 ' + range + '</span>';
        if (G.profile && G.profile.weight > 0) {
            const res = calcWorkoutKcal(G.profile, w);
            if (res && res.total > 0) pill += '<span class="wpill wp-k">🔥 ' + res.total + ' ккал</span>';
        }
        if (setsTotal > 0) pill += '<span class="wpill wp-s">🏋 ' + setsTotal + ' подх.</span>';
        h += '<div class="wcpill">' + pill + '</div>';
    }
    if (w.nutrition && w.nutrition.trim()) h += '<p class="meta">🥤 ' + esc(w.nutrition) + '</p>';
    const exs = w.exercises || [];
    if (!exs.length) {
        h += '<p class="muted" style="margin-top:8px">Пока нет упражнений.</p>';
    }
    exs.forEach((e, ei) => {
        const c = findCatalog(e.name);
        /* тап по названию упражнения — переименование; корзина — удаление упражнения;
           тап по записи — редактирование (удаление — из окна редактирования);
           [UX-T22] «➕ Запись» — тонкий плюсик справа в exhead (ручка ⠿ и btnrow под
           сетами убраны); у завершённой плюсика нет — только просмотр [UX-B6];
           [UX-T32] в шапке упражнения фото-миниатюра из каталога (если есть img,
           та же .exthumb-логика, что в Технике), «свои»/без img — прежняя иконка */
        h += '<div class="expill"><div class="exhead" data-act="renameExercise" data-a="' + w.id + '" data-b="' + ei + '">' + (c ? exVisual(c) : ico('custom')) +
            '<span class="exname">' + esc(e.name) + '</span>' +
            '<button class="barebtn trash-bare" data-act="deleteExercise" data-a="' + w.id + '" data-b="' + ei + '" title="Удалить упражнение">' + ICONS.trash + '</button>' +
            (!w.finished ? '<button class="barebtn ex-add" data-act="openEntryModal" data-a="' + w.id + '" data-b="' + ei + '" data-c="-1" title="Добавить запись" aria-label="Добавить запись">' + ICONS.plusThin +
                /* [ONB-T4] шаг 2: подсветка ВЛОЖЕНА в реальную кнопку добавления подхода (ред. 5) */
                (tutOpen && tutStep === 1 && ei === 0 ? '<span class="spot wrap box" aria-hidden="true"></span>' : '') + '</button>' : '') +
            '</div>';
        const prSi = prChipSetIdx(w, e);
        e.sets.forEach((s, si) => {
            h += '<div class="entry" data-act="openEntryModal" data-a="' + w.id + '" data-b="' + ei + '" data-c="' + si + '">' +
                '<span class="rectext">' + esc(entryLine(s)) + '</span>' +
                (si === prSi ? '<span class="prtag">🏆 ' + Math.round(e1rmOf(s)) + '</span>' : '') +
                '</div>';
        });
        if (w.id === (CUR && CUR.wid) && e.name === (CUR && CUR.name)) {
            h += '<div class="restline"> упражнение активно — время идёт</div>';
        }
        h += '</div>';
    });
    /* [UX-T22] «Добавить упражнение» — кнопка на всю ширину под упражнениями
       (➕ из шапки убрана); только у активной */
    if (!w.finished) {
        h += '<div class="btnrow"><button class="btn sec wide" data-act="openPicker" data-a="' + w.id + '">➕ Добавить упражнение</button></div>';
    }
    if (G.profile && G.profile.weight > 0 && exs.length) {
        h += '<details><summary>🔥 Ккал по упражнениям <span class="wip">(в разработке)</span></summary>' + kcalBreakdown(w) + '</details>';
    }
    h += '<details><summary>📈 Прогресс <span class="wip">(в разработке)</span></summary>' + progressHtml(w) + '</details>';
    /* [UX-T18] красная «Удалить тренировку» из потока карточки убрана: удаление —
       в backbar (у активной и у завершённой [UX-T23]); ACTION и бота не трогали */
    h += '</div>';
    return h;
}

/* ---------- [UX-T14] перетаскивание упражнений (pointer events, без библиотек) ---------- */
/* long-press 650 мс по плитке (кроме кнопок и записей) поднимает её; остальные
   разъезжаются transform-сдвигом (позиция-призрак); отпускание
   переставляет w.exercises и сохраняет обычным save()-флоу (как deleteExerciseGo).
   Скролл работает, пока drag не начался; во время drag — автоскролл у верхнего/нижнего
   края. Тап по плитке и кнопкам не затронут: drag стартует только после удержания. */
let DRAG = null;
let __dragClickGuard = 0;

function dragHaptic(method, param) {
    if (tg && tg.HapticFeedback && tg.HapticFeedback[method]) {
        try { tg.HapticFeedback[method](param); } catch (e) { /* noop */ }
    }
}
function dragTeardown(d, suppressClick) {
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.pill) {
        d.pill.classList.remove('exhold', 'drag-src');
        d.pill.style.transform = '';
        for (const p of d.pills) {
            if (p !== d.pill) { p.classList.remove('drag-shift'); p.style.transform = ''; }
        }
    }
    if (suppressClick) __dragClickGuard = Date.now();
}
document.addEventListener('pointerdown', function (ev) {
    if (DRAG || (ev.button != null && ev.button !== 0)) return;
    const pill = ev.target && ev.target.closest ? ev.target.closest('.expill') : null;
    if (!pill) return;
    /* кнопки, записи и прочие интерактивные элементы плитки — обычные тапы, не drag */
    if (ev.target.closest('button, .entry, input, textarea, summary, a')) return;
    const card = pill.closest('.card');
    const pills = card ? Array.prototype.filter.call(card.children, function (el) { return el.classList.contains('expill'); }) : [];
    if (pills.length < 2) return; /* единственное упражнение — тащить некуда */
    DRAG = {
        pill: pill, pills: pills, id: ev.pointerId,
        wid: card && card.id ? parseInt(String(card.id).slice(1), 10) || 0 : 0,
        x0: ev.clientX, y0: ev.clientY, sy: window.pageYOffset,
        idx: pills.indexOf(pill), dst: -1,
        started: false, timer: null, raf: 0, lastY: null,
        h: 0, cy0: 0, step: 0, gap: 10, shift: 0, centers: []
    };
    pill.classList.add('exhold'); /* на время удержания: без выделения текста и callout */
    /* [UX-T22] ручки ⠿ больше нет: плитка поднимается long-press 650 мс [UX-T17]
       (350 мс цеплялись при обычном скролле; порог отмены движением — 14px) */
    DRAG.timer = setTimeout(dragStart, 650);
});
document.addEventListener('pointermove', function (ev) {
    if (!DRAG || ev.pointerId !== DRAG.id) return;
    if (!DRAG.started) {
        /* движение до подъёма — это скролл/жест: отменяем long-press, скролл не трогаем */
        if (Math.abs(ev.clientX - DRAG.x0) > 14 || Math.abs(ev.clientY - DRAG.y0) > 14) {
            const d = DRAG; DRAG = null; dragTeardown(d, false);
        }
        return;
    }
    DRAG.lastY = ev.clientY;
    dragPlace(ev.clientY);
});
document.addEventListener('touchmove', function (ev) {
    /* [UX-T14] пока плитка поднята — страница не скроллится, drag двигается 1:1 */
    if (DRAG && DRAG.started && ev.cancelable) ev.preventDefault();
}, { passive: false });
document.addEventListener('contextmenu', function (ev) {
    /* long-press на Android открывает контекстное меню — мешает drag по плитке */
    if (DRAG && ev.target && ev.target.closest && ev.target.closest('.expill')) ev.preventDefault();
});
function onDragFinish(ev) {
    if (!DRAG || (ev && ev.pointerId !== undefined && ev.pointerId !== DRAG.id)) return;
    const d = DRAG;
    DRAG = null;
    dragTeardown(d, d.started); /* после drag гасим клик, чтобы тап-действия не сработали */
    if (!d.started || d.dst < 0 || d.dst === d.idx) return; /* вернул на место — сохранения нет */
    /* перестановка массива: записи (sets) и план pw/ps/pr едут вместе с упражнением */
    const w = findW(d.wid);
    if (!w || !w.exercises[d.idx] || !document.contains(d.pill)) { render(); return; } /* плитка пережила рендер — отмена, не сохраняем чужой порядок */
    const e = w.exercises.splice(d.idx, 1)[0];
    w.exercises.splice(d.dst, 0, e);
    save(); /* ошибки показывает doSave (тост); бот-карточка читает порядок из массива */
    render();
}
document.addEventListener('pointerup', onDragFinish);
document.addEventListener('pointercancel', onDragFinish);
window.addEventListener('blur', function () {
    if (DRAG) { const d = DRAG; DRAG = null; dragTeardown(d, d.started); }
});
function dragStart() {
    if (!DRAG || DRAG.started) return;
    DRAG.started = true;
    DRAG.timer = null;
    const rects = DRAG.pills.map(function (p) { return p.getBoundingClientRect(); });
    DRAG.h = rects[DRAG.idx].height;
    DRAG.cy0 = rects[DRAG.idx].top + rects[DRAG.idx].height / 2;
    /* шаг сетки = верх соседа − верх источника; зазор = шаг − высота источника */
    DRAG.step = rects.length > 1 ? rects[1].top - rects[0].top : DRAG.h + 10;
    DRAG.gap = Math.max(0, DRAG.step - DRAG.h);
    DRAG.shift = DRAG.h + DRAG.gap; /* на сколько разъезжаются соседи */
    DRAG.centers = rects.map(function (b) { return b.top + b.height / 2; });
    DRAG.pill.classList.remove('exhold');
    DRAG.pill.classList.add('drag-src');
    try { DRAG.pill.setPointerCapture(DRAG.id); } catch (e) { /* noop */ }
    dragHaptic('selectionChanged');
    DRAG.raf = requestAnimationFrame(dragAutoScroll);
}
function dragPlace(clientY) {
    if (!DRAG || !DRAG.started) return;
    if (!document.contains(DRAG.pill)) { const d = DRAG; DRAG = null; dragTeardown(d, true); return; }
    /* прокрутка страницы во время drag входит в смещение */
    const off = clientY - DRAG.y0 + (window.pageYOffset - DRAG.sy);
    DRAG.pill.style.transform = 'translateY(' + off + 'px)';
    /* позиция-призрак: сколько центров других плиток прошёл плавающий центр */
    const c = DRAG.cy0 + off;
    let dst = 0;
    for (let i = 0; i < DRAG.centers.length; i++) {
        if (i !== DRAG.idx && DRAG.centers[i] < c) dst++;
    }
    if (dst !== DRAG.dst) {
        DRAG.dst = dst;
        DRAG.pills.forEach(function (p, i) {
            if (i === DRAG.idx) return;
            let o = 0;
            if (DRAG.idx < dst && i > DRAG.idx && i <= dst) o = -DRAG.shift;
            if (dst < DRAG.idx && i >= dst && i < DRAG.idx) o = DRAG.shift;
            p.classList.add('drag-shift');
            p.style.transform = o ? 'translateY(' + o + 'px)' : '';
        });
        if (dst !== DRAG.idx) dragHaptic('selectionChanged');
    }
}
function dragAutoScroll() {
    if (!DRAG || !DRAG.started) return;
    if (!document.contains(DRAG.pill)) { const d = DRAG; DRAG = null; dragTeardown(d, false); return; } /* плитка ушла (рендер) — не скроллим впустую */
    const vh = window.innerHeight, topM = 80, botM = 100;
    let v = 0;
    if (DRAG.lastY != null) {
        if (DRAG.lastY < topM) v = -Math.ceil((topM - DRAG.lastY) / 5);
        else if (DRAG.lastY > vh - botM) v = Math.ceil((DRAG.lastY - (vh - botM)) / 5);
    }
    if (v) {
        window.scrollBy(0, v);
        dragPlace(DRAG.lastY); /* пересчёт позиции и призрака с учётом прокрутки */
    }
    DRAG.raf = requestAnimationFrame(dragAutoScroll);
}
function timeLine(w) {
    if (!w.started) return '⏱ время не зафиксировано';
    const start = w.started.slice(11, 16);
    const mins = durationMin(w);
    const dur = mins != null ? ' · ' + durationText(mins) : '';
    if (w.finished && w.ended) return '⏱ ' + start + '–' + w.ended.slice(11, 16) + dur;
    return '⏱ начало ' + start + dur;
}
function kcalBreakdown(w) {
    const mins = durationMin(w);
    if (mins == null) return '<p class="muted">Время начала не зафиксировано — нажми «⏱ Время».</p>';
    const res = calcWorkoutKcal(G.profile, w);
    let h = '⏱ Длительность: ' + durationText(mins);
    h += '\n🏋️ Объём: ≈' + fmtW(Math.round(workoutVolume(w))) + ' кг';
    if (!G.profile || !(G.profile.weight > 0)) {
        h += '\n\n⚠️ Задай вес в профиле — он нужен для расчёта.';
        return '<div class="hl">' + esc(h) + '</div>';
    }
    h += '\nВес: ' + fmtW(G.profile.weight) + ' кг · ' + res.perMin + ' кг/мин → ' + res.met + ' MET\n';
    for (const l of res.lines) {
        h += '\n• ' + esc(l.name) + ' — ' + (l.m != null ? l.m + ' мин, ' : '') + (l.kcal != null ? '≈ ' + l.kcal + ' ккал' : '');
    }
    h += '\n\n🔥 Итого: ≈' + res.total + ' ккал';
    return '<div class="hl">' + esc(h) + '</div>';
}
function progressHtml(w) {
    const prev = prevOf(w);
    if (!prev) return '<p class="muted">Это первая тренировка — сравнивать не с чем.</p>';
    let h = '<p class="muted">Сравнение с ' + esc(firstLine(prev)) + '</p>';
    const d1 = durationMin(w), d0 = durationMin(prev);
    if (d1 != null && d0 != null) {
        h += '<div class="statline">⏱ ' + durationText(d0) + ' → ' + durationText(d1) + diffTxt(d1 - d0, ' мин') + '</div>';
    }
    const p = G.profile;
    if (p && p.weight > 0) {
        const k1 = calcWorkoutKcal(p, w), k0 = calcWorkoutKcal(p, prev);
        if (k0 && k1) {
            h += '<div class="statline">🔥 ' + k0.total + ' → ' + k1.total + ' ккал' + diffTxt(k1.total - k0.total, '') + '</div>';
        }
    }
    h += '<div class="statline"><b>Упражнения</b></div>';
    let any = false;
    for (const e of (w.exercises || [])) {
        if (!e.sets.length) continue;
        const pe = findEx(prev, e.name);
        if (!pe || !pe.sets.length) {
            h += '<div class="statline">• ' + esc(e.name) + ': новое упражнение</div>';
            any = true;
            continue;
        }
        const cur = maxWeightOf(e), pw = maxWeightOf(pe);
        const cs = setsCount(e), ps = setsCount(pe);
        let line = '• ' + esc(e.name) + ': ';
        if (pw > 0 || cur > 0) {
            line += fmtW(pw) + ' → ' + fmtW(cur) + ' кг' + diffTxt(Math.round(cur - pw), ' кг');
        } else {
            line += 'без веса';
        }
        if (ps !== cs) line += ', подходов ' + ps + ' → ' + cs;
        h += '<div class="statline">' + line + '</div>';
        any = true;
    }
    if (!any) h += '<p class="muted">Нет записей.</p>';
    return h;
}
function diffTxt(delta, unit) {
    if (!delta) return '';
    const up = delta > 0;
    return ' <span class="dl ' + (up ? 'dl-up' : 'dl-down') + '">' + (up ? '▲ +' : '▼ −') + Math.abs(delta) + unit + '</span>';
}
function maxWeightSeries(name) {
    const out = [];
    for (const w of G.workouts) {
        const e = findEx(w, name);
        if (e && e.sets.length) out.push(maxWeightOf(e));
    }
    return out;
}

/* ---------- техника ---------- */
/* [EXR-T2] визуал упражнения в Технике: фото из базы free-exercise-db (поле img),
   если есть, иначе прежняя SVG-иконка; loading="lazy" — в списке ~150 карточек */
function exVisual(c) {
    if (c.img) return '<img class="exthumb" src="img/exercises/' + c.img + '-0.jpg" alt="" loading="lazy">';
    return ico(c.i);
}

/* ============ [EXR-T4] миграция тегов и фильтры-мультивыбор ============ */
/* теги записи в обеих схемах: новый каталог несёт tags (m:/e:/cat:), старый — t (плоские) */
function exTags(c) { return c.tags || c.t || []; }
/* матч тега с миграционным фолбэком: «m:chest» ловит и legacy-плоский «chest»,
   плоский «warmup» — и новый «cat:warmup»; работает до и после переезда каталога */
function exTagMatch(c, tag) {
    const tags = exTags(c);
    if (tags.indexOf(tag) !== -1) return true;
    const i = tag.indexOf(':');
    if (i === -1) return tags.indexOf('cat:' + tag) !== -1;
    return tags.indexOf(tag.slice(i + 1)) !== -1;
}
/* «#m:chest» → «#chest»: префиксы схемы — служебные, в карточках не показываем */
function exTagHashes(c, limit) {
    const arr = exTags(c).map(function (t) { return '#' + t.replace(/^[a-z]+:/, ''); });
    return (limit ? arr.slice(0, limit) : arr).join(' ');
}
/* выбранные теги группы: muscle/gear → массив состояния */
function techGroupSel(a) {
    const i = a.indexOf(':');
    const fkey = a.slice(0, i), id = a.slice(i + 1);
    const arr = fkey === 'muscle' ? TECH.fMuscle : TECH.fGear;
    return { fkey: fkey, id: id, arr: arr, k: arr.indexOf(id) };
}
function techClearFilters() { TECH.fMuscle = []; TECH.fGear = []; TECH.fCats = []; }
function techResetState() {
    TECH.section = 'all';
    TECH.cat = null;
    TECH.open = null;
    TECH.q = '';
    techClearFilters();
}
/* индекс тегов фильтров: id айтема FILTERS → массив тегов (по умолчанию [id]) */
const FILTER_ITEMS = (function () {
    const m = {};
    const add = function (it) { m[it.id] = it.tags || [it.id]; };
    for (const it of (FILTERS.muscle.items || [])) add(it);
    for (const g of (FILTERS.gear.groups || [])) for (const it of (g.items || [])) add(it);
    return m;
})();
function fItemTags(id) { return FILTER_ITEMS[id] || [id]; }
function catChipTags(id) {
    const c = (FILTERS.cats || []).find(x => x.id === id);
    return c ? c.tags : [];
}
function filterLabel(fkey, id) {
    const f = FILTERS[fkey];
    const pool = (f.items || []).concat(...(f.groups || []).map(g => (g.items || [])));
    const it = pool.find(x => x.id === id);
    return it ? it.n : id;
}
/* «Своё» и «Коллекции → Свои»: собственные упражнения пользователя.
   TODO [EXR]: выбор категории при добавлении «Своего» — сейчас у «Своих» тегов нет,
   поэтому тег-фильтры к ним неприменимы (режим «Своё» фильтры не применяет) */
function techOwnMode() { return TECH.section === 'own' || (TECH.section === 'coll' && TECH.cat === 'own'); }

function techFiltered() {
    let list = CATALOG.slice();
    /* [UX-T17] секция «★ Любимые»: только упражнения из gymFavs (раньше чип ничего не фильтровал) */
    if (TECH.section === 'fav') list = list.filter(c => isFav(c.n));
    /* [EXR-T4] «Коллекции»: прежняя одиночная категория (Разминка/Заминка/Пилатес) */
    if (TECH.section === 'coll' && TECH.cat && TECH.cat !== 'own') list = list.filter(c => exTagMatch(c, TECH.cat));
    /* [EXR-T4] тег-фильтры: внутри группы ИЛИ (матчит любой выбранный тег), между группами И;
       в режиме «Своё» не применяются — у собственных упражнений тегов нет */
    if (!techOwnMode()) {
        if (TECH.fMuscle.length) list = list.filter(c => TECH.fMuscle.some(id => fItemTags(id).some(t => exTagMatch(c, t))));
        if (TECH.fGear.length) list = list.filter(c => TECH.fGear.some(id => fItemTags(id).some(t => exTagMatch(c, t))));
        if (TECH.fCats.length) list = list.filter(c => TECH.fCats.some(id => catChipTags(id).some(t => exTagMatch(c, t))));
    }
    if (TECH.q) list = list.filter(c => c.n.toLowerCase().includes(TECH.q.toLowerCase()));
    return list;
}
/* [UX-T24] порядок чипов «Техники» [EXR-T4]: режимы «★ Любимые · Своё · Все · Коллекции»
   («Вид»/«Блок»/«Мышцы» заменены фильтрами-мультивыбором и одиночными категориями) */
const TECH_MODES = [
    { id: 'fav', n: '★ Любимые' },
    { id: 'own', n: 'Своё' },
    { id: 'all', n: 'Все' },
    { id: 'coll', n: 'Коллекции' }
];
function techGroupChipHtml(fkey) {
    const sel = fkey === 'muscle' ? TECH.fMuscle : TECH.fGear;
    return '<button class="chip' + (sel.length ? ' on' : '') + '" data-act="' + (fkey === 'muscle' ? 'techFiltersMuscle' : 'techFiltersGear') + '">' +
        esc(FILTERS[fkey].label) + (sel.length ? ' <span class="cnt">' + sel.length + '</span>' : '') + '</button>';
}
/* строка выбранных значений группы: мини-чипы с × (сброс по одному) + «Сбросить группу» */
function techSelRowHtml(fkey) {
    const sel = fkey === 'muscle' ? TECH.fMuscle : TECH.fGear;
    let h = '<div class="fselrow"><span class="fsellabel">' + esc(FILTERS[fkey].label) + ':</span>';
    for (const id of sel) {
        h += '<span class="fchip">' + esc(filterLabel(fkey, id)) +
            '<button class="fchip-x" data-act="techGroupRemove" data-a="' + fkey + ':' + id + '" aria-label="Убрать">×</button></span>';
    }
    h += '<button class="fclear" data-act="techGroupClear" data-a="' + fkey + '">Сбросить группу</button></div>';
    return h;
}
function techChipsHtml() {
    let h = '<div class="secrow">';
    for (const m of TECH_MODES) {
        h += '<button class="chip' + (TECH.section === m.id ? ' on' : '') + '" data-act="techSection" data-a="' + m.id + '">' + m.n + '</button>';
    }
    h += '</div>';
    /* [EXR-T4] фильтры: чипы-группы (открывают шит мультивыбора) + одиночные категории */
    h += '<div class="secrow">';
    h += techGroupChipHtml('muscle');
    h += techGroupChipHtml('gear');
    for (const c of FILTERS.cats) {
        h += '<button class="chip' + (TECH.fCats.includes(c.id) ? ' on' : '') + '" data-act="techCatToggle" data-a="' + c.id + '">' + esc(c.n) + '</button>';
    }
    h += '</div>';
    /* выбранные значения групп — под чипами групп */
    if (TECH.fMuscle.length) h += techSelRowHtml('muscle');
    if (TECH.fGear.length) h += techSelRowHtml('gear');
    /* «Коллекции»: прежний ряд одиночных категорий (функциональность сохранена) */
    if (TECH.section === 'coll' && (CATS.coll || []).length) {
        h += '<div class="secrow">';
        for (const c of CATS.coll) {
            h += '<button class="chip' + (TECH.cat === c.id ? ' on' : '') + '" data-act="techCat" data-a="' + c.id + '">' + ico(c.icon) + ' ' + c.n + '</button>';
        }
        h += '</div>';
    }
    return h;
}
/* шит мультивыбора (модалка с чекбоксами): muscle — плоский список, gear — 4 подгруппы */
function techSheetHtml(fkey) {
    const f = FILTERS[fkey];
    const sel = fkey === 'muscle' ? TECH.fMuscle : TECH.fGear;
    let h = '<div class="mtitle-row"><p class="mtitle">' + esc(f.label) +
        ' <span class="cnt" id="sheetCnt"' + (sel.length ? '' : ' style="display:none"') + '>' + sel.length + '</span></p>' +
        '<button class="barebtn" data-act="techApplyFilters" title="Закрыть" aria-label="Закрыть">' + ICONS.cross + '</button></div>';
    const row = function (it) {
        const on = sel.indexOf(it.id) !== -1;
        return '<button class="frow' + (on ? ' on' : '') + '" data-act="techSheetToggle" data-a="' + fkey + ':' + it.id + '">' +
            '<span class="fbox">' + ICONS.check + '</span><span class="fn">' + esc(it.n) + '</span></button>';
    };
    if (f.items) {
        for (const it of f.items) h += row(it);
    } else {
        for (const g of (f.groups || [])) {
            h += '<p class="msub" style="margin:10px 0 2px">' + esc(g.n) + '</p>';
            for (const it of (g.items || [])) h += row(it);
        }
    }
    h += '<div class="btnrow"><button class="btn prime wide" id="sheetApply" data-act="techApplyFilters">' + techApplyLabel(techFiltered().length) + '</button></div>';
    return h;
}
/* [EXR] гибрид B→A: живой счётчик результатов на «Применить» шита фильтров —
   пересчёт techFiltered() с промежуточным состоянием чекбоксов; 0 → «Применить» без числа */
function techApplyLabel(n) { return n ? 'Применить · ' + n : 'Применить'; }
function techSheetApplySync() {
    const btn = document.getElementById('sheetApply');
    if (btn) btn.textContent = techApplyLabel(techFiltered().length);
}
/* тап по чекбоксу шита: точечное обновление строки, счётчика и кнопки «Применить · N» — модалка не перерисовывается */
function techSheetToggle(a) {
    const s = techGroupSel(a);
    if (s.k === -1) s.arr.push(s.id); else s.arr.splice(s.k, 1);
    const btn = document.querySelector('.modal.open .frow[data-a="' + a + '"]');
    if (btn) btn.classList.toggle('on', s.arr.indexOf(s.id) !== -1);
    const cnt = document.getElementById('sheetCnt');
    if (cnt) {
        cnt.textContent = s.arr.length;
        cnt.style.display = s.arr.length ? '' : 'none';
    }
    techSheetApplySync();
}
function techResultsHtml() {
    /* [EXR-T4] «Своё»: собственные упражнения без категории, тег-фильтры не применяются */
    if (techOwnMode()) {
        const q = (TECH.q || '').toLowerCase();
        const own = ownCustomNames().filter(n => !q || n.toLowerCase().includes(q));
        let h = '<div class="exgrid">';
        for (const n of own) {
            h += '<div class="excard">' + ico('custom') +
                '<span style="flex:1;min-width:0"><div class="exn">' + esc(n) + '</div><div class="extags">#своё</div></span>' + starHtml(n) + '</div>';
        }
        h += '</div>';
        if (!own.length) h += emptyFiltersHtml('Своих упражнений пока нет — добавь их из тренировки («✍️ Своё упражнение»)');
        return h;
    }
    const list = techFiltered();
    let h = '<div class="exgrid">';
    for (const c of list) {
        /* [UX-T18] ⭐ в строке — тогл любимых; тап мимо звезды открывает упражнение.
           [UX-T20] span с названием flex:1 — звезда прижата к правому краю строки */
        h += '<div class="excard" data-act="openTech" data-a="' + c.id + '">' + exVisual(c) +
            '<span style="flex:1;min-width:0"><div class="exn">' + esc(c.n) + '</div><div class="extags">' + exTagHashes(c) + '</div></span>' + starHtml(c.n) + '</div>';
    }
    h += '</div>';
    if (!list.length) h += emptyFiltersHtml(null);
    return h;
}
/* пустой результат: «Ничего не найдено» + сброс фильтров */
function emptyFiltersHtml(msg) {
    return '<div class="empty"><p style="margin:0 0 10px">' + (msg ? esc(msg) : 'Ничего не найдено') + '</p>' +
        '<button class="btn sec" data-act="techResetFilters">Сбросить фильтры</button></div>';
}
/* живое обновление списка при вводе в поиск (контейнер перерисовывается, фокус в поле остаётся) */
function refreshTechList() {
    const box = document.getElementById('techList');
    if (box) box.innerHTML = techResultsHtml();
}
function renderTechTab() {
    if (TECH.open) {
        const c = CATALOG.find(x => x.id === TECH.open);
        if (!c) { TECH.open = null; } else {
            /* [UX-T13] «К упражнениям» — компактная иконка вверху экрана; ⭐ — в/из «Любимых» (как в каталоге) */
            let h = '<div class="card"><div class="exhead">' + exVisual(c) + '<span class="t1">' + esc(c.n) + '</span><span class="metbadge">MET ' + c.met + '</span>' +
                starHtml(c.n) +
                '<button class="barebtn" data-act="techBack" title="К упражнениям" aria-label="К упражнениям">' + ICONS.back + '</button></div>';
            h += '<p class="meta">' + exTagHashes(c) + '</p>';
            /* [EXR-T2] фото (2 ракурса) и RU-описание из базы free-exercise-db */
            if (c.img) {
                h += '<div class="exphotos"><img src="img/exercises/' + c.img + '-0.jpg" alt="Ракурс 1" loading="lazy">' +
                    '<img src="img/exercises/' + c.img + '-1.jpg" alt="Ракурс 2" loading="lazy"></div>';
            }
            if (c.desc) h += '<p class="exdesc">' + esc(c.desc) + '</p>';
            h += '<p class="mtitle" style="margin-top:12px">Техника</p>';
            c.how.forEach((s, i) => {
                h += '<div class="techstep"><span class="num">' + (i + 1) + '.</span><span>' + esc(s) + '</span></div>';
            });
            if (c.err && c.err.length) {
                h += '<p class="mtitle" style="margin-top:12px">Частые ошибки</p>';
                for (const e of c.err) h += '<div class="techerr">✕ ' + esc(e) + '</div>';
            }
            h += '</div>';
            return h;
        }
    }
    /* [UX-T20] кнопка «Назад» переехала из заголовка карточки в topbar;
       [UX-T23] topbar-стрелка убрана — возврат к списку только через «К упражнениям» */
    let h = '<div class="card"><div class="exhead"><p class="t1">📖 Техника упражнений</p></div>' +
        '<div class="searchbox"><input id="techQ" type="text" placeholder="Поиск упражнения..." value="' + esc(TECH.q) + '"></div>' +
        techChipsHtml() + '</div>';
    h += '<div id="techList">' + techResultsHtml() + '</div>';
    return h;
}

/* ---------- статистика ---------- */
/* серия: самая длинная череда ПОДРЯД идущих календарных дней с тренировками
   за последний месяц (30 дней); n — число тренировок в череде, days — её дни */
function trainWord(n) {
    n = Math.abs(+n || 0);
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'тренировка';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'тренировки';
    return 'тренировок';
}
function monthStreak() {
    const now = new Date();
    const monthAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const perDay = {};
    for (const w of G.workouts) {
        if (!w.finished) continue;
        const d = parseDateISO(w.date);
        if (!d || d < monthAgo) continue;
        perDay[w.date.slice(0, 10)] = (perDay[w.date.slice(0, 10)] || 0) + 1;
    }
    const sorted = Object.keys(perDay).sort();
    let best = null, run = null;
    for (const iso of sorted) {
        if (run && Math.round((parseDateISO(iso) - parseDateISO(run.last)) / 86400000) === 1) {
            run.last = iso;
            run.days.push(iso);
            run.n += perDay[iso];
        } else {
            run = { last: iso, days: [iso], n: perDay[iso] };
        }
        if (!best || run.days.length > best.days.length) best = run;
    }
    return best;
}
function streakCardHtml(st) {
    const dows = st.days.map(function (iso) { return DOW[(parseDateISO(iso).getDay() + 6) % 7]; });
    return '<div class="card strow"><span class="mgc mgc-fire">🔥</span>' +
        '<span class="sttxt"><b>Серия: ' + st.n + ' ' + trainWord(st.n) + ' подряд</b>' +
        '<span class="tn">' + dows.join(' · ') + ' — самая длинная за месяц</span></span></div>';
}

/* мышечные группы недели: источник — каталог упражнений (первый мышечный тег);
   показываются только группы, по которым были подходы на этой неделе (Пн–Вс) */
const MG_STYLE = {
    chest: 'var(--c-bench)', back: 'var(--c-back)', legs: 'var(--c-legs)',
    glutes: 'var(--c-glutes)', shoulders: 'var(--c-shoulders)', arms: 'var(--c-arms)', core: 'var(--c-abs)'
};
/* [UX-T32] representative-фото мышечной группы вместо иконки: характерное базовое
   упражнение каталога с img (маппинг group → catalog id); нет записи/фото —
   прежняя иконка группы */
const MG_IMG = {
    chest: 'bench',        /* Жим штанги лёжа */
    back: 'pullup',        /* Подтягивания */
    shoulders: 'ohp',      /* Жим штанги стоя */
    arms: 'barbellcurl',   /* Подъём штанги на бицепс */
    legs: 'squat',         /* Приседания со штангой */
    glutes: 'hipthrust',   /* Ягодичный мост со штангой */
    core: 'crunch'         /* Скручивания лёжа */
};
function mgVisual(g) {
    const c = CATALOG.find(function (x) { return x.id === MG_IMG[g.id]; });
    if (c && c.img) return '<img class="mgimg" src="img/exercises/' + c.img + '-0.jpg" alt="" loading="lazy">';
    return ICONS[g.icon] || ICONS.custom;
}
/* [EXR-T4 fix] ключ MG_STYLE из тега каталога: префикс схемы снимается,
   bi/трицепс алиасятся в «Руки» (arms) — у новых тегов m:biceps/m:triceps своего
   цвета в MG_STYLE нет, и без алиаса подходы на руки пропали бы из карточки */
function mgTagKey(tag) {
    const MG_ALIAS = { biceps: 'arms', triceps: 'arms' };
    const t = tag.replace(/^[a-z]+:/, '');
    return MG_ALIAS[t] || t;
}
function weekMuscleGroups() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const byGroup = {};
    for (const w of G.workouts) {
        if (!w.finished) continue;
        const d = parseDateISO(w.date);
        if (!d || d < monday) continue;
        for (const e of (w.exercises || [])) {
            if (!e.sets.length) continue;
            const c = findCatalog(e.name);
            if (!c) continue;
            /* [EXR-T4 fix] mgTagKey: префикс схемы снимается, m:biceps/m:triceps → arms */
            const g = exTags(c).map(mgTagKey).find(function (t) { return MG_STYLE[t]; });
            if (g) byGroup[g] = (byGroup[g] || 0) + setsCount(e);
        }
    }
    return Object.keys(byGroup).map(function (g) {
        const meta = (CATS.muscle || []).find(function (m) { return m.id === g; }) || { n: g, icon: 'custom' };
        return { id: g, n: meta.n, icon: meta.icon, sets: byGroup[g] };
    }).sort(function (a, b) { return b.sets - a.sets; });
}
function muscleGroupsCardHtml(groups) {
    let h = '<div class="card"><div class="rec-l">Мышечные группы · эта неделя</div><div class="mgroups">';
    for (const g of groups) {
        /* [UX-T32] фото группы в цветном круге (.mgc остаётся подложкой/кольцом); нет фото — иконка */
        h += '<div class="mg"><span class="mgc" style="background:' + MG_STYLE[g.id] + '">' + mgVisual(g) + '</span>' +
            '<span class="mgn">' + esc(g.n) + '</span><b>' + g.sets + ' подх.</b></div>';
    }
    return h + '</div></div>';
}

function renderStatsTab() {
    const fin = G.workouts.filter(w => w.finished);
    if (!fin.length) {
        /* пустое состояние как в истории */
        return '<div class="card hero"><p class="t1">Пока пусто 💪</p>' +
            '<p class="muted">Начни первую тренировку — кнопка ниже или «+» в нижнем меню.</p>' +
            '<div class="btnrow"><button class="btn prime wide" data-act="startWorkout">🏋️ Начать тренировку</button></div></div>';
    }
    const month = todayISO().slice(0, 7);
    let monthCount = 0, totalMin = 0, totalSets = 0;
    const byEx = {};
    for (const w of fin) {
        if ((w.date || '').startsWith(month)) monthCount++;
        const m = durationMin(w);
        if (m != null) totalMin += m;
        for (const e of (w.exercises || [])) {
            totalSets += e.sets.length;
            const s = byEx[e.name] = byEx[e.name] || { sessions: 0, maxW: 0, hasW: false, last: '', lastDate: '', e1rm: 0, best: null };
            s.sessions++;
            for (const b of e.sets) {
                const mw = maxNum(b.w);
                if (mw > s.maxW) s.maxW = mw;
                if (mw > 0) s.hasW = true;
                const er = e1rmOf(b);
                if (er > s.e1rm) { s.e1rm = er; s.best = b; }
                s.last = entryLine(b);
                s.lastDate = w.date;
            }
        }
    }
    const names = Object.keys(byEx).sort((a, b) => byEx[b].sessions - byEx[a].sessions);
    /* новые блоки: рекорды недели, оценка 1ПМ (Эпли), серия, мышечные группы */
    let h = '';
    for (const rec of weekRecords(3)) h += recordCardHtml(rec);
    h += e1rmCardHtml(byEx);
    const st = monthStreak();
    if (st && st.days.length >= 2) h += streakCardHtml(st);
    const groups = weekMuscleGroups();
    if (groups.length) h += muscleGroupsCardHtml(groups);
    /* старые блоки ниже — компактно, состав решит владелец */
    h += '<div class="card"><div class="rec-l">Тренировки</div><div class="statgrid">' +
        '<div class="sg"><b>' + fin.length + '</b><span>тренировок всего</span></div>' +
        '<div class="sg"><b>' + monthCount + '</b><span>в этом месяце</span></div>' +
        (totalMin > 0 ? '<div class="sg"><b>' + durationText(totalMin) + '</b><span>общее время</span></div>' : '') +
        '<div class="sg"><b>' + totalSets + '</b><span>подходов всего</span></div>' +
        '</div></div>';
    h += '<div class="card"><p class="t1">📈 Тренды</p>';
    const trendNames = names.slice(0, 5);
    for (const name of trendNames) {
        const series = maxWeightSeries(name);
        h += '<div class="trendline"><span style="flex:1;min-width:0"><b>' + esc(name) + '</b><br><span class="tn">' +
            fmtW(series[series.length - 1] || 0) + ' кг — последний результат</span></span></div>';
    }
    if (!trendNames.length) h += '<p class="muted">Нет данных</p>';
    h += '</div><div class="card"><p class="t1">🏆 Упражнения</p>';
    for (const name of names.slice(0, 15)) {
        const s = byEx[name];
        h += '<div class="statline"><b>' + esc(name) + '</b> (' + s.sessions + ' раз.)</div>' +
            '<div class="tn">Рекорд веса: ' + (s.hasW ? fmtW(s.maxW) + ' кг' : 'без веса') + '</div>' +
            '<div class="tn">Последний: ' + esc(s.last) + (s.lastDate ? ' (' + esc(s.lastDate.split('-').reverse().slice(0, 2).join('-')) + ')' : '') + '</div>';
    }
    h += '</div>';
    return h;
}

/* ---------- оценка 1ПМ (Эпли) ---------- */
/* карточка «Оценка 1ПМ · Эпли» [UX-T2]: топ-5 упражнений С ВЕСОМ по убыванию e1RM;
   упражнений с весом нет — карточка не показывается вовсе */
function e1rmCardHtml(byEx) {
    const rows = Object.keys(byEx)
        .filter(function (n) { return byEx[n].e1rm > 0 && byEx[n].best; })
        .sort(function (a, b) { return byEx[b].e1rm - byEx[a].e1rm; })
        .slice(0, 5)
        .map(function (n) { return { name: n, val: byEx[n].e1rm, best: byEx[n].best }; });
    if (!rows.length) return '';
    let h = '<div class="card"><div class="rec-l">Оценка 1ПМ · Эпли</div>';
    for (const r of rows) {
        /* [UX-T32] фото-миниатюра вместо иконки (если у каталога есть img), fallback прежний */
        const c = findCatalog(r.name);
        h += '<div class="prmrow">' + (c ? exVisual(c) : ico('custom')) +
            '<span class="prmwho"><b>' + esc(r.name) + '</b>' +
            '<span class="tn">лучший подход: ' + esc(String(r.best.w).replace('.', ',')) + ' кг × ' + esc(r.best.r || '—') + '</span></span>' +
            '<span class="prmval">≈ ' + Math.round(r.val) + ' <small>кг</small></span></div>';
    }
    h += '<div class="formula">e1RM = вес × (1 + повторения ÷ 30) — оценка, а не цель для разовых попыток</div>';
    return h + '</div>';
}

/* ---------- тренер ---------- */
function renderCoachTab() {
    return '<div class="card hero"><p class="t1">🧑‍🏫 Персональный тренер</p>' +
        '<p class="muted">Раздел в разработке: здесь появятся персональные программы тренировок, разборы техники и советы по питанию.</p>' +
        '<p class="meta">Следи за обновлениями 💪</p></div>';
}

/* ---------- [UX-T27] экран «Настройки» (Story [UX-S4], спека §6) ---------- */
/* тогл-компонент .switch [UX-S4 §4]: role=switch/aria-checked; у темы ручка несёт иконку
   активной темы, на свободном конце — «призрак» пассивной; fullscreen и звук — без иконок */
function swToggleHtml(on, act, arg, label, knobIco, ghostIco, ghostSide) {
    let inner = '<span class="sw-track">';
    if (ghostIco) inner += '<span class="sw-ico ' + ghostSide + '">' + ghostIco + '</span>';
    inner += '<span class="sw-knob">' + (knobIco || '') + '</span></span>';
    return '<button class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') +
        '" aria-label="' + escAttr(label) + '" data-act="' + act + '"' + (arg != null ? ' data-a="' + escAttr(arg) + '"' : '') + '>' + inner + '</button>';
}
function renderSettings() {
    /* 🎨 Оформление: тогл темы (ON = тёмная) + тогл fullscreen + фон [UX-S4 §6] */
    const dark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    /* [UX-S4 §8.2] клиент без requestFullscreen (Telegram < 8.0): locked-тогл,
       наличие API считается при каждом рендере (клиент мог обновиться) */
    const fsAvail = !!(tg && tg.requestFullscreen);
    let h = '<div class="card"><p class="t1">🎨 Оформление</p>';
    /* тогл темы показывает фактическую тему; тап фиксирует выбор в gymTheme [UX-S4 §8.1] */
    h += '<div class="setrow"><span class="lbl">Тёмная тема</span>' +
        swToggleHtml(dark, 'setTheme', dark ? 'light' : 'dark', 'Тёмная тема',
            dark ? ICONS.moon : ICONS.sun, dark ? ICONS.sun : ICONS.moon, dark ? 'l' : 'r') + '</div>' +
        '<p class="meta">Без выбора — тема как в клиенте Telegram</p>';
    h += '<div class="setrow"><span class="lbl">Полноэкранный режим <span class="wip">(в разработке)</span></span>' +
        (fsAvail
            ? swToggleHtml(fullscreenOn(), 'fullscreenToggle', null, 'Полноэкранный режим')
            : '<button class="switch locked" role="switch" aria-checked="' + (fullscreenOn() ? 'true' : 'false') +
              '" aria-disabled="true" aria-label="Полноэкранный режим"><span class="sw-track"><span class="sw-knob"></span></span></button>') +
        '</div>' +
        '<p class="meta">' + (fsAvail ? 'Автоматически разворачивает приложение на весь экран' : 'Недоступно: обнови Telegram до 8.0+') + '</p>';
    /* фон приложения — перенос из Профиля как есть (pickBg/clearBg не тронуты) [UX-S4 §2] */
    h += '<div class="hr"></div>' +
        '<div class="flabel">Фон приложения</div>' +
        '<p class="meta">Картинка хранится только на этом устройстве</p>' +
        '<div class="split2">' +
        '<button class="btn sec" data-act="pickBg">📷 Из галереи</button>' +
        '<button class="btn sec" data-act="clearBg">Убрать фон</button>' +
        '</div></div>';
    /* ⏱ Таймер отдыха — перенос из Профиля: чипы/«Своё…» [UX-T13] + тогл звука [UX-S4 §6] */
    const rs = (G.restSec == null ? 90 : G.restSec);
    const presets = [60, 90, 120, 180];
    const off = rs === 0;
    const custom = !off && (REST_CUSTOM || presets.indexOf(rs) < 0);
    /* [UX-B12] тап «Своё…» при «Выкл» (off) молча ничего не делал: custom = !off && ...
       глушил флаг REST_CUSTOM — поле не открывалось, выглядело как «некликабельно».
       customOpen открывает инлайн-поле всегда по явному тапу; подсветка чипа (custom)
       остаётся честной: при «Выкл» горит «Выкл», пока своё значение не сохранено */
    const customOpen = custom || REST_CUSTOM;
    h += '<div class="card"><p class="t1">⏱ Таймер отдыха</p>' +
        '<p class="meta">Запускается автоматически после записи подхода; «Выкл» — отсчёт не запускается.</p>' +
        '<div class="chips">' +
        presets.map(function (n) {
            return '<button class="chip' + (!custom && !off && rs === n ? ' on' : '') + '" data-act="restSet" data-a="' + n + '">' + n + '</button>';
        }).join('') +
        '<button class="chip' + (off ? ' on' : '') + '" data-act="restSet" data-a="0">Выкл</button>' +
        '<button class="chip' + (custom ? ' on' : '') + '" data-act="restCustom">Своё…</button>' +
        '</div>';
    if (customOpen) {
        h += '<div class="setrow"><span class="lbl">Своё, сек (30–600)</span>' +
            '<input id="restCustomSec" type="number" inputmode="numeric" value="' + rs + '">' +
            '<button class="btn" data-act="restCustomSave">ОК</button></div>';
    }
    const snd = restSoundOn();
    h += '<div class="setrow"><span class="lbl">Звук по окончании</span>' +
        swToggleHtml(snd, 'restSound', snd ? 'off' : 'on', 'Звук по окончании') + '</div></div>';
    /* 🧑‍🏫 Персональный тренер — перенос как есть; switchTab закрывает Настройки [UX-S4 §6] */
    h += '<div class="card"><p class="t1">🧑‍🏫 Персональный тренер</p>' +
        '<p class="meta">Программы тренировок и разборы техники — раздел в разработке</p>' +
        '<div class="btnrow"><button class="btn sec wide" data-act="switchTab" data-a="coach">Открыть раздел</button></div></div>';
    /* [ONB-T5/T7] «О приложении»: строка «Помощь и FAQ» с пилюлей «новое» (решение 13,
        до первого открытия Помощи — gymHelpSeen), строка «Что нового» (модалка вручную,
        работает и при выключенном автопоказе — решение 13.2), тогл «Сообщать об
        обновлениях» (синхронен gymWnOff, решение 8) и политика [ONB-T2].
        Строки — с РАЗНЫМИ иконками набора: вопрос / искра / щит (решение 13.1) */
    const wnOn = lsGet('gymWnOff') !== '1';
    const helpNew = lsGet('gymHelpSeen') !== '1';
    h += '<div class="card"><p class="t1">ℹ️ О приложении</p>' +
        '<button class="arow" data-act="openHelp"><span class="aico">' + ICONS.question + '</span>Помощь и FAQ' +
        (helpNew ? '<span class="newpill">новое</span>' : '') +
        '<span class="chevr">' + ICONS.chevR + '</span></button>' +
        '<button class="arow" data-act="wnRow"><span class="aico">' + ICONS.spark + '</span>Что нового' +
        '<span class="chevr">' + ICONS.chevR + '</span></button>' +
        '<div class="setrow wnset"><span class="lbl">Сообщать об обновлениях</span>' +
        swToggleHtml(wnOn, 'wnToggle', null, 'Сообщать об обновлениях') + '</div>' +
        '<p class="meta">Окно «Что нового» после значимых релизов</p>' +
        '<button class="arow" data-act="openPrivacy"><span class="aico">' + ICONS.shield + '</span>Политика конфиденциальности' +
        '<span class="chevr">' + ICONS.chevR + '</span></button></div>';
    return h;
}

/* ---------- профиль ---------- */
function renderProfileTab() {
    if (!profileSex && G.profile) profileSex = G.profile.sex;
    const p = G.profile || { sex: profileSex, height: '', weight: '' };
    /* [UX-T27] имя из Telegram в шапке профиля: GymData имени не хранит — только показ [UX-S4 §11] */
    const u = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;
    let name = '';
    if (u) {
        name = String([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '').trim();
    }
    /* [UX-S4 §7] заголовок саммари «Профиль» — без ⚙️ (шестерёнка теперь означает Настройки) */
    let h = '<div class="card"><p class="t1">Профиль</p>' +
        (name ? '<p class="meta">' + esc(name) + '</p>' : '');
    if (G.profile) {
        /* [UX-T29] возраст вычисленный + склонения; бейдж — только в месяце рождения */
        const age = ageOf(G.profile);
        h += '<p class="meta">' + esc(G.profile.sex.toUpperCase()) + ' · ' + age + ' ' + ageWord(age) + ' · ' +
            G.profile.height + ' см · ' + fmtW(G.profile.weight) + ' кг</p>' +
            '<p class="meta">BMR ≈ ' + Math.round(bmr(G.profile)) + ' ккал/сут (Mifflin-St Jeor)</p>' +
            (isBirthMonth(G.profile) ? '<div class="bdg">🎂 Твой день рождения в этом месяце</div>' : '');
    } else {
        h += '<p class="meta">Нужен для расчёта калорий 🔥</p>';
    }
    h += '</div>';
    /* [UX-T20] «Пол» одной строкой: label слева, компактный сегмент М/Ж справа */
    h += '<div class="card"><div class="sexrow"><p class="t1">Пол</p>' +
        '<div class="seg" role="group" aria-label="Пол">' +
        '<button class="seg-btn' + (profileSex === 'м' ? ' on' : '') + '" data-act="setSex" data-a="м" title="Мужской" aria-label="Мужской">М</button>' +
        '<button class="seg-btn' + (profileSex === 'ж' ? ' on' : '') + '" data-act="setSex" data-a="ж" title="Женский" aria-label="Женский">Ж</button>' +
        '</div></div></div>';
    /* [UX-T29] карточка «Дата рождения»: два нативных select в ряд (.brow, стиль полей
        Рост/Вес), живая строка возраста, meta ×2, плашка миграции для legacy age-only;
        ниже — prow рост/вес/сохранить. Поле «Возраст» удалено: два редактируемых
        источника возраста = конфликт; возраст теперь вычисляется из даты.
        Годы — динамически: верх = текущий−5 (ровно 5 лет), низ = max(1930, текущий−100) */
    const now = new Date();
    const yTop = now.getFullYear() - 5;
    const yLow = Math.max(1930, now.getFullYear() - 100);
    const hasBirth = G.profile && G.profile.birthYear >= 1900 && G.profile.birthYear <= 2100 &&
        G.profile.birthMonth >= 1 && G.profile.birthMonth <= 12;
    const py = hasBirth ? G.profile.birthYear : 0;
    const pm = hasBirth ? G.profile.birthMonth : 0;
    /* legacy-плашка: у профиля есть только статический age — просим дату, не молча */
    const legacyHint = G.profile && !hasBirth && +G.profile.age > 0;
    let yearOpts = '<option value=""' + (py ? '' : ' selected') + '>—</option>';
    for (let y = yTop; y >= yLow; y--) {
        yearOpts += '<option value="' + y + '"' + (py === y ? ' selected' : '') + '>' + y + '</option>';
    }
    let monthOpts = '<option value=""' + (pm ? '' : ' selected') + '>Выбрать…</option>';
    for (let i = 0; i < 12; i++) {
        monthOpts += '<option value="' + (i + 1) + '"' + (pm === i + 1 ? ' selected' : '') + '>' + MONTHS_FULL[i] + '</option>';
    }
    let liveAge = '';
    if (hasBirth) liveAge = 'Возраст: ' + ageOf(G.profile) + ' ' + ageWord(ageOf(G.profile));
    h += '<div class="card">' +
        '<div class="flabel" style="margin-top:0;">Дата рождения</div>' +
        '<div class="brow">' +
        '<div class="bf"><label for="pfBirthYear">Год рождения</label>' +
        '<select id="pfBirthYear" class="' + (py ? '' : 'ph') + '">' + yearOpts + '</select></div>' +
        '<div class="bf"><label for="pfBirthMonth">Месяц рождения</label>' +
        '<select id="pfBirthMonth" class="' + (pm ? '' : 'ph') + '">' + monthOpts + '</select></div>' +
        '</div>' +
        '<p class="badg" id="pfBirthAge"' + (liveAge ? '' : ' style="display:none;"') + '>' + liveAge + '</p>' +
        (legacyHint ? '<div class="hint"><span class="hico">🎂</span><span>Укажи год и месяц рождения — возраст станет обновляться сам</span></div>' : '') +
        '<p class="meta">Возраст пересчитается сам · день не нужен</p>' +
        '<p class="meta">Хранится вместе с дневником · политика — в ⚙️ Настройках</p>' +
        '<div class="hr"></div>' +
        '<div class="prow">' +
        '<div class="pf"><label for="pfHeight">Рост, см</label><input id="pfHeight" type="number" inputmode="numeric" value="' + p.height + '"></div>' +
        '<div class="pf"><label for="pfWeight">Вес, кг</label><input id="pfWeight" type="number" inputmode="decimal" step="0.1" value="' + p.weight + '"></div>' +
        '<button class="btn pfsave" data-act="saveProfile">💾 Сохранить</button>' +
        '</div></div>';
    /* [UX-T17] любимые упражнения: «Техника» с активным фильтром «★ Любимые» (gymFavs) */
    h += '<div class="card"><p class="t1">⭐ Любимые упражнения</p>' +
        '<p class="meta">Упражнения, отмеченные ★ в каталоге и пикере</p>' +
        '<div class="btnrow"><button class="btn sec wide" data-act="openFavs">Открыть в технике</button></div></div>';
    /* [UX-T27] настройки (тема/fullscreen/фон/таймер/тренер) переехали в экран «Настройки» [UX-S4 §7] */
    /* [UX-T18] обёртка .prof: компактные карточки/поля (стиль токенов не менялся) */
    return '<div class="prof">' + h + '</div>';
}
/* [UX-T29] живая строка возраста на change select-ов — без полного render
   (иначе сброс состояния открытого системного пикера/фокуса) */
function pfBirthSync() {
    const ys = document.getElementById('pfBirthYear');
    const ms = document.getElementById('pfBirthMonth');
    const line = document.getElementById('pfBirthAge');
    if (!ys || !ms) return;
    ys.classList.toggle('ph', ys.value === '');
    ms.classList.toggle('ph', ms.value === '');
    if (!line) return;
    if (ys.value !== '' && ms.value !== '') {
        const a = ageOf({ birthYear: +ys.value, birthMonth: +ms.value });
        line.textContent = 'Возраст: ' + a + ' ' + ageWord(a);
        line.style.display = '';
    } else {
        line.style.display = 'none';
    }
}
function pfBirthBind() {
    const ys = document.getElementById('pfBirthYear');
    const ms = document.getElementById('pfBirthMonth');
    if (ys) ys.addEventListener('change', pfBirthSync);
    if (ms) ms.addEventListener('change', pfBirthSync);
}
function saveProfile() {
    const sex = profileSex || 'м';
    const height = parseInt(document.getElementById('pfHeight').value, 10);
    const weight = parseFloat(String(document.getElementById('pfWeight').value).replace(',', '.'));
    const yEl = document.getElementById('pfBirthYear');
    const mEl = document.getElementById('pfBirthMonth');
    const yv = yEl && yEl.value ? +yEl.value : 0;
    const mv = mEl && mEl.value ? +mEl.value : 0;
    const hasOldBirth = G.profile && G.profile.birthYear >= 1900 && G.profile.birthYear <= 2100 &&
        G.profile.birthMonth >= 1 && G.profile.birthMonth <= 12;
    /* [UX-T29] порядок проверок §4.5: дата → рост/вес */
    if (yEl) yEl.classList.remove('err');
    if (mEl) mEl.classList.remove('err');
    if (yv > 0 !== (mv > 0)) {
        /* частичный ввод — ошибка формы, а не легитимное «не указано» */
        if (yEl) yEl.classList.add('err');
        if (mEl) mEl.classList.add('err');
        toast('Укажи и год, и месяц — или выбери „—“ в обоих полях', true);
        return;
    }
    /* [UX-T29] рост/вес §4.5 п.3 — как раньше (слово про возраст убрано: возраст теперь
       вычисляется из даты, диапазона «возраст 10–100» больше нет) */
    if (!(height >= 100 && height <= 250) || !(weight >= 30 && weight <= 300)) {
        toast('Проверь значения: рост 100–250, вес 30–300', true);
        return;
    }
    if (yv === 0 && mv === 0) {
        /* «не указано»: для нового профиля дата обязательна (BMR невозможен);
           legacy-сохранение разрешено — birth-поля не пишутся, сервер перенесёт существующие */
        if (!G.profile || (!(+G.profile.age > 0) && !hasOldBirth)) {
            toast('Укажи год и месяц рождения — они нужны для расчёта калорий', true);
            return;
        }
        const age = hasOldBirth ? ageOf(G.profile) : (+G.profile.age || 0);
        G.profile = { sex: sex, age: age, height: height, weight: weight };
        save().then(function (r) { if (r === 'ok') toast('✓ Профиль сохранён'); render(); });
        return;
    }
    /* защитная проверка диапазона — из select недостижима, остаётся для сервера/мусора */
    const now = new Date();
    const yLow = Math.max(1930, now.getFullYear() - 100);
    const yTop = now.getFullYear() - 5;
    if (!(yv >= yLow && yv <= yTop)) {
        toast('Проверь год рождения: ' + yLow + '–' + yTop, true);
        return;
    }
    /* birth-пара + age-зеркало (вычисленный) для старых читателей */
    const np = { sex: sex, height: height, weight: weight, birthYear: yv, birthMonth: mv };
    np.age = ageOf(np);
    G.profile = np;
    save().then(function (r) { if (r === 'ok') toast('✓ Профиль сохранён'); render(); });
}

/* ---------- действия тренировки ---------- */
function startWorkout() {
    const active = activeW();
    if (active) { openHistory(active.id); openPicker(active.id); return; }
    /* [UX-T7 §4.7]: модалка «Новая тренировка» — только когда есть выбор (шаблоны или история);
       у новичка без того и другого — прежний мгновенный старт */
    const hasChoice = (G.templates || []).length > 0 || G.workouts.some(w => w.finished);
    if (hasChoice) { openStartModal(); return; }
    startBlank();
}
function startBlank() {
    /* [UX-B7] при активной тренировке вторая не создаётся — диалог как в боте */
    activeConflictAsk(function () {
        const w = { id: G.nextId++, date: todayISO(), started: nowLocalISO(), ended: '', finished: false, title: '', nutrition: '', exercises: [] };
        if (G.nextId < 1) G.nextId = 1;
        G.workouts.push(w);
        save().then(function (r) {
            /* [UX-T28] при 409 (conflict) тост «Данные были удалены...» уже от doSave */
            if (r === 'err') toast('Нет связи: тренировка сохранится при следующей записи', true);
            /* сразу экран редактирования тренировки (карточка + пикер), а не главный экран */
            openHistory(w.id);
            openPicker(w.id);
        });
    });
}

/* ---------- конфликт активной тренировки [UX-B7] ---------- */
/* как в боте (wk:new): продолжить текущую / удалить и начать новую; вторую незавершённую не создаём */
let __conflictProceed = null;
function activeConflictAsk(proceed) {
    const a = activeW();
    if (!a) { proceed(); return; }
    __conflictProceed = proceed;
    const h = '<p class="mtitle">У тебя есть незавершённая тренировка</p>' +
        '<p class="msub">от ' + esc(firstLine(a)) + '. Что делаем?</p>' +
        '<div class="btnrow">' +
        '<button class="btn prime wide" data-act="conflictKeep">▶️ Продолжить текущую</button>' +
        '<button class="btn danger wide" data-act="conflictDiscard">🗑 Удалить и начать новую</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
function conflictKeep() {
    closeModal();
    __conflictProceed = null;
    const a = activeW();
    if (a) openHistory(a.id); /* аккуратно ведём к активной */
}
function conflictDiscard() {
    const proceed = __conflictProceed;
    __conflictProceed = null;
    closeModal();
    const a = activeW();
    if (!a || !proceed) return;
    if (!G.del) G.del = [];
    G.del.push(a.id);
    G.workouts = G.workouts.filter(w => w.id !== a.id);
    save().then(proceed); /* новая тренировка создаётся после удаления текущей */
}

/* ============ шаблоны тренировок [UX-T6/T7] (спека §4) ============ */
const TPL_LIMIT = 20;
function tplById(id) { return (G.templates || []).find(t => t.id === id) || null; }
function tplNextId() {
    let n = 0;
    for (const t of (G.templates || [])) if (t.id > n) n = t.id;
    return n + 1;
}
function tplExWord(n) {
    n = Math.abs(+n || 0);
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'упражнение';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'упражнения';
    return 'упражнений';
}
function tplNewestFirst() {
    return (G.templates || []).slice().sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}
/* последняя завершённая тренировка (список хронологический) */
function lastFinished() {
    for (let i = G.workouts.length - 1; i >= 0; i--) if (G.workouts[i].finished) return G.workouts[i];
    return null;
}
/* снимок тренировки: упражнения с записями по порядку, план = последний блок (для превью) */
function tplFromWorkout(w) {
    const exs = [];
    for (const e of (w.exercises || [])) {
        if (!e.sets.length || exs.length >= 20) continue;
        const last = e.sets[e.sets.length - 1];
        exs.push({ name: e.name, w: last.w || '', s: +last.s || 1, r: last.r || '' });
    }
    return exs;
}
/* авто-имя: своя первая строка названия → первые 2 упражнения через « · » → «Тренировка ДД-ММ» */
function tplAutoName(w) {
    if (w.title && w.title.trim()) return w.title.split('\n')[0].trim();
    const names = (w.exercises || []).filter(e => e.sets.length).slice(0, 2).map(e => e.name);
    if (names.length) return names.join(' · ');
    const d = parseDateISO(w.date);
    return 'Тренировка ' + (d ? pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) : '');
}
function tplMeta(t) {
    const exs = t.exercises || [];
    const names = exs.slice(0, 2).map(e => e.name);
    let m = exs.length + ' упр.';
    if (names.length) m += ' · ' + names.join(', ');
    if (exs.length > 2) m += '…';
    return m;
}
/* компактный план: «60×3×10», без веса «3×10», без повторений «60×3» [UX-E5 §4.3]; вес с запятой */
function tplCompact(e) {
    const w = e.w ? String(e.w).replace('.', ',') : '';
    const r = e.r ? String(e.r) : '';
    if (w && r) return w + '×' + (+e.s || 0) + '×' + r;
    if (w) return w + '×' + (+e.s || 0);
    if (r) return (+e.s || 0) + '×' + r;
    return String(+e.s || 0);
}
/* строка плана карточки шаблона [UX-E5 §4.3]: первые 3 упражнения + «+N», имя > 16 симв. клипается;
   скрыта, если ни у одного упражнения нет осмысленного плана (рукотворный JSON) */
function tplPlanLine(t) {
    const exs = t.exercises || [];
    let line = '';
    let n = 0;
    for (const e of exs) {
        if (n < 3 && (+e.s > 1 || (e.w && String(e.w)) || (e.r && String(e.r)))) {
            const nm = String(e.name || '');
            line += (line ? ' · ' : '') + (nm.length > 16 ? nm.slice(0, 15) + '…' : nm) + ' ' + tplCompact(e);
        }
        n++;
    }
    if (!line) return '';
    if (exs.length > 3) line += ' · +' + (exs.length - 3);
    return line;
}
function tplPlan(te) {
    return (te.w ? String(te.w).replace('.', ',') + ' кг' : 'свой вес') + ' × ' + te.s + ' × ' + te.r;
}
/* старт из шаблона / повтора: незавершённая тренировка со списком упражнений, записи пустые;
   план (w/s/r шаблона) снимком в записи — пилюля «в один тап» [UX-E5]; isRepeat — тост повтора */
function createFromList(t, isRepeat) {
    /* [UX-B7] при активной тренировке вторая не создаётся — диалог как в боте */
    activeConflictAsk(function () {
        const w = { id: G.nextId++, date: todayISO(), started: nowLocalISO(), ended: '', finished: false, title: '', nutrition: '',
            exercises: (t.exercises || []).slice(0, 20).map(e => ({ name: e.name, sets: [], st: nowLocalISO(), en: '',
                pw: e.w || '', ps: (+e.s || 0) >= 1 ? +e.s : 0, pr: e.r || '' })) };
        if (G.nextId < 1) G.nextId = 1;
        G.workouts.push(w);
        save().then(function (r) {
            /* [UX-T28] при 409 (conflict) тост «Данные были удалены...» уже от doSave */
            if (r === 'err') toast('Нет связи: тренировка сохранится при следующей записи', true);
            toast((isRepeat ? '🔁 Повтор прошлой тренировки: ' : '📋 Шаблон применён: ')
                + w.exercises.length + ' ' + tplExWord(w.exercises.length));
            openHistory(w.id);
        });
    });
}
function tplStart(id) {
    const t = tplById(id);
    if (!t) return;
    closeModal();
    createFromList(t);
}
function newRepeatLast() {
    const last = lastFinished();
    if (!last) return;
    closeModal();
    createFromList({ exercises: tplFromWorkout(last) }, true);
}
function newRepeatFrom(id) {
    const w = findW(id);
    if (!w || !w.finished) return;
    createFromList({ exercises: tplFromWorkout(w) }, true);
}
/* модалка «Новая тренировка» [§4.7]: пустой список / повторить прошлую / карточки шаблонов */
function openStartModal() {
    const last = lastFinished();
    let h = '<p class="mtitle">Новая тренировка</p>';
    h += '<div class="btnrow"><button class="btn prime wide" data-act="newBlank">🏋️ С пустого списка</button></div>';
    if (last) {
        const n = (last.exercises || []).filter(e => e.sets.length).length;
        h += '<div class="btnrow"><button class="btn sec wide" data-act="newRepeat">🔁 Повторить прошлую' +
            '<span class="bsub">' + esc(firstLine(last)) + ' · ' + n + ' ' + tplExWord(n) + '</span></button></div>';
    }
    const tpls = tplNewestFirst();
    if (tpls.length) {
        h += '<p class="msub" style="margin-top:14px">📋 Шаблоны · ' + tpls.length + ' из ' + TPL_LIMIT + '</p>';
        for (const t of tpls) {
            const planLine = tplPlanLine(t);
            h += '<div class="tcard" data-act="tplStart" data-a="' + t.id + '">' +
                '<div class="tchead"><span class="tico">📋</span>' +
                '<span style="flex:1;min-width:0"><div class="tname">' + esc(t.name) + '</div>' +
                '<div class="tmeta">' + esc(tplMeta(t)) + '</div>' +
                (planLine ? '<div class="tplan">' + esc(planLine) + '</div>' : '') +
                '</span>' +
                '<button class="tdel" data-act="tplDelAsk" data-a="' + t.id + '" title="Удалить шаблон">🗑</button>' +
                '</div></div>';
        }
    }
    h += '<div class="btnrow"><button class="btn sec wide" data-act="closeModal">Закрыть</button></div>';
    openModal(h);
}
function tplDelAsk(id) {
    const t = tplById(id);
    if (!t) return;
    confirmModal('Удалить шаблон «' + t.name + '»?', 'tplDelete', id);
}
function tplDelete(id) {
    G.templates = (G.templates || []).filter(t => t.id !== id);
    save().then(function (r) {
        if (r === 'ok') toast('Шаблон удалён');
        openStartModal(); /* возвращаем к выбору — модалка, из которой удалили */
    });
}
/* модалка сохранения завершённой тренировки как шаблона [§4.8] */
function tplSaveModal(wid) {
    const w = findW(wid);
    if (!w || !w.finished) return;
    if ((G.templates || []).length >= TPL_LIMIT) {
        toast('Лимит — 20 шаблонов, удали лишний при старте', true);
        return;
    }
    const exs = tplFromWorkout(w);
    if (!exs.length) { toast('Сначала добавь хотя бы одно упражнение 💪', true); return; }
    let h = '<p class="mtitle">💾 Сохранить как шаблон</p>' +
        '<label>Название (до 60 символов)</label>' +
        '<input id="mTplName" type="text" maxlength="60" value="' + escAttr(tplAutoName(w)) + '">' +
        '<div class="savelex"><div class="lh">В шаблон войдут (' + exs.length + '):</div>';
    for (const e of exs) {
        h += '<div class="trow"><span>•</span><b>' + esc(e.name) + '</b><span class="plan">' + esc(tplPlan(e)) + '</span></div>';
    }
    h += '</div>';
    h += '<p class="thint">Шаблон запоминает упражнения и план последнего подхода. При старте из шаблона план подставится в форму ввода одним тапом.</p>';
    h += '<div class="btnrow"><button class="btn prime wide" data-act="tplSave" data-a="' + wid + '">💾 Сохранить шаблон</button></div>';
    h += '<div class="btnrow"><button class="btn sec wide" data-act="closeModal">Закрыть</button></div>';
    openModal(h);
}
function tplSave(wid) {
    const w = findW(wid);
    if (!w) return;
    const name = String((document.getElementById('mTplName') || {}).value || '').trim();
    if (!name || name.length > 60) { toast('Название от 1 до 60 символов', true); return; }
    const exs = tplFromWorkout(w);
    if (!exs.length) { toast('Сначала добавь хотя бы одно упражнение 💪', true); return; }
    if ((G.templates || []).length >= TPL_LIMIT) { toast('Лимит — 20 шаблонов, удали лишний при старте', true); return; }
    if (!G.templates) G.templates = [];
    G.templates.push({ id: tplNextId(), name: name, createdAt: nowLocalISO(), exercises: exs });
    save().then(function (r) {
        if (r === 'ok') toast('✓ Шаблон сохранён');
        closeModal();
        render();
    });
}
function finishWorkout(id) {
    const w = findW(id);
    if (!w) return;
    closeCurrentExercise();
    for (const e of w.exercises) {
        if (e.st && !e.en) e.en = nowLocalISO();
    }
    w.exercises = (w.exercises || []).filter(e => e.sets.length);
    if (!w.exercises.length) { toast('Сначала добавь хотя бы одно упражнение 💪', true); return; }
    w.finished = true;
    if (!w.ended) w.ended = nowLocalISO();
    /* [UX-T13] после завершения — сразу список истории, экран карточки закрывается */
    save().then(function (r) { if (r === 'ok') toast('✅ Тренировка завершена'); viewWid = 0; render(); });
}
function deleteWorkout(id) {
    if (!G.del) G.del = [];
    G.del.push(id);
    G.workouts = G.workouts.filter(w => w.id !== id);
    if (viewWid === id) viewWid = 0;
    save().then(render);
}

/* ---------- пикер ---------- */
function openPicker(wid) {
    const w = findW(wid);
    if (!w || w.finished) return; /* [UX-B6] у завершённой тренировки добавления нет */
    /* [UX-T30] дефолт — «★ Любимые»; вкладка «Техника» использует свой дефолт «Все» */
    PICKER = { wid, section: 'fav', cat: null, q: '' };
    renderPickerModal();
}
function favsList() {
    try { return JSON.parse(localStorage.getItem('gymFavs') || '[]'); } catch (e) { return []; }
}
function isFav(n) { return favsList().includes(n); }
function toggleFav(n) {
    let f = favsList();
    if (f.includes(n)) f = f.filter(x => x !== n); else f.push(n);
    try { localStorage.setItem('gymFavs', JSON.stringify(f)); } catch (e) { /* noop */ }
    /* в пикере список обновляется точечно; вне его (звезда в технике [UX-T13]) — перерисовка экрана */
    if (document.getElementById('pickerList')) renderPickerList();
    else render();
}
function mostUsed(n) {
    const cnt = {};
    for (const w of G.workouts) {
        for (const e of (w.exercises || [])) {
            if (e.sets.length) cnt[e.name] = (cnt[e.name] || 0) + e.sets.length;
        }
    }
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, n);
}
function ownCustomNames() {
    const set = new Set(customBase());
    for (const w of G.workouts) {
        for (const e of (w.exercises || [])) {
            if (isCustomEx(e.name)) set.add(e.name);
        }
    }
    return Array.from(set);
}
function customBase() {
    try { return JSON.parse(localStorage.getItem('gymCustomEx') || '[]'); } catch (e) { return []; }
}
function addCustomBase(n) {
    const a = customBase();
    if (a.includes(n)) return;
    a.push(n);
    try { localStorage.setItem('gymCustomEx', JSON.stringify(a)); } catch (e) { /* noop */ }
}
/* [EXR-T9] карточки пикера: фото вместо иконки — тот же exVisual, что в Технике
   (записи каталога без img и «свои» — прежняя SVG-иконка); чипы категорий не тронуты */
function exCard(c) {
    return '<div class="excard" data-act="pickCatEx" data-a="' + esc(c.n) + '">' + exVisual(c) +
        '<span style="flex:1;min-width:0"><div class="exn">' + esc(c.n) + '</div>' +
        '<div class="extags">' + exTagHashes(c, 3) + '</div></span>' + starHtml(c.n) + '</div>';
}
function exCardByName(name) {
    const c = findCatalog(name);
    const tags = c ? exTagHashes(c, 3) : '#своё';
    return '<div class="excard" data-act="pickCatEx" data-a="' + esc(name) + '">' + (c ? exVisual(c) : ico('custom')) +
        '<span style="flex:1;min-width:0"><div class="exn">' + esc(name) + '</div><div class="extags">' + tags + '</div></span>' + starHtml(name) + '</div>';
}
function starHtml(name) {
    const fav = isFav(name);
    return '<span class="star' + (fav ? ' fav' : '') + '" data-fav="' + escAttr(name) + '" role="button" aria-label="' + (fav ? 'Из любимых' : 'В любимые') + '">' + (fav ? '★' : '☆') + '</span>';
}
function pickerChipsHtml() {
    let h = '';
    for (const s of CAT_SECTIONS) {
        h += '<button class="chip' + (PICKER.section === s.id ? ' on' : '') + '" data-act="pickerSection" data-a="' + s.id + '">' + s.n + '</button>';
    }
    return h;
}
function pickerCatsHtml() {
    let h = '';
    for (const c of (CATS[PICKER.section] || [])) {
        h += '<button class="chip' + (PICKER.cat === c.id ? ' on' : '') + '" data-act="pickerCat" data-a="' + c.id + '">' + ico(c.icon) + ' ' + c.n + '</button>';
    }
    return h;
}
/* [EXR-T4 fix] теги чипа категории пикера: явный массив tags айтема CATS
   (составные — OR: «Руки» = m:biceps ∨ m:triceps), fallback на id для айтемов без tags */
function pickerCatTags(section, cat) {
    const it = (CATS[section] || []).find(x => x.id === cat);
    return it ? (it.tags || [it.id]) : [cat];
}
function renderPickerChips() {
    const sec = document.getElementById('pickerSections');
    if (sec) sec.innerHTML = pickerChipsHtml();
    const catsBox = document.getElementById('pickerCats');
    if (!catsBox) return;
    const showCats = PICKER.section !== 'fav' && PICKER.section !== 'all';
    catsBox.style.display = showCats ? '' : 'none';
    if (showCats) catsBox.innerHTML = pickerCatsHtml();
}
function renderPickerList() {
    const box = document.getElementById('pickerList');
    if (!box) return;
    console.log('[picker] section=' + PICKER.section + ' cat=' + PICKER.cat + ' q=' + (PICKER.q || ''));
    const q = (PICKER.q || '').toLowerCase();
    let h = '';
    if (PICKER.section === 'fav') {
        const favs = favsList().filter(n => !q || n.toLowerCase().includes(q));
        let list;
        if (favs.length) {
            list = CATALOG.filter(c => favs.includes(c.n));
            h += '<div class="muted" style="margin:6px 0">★ Избранные</div>';
            h += '<div class="exgrid">';
            for (const c of list) h += exCard(c);
            h += '</div>';
        } else {
            h += '<p class="empty">★ Избранных пока нет — отмечай ☆ на карточках упражнений</p>';
        }
    } else if (PICKER.section === 'coll' && PICKER.cat === 'own') {
        const own = ownCustomNames().filter(n => !q || n.toLowerCase().includes(q));
        for (const n of own) h += exCardByName(n);
        if (!own.length) h += '<p class="empty">Своих упражнений пока нет</p>';
    } else {
        let list = CATALOG.slice();
        /* [EXR-T4 fix] теги айтема CATS (составные — OR; внутри exTagMatch — фолбэк legacy) */
        if (PICKER.cat) {
            const catTags = pickerCatTags(PICKER.section, PICKER.cat);
            list = list.filter(c => catTags.some(t => exTagMatch(c, t)));
        }
        if (q) list = list.filter(c => c.n.toLowerCase().includes(q));
        let customs = [];
        if (!PICKER.cat && PICKER.section !== 'coll') {
            customs = customBase().filter(n => !q || n.toLowerCase().includes(q));
        }
        h += '<div class="exgrid">';
        for (const c of list) h += exCard(c);
        for (const n of customs) h += exCardByName(n);
        h += '</div>';
        if (!list.length && !customs.length) h += '<p class="empty">Ничего не найдено</p>';
    }
    box.innerHTML = h;
}
function renderPickerModal() {
    /* [UX-T18] ✕ в правом верхнем углу заголовка — закрыть пикер без выбора (как по фону) */
    let h = '<div class="mtitle-row"><p class="mtitle">➕ Добавить упражнение</p>' +
        '<button class="barebtn" data-act="closeModal" title="Закрыть" aria-label="Закрыть">' + ICONS.cross + '</button></div>';
    h += '<div class="searchbox"><input id="pickerQ" type="text" placeholder="Поиск..." autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(PICKER.q) + '"></div>';
    const showCats = PICKER.section !== 'fav' && PICKER.section !== 'all';
    h += '<div class="secrow" id="pickerSections">' + pickerChipsHtml() + '</div>';
    h += '<div class="secrow" id="pickerCats"' + (showCats ? '' : ' style="display:none"') + '>' + (showCats ? pickerCatsHtml() : '') + '</div>';
    h += '<div class="excard" data-act="customExerciseModal" style="margin:6px 0">' + ico('custom') +
        '<span><div class="exn">✍️ Своё упражнение</div><div class="extags">добавь то, чего нет в каталоге</div></span></div>';
    h += '<div id="pickerList"></div>';
    h += '<div class="btnrow"><button class="btn sec wide" data-act="closeModal">Закрыть</button></div>';
    openModal(h);
    const q = document.getElementById('pickerQ');
    if (q) q.addEventListener('input', function () { PICKER.q = this.value; renderPickerList(); });
    renderPickerList();
}
function pickCatEx(name) {
    const w = findW(PICKER.wid);
    if (!w || w.finished) return closeModal(); /* [UX-B6] завершённая — только просмотр */
    closeCurrentExercise();
    const e = startExercise(w, name);
    storage_after_pick(w, e);
}
function storage_after_pick(w, e) {
    save();
    closeModal();
    openEntryModalIdx(w, w.exercises.indexOf(e), -1);
}
function customExerciseModal() {
    const w = findW(PICKER.wid);
    const h = '<p class="mtitle">✍️ Своё упражнение</p>' +
        '<label>Название (до 60 символов)</label><input id="mCustomName" type="text" maxlength="60">' +
        '<div class="btnrow"><button class="btn wide" data-act="createCustom">➕ Добавить</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
    const inp = document.getElementById('mCustomName');
    if (inp) inp.focus();
    void w;
}
function createCustom() {
    const w = findW(PICKER.wid);
    if (w && w.finished) { toast('Тренировка завершена — доступен просмотр', true); return; } /* [UX-B6] симметрия с pickCatEx */
    const name = String((document.getElementById('mCustomName') || {}).value || '').trim();
    if (!name || name.length > 60) { toast('Название от 1 до 60 символов', true); return; }
    addCustomBase(name);
    closeCurrentExercise();
    const e = startExercise(w, name);
    save();
    closeModal();
    openEntryModalIdx(w, w.exercises.indexOf(e), -1);
}

/* ---------- окно записи ---------- */
/* пилюля в слоте под полем веса [UX-E5 §4.1]: план — пока у упражнения нет записей.
   Подсказка «Предыдущий подход» (UX-I1) заменена автоподстановкой в поля [UX-T12] */
function entryPillHtml(e, isNew) {
    if (isNew && e.sets.length === 0 && +e.ps >= 1) {
        const w = e.pw ? String(e.pw).replace('.', ',') + ' кг' : 'свой вес';
        const label = String(e.pr || '')
            ? '📋 План: ' + w + ' × ' + e.ps + ' × ' + e.pr + ' — подставить'
            : '📋 План: ' + w + ' × ' + e.ps + ' — вес и подходы';
        return '<button class="prevpill" data-act="planTake">' + esc(label) + '</button>';
    }
    return '';
}
/* [UX-E5] тап по пилюле плана: подставить w/s/r (пилюля остаётся — работает как «вернуть план») */
function planTake() {
    const ctx = modalCtx;
    const w = ctx ? findW(ctx.wid) : null;
    const e = w ? findEx(w, ctx.name) : null;
    if (!e) return;
    const mSets = document.getElementById('mSets');
    const mWeight = document.getElementById('mWeight');
    const mReps = document.getElementById('mReps');
    if (mSets && +e.ps >= 1) mSets.value = e.ps;
    if (mWeight && e.pw) mWeight.value = e.pw; /* пустой план веса — поле не трогаем (остаётся «0») */
    if (mReps && e.pr) mReps.value = e.pr;
}
function openEntryModal(wid, exIdx, setIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    if (setIdx < 0 && w.finished) { /* [UX-B6] новую запись в завершённую не добавляем */
        toast('Тренировка завершена — доступен просмотр', true);
        return;
    }
    openEntryModalIdx(w, exIdx, setIdx);
}
function openEntryModalIdx(w, exIdx, setIdx) {
    const e = w.exercises[exIdx];
    const isNew = setIdx < 0;
    const s = isNew ? { w: '', s: 1, r: '' } : e.sets[setIdx];
    /* [UX-T12] второй и дальше подход того же упражнения в текущей тренировке:
       вес предыдущего подхода сразу в поле веса (только внутри текущей тренировки).
       [UX-T17] повторения и подходы НЕ подставляются — дефолты «1» / «1» */
    const prev = isNew && e.sets.length ? e.sets[e.sets.length - 1] : null;
    modalCtx = { wid: w.id, exIdx, setIdx, name: e.name };
    /* [UX-T23] правый угол заголовка — паттерн пикера [UX-T18]: у «Изменить записи» —
       🗑 (deleteEntry, удаление сразу, как раньше с нижней красной кнопки) и ✕ (closeModal);
       у «Новой записи» — «← Назад» (closeModal, бывшая «Закрыть»); нижний ряд — только
       жёлтая prime-кнопка (💾 Сохранить / ➕ Добавить), нижние дубли убраны */
    const mHead = isNew
        ? '<div class="mtitle-row"><p class="mtitle">Новая запись</p>' +
          '<button class="barebtn" data-act="closeModal" title="Назад" aria-label="Назад">' + ICONS.back + '</button></div>'
        : '<div class="mtitle-row"><p class="mtitle">Изменить запись</p>' +
          '<button class="barebtn trash-bare" data-act="deleteEntry" title="Удалить запись" aria-label="Удалить запись">' + ICONS.trash + '</button>' +
          '<button class="barebtn" data-act="closeModal" title="Закрыть" aria-label="Закрыть">' + ICONS.cross + '</button></div>';
    let h = mHead +
        '<p class="msub">' + esc(e.name) + '</p>' +
        '<div class="fglass">' +
        '<div class="flabel">Вес, кг (0 — без веса)</div>' +
        '<div class="inwrap"><input id="mWeight" type="text" inputmode="decimal" value="' + esc((prev && prev.w) || s.w || '0') + '">' +
        '<button class="clr" data-act="wClr">Очистить</button></div>' +
        /* [UX-E5] пилюля плана — пока у упражнения нет записей */
        entryPillHtml(e, isNew) +
        '<div class="keyrow">' +
        /* [UX-T26] мелкий инкремент веса 0,25 кг (был 0,5) — точность под шаг 1,25 кг */
        ['0.25', '1', '2', '5', '10', '15', '20', '50'].map(function (n) {
            const label = n === '0.25' ? '+0,25' : '+' + n;
            return '<button class="k plus" data-act="wAdd" data-a="' + n + '">' + label + '</button>';
        }).join('') +
        '</div>' +
        '<div class="keyrow">' +
        ['10', '20', '30', '50', '60', '80', '100', '200'].map(function (n) {
            return '<button class="k" data-act="wSet" data-a="' + n + '">' + n + '</button>';
        }).join('') +
        '</div>' +
        '</div>' +
        '<div class="fglass">' +
        '<div class="flabel">Подходы</div>' +
        '<div class="inwrap"><input id="mSets" type="number" inputmode="numeric" value="' + (+s.s || 1) + '">' +
        '<button class="clr" data-act="sClr">Очистить</button></div>' +
        '<div class="keyrow">' +
        ['1', '2', '3', '4', '5', '6', '7', '8'].map(function (n) {
            return '<button class="k" data-act="setsSet" data-a="' + n + '">' + n + '</button>';
        }).join('') +
        '</div>' +
        '</div>' +
        '<div class="fglass">' +
        '<div class="flabel">Повторения (например 12, 8-10)</div>' +
        '<div class="inwrap"><input id="mReps" type="text" value="' + esc(s.r || '1') + '">' +
        '<button class="clr" data-act="rClr">Очистить</button></div>' +
        '<div class="keyrow">' +
        ['1', '2', '3', '4', '5', '6', '7', '8'].map(function (n) {
            return '<button class="k" data-act="repsSet" data-a="' + n + '">' + n + '</button>';
        }).join('') +
        '</div>' +
        /* второй ряд: пресеты частых значений в начале (тап вставляет значение целиком,
           как старые чипсы), инкременты дальше — всего два ряда, без третьей строки */
        '<div class="keyrow">' +
        ['10', '12'].map(function (n) {
            return '<button class="k" data-act="repsSet" data-a="' + n + '">' + n + '</button>';
        }).join('') +
        ['1', '2', '5', '10'].map(function (n) {
            return '<button class="k plus" data-act="repsAdd" data-a="' + n + '">+' + n + '</button>';
        }).join('') +
        '</div>' +
        '</div>';
    /* [UX-T23] внизу — только prime: удаление/выход переехали в шапку модалки */
    h += '<div class="btnrow"><button class="btn prime wide" data-act="saveEntry">' + (isNew ? '➕ Добавить' : '💾 Сохранить') + '</button></div>';
    openModal(h);
    /* при фокусе поле выделяется целиком — ввод с клавиатуры заменяет значение, а не дописывает.
       WebKit (iOS Safari) ставит каретку ПОСЛЕ клика и затирает выделение из focus,
       поэтому отменяем дефолтный mousedown и ставим фокус + выделение сами */
    ['mWeight', 'mSets', 'mReps'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        const sel = function () { try { el.select(); } catch (err) { /* noop */ } };
        el.addEventListener('focus', sel);
        el.addEventListener('mousedown', function (ev) {
            if (document.activeElement !== el) {
                ev.preventDefault();
                el.focus();
                sel();
            }
        });
    });
}
function fmtNum2(v) {
    return String(Math.round(v * 100) / 100);
}
function wSet(v) {
    const inp = document.getElementById('mWeight');
    if (inp) inp.value = v;
}
function wClr() {
    const inp = document.getElementById('mWeight');
    if (inp) inp.value = '0';
}
function sClr() {
    const inp = document.getElementById('mSets');
    if (inp) inp.value = '1';
}
function rClr() {
    const inp = document.getElementById('mReps');
    if (inp) inp.value = '1'; /* дефолт повторений — 1 [UX-T12] */
}
function wAdd(n) {
    const inp = document.getElementById('mWeight');
    if (!inp) return;
    const cur = parseFloat(String(inp.value).replace(',', '.')) || 0;
    inp.value = fmtNum2(cur + (+n || 0));
}
function setsSet(n) {
    const inp = document.getElementById('mSets');
    if (inp) inp.value = +n || 1;
}
function repsSet(v) {
    const inp = document.getElementById('mReps');
    if (inp) inp.value = v;
}
function repsAdd(n) {
    const inp = document.getElementById('mReps');
    if (!inp) return;
    const nums = String(inp.value).match(/\d+/g);
    const cur = nums.length ? +nums[nums.length - 1] : 0;
    inp.value = (cur + (+n || 0)) + '';
}
async function saveEntry() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, setIdx = modalCtx.setIdx, name = modalCtx.name;
    restAudioUnlock(); /* тап «Добавить»: разблокировать WebAudio для сигнала по окончании */
    let weight = String(document.getElementById('mWeight').value).trim().replace(/[.,;]+$/, '');
    const sets = parseInt(document.getElementById('mSets').value, 10);
    const reps = String(document.getElementById('mReps').value).trim();
    /* буквы запрещены: только число или диапазон (75-175); пусто или 0 = без веса */
    if (weight !== '' && (weight.length > 25 || !/^[\d.,\-\s]+$/.test(weight) || !/\d/.test(weight))) {
        toast('Вес: число или диапазон, например 100 или 75-175', true);
        return;
    }
    if (weight === '' || +weight === 0) weight = '';
    if (!(sets >= 1 && sets <= 30)) { toast('Подходы: число от 1 до 30', true); return; }
    if (!reps || reps.length > 15) { toast('Повторения: например 12, 8-10', true); return; }
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name) : null;
    if (!e) {
        toast('Упражнение не найдено — запись не сохранена', true);
        closeModal();
        render();
        return;
    }
    /* живой рекорд — только для НОВОГО блока, проверяем до добавления в e.sets:
       база — прошлые тренировки, редактирование задним числом не празднуется [UX-T2] */
    const pr = setIdx < 0 ? prCheck(w, name, { w: weight, s: sets, r: reps }) : null;
    if (setIdx < 0) {
        e.sets.push({ w: weight, s: sets, r: reps, t: nowLocalISO() });
    } else {
        const old = e.sets[setIdx];
        e.sets[setIdx] = { w: weight, s: sets, r: reps, t: old ? (old.t || nowLocalISO()) : nowLocalISO() };
    }
    const r = await save();
    /* таймер отдыха: автозапуск только для НОВОГО блока незавершённой тренировки [UX-T4];
       «выкл» (restSec=0) отсчёт не запускает [UX-T13] */
    if (setIdx < 0 && w && !w.finished) { const dur = restDur(); if (dur > 0) restStart(dur, name); }
    /* [UX-B9] тосты успеха (включая рекорд) — только при реальном сохранении:
       при сбое сети ошибку уже показал doSave, «✓ Сохранено» поверх неё противоречив */
    if (modalCtx && r === 'ok') {
        if (pr) {
            toastPr(pr.type === 'e1rm'
                ? '🏆 Новый рекорд! 1ПМ ≈ ' + Math.round(pr.val) + ' кг'
                : '🏆 Рекорд объёма! ' + pr.val + ' повторений');
        } else {
            toast('✓ Сохранено');
        }
    }
    closeModal();
    render();
}
async function deleteEntry() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, setIdx = modalCtx.setIdx, name = modalCtx.name;
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name) : null;
    if (!e) { closeModal(); render(); return; }
    if (setIdx < e.sets.length) e.sets.splice(setIdx, 1);
    if (!e.sets.length) w.exercises.splice(w.exercises.indexOf(e), 1);
    await save();
    closeModal();
    render();
}

/* ---------- переименование/удаление упражнения ---------- */
function renameExercise(wid, exIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    modalCtx = { wid, exIdx, setIdx: -1, name: w.exercises[exIdx].name };
    renameModalHtml(w);
}
function renameModalHtml(w) {
    const e = w.exercises[modalCtx.exIdx];
    const h = '<p class="mtitle">Переименовать упражнение</p>' +
        '<label>Название (до 60 символов)</label><input id="mName" type="text" value="' + esc(e.name) + '">' +
        '<div class="btnrow"><button class="btn wide" data-act="doRename">💾 Сохранить</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
async function doRename() {
    if (!modalCtx) return;
    const wid = modalCtx.wid, name2 = modalCtx.name;
    const name = String(document.getElementById('mName').value).trim();
    if (!name || name.length > 60) { toast('Название от 1 до 60 символов', true); return; }
    await reloadSilently();
    const w = findW(wid);
    const e = w ? findEx(w, name2) : null;
    if (!e) {
        toast('Упражнение не найдено — переименование не сохранено', true);
        closeModal();
        render();
        return;
    }
    const other = w.exercises.find(x => x !== e && x.name.toLowerCase() === name.toLowerCase());
    if (other) {
        other.sets.push(...e.sets);
        w.exercises.splice(w.exercises.indexOf(e), 1);
    } else {
        e.name = name;
    }
    await save();
    closeModal();
    render();
}
function deleteExercise(wid, exIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx]) return;
    __delExerciseCtx = { wid, exIdx };
    confirmModal('Удалить упражнение «' + w.exercises[exIdx].name + '» со всеми записями?', 'deleteExerciseGo', null);
}
async function deleteExerciseGo() {
    await reloadSilently();
    const w = findW(__delExerciseCtx.wid);
    if (w && w.exercises[__delExerciseCtx.exIdx]) {
        w.exercises.splice(__delExerciseCtx.exIdx, 1);
        await save();
    }
    __delExerciseCtx = null;
    closeModal();
    render();
}

/* ---------- удаление записи ---------- */
function deleteSet(wid, exIdx, setIdx) {
    const w = findW(wid);
    if (!w || !w.exercises[exIdx] || !w.exercises[exIdx].sets[setIdx]) return;
    __delSetCtx = { wid, exIdx, setIdx };
    confirmModal('Удалить запись «' + entryLine(w.exercises[exIdx].sets[setIdx]) + '»?', 'deleteSetGo', null);
}
async function deleteSetGo() {
    await reloadSilently();
    const w = findW(__delSetCtx.wid);
    const e = w ? w.exercises[__delSetCtx.exIdx] : null;
    if (e && __delSetCtx.setIdx < e.sets.length) {
        e.sets.splice(__delSetCtx.setIdx, 1);
        if (!e.sets.length) w.exercises.splice(w.exercises.indexOf(e), 1);
        await save();
    }
    __delSetCtx = null;
    closeModal();
    render();
}

/* ---------- питание / название / время ---------- */
function nutrModal(wid) {
    const w = findW(wid);
    const h = '<p class="mtitle">🥤 Питание во время тренировки</p>' +
        '<label>Что пил и что ел</label>' +
        '<textarea id="mNutr" maxlength="500">' + esc(w.nutrition || '') + '</textarea>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveNutr" data-a="' + wid + '">💾 Сохранить</button>' +
        '<button class="btn sec wide" data-act="clearNutr" data-a="' + wid + '">🚫 Очистить</button></div>';
    openModal(h);
}
function saveNutr(wid) {
    const w = findW(wid);
    const v = String(document.getElementById('mNutr').value).trim();
    if (v.length > 500) { toast('До 500 символов', true); return; }
    w.nutrition = v || null;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); closeModal(); render(); });
}
function clearNutr(wid) {
    const w = findW(wid);
    w.nutrition = null;
    save().then(() => { closeModal(); render(); });
}
function titleModal(wid) {
    const w = findW(wid);
    const cur = w.title && w.title.trim() ? w.title : '';
    const h = '<p class="mtitle">🏷 Название тренировки</p>' +
        '<p class="muted">Сейчас: ' + esc(titleLines(w).join(' / ')) + '</p>' +
        '<label>Напиши своё название тренировки</label>' +
        '<textarea id="mTitle" maxlength="200" placeholder="Например: Спина и грудь"></textarea>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveTitle" data-a="' + wid + '">💾 Сохранить</button></div>';
    openModal(h);
}
function saveTitle(wid) {
    const w = findW(wid);
    let v = String(document.getElementById('mTitle').value).trim();
    if (v.length > 200) { toast('До 200 символов', true); return; }
    if (v.toLowerCase() === 'авто') v = '';
    w.title = v || null;
    save().then(function (r) { if (r === 'ok') toast('✓ Сохранено'); closeModal(); render(); });
}
function autoTitle(wid) {
    const w = findW(wid);
    w.title = null;
    save().then(() => { closeModal(); render(); });
}
function timeModal(wid) {
    const w = findW(wid);
    const sd = isoToDateInput(w.started || w.date);
    const st = w.started ? w.started.slice(11, 16) : '';
    const ed = isoToDateInput(w.ended);
    const et = w.ended ? w.ended.slice(11, 16) : '';
    const h = '<p class="mtitle">⏱ Даты и время тренировки</p>' +
        '<label>Начало — дата (ДД.ММ.ГГГГ)</label><input id="mStartDate" type="text" inputmode="numeric" placeholder="29.10.2026" value="' + esc(sd) + '">' +
        '<label>Начало — время (ЧЧ:ММ)</label><input id="mStartTime" type="text" inputmode="numeric" placeholder="18:30" value="' + esc(st) + '">' +
        '<label>Окончание — дата</label><input id="mEndDate" type="text" inputmode="numeric" placeholder="29.10.2026" value="' + esc(ed) + '">' +
        '<label>Окончание — время</label><input id="mEndTime" type="text" inputmode="numeric" placeholder="20:05" value="' + esc(et) + '">' +
        '<p class="muted">У активной тренировки окончание можно оставить пустым.</p>' +
        '<div id="mTimeErr" class="formerr"></div>' +
        '<div class="btnrow"><button class="btn wide" data-act="saveTime" data-a="' + wid + '">💾 Сохранить</button></div>';
    openModal(h);
    ['mStartDate', 'mEndDate'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { maskDate(this); });
    });
    ['mStartTime', 'mEndTime'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { maskTime(this); });
    });
}
function parseDateInput(s) {
    s = String(s || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
    if (m) return m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/.exec(s);
    if (m) return '20' + m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    return null;
}
function parseTimeInput(s) {
    s = String(s || '').trim().replace('.', ':').replace(',', ':');
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    if (+m[1] > 23 || +m[2] > 59) return null;
    return pad2(+m[1]) + ':' + m[2];
}
function isoToDateInput(iso) {
    const d = iso ? String(iso).slice(0, 10) : '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : d;
}
function maskDate(el) {
    const v = el.value.replace(/\D/g, '').slice(0, 8);
    let out = v.slice(0, 2);
    if (v.length >= 3) out += '.' + v.slice(2, 4);
    if (v.length >= 5) out += '.' + v.slice(4, 8);
    el.value = out;
}
function maskTime(el) {
    const v = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = v.length >= 3 ? v.slice(0, 2) + ':' + v.slice(2) : v;
}
async function saveTime(wid) {
    const errEl = document.getElementById('mTimeErr');
    const err = function (msg) { if (errEl) errEl.textContent = msg; };
    const w = findW(wid);
    if (!w) return;
    const sdt = parseDateInput(document.getElementById('mStartDate').value);
    const stm = parseTimeInput(document.getElementById('mStartTime').value);
    if (!sdt || !stm) { err('Проверь дату и время начала (например 29.10.2026 и 18:30)'); return; }
    const rawEd = String(document.getElementById('mEndDate').value).trim();
    const rawEt = String(document.getElementById('mEndTime').value).trim();
    let endVal = null;
    if (rawEd || rawEt) {
        const edt = parseDateInput(rawEd) || sdt;
        const etm = parseTimeInput(rawEt);
        if (!etm) { err('Проверь время окончания (например 20:05) или очисти оба поля'); return; }
        endVal = edt + 'T' + etm + ':00';
    }
    const startVal = sdt + 'T' + stm + ':00';
    if (endVal && new Date(endVal) < new Date(startVal)) { err('Окончание не может быть раньше начала'); return; }
    err('');
    await reloadSilently();
    const w2 = findW(wid);
    if (!w2) { err('Тренировка не найдена'); return; }
    w2.started = startVal;
    w2.date = sdt;
    if (endVal) w2.ended = endVal;
    else if (!w2.finished) w2.ended = '';
    const r = await save();
    /* [UX-B9] успех — только при реальном сохранении (ошибку сети уже показал doSave);
       [UX-T28] при сбое модалка НЕ закрывается — введённое время остаётся для повтора
       (как в closeHistory [UX-T22]) */
    if (r !== 'ok') return;
    if (!errEl || !errEl.textContent) toast('✓ Сохранено');
    closeModal();
    render();
}

/* ---------- подтверждения и модалки ---------- */
function confirmModal(text, fn, id) {
    PENDING = { fn, id };
    const h = '<p class="mtitle">' + esc(text) + '</p>' +
        '<div class="btnrow"><button class="btn danger wide" data-act="confirmYes">Да</button>' +
        '<button class="btn sec wide" data-act="closeModal">Отмена</button></div>';
    openModal(h);
}
function confirmYes() {
    const p = PENDING;
    closeModal();
    if (p && typeof ACTIONS[p.fn] === 'function') ACTIONS[p.fn](p.id);
}
function openModal(html) {
    const m = document.getElementById('modal');
    const mb = document.getElementById('modalBox');
    mb.innerHTML = html;
    m.classList.remove('hidden');
    m.classList.add('open');
    mb.scrollTop = 0;
}
function closeModal() {
    const m = document.getElementById('modal');
    m.classList.remove('open');
    m.classList.add('hidden');
    modalCtx = null;
}

function applyBg(data) {
    document.documentElement.classList.add('has-bg');
    document.body.style.setProperty('--bg-img', 'url("' + data + '")');
}
function loadBg() {
    let bg = null;
    try { bg = localStorage.getItem('gymBg'); } catch (e) { /* noop */ }
    if (bg) applyBg(bg);
}
function initBgPicker() {
    const bf = document.getElementById('bgFile');
    if (!bf || bf.__gymBound) return;
    bf.__gymBound = true;
    bf.addEventListener('change', function () {
        const f = this.files && this.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = function () {
            const img = new Image();
            img.onload = function () {
                const max = 1280;
                const k = Math.min(1, max / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(img.width * k));
                cv.height = Math.max(1, Math.round(img.height * k));
                try { cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); } catch (e1) { toast('Не удалось обработать картинку', true); return; }
                let data;
                try { data = cv.toDataURL('image/jpeg', 0.82); } catch (e2) { toast('Не удалось обработать картинку', true); return; }
                try { localStorage.setItem('gymBg', data); } catch (e3) { toast('Картинка слишком большая, выбери другую', true); return; }
                applyBg(data);
                toast('✓ Фон установлен');
            };
            img.onerror = function () { toast('Не удалось открыть картинку', true); };
            img.src = fr.result;
        };
        fr.readAsDataURL(f);
        this.value = '';
    });
}

/* ============ [ONB-T3..T7] онбординг: приветствие, туториал, Помощь, «Что нового» ============ */
/* localStorage-флаги (спека §8): gymOnbDone, gymWnVer, gymWnOff, gymHelpSeen.
   localStorage недоступен (приватный режим) — онбординг молча пропускаем (fail-open, §6) */
let LS_OK = null;
function lsOk() {
    if (LS_OK !== null) return LS_OK;
    try { localStorage.setItem('__gymT', '1'); localStorage.removeItem('__gymT'); LS_OK = true; }
    catch (e) { LS_OK = false; }
    return LS_OK;
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }

/* [ANA-T5] события онбординга (спека ANA-S2 г2): имена — белый список сервера, доставка —
   fire-and-forget POST /api/track (онбординг завершается без изменений данных, /api/save
   при нём не зовётся, а completed/skipped наступают после /api/init). Дедуп — флаг в
   localStorage: каждое событие 1 раз за жизнь онбординга (спека г2). */
function trackOnb(name) {
    if (!lsOk() || lsGet('gymOnbEv' + name) === '1') return;
    lsSet('gymOnbEv' + name, '1');
    try {
        fetch('/api/track', { method: 'POST', body: JSON.stringify({ initData: INIT, events: [name] }), keepalive: true })
            .catch(function () { /* noop: аналитика не должна ронять онбординг */ });
    } catch (e) { /* noop */ }
}

/* ---------- ворота онбординга: вызывается один раз из init() после первого render ---------- */
function onbGate() {
    if (!lsOk()) return;
    if (lsGet('gymOnbDone') !== '1') { /* [ONB-T3] приветствие — всем при первом открытии (решение 12) */
        obTracked = true;
        trackOnb('onboardingStarted'); /* [ANA-T5] */
        obOpen = true;
        obSlide = 0;
        render();
        obAlignTrack();
        return;
    }
    wnAuto(); /* [ONB-T7] значимый релиз, который пользователь ещё не видел */
    if (wnOpen) render();
}

/* ---------- [ONB-T3] приветствие-карусель (макет, экраны 1–3) ---------- */
function obWelcomeHtml() {
    let h = '<div class="obwrap"><div class="ob"><div class="ob-center">' +
        '<div class="wlogo">' + ICONS.logo + '</div>' +
        '<div class="wtitle">GymHelper</div>' +
        '<div class="wtag">Дневник тренировок в Telegram</div>' +
        '<div class="car"><div class="car-track" id="obTrack">';
    OB_SLIDES.forEach(function (s, i) {
        h += '<div class="car-card' + (i === obSlide ? ' glow' : ' peek') + '">' +
            '<div class="cic">' + s.ico + '</div>' +
            '<div class="ch">' + esc(s.title) + '</div>' +
            '<p class="cp">' + esc(s.text) + '</p></div>';
    });
    h += '</div></div><div class="dots">';
    OB_SLIDES.forEach(function (_, i) { h += '<i' + (i === obSlide ? ' class="on"' : '') + '></i>'; });
    h += '</div></div><div class="ob-bottom">' +
        '<button class="cta" data-act="obNext">' + (obSlide === OB_SLIDES.length - 1 ? 'Начать' : 'Далее') + '</button>' +
        (obSlide < OB_SLIDES.length - 1 ? '<button class="wskip" data-act="obSkip">Пропустить</button>' : '') +
        '</div></div></div>';
    return h;
}
/* центрирование активной карточки: clip-контейнер неподвижен, сдвигается только трек
   (фикс ред. 3); геометрия считается по фактической ширине — работает и на 320px */
function obAlignTrack() {
    const car = document.querySelector('.obwrap .car');
    const track = document.getElementById('obTrack');
    const card = car ? car.querySelector('.car-card') : null;
    if (!car || !track || !card) return;
    const step = card.offsetWidth + 10; /* ширина карточки + gap */
    const off = Math.max(0, obSlide * step - (car.offsetWidth - card.offsetWidth) / 2);
    track.style.transform = 'translateX(' + (-Math.round(off)) + 'px)';
}
function obFinish() {
    lsSet('gymOnbDone', '1'); /* любой выход — навсегда [§8] */
    obOpen = false;
    tutStart(); /* [ONB-T4] автопоказ туториала после приветствия (решение 3) */
}

/* ---------- [ONB-T4] туториал: спотлайты поверх реальных экранов ---------- */
/* есть ли цель шага 2: реальная активная тренировка с упражнением (элемент .ex-add);
   нет — шаг пропускается (разрешено задачей: «шаг пропускается или подложка-История») */
function tutStep2Target() {
    const w = activeW();
    return !!(w && !w.finished && (w.exercises || []).length);
}
/* каждый шаг рендерит свой «реальный экран» (подложка туториала) */
function tutApplySurface() {
    settingsOpen = false;
    calOpen = false;
    helpOpen = false;
    if (tutStep === 1) {
        const w = activeW();
        if (w) { editSnap = JSON.stringify(G); viewWid = w.id; } else viewWid = 0;
        tab = 'history';
        return;
    }
    if (tab === 'history' && viewWid && isDirty()) save(); /* тихий автосейв, как switchTab */
    viewWid = 0;
    tab = tutStep === 3 ? 'stats' : 'history';
}
function tutStart() {
    if (tab === 'history' && viewWid && isDirty()) save();
    viewWid = 0;
    tab = 'history';
    settingsOpen = false;
    calOpen = false;
    helpOpen = false;
    tutOpen = true;
    tutStep = 0; /* всегда с шага 1; шаг 2 пропускается при «Дальше», если цели нет */
    tutApplySurface();
    window.scrollTo(0, 0);
    render();
    tutPlaceTip();
}
function tutNext() {
    let next = tutStep + 1;
    if (next === 1 && !tutStep2Target()) next = 2; /* нет активной тренировки — шаг пропускается */
    if (next >= TUT_STEPS.length) {
        if (obTracked) trackOnb('onboardingCompleted'); /* [ANA-T5] прошёл онбординг до конца */
        tutFinish(); return;
    } /* завершение молча, без финального экрана */
    tutStep = next;
    tutApplySurface();
    window.scrollTo(0, 0);
    render();
    tutPlaceTip();
}
function tutFinish() {
    obTracked = false; /* [ANA-T5] дальше — только повторы из Помощи, без событий */
    tutOpen = false;
    lsSet('gymOnbDone', '1');
    if (tab === 'history' && viewWid && isDirty()) save();
    viewWid = 0;
    tab = 'history';
    window.scrollTo(0, 0);
    render();
}
/* щит + тултип; подсветки (.spot.wrap.*) рендерятся ВНУТРИ целевых элементов
   (topbarHtml/navHtml/workoutCard) по ред. 5 — экранных координат нет */
function tutOverlayHtml() {
    const t = TUT_STEPS[tutStep];
    return '<div class="spot-shield" data-act="tutShield" aria-hidden="true"></div>' +
        '<div class="tip" id="tutTip">' +
        '<div class="step">' + esc(t.label) + '</div>' +
        '<div class="tt">' + esc(t.title) + '</div>' +
        '<p class="tx">' + esc(t.text) + '</p>' +
        '<div class="tiprow"><button class="btn acc" data-act="tutNext">Дальше</button>' +
        '<button class="tskip" data-act="tutSkip">Пропустить</button></div></div>';
}
/* позиция тултипа по месту подсветки: над элементом снизу экрана, под — сверху */
function tutPlaceTip() {
    const tip = document.getElementById('tutTip');
    if (!tip) return;
    tip.style.top = '';
    tip.style.bottom = '';
    const spot = document.querySelector('.spot.wrap');
    if (!spot) return;
    const r = spot.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top > vh * 0.55) tip.style.bottom = (vh - r.top + 12) + 'px';
    else tip.style.top = (r.bottom + 12) + 'px';
}

/* ---------- [ONB-T5] Помощь: FAQ-аккордеон + «Не нашли ответа?» + контакты [ONB-T6] ---------- */
function renderHelp() {
    let h = '';
    FAQ_ITEMS.forEach(function (it, i) {
        h += '<div class="faq-it' + (helpFaq === i ? ' open' : '') + '">' +
            '<button class="faq-q" data-act="faqToggle" data-a="' + i + '">' + esc(it.q) +
            '<span class="chev">' + ICONS.chevD + '</span></button>' +
            (helpFaq === i ? '<div class="faq-a">' + esc(it.a) + '</div>' : '') +
            '</div>';
    });
    h += '<div class="card"><p class="t1">Не нашли ответа?</p>' +
        '<p class="meta">Напишите разработчику — разберёмся и ответим.</p>' +
        '<div class="btnrow"><button class="btn sec wide" data-act="replayTut">▶ Повторить подсказки</button></div>' +
        '<button class="cbtn" data-act="openFeedback">' + ICONS.send +
        '<span><b>Написать разработчику</b><small>через бота ' + esc(BOT_NAME) + '</small></span></button>' +
        '<button class="cbtn" data-act="copyEmail">' + ICONS.mail +
        '<span><b>Скопировать email</b><small>' + SUPPORT_EMAIL + '</small></span></button>' +
        '<div class="btnrow"><button class="btn sec wide" data-act="checkServer">🔎 Проверить сервер</button></div>' +
        (srvState === 'checking' ? '<p class="serline">⏳ Проверяем…</p>' :
            srvState === 'ok' ? '<p class="serline ok">✅ Сервер работает</p>' :
                srvState === 'fail' ? '<p class="serline fail">⛔ Сервер не отвечает</p>' : '') +
        '<p class="meta wn-foot">GymHelper ' + APP_VERSION + ' · ' + APP_BUILD + '</p>' +
        '</div>';
    return h;
}
function copyText(text) {
    const done = function () { toast('Скопировано'); };
    const fallback = function () {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
        } catch (e) { toast('Не удалось скопировать', true); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
}
/* [ONB-T6] проверка сервера: GET /health → инлайн-результат под кнопкой, без адресов */
async function checkServer() {
    srvState = 'checking';
    render();
    let ok = false;
    try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); ok = !!j.ok; }
    } catch (e) { ok = false; }
    if (!helpOpen) { srvState = ''; return; } /* экран закрыли, пока шёл запрос */
    srvState = ok ? 'ok' : 'fail';
    render();
}

/* ---------- [ONB-T7] «Что нового»: модалка значимых релизов ---------- */
/* автопоказ: по умолчанию всем, раз на релиз (решения 8–10); пустой RELNOTES — тишина */
function wnAuto() {
    if (!RELNOTES.length) return;
    if (lsGet('gymWnOff') === '1') return;
    const rel = RELNOTES[RELNOTES.length - 1];
    if (lsGet('gymWnVer') === rel.ver) return;
    wnRel = rel;
    wnOpen = true;
}
function wnOpenManual() {
    if (!RELNOTES.length) { toast('Новых возможностей пока нет'); return; }
    wnRel = RELNOTES[RELNOTES.length - 1];
    wnOpen = true;
    render();
}
function wnClose() {
    if (wnRel) lsSet('gymWnVer', wnRel.ver); /* «Понятно»/тап по фону — раз на релиз (решение 9) */
    wnOpen = false;
    render();
}
function wnModalHtml() {
    const rel = wnRel || RELNOTES[RELNOTES.length - 1];
    if (!rel) return '';
    let h = '<div class="mwrap" data-act="wnBackdrop"><div class="wnm">' +
        '<div class="wnh"><span class="t1">🚀 Что нового</span>' +
        '<span class="relpill">Релиз ' + esc(rel.ver) + '</span></div><div class="wnlist">';
    for (const it of rel.items) {
        h += '<div class="wni"><i class="mark"></i><div class="wtx"><b>' + esc(it.t) + '</b><span>' + esc(it.d) + '</span></div></div>';
    }
    h += '</div><button class="cta" data-act="wnAck">Понятно</button>' +
        '<button class="wnskip" data-act="wnOff">Больше не показывать</button>' +
        '</div></div>';
    return h;
}

/* ---------- init ---------- */
async function init() {
    loadTheme();
    loadBg();
    initBgPicker();
    restInitState(); /* таймер независим от сети: восстанавливается до /api/init */
    if (tg) {
        try { tg.ready(); tg.expand(); } catch (e) { /* noop */ }
        /* [UX-T25] тихое восстановление полноэкранного режима, только если клиент умеет (8.0+) */
        let fsSaved = '0';
        try { fsSaved = localStorage.getItem('gymFullscreen') || '0'; } catch (e9) { /* noop */ }
        if (fsSaved === '1' && tg.requestFullscreen && !tg.isFullscreen) {
            try { tg.requestFullscreen(); } catch (e10) { /* noop */ }
        }
        /* [UX-B10] шапка в fullscreen: класс fs + верхний safe-area — стартовое
           состояние сразу, далее по событиям входа/выхода и изменения safe-area.
           [UX-T27] после подтверждения входа/выхода тогл в Настройках перерисовывается [UX-S4 §8.2] */
        try {
            tg.onEvent('fullscreenChanged', function () {
                applyFsChrome();
                if (settingsOpen) render();
            });
            tg.onEvent('safeAreaChanged', applyFsChrome);
            applyFsChrome();
        } catch (e11) { /* noop */ }
        INIT = tg.initData || '';
    }
    let usedFallback = false;
    if (!INIT && location.hash) {
        const sources = [location.hash.slice(1), location.search.slice(1)];
        for (const src of sources) {
            if (!src || INIT) continue;
            const variants = [src];
            try { variants.push(decodeURIComponent(src)); } catch (e4) { /* noop */ }
            for (const v of variants) {
                const m = /tgWebAppData=([^&#]+)/.exec(v);
                if (m && m[1]) {
                    let val = m[1];
                    try { if (val.indexOf('%') >= 0) val = decodeURIComponent(val); } catch (e6) { /* noop */ }
                    INIT = val;
                    usedFallback = true;
                    break;
                }
            }
        }
    }
    let failMsg = '';
    try {
        const r = await fetch('/api/init', {
            method: 'POST',
            body: JSON.stringify({ initData: INIT })
        });
        let j = {};
        try { j = await r.json(); } catch (e2) { /* noop */ }
        if (j.ok) {
            G = j.data;
            if (!G.workouts) G.workouts = [];
            if (!G.del) G.del = [];
            if (!G.templates) G.templates = [];
            if (G.nextId < 1) G.nextId = 1;
            /* id из tombstone-списка нельзя выдавать заново — иначе новая тренировка мгновенно «удалится» */
            for (const d of G.del) if (d >= G.nextId) G.nextId = d + 1;
            /* и не должен совпадать с живыми тренировками сервера */
            for (const w of G.workouts) if (w.id >= G.nextId) G.nextId = w.id + 1;
            if (G.profile) profileSex = G.profile.sex;
            /* [ONB-T6] username бота для deep-link «Написать разработчику» — из /api/init */
            if (typeof j.botUsername === 'string' && j.botUsername) BOT_NAME = j.botUsername;
            render();
            onbGate(); /* [ONB] приветствие/«Что нового» — после первого рендера приложения */
        } else {
            failMsg = 'HTTP ' + r.status;
        }
    } catch (e) {
        failMsg = (e && e.message) ? e.message : 'ошибка сети';
    }
    if (failMsg) {
        const info = 'tg: ' + (tg ? 'да' : 'нет')
            + ' · initData: ' + (INIT ? INIT.length + ' симв.' : 'пусто')
            + ' · платформа: ' + (tg && tg.platform ? tg.platform : '?')
            + ' · ' + failMsg;
        document.getElementById('app').innerHTML =
            '<p class="empty">Не удалось авторизоваться 😕<br>' + esc(info) +
            '<br><br>Открой приложение через меню бота (кнопка ☰ → «🏋️ Дневник»).</p>';
    }
}
init();

/* ============ тестовый крюк (используется tests/render-smoke.js) ============ */
if (typeof globalThis !== 'undefined' && globalThis.__gymExpose) {
    globalThis.__gymExpose({
        render: function (t) { if (t) { tab = t; } render(); },
        setTab: function (t) { tab = t; },
        avgNum: avgNum,
        repsAvg: repsAvg,
        e1rmOf: e1rmOf,
        prCheck: prCheck,
        setsWord: setsWord,
        repsPhrase: repsPhrase,
        dayPart: dayPart,
        calcWorkoutKcal: calcWorkoutKcal,
        workoutVolume: workoutVolume,
        ageOf: ageOf,
        ageWord: ageWord,
        isBirthMonth: isBirthMonth,
        modalCtx: function () { return modalCtx; },
        /* [ONB-T7] e2e: ссылка на RELNOTES (const-массив мутируем push/splice) и wnAuto —
           тесты подкладывают фейковый релиз без правки прод-кода */
        RELNOTES: RELNOTES,
        wnAuto: wnAuto
    });
}
