# Κατασκευή του Word από το manual.html: ενσωμάτωση εικόνων, στυλ, εξώφυλλο με πλαίσιο,
# αρίθμηση σελίδων από 1 μετά το εξώφυλλο, .docx μέσω flat2docx.py, εικόνες σελίδων για έλεγχο.
# Χρήση (σε ξεχωριστή διεργασία, με όριο χρόνου): build_docx.ps1 -Dir <φάκελος με manual.html> -OutName manual.docx [-Preview 14]
param([string]$Dir, [string]$OutName, [int]$Preview = 0)
$ErrorActionPreference = 'Stop'
$html = Join-Path $Dir 'manual.html'
$docx = Join-Path $Dir $OutName
$flat = Join-Path $Dir 'manual_flat.xml'
$cm = 28.3465
$logf = Join-Path $Dir 'build_log.txt'
function Write-Step($t) { Add-Content -Path $logf -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding UTF8 }
if (Test-Path $logf) { Remove-Item $logf }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.ConfirmConversions = $false
Write-Step 'Word ξεκίνησε'
try {
  $doc = $word.Documents.Add()
  Write-Step 'νέο έγγραφο'
  $doc.Range().InsertFile($html)
  Write-Step 'εισαγωγή HTML'
  $doc.ActiveWindow.View.Type = 3   # διάταξη εκτύπωσης

  # Μη διασπώμενο κενό αμέσως μετά από εξίσωση (το tex2html το βάζει επειδή το Word πετά το
  # κανονικό κενό) → κανονικό κενό, ώστε η γραμμή να σπάει κανονικά
  $nbspFixed = 0
  foreach ($m in @($doc.OMaths)) {
    $e = $m.Range.End
    $r = $doc.Range($e, $e + 1)
    if ($r.Text -eq [string][char]0xA0) { $r.Text = ' '; $nbspFixed++ }
  }
  Write-Step "κενά μετά από εξισώσεις: $nbspFixed"

  # Σελίδα A4 και περιθώρια όπως στο εγχειρίδιο GeoFEM
  foreach ($s in $doc.Sections) {
    $s.PageSetup.PaperSize = 7       # A4
    $s.PageSetup.TopMargin = 2.5 * $cm; $s.PageSetup.BottomMargin = 2.5 * $cm
    $s.PageSetup.LeftMargin = 2.5 * $cm; $s.PageSetup.RightMargin = 2.5 * $cm
  }

  Write-Step 'σελίδα A4'
  # Ενσωμάτωση των εικόνων στο αρχείο (το HTML τις έχει ως συνδέσμους)
  foreach ($sh in @($doc.InlineShapes)) { if ($sh.LinkFormat) { $sh.LinkFormat.SavePictureWithDocument = $true; $sh.LinkFormat.BreakLink() } }
  foreach ($f in @($doc.Fields)) { if ($f.Type -eq 67) { $f.Unlink() } }   # INCLUDEPICTURE

  Write-Step 'εικόνες ενσωματώθηκαν'
  # Στυλ: Times New Roman, μαύρες επικεφαλίδες
  $st = $doc.Styles.Item(-1); $st.Font.Name = 'Times New Roman'; $st.Font.Size = 11
  foreach ($h in -2, -3, -4) { $hs = $doc.Styles.Item($h); $hs.Font.Name = 'Times New Roman'; $hs.Font.Color = 0; $hs.Font.Bold = $true; $hs.ParagraphFormat.KeepWithNext = $true }

  # Πίνακες εξισώσεων χωρίς περιγράμματα, κελιά στοιχισμένα κατακόρυφα στο κέντρο
  $eqTables = 0
  foreach ($t in @($doc.Tables)) {
    if ($t.Columns.Count -eq 3 -and $t.Range.OMaths.Count -ge 1 -and $t.Rows.Count -eq 1) {
      $t.Borders.Enable = $false
      $t.Rows.AllowBreakAcrossPages = $false
      $t.Range.Cells.VerticalAlignment = 1
      $t.Rows.Alignment = 1
      $t.Range.ListFormat.RemoveNumbers()   # εξίσωση μέσα σε στοιχείο λίστας: χωρίς δική της κουκκίδα
      $eqTables++
    }
  }

  Write-Step "πίνακες εξισώσεων: $eqTables"
  # Εξώφυλλο: αλλαγή ενότητας μετά την ημερομηνία
  $find = {
    param($text)
    foreach ($p in $doc.Paragraphs) { if ($p.Range.Text.Trim() -eq $text) { return $p } }
    throw "δεν βρέθηκε: $text"
  }
  $datePar = & $find 'Πάτρα, Νοέμβριος 2026'
  $r = $datePar.Range; $r.Collapse(0); $r.InsertBreak(2)   # αλλαγή ενότητας, νέα σελίδα

  # Πλαίσιο μόνο στη σελίδα του εξωφύλλου (1η ενότητα)
  # (όχι Borders.Enable: στο Word ισχύει για όλες τις ενότητες και βάζει πλαίσιο και στο κείμενο)
  $b = $doc.Sections.Item(1).Borders
  $b.DistanceFrom = 0
  $b.DistanceFromTop = 24; $b.DistanceFromBottom = 24; $b.DistanceFromLeft = 24; $b.DistanceFromRight = 24
  foreach ($k in -1, -2, -3, -4) { $e = $b.Item($k); $e.LineStyle = 1; $e.LineWidth = 6; $e.Color = 0 }

  Write-Step 'εξώφυλλο'
  # Αρίθμηση σελίδων: καμία στο εξώφυλλο, από 1 στο κείμενο, στο κέντρο του υποσέλιδου
  $ft = $doc.Sections.Item(2).Footers.Item(1)
  $ft.LinkToPrevious = $false
  $ft.PageNumbers.RestartNumberingAtSection = $true
  $ft.PageNumbers.StartingNumber = 1
  $null = $ft.PageNumbers.Add(1, $true)
  $doc.Sections.Item(1).Footers.Item(1).Range.Text = ''

  # Ιδιότητες εγγράφου
  $bf = [System.Reflection.BindingFlags]
  $props = $doc.BuiltInDocumentProperties
  foreach ($kv in @(@('Title', 'CONS_3D: Εγχειρίδιο χρήσης και θεωρία'), @('Author', 'Παναγιώτης Πελέκης'))) {
    $prop = [System.__ComObject].InvokeMember('Item', $bf::GetProperty, $null, $props, @($kv[0]))
    [void][System.__ComObject].InvokeMember('Value', $bf::SetProperty, $null, $prop, @($kv[1]))
  }

  Write-Step 'ιδιότητες'

  # Το περιεχόμενο βγαίνει ως XML (Flat OPC) αντί για SaveAs2/ExportAsFixedFormat, που κολλάνε
  # σε αυτόματο Word σε αυτόν τον υπολογιστή· το .docx το συναρμολογεί το flat2docx.py.
  [IO.File]::WriteAllText($flat, $doc.WordOpenXML, (New-Object Text.UTF8Encoding($false)))
  Write-Step 'XML εγγράφου'

  # Εικόνες σελίδων για οπτικό έλεγχο, απευθείας από τη διάταξη εκτύπωσης του Word
  if ($Preview -gt 0) {
    Add-Type -AssemblyName System.Drawing
    $pages = $doc.ActiveWindow.Panes.Item(1).Pages
    $n = [Math]::Min($Preview, $pages.Count)
    for ($i = 1; $i -le $n; $i++) {
      $ms = New-Object IO.MemoryStream(, [byte[]]$pages.Item($i).EnhMetaFileBits)
      $mf = New-Object Drawing.Imaging.Metafile($ms)
      $bmp = New-Object Drawing.Bitmap(827, 1169)
      $g = [Drawing.Graphics]::FromImage($bmp); $g.Clear([Drawing.Color]::White)
      $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
      $g.DrawImage($mf, 0, 0, 827, 1169)
      $bmp.Save((Join-Path $Dir ('page{0:D2}.png' -f $i)), [Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose(); $mf.Dispose(); $ms.Dispose()
    }
    Write-Step "εικόνες σελίδων: $n"
  }
  "σελίδες: {0} · εξισώσεις Word: {1} · πίνακες εξισώσεων: {2} · εικόνες: {3} · σύνδεσμοι εικόνων που έμειναν: {4}" -f $doc.ComputeStatistics(2), $doc.OMaths.Count, $eqTables, $doc.InlineShapes.Count, (@($doc.InlineShapes) | Where-Object { $_.LinkFormat }).Count
  $doc.Close($false)
} finally {
  $word.Quit([ref]0)   # χωρίς αποθήκευση αλλαγών, για να μη μείνει ανοιχτό σε σφάλμα
}

# Συναρμολόγηση του .docx έξω από το Word
& python (Join-Path $PSScriptRoot 'flat2docx.py') $flat $docx
if ($LASTEXITCODE -ne 0) { throw 'αποτυχία συναρμολόγησης .docx' }
