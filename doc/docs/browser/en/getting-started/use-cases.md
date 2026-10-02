# Browser Use Cases

## Explore an S3 bucket

Select a context and bucket, then navigate prefixes without changing the storage
identity. Use search and listing options appropriate to the Browser profile.

## Transfer files

Upload and download objects while the Browser tracks progress for the current
session. Direct transfers use bucket CORS; configured proxy transfers provide an
alternative path when available.

## Reorganize objects

Use copy, cut, and paste to move or duplicate exact S3 keys. Review the
destination before applying a cross-context transfer.

## Work with many objects

Use selections and the Operations view for multi-object actions. Selection
covers loaded items; folder content is enumerated when an operation needs it.

## Recover versioned data

When the bucket keeps versions, inspect historical versions and delete markers,
then download or restore the required state when your S3 permissions allow it.

## Return to frequent paths

Save personal path favorites in standalone Browser. Favorites preserve the
exact storage context and location; they do not save search, sorting, or column
state.

## Related pages

- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Feature availability](../help/feature-availability.md)
