# Nightjar patches to Odysseus

`research/odysseus` is a **git submodule** pinned to an exact upstream commit of
[pewdiepie-archdaemon/odysseus](https://github.com/pewdiepie-archdaemon/odysseus)
(so its AGPL source is available alongside Nightjar, and a fresh clone can fetch
it with `git submodule update --init`). The submodule is kept **clean** — it
points at the unmodified upstream commit.

Nightjar's two small, integration-only changes to Odysseus live here as a patch,
applied on top of the pinned submodule by `scripts/setup.sh` (or manually with
`git -C research/odysseus apply phase2-odysseus/odysseus-patches/nightjar-odysseus.patch`):

- **`src/chroma_client.py`** — embedded / local-only ChromaDB. When
  `CHROMADB_PERSIST_DIR` is set, use an on-disk `PersistentClient` instead of the
  client-server `HttpClient`, so Nightjar needs **no docker ChromaDB service**
  ("runs on any laptop"). Backward-compatible: upstream behavior is unchanged when
  the env var is absent.
- **`services/docs/service.py`** — read the RAG chunk text from the `document`
  key the search backend actually returns (one-line fallback fix).

Keeping these as a patch (rather than committing them into the submodule) means
the submodule stays a faithful mirror of upstream — the AGPL source is exactly
what upstream published, and Nightjar's modifications are explicit and reviewable
right here.
