'use strict';
// Windows branding of the prebuilt launcher (ADR-0005): icon, version information and the
// application manifest, edited with resedit so it works from any build host.

const fs = require('fs');

const LANG_EN_US = 1033;
const CODEPAGE_UNICODE = 1200;
const RT_MANIFEST = 24;
const VOS_NT_WINDOWS32 = 0x40004;
const VFT_APP = 1;

/** "1.2.3" → [1, 2, 3, 0] (Windows version resources have four 16-bit parts). */
function versionParts(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length > 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 65535)) throw new Error(`version "${version}" does not fit a Windows version resource`);
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** Adds per-monitor DPI awareness to an application manifest. */
function withDpiAwareness(xml) {
  if (/dpiAwareness/.test(xml)) return xml;
  const settings = '<dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>'
    + '<dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>';
  if (!/<\/windowsSettings>/.test(xml)) throw new Error('the launcher manifest has no windowsSettings element');
  return xml.replace('</windowsSettings>', `${settings}\n    </windowsSettings>`);
}

/**
 * Brands a launcher executable in place.
 * @param {string} file
 * @param {{name: string, version: string, exeName: string, company?: string, copyright?: string,
 *          description?: string, ico?: Buffer|null, dpiAware?: boolean}} o
 */
async function brandExe(file, o) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(await fs.promises.readFile(file));
  const res = ResEdit.NtExecutableResource.from(exe);

  if (o.ico) {
    const iconFile = ResEdit.Data.IconFile.from(o.ico);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, LANG_EN_US, iconFile.icons.map((i) => i.data));
  }

  for (let i = res.entries.length - 1; i >= 0; i--) if (res.entries[i].type === 16) res.entries.splice(i, 1); // RT_VERSION
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.lang = LANG_EN_US;
  vi.fixedInfo.fileOS = VOS_NT_WINDOWS32;
  vi.fixedInfo.fileType = VFT_APP;
  const [a, b, c, d] = versionParts(o.version);
  vi.setFileVersion(a, b, c, d, LANG_EN_US);
  vi.setProductVersion(a, b, c, d, LANG_EN_US);
  const strings = {
    ProductName: o.name,
    FileDescription: o.description || o.name,
    FileVersion: o.version,
    ProductVersion: o.version,
    InternalName: o.name,
    OriginalFilename: o.exeName,
    CompanyName: o.company,
    LegalCopyright: o.copyright,
    Comments: 'Built with dropring-pack',
  };
  vi.setStringValues({ lang: LANG_EN_US, codepage: CODEPAGE_UNICODE }, Object.fromEntries(Object.entries(strings).filter(([, v]) => v)));
  vi.outputToResourceEntries(res.entries);

  if (o.dpiAware) {
    const entry = res.entries.find((e) => e.type === RT_MANIFEST);
    if (!entry) throw new Error('the launcher has no application manifest to extend');
    const xml = Buffer.from(entry.bin).toString('utf8');
    entry.bin = new Uint8Array(Buffer.from(withDpiAwareness(xml), 'utf8')).buffer;
  }

  res.outputResource(exe);
  await fs.promises.writeFile(file, Buffer.from(exe.generate()));
}

/** Reads back what brandExe wrote (used by tests and `inspect`). */
async function readBranding(file) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(await fs.promises.readFile(file));
  const res = ResEdit.NtExecutableResource.from(exe);
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const strings = vi ? vi.getStringValues({ lang: LANG_EN_US, codepage: CODEPAGE_UNICODE }) : {};
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const manifest = res.entries.find((e) => e.type === RT_MANIFEST);
  return {
    strings,
    iconSizes: groups.length ? groups[0].icons.map((i) => i.width || 256) : [],
    manifest: manifest ? Buffer.from(manifest.bin).toString('utf8') : null,
  };
}

module.exports = { brandExe, readBranding, versionParts, withDpiAwareness };
