// expo-widgets has no option for the picker preview, so this adds android:previewImage to the
// widget info XML it generates. Runs as a finalized mod, after expo-widgets has written its files.
// Previews come from scripts/make-widget-previews.py.
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

/** @param {{ previews: Record<string, string> }} options widget resource name -> PNG path */
module.exports = function withWidgetPreviews(config, { previews }) {
  return withFinalizedMod(config, [
    'android',
    (config) => {
      const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
      const drawables = path.join(res, 'drawable-nodpi');
      fs.mkdirSync(drawables, { recursive: true });

      for (const [name, image] of Object.entries(previews)) {
        const infoPath = path.join(res, 'xml', `${name}_info.xml`);
        if (!fs.existsSync(infoPath)) throw new Error(`with-widget-previews: no widget info at ${infoPath}`);
        const drawable = `widget_preview_${name}`;
        fs.copyFileSync(path.join(config.modRequest.projectRoot, image), path.join(drawables, `${drawable}.png`));

        const xml = fs.readFileSync(infoPath, 'utf8');
        if (!xml.includes('android:previewImage')) {
          fs.writeFileSync(
            infoPath,
            xml.replace('<appwidget-provider ', `<appwidget-provider android:previewImage="@drawable/${drawable}" `)
          );
        }
      }
      return config;
    },
  ]);
};
