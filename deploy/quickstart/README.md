# BucketReef QuickStart release bundle

Run a published release without cloning or building sources. Requirements:
Bash, Docker Compose v2, OpenSSL and curl; Linux AMD64/ARM64 or Docker Desktop
on macOS. The supported installer verifies the bundle and installs it in
`~/.local/share/bucketreef-quickstart`, with a launcher in `~/.local/bin`:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh | sh
```

For manual extraction, verify `bucketreef-quickstart.tar.gz.sha256` with
`sha256sum -c` or `shasum -a 256 -c`, then run `./bucketreef-quickstart`.
The command always uses the script's directory, regardless of your current one.

```sh
bucketreef-quickstart start
bucketreef-quickstart status
bucketreef-quickstart stop
bucketreef-quickstart version
bucketreef-quickstart reset
```

If `~/.local/bin` is not on PATH, use the full command path. No shell startup
file is edited. Repeat installs and starts preserve the same version and data.
There is no automatic upgrade command.

QuickStart runs backend and frontend with SQLite and loopback ports 8000/8080.
On first start, distinct secrets are generated in `.env.quickstart` (0600).
The first-administrator URL appears only after both services are ready.
Project name: `bucketreef-quickstart`. The scheduler remains disabled.

Reset requires `RESET BUCKETREEF QUICKSTART`, stops the project, saves the
environment and complete SQLite directory, verifies the archive, then removes
only the identified backend volume and creates new keys. Backups remain in
`.bucketreef-backups` with restrictive permissions.

An existing volume without its matching environment blocks startup before
secret generation. Never pair existing data with newly generated keys.
See the [QuickStart guide](https://docs.bucketreef.ksperis.com/ops/quickstart/)
for ports, installation without starting, migration and manual upgrades.
