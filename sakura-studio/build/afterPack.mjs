// Setzt Icon und Versionsinfos der EXE (ohne Wine) mit resedit
import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';
import fs from 'fs';
import path from 'path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const pe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(pe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(context.packager.info.buildResourcesDir, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const ids = groups.length ? groups.map((g) => [g.id, g.lang]) : [[1, 1033]];
  for (const [id, lang] of ids) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map((i) => i.data));
  }
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  for (const v of vi) {
    const lang = { lang: 1033, codepage: 1200 };
    v.setStringValues(lang, { FileDescription: 'Sakura Studio', ProductName: 'Sakura Studio', CompanyName: 'Sakura Studio', LegalCopyright: '© 2026 Sakura Studio', OriginalFilename: 'Sakura Studio.exe', InternalName: 'Sakura Studio' });
    v.setFileVersion(1, 0, 0, 0, 1033); v.setProductVersion(1, 0, 0, 0, 1033);
    v.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • Icon & Versionsinfo gesetzt:', exe);
}
