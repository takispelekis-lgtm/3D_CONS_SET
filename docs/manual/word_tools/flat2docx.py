# Μετατροπή του «επίπεδου» XML του Word (Document.WordOpenXML, μορφή Flat OPC) σε αρχείο .docx.
# Χρειάζεται επειδή η αποθήκευση μέσω Word (SaveAs2, ExportAsFixedFormat) κολλάει σε αυτόν τον
# υπολογιστή όταν το Word τρέχει αυτόματα (πιθανότατα λόγω του πρόσθετου PDFMaker του Acrobat).
# Το XML κάθε τμήματος αντιγράφεται αυτούσιο, ώστε να μείνουν ανέπαφα τα προθέματα χώρων ονομάτων.
# Χρήση: python flat2docx.py <flat.xml> <out.docx>
import base64
import re
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
flat = open(src, encoding='utf-8').read()

decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
parts = []
for m in re.finditer(r'<pkg:part ([^>]*)>(.*?)</pkg:part>', flat, re.S):
    attrs = dict(re.findall(r'pkg:(\w+)="([^"]*)"', m.group(1)))
    body = m.group(2)
    x = re.fullmatch(r'\s*<pkg:xmlData>(.*)</pkg:xmlData>\s*', body, re.S)
    if x:
        data = (decl + x.group(1)).encode('utf-8')
    else:
        b = re.fullmatch(r'\s*<pkg:binaryData>(.*)</pkg:binaryData>\s*', body, re.S)
        if not b:
            raise SystemExit(f'άγνωστο περιεχόμενο τμήματος {attrs.get("name")}')
        data = base64.b64decode(re.sub(r'\s+', '', b.group(1)))
    parts.append((attrs['name'], attrs['contentType'], data))

if not any(n == '/word/document.xml' for n, _, _ in parts):
    raise SystemExit('λείπει το /word/document.xml')

ct = ['<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>']
ct += [f'<Override PartName="{n}" ContentType="{c}"/>' for n, c, _ in parts if not n.endswith('.rels')]
ct.append('</Types>')

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', decl + ''.join(ct))
    for n, _, data in parts:
        z.writestr(n.lstrip('/'), data)

print(f'docx: {out} · τμήματα {len(parts)} · εικόνες {sum(1 for n, _, _ in parts if "/media/" in n)}')
