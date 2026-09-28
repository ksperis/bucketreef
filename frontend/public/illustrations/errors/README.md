# Error illustrations

Three images generated for BucketReef from the selected blue-octopus error-page
concept: `lost.webp` (navigation), `access.webp` (identity/permissions) and
`connection.webp` (availability). Each is 900 × 720 with transparency and served
locally. They contain no interface text, credentials or user data.

`components/errors/errorCopy.ts` maps states to illustrations; `errorState.css`
adapts their layout and dark-theme brightness. Keep them decorative (`alt=""`)
and preserve aspect ratio. Theme colors and error meaning belong to the HTML,
not text embedded in an image.
