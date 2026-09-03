# SQLite infrastructure boundary

`sqlite-file.cjs` is intentionally independent of the pet overlay domain.
It owns only SQLite file opening, WAL/foreign-key pragmas, migration history,
transactions, and corrupt-file quarantine.

Feature-specific schema and SQL belong in a repository such as
`../persistence/pet-growth-repository.cjs`. A future `@pet/core` database
package can move this directory without importing React, Electron UI code, or
pet tables.
