' [BAK-T6] Скрытый запуск ежечасного бэкап-пулла: окно PowerShell не показывается.
' Задача планировщика GymBackupPull вызывает этот vbs вместо прямого запуска powershell.exe.
' intWindowStyle=0 (hidden), bWaitOnReturn=False (планировщику не ждём завершения).
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\Lenovo\IdeaProjects\MyHelper\scripts\backup-pull.ps1""", 0, False
