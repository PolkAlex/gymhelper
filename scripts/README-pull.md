# Доставка бэкапов с VPS на ПК ([BAK-T2], «Вариант 2»: pull по расписанию)

`scripts/backup-pull.ps1` раз в час (и при каждом входе в Windows) проверяет на VPS
свежий архив `/opt/gym/backups/gym-data-*.tar.gz` (его создаёт `deploy/backup.sh`, см.
`deploy/README-backup.md`) и, если он новее скачанного ранее (маркер `last-pulled.txt`),
забирает его по SSH в `C:\Backups\Gym`. Старше 14 дней локальные архивы удаляются.

**Секретов в скрипте нет** — только пути. Аутентификация через отдельный ключ
`backup_key`, прописанный в ssh config. **`deploy_key` и `token.txt` не трогать** —
они для другого.

## Шаг 1. Сгенерировать отдельный ключ (в PowerShell)

Если каталога `.ssh` ещё нет — создайте его, затем сгенерируйте ключ:

```powershell
mkdir "$env:USERPROFILE\.ssh" -Force
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\backup_key" -C "gym-backup-pull"
```

⚠️ Важно: команды — для **PowerShell** (`$env:USERPROFILE`). В cmd.exe синтаксис другой
(`%USERPROFILE%`), и при запуске из cmd пути с `$env:` не сработают.

Passphrase оставить пустой (иначе планировщик не сможет запускать без ввода пароля).
Ключ посвящён только бэкапам: если что-то подозрительное — просто удалите его строку
из `authorized_keys` на VPS (шаг 3).

## Шаг 2. Описать хост в ssh config

Файл `$env:USERPROFILE\.ssh\config` (создать, если нет), добавить блок:

```
Host gym-vps
    HostName 45.91.169.125
    User root
    IdentityFile ~/.ssh/backup_key
    IdentitiesOnly yes
```

`IdentitiesOnly yes` важен: без него ssh может подставить другой ключ (например
`deploy_key`) — так делать нельзя.

## Шаг 3. Авторизовать ключ на VPS (один раз, спросит пароль root)

```powershell
type "$env:USERPROFILE\.ssh\backup_key.pub" | ssh root@45.91.169.125 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Проверка (пароль спросить не должен):

```powershell
ssh gym-vps "echo ok"
```

## Шаг 4. Проверить скрипт руками

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-pull.ps1
```

Ожидаемо: скачает свежий архив в `C:\Backups\Gym` (путь настраивается в шапке скрипта:
`$VpsHost`, `$RemoteDir`, `$LocalDir`, `$KeepDays`). Повторный запуск скажет
«Новых архивов нет». Лог: `C:\Backups\Gym\backup-pull.log`, маркер: `last-pulled.txt`.
Маркер можно удалить — тогда скрипт перекачает тот же архив поверх (безопасно).

## Шаг 5. Задача планировщика

### Вариант GUI (рекомендую: покрывает все три требования)

`schtasks` / «Планировщик задач» (taskschd.msc) → «Создать задачу…»:

- **Общие**: имя `GymBackupPull`; «Выполнять только для вошедшего пользователя».
- **Триггеры**: два триггера:
  1. «При входе в систему»;
  2. «По расписанию: ежедневно», внизу — «Повторять каждые: 1 час», «бесконечно».
- В каждом триггере включить **«Немедленно запускать задачу, если пропущен плановый
  запуск»** (компенсирует выключенный/спящий ПК — «Запускать при пропуске»).
- **Действия**: «Запуск программы»:
  - Программа: `powershell.exe`
  - Аргументы: `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ПУТЬ\К\Репозиторию\scripts\backup-pull.ps1"`
- **Условия**: снять «Запускать только при питании от электросети» (для ноутбука).

### Вариант schtasks (быстро, только «раз в час»)

```powershell
schtasks /Create /TN "GymBackupPull" /SC HOURLY /MO 1 /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\ПУТЬ\К\Репозиторию\scripts\backup-pull.ps1\""
```

При триггере «при входе + каждый час» из CLI нужны две задачи или XML — проще GUI.

## Ручная проверка всей цепочки

```powershell
ssh gym-vps "ls -1 /opt/gym/backups"                 # архивы на VPS есть?
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-pull.ps1   # код 0
Get-Content C:\Backups\Gym\backup-pull.log -Tail 10  # лог без ERROR
schtasks /Run /TN "GymBackupPull"                    # задача запускается
schtasks /Query /TN "GymBackupPull" /V /FO LIST      # последний результат: 0x0
```

Exit-коды скрипта (видны планировщику): `0` — ок, `1` — ошибка сети/ssh/scp,
`2` — на VPS нет архивов (тогда сначала чинить `backup.timer` на сервере).

## Почему так

ПК не всегда онлайн (issue #17) — поэтому pull с ПК, а не push с VPS: пропущенные запуски
не страшны, скрипт всегда догоняет самый свежий архив; на VPS хранятся все копии (14д+8н+12м),
на ПК — рабочее окно 14 дней (параметр `$KeepDays`).
