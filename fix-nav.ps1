$ErrorActionPreference = 'Stop'
$p = 'web\app.js'
$c = Get-Content -Raw -Encoding UTF8 $p

$oldItems = "    const items = [`n        ['workout', 'dumbbell', 'Тренировка'],`n        ['history', 'timer', 'История'],`n        ['tech', 'pilates', 'Техника'],`n        ['stats', 'chart', 'Статистика']`n    ];"
$oldItemsC = $oldItems.Replace("`n", "`r`n")
$newItems = (Get-Content -Raw -Encoding UTF8 'tests\items-new.txt').TrimEnd() + ';'
$newItemsC = $newItems.Replace("`n", "`r`n")
$oldNav = Get-Content -Raw -Encoding UTF8 'tests\nav-old.txt'
$oldNavC = $oldNav.Replace("`n", "`r`n")
$newNav = (Get-Content -Raw -Encoding UTF8 'tests\nav-new.txt').TrimEnd()

$done = @()
if ($c.Contains($oldItems)) { $c = $c.Replace($oldItems, $newItems); $done += 'items' }
elseif ($c.Contains($oldItemsC)) { $c = $c.Replace($oldItemsC, $newItemsC); $done += 'items(crlf)' }
else { $done += 'items: NOT FOUND' }

if ($c.Contains($oldNav)) { $c = $c.Replace($oldNav, $newNav); $done += 'nav' }
elseif ($c.Contains($oldNavC)) { $c = $c.Replace($oldNavC, $newNav); $done += 'nav(crlf)' }
else { $done += 'nav: NOT FOUND' }

[IO.File]::WriteAllText((Resolve-Path $p), $c, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ($done -join ' | ')
