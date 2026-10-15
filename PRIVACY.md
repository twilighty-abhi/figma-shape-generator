# Shape Maker — Privacy

Shape Maker runs entirely inside Figma.

- It makes **no network requests** (`networkAccess` is set to `none` in the manifest).
- It collects **no analytics, telemetry or personal data**.
- It saves your custom color palette locally with Figma's `clientStorage` on your device.
- It saves each generated shape's settings (shape type, slider values, colors) as plugin data on that layer, inside your own file, so you can re-edit the shape later. That data stays in the document and is never sent anywhere.
- It reads the file's local paint styles and color variables only to show them as color choices. It never changes them.
- It only changes your document when you insert, edit or scatter shapes, and then only the shapes it generated.
