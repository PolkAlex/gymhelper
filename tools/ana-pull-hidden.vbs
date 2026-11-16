' [ANA-T4] Hidden launcher for the hourly Task Scheduler job "GymHelper ANA stats pull".
' PowerShell is a console app: even with -WindowStyle Hidden its window flashes on start.
' wscript.exe has no console, so the whole run stays invisible (intWindowStyle=0, no wait).
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\Lenovo\IdeaProjects\MyHelper\tools\ana-pull.ps1""", 0, False
