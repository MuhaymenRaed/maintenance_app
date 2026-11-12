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
