# Fe Web CAP / CSP integration

This is the reviewed Fe Web port of LastStudio's CAP adapter, pinned to the actual
installed `cap-widget@0.1.57`. Only the transport of the unchanged server-generated
instrumentation script changes: it runs in an opaque-origin `allow-scripts` iframe
with a separate policy, never in a srcdoc inheriting the parent's no-eval policy.
PoW, server checks, token policy and automatic-completion permissions are unchanged.

Solver assets are pinned and served from this site, not a third-party CDN. Their
licenses are included alongside them. SHA-256:

- `cap_wasm-0.0.7.wasm`: `e4f3c00246a775193661f9277ca1288cd310a6514de166ecc2176ccd26fb06a9`
- `pako_inflate-2.1.0.min.js`: `fa226c8e1e3556993260e6a5c1fe94e225da59b3418a06811fdc51d308f8bb43`

## Required deployment configuration

Deploy the built assets and the CSP/HTML configuration together. This site must
include `deploy/cap-html.conf` at server level to replace `__LASTUDIO_CAP_NONCE__`
with Nginx's random `$request_id`. The parent policy in `security-fe-web.conf`
authorizes only this style nonce and the narrow WASM/worker permissions, not JS eval.
The same nonce is registered with `get-nonce` for the real Dialog's scroll-lock
stylesheet, so the dialog itself also remains CSP-compliant.

The exact `/cap-assets/instrumentation-v1.html` location uses the separate policy
in `security-cap-sandbox.conf`, `Cache-Control: no-store`, `etag off`, and
`if_modified_since off`. It must allow same-origin framing, not inherit X-Frame-Options
DENY. SPA HTML/callbacks also need no-store and disabled conditional 304 responses.
The iframe retains only `allow-scripts`, not `allow-same-origin`; do not weaken this.

`CapVerification` keeps the raw widget hidden until computed styles are verified.
Missing/mismatched nonces fail closed with an error rather than exposing a giant SVG
or emitting a verification token. `npm run test:cap-csp` exercises the real component
inside the real Dialog, both themes, mobile/desktop, legacy decompression, and both
missing/wrong-nonce failure cases. All challenge/redeem fixtures are local: no
student account is logged in and no actual homework task is started.
