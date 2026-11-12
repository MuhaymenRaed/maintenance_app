const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

/**
 * Packaging only. `electron-vite build` has already produced `out/` — main,
 * preload and renderer, every renderer dependency bundled — so the package is
 * `out/`, `package.json` and the one runtime dependency the main process keeps
 * external (@supabase/supabase-js). Nothing else from the project goes in.
 *
 * The print agent travels beside the app as a plain folder
 * (`resources/print-agent`), because PowerShell has to read it from disk.
 */
const KEEP = [/^\/out(\/|$)/, /^\/package\.json$/, /^\/node_modules(\/|$)/];

module.exports = {
  // ⚠️ Not Forge's default `out/`: electron-vite builds the app itself into
  // `out/main`, `out/preload` and `out/renderer`, and the package takes `out/`
  // whole (`KEEP` below) — so a package written there would ship the previous
  // package inside the next one.
  outDir: path.join(__dirname, "release"),
  packagerConfig: {
    asar: true,
    executableName: 'al-esnad-maintenance',
    appBundleId: 'iq.alisnad.maintenance',
    icon: path.join(__dirname, 'resources', 'icon'),
    extraResource: [
      path.join(__dirname, 'resources', 'print-agent'),
      path.join(__dirname, 'resources', 'icon.png'),
    ],
    ignore: (file) => {
      if (!file) return false;
      return !KEEP.some((pattern) => pattern.test(file.replace(/\\/g, '/')));
    },
  },
  rebuildConfig: {},
  hooks: {
    /**
     * Chromium ships its own interface strings in ~55 languages (49MB); the
     * desk speaks two. Kept: Arabic, and both Englishes — `en-US` is what
     * Chromium falls back to for any language it does not find, so removing it
     * would leave a French Windows with no strings at all.
     */
    postPackage: async (_config, { outputPaths }) => {
      const keep = new Set(["ar.pak", "en-US.pak", "en-GB.pak"]);
      for (const output of outputPaths) {
        const locales = path.join(output, "locales");
        if (!fs.existsSync(locales)) continue;
        for (const file of fs.readdirSync(locales)) {
          if (file.endsWith(".pak") && !keep.has(file)) fs.rmSync(path.join(locales, file));
        }
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'al_esnad_maintenance',
        setupIcon: path.join(__dirname, 'resources', 'icon.ico'),
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
