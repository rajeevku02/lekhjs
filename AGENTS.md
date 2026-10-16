# lekhjs: agent notes

The design of lekhjs lives in the Windy knowledge base, not here. Read it first, over the Windy MCP
(`docs_read`), starting at `/index.md`, then the lekhjs section (`/frontend/lekhjs/`) once it exists.
Until then the design is the spec of Work `01M4X7TCHFB862XGT68GPY071C` ("Porting lekhcore in
typescript"), `spec/01-architecture-and-packaging.md` and the area specs it links.

If the code and the knowledge base disagree, say so; do not silently follow one of them.
Knowledge-base changes go through a changeset, never an in-place edit.

Before you commit, run `npm run check`. It enforces the module ranks, the no-module-state rule and
the "no DOM, no Node" rule described in `README.md`.
