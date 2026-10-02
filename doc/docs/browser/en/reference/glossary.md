# Browser Glossary

| Term | Meaning in Browser |
|---|---|
| Context | The storage identity selected in standalone Browser, such as an eligible private connection or Portal project context. |
| Bucket | S3 container that holds objects. |
| Prefix / folder | Browser presentation of an S3 key prefix. S3 itself stores object keys rather than real directories. |
| Object | S3 item stored under an exact key. Browser often presents file-like objects as files. |
| Version | Historical state of an object when bucket versioning is enabled. |
| Delete marker | Versioning record that makes an object appear deleted without removing earlier versions. |
| Operation | Upload, download, copy, move, delete, ZIP, or other object work tracked in the current Browser session. |
| Direct transfer | Browser-to-S3 transfer that requires compatible bucket CORS settings. |
| Proxy transfer | Transfer relayed by BucketReef when that path is enabled and appropriate. |
| CORS | Bucket rules that allow the web Browser origin to make direct S3 requests. |
| Favorite | Personal saved Browser path for a specific storage context. |
| `AccessDenied` | S3 authorization failure from the credentials of the selected context. |

## Related pages

- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Troubleshooting](../help/troubleshooting.md)
