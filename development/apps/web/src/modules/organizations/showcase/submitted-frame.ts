const sandbox =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation';

const bundledEntry =
  /^(?:\.\/|\/development\/)organization-showcase\/sites\/(?:research|creative|audiovisual|sail|humanities|hardware|software|liaison)\/index\.html$/;

export function submittedFrameSandbox(offline: boolean, protocol: string, entry: string): string {
  // An opaque file frame cannot load its sibling styles, scripts or images.
  // Only the shipped local-file viewer can retain the bundled document's origin;
  // website previews and uploaded documents keep their existing isolation.
  return offline && protocol === 'file:' && bundledEntry.test(entry)
    ? `${sandbox} allow-same-origin`
    : sandbox;
}
